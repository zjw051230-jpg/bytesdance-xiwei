const { CompactSummarizer } = require("../compactSummarizer");

function createSummarizer() {
  return new CompactSummarizer({
    idGenerator: (prefix) => `${prefix}_001`,
  });
}

function expectSummaryArtifact(artifact) {
  expect(artifact).toMatchObject({
    summary_id: expect.any(String),
    source_artifact_ref: expect.any(String),
    source_artifact_hash: expect.stringMatching(/^sha256:/),
    summarizer_type: "rule_based",
    summarizer_version: expect.any(String),
    output_hash: expect.stringMatching(/^sha256:/),
    value: expect.any(Object),
  });
}

describe("CompactSummarizer", () => {
  test("compressPlan outputs a SummaryArtifact", () => {
    const artifact = createSummarizer().compressPlan({
      id: "plan_001",
      steps: ["Update Article page"],
      target_files: ["Article.jsx"],
      risks: ["render regression"],
      verification_plan: ["npm test"],
    });

    expectSummaryArtifact(artifact);
    expect(artifact.value).toMatchObject({
      steps: ["Update Article page"],
      target_files: ["Article.jsx"],
      risks: ["render regression"],
      verification_plan: ["npm test"],
    });
  });

  test("compressPatch outputs a SummaryArtifact without full diff", () => {
    const artifact = createSummarizer().compressPatch({
      id: "patch_001",
      changed_files: ["Article.jsx"],
      added_symbols: ["wordCount"],
      removed_symbols: [],
      modified_functions: ["Article"],
      patch_intent: "Show word count",
      risk_flags: ["frontend-only"],
      diff: "FULL_PATCH_DIFF_SHOULD_NOT_APPEAR",
      full_patch_diff: "ANOTHER_FULL_DIFF",
    });

    expectSummaryArtifact(artifact);
    expect(JSON.stringify(artifact)).not.toContain("FULL_PATCH_DIFF_SHOULD_NOT_APPEAR");
    expect(JSON.stringify(artifact)).not.toContain("ANOTHER_FULL_DIFF");
  });

  test("compressSandboxResult outputs a SummaryArtifact without full sandbox log", () => {
    const artifact = createSummarizer().compressSandboxResult({
      id: "sandbox_001",
      failed_command: "npm test",
      exit_code: 1,
      error_type: "ReferenceError",
      top_stack_lines: ["ReferenceError: wordCount is not defined"],
      likely_cause: "Variable scope",
      affected_files: ["Article.jsx"],
      log: "FULL_SANDBOX_LOG_SHOULD_NOT_APPEAR",
      stderr: "RAW_STDERR_SHOULD_NOT_APPEAR",
    });

    expectSummaryArtifact(artifact);
    expect(JSON.stringify(artifact)).not.toContain("FULL_SANDBOX_LOG_SHOULD_NOT_APPEAR");
    expect(JSON.stringify(artifact)).not.toContain("RAW_STDERR_SHOULD_NOT_APPEAR");
  });

  test("compressRepair outputs a SummaryArtifact", () => {
    const artifact = createSummarizer().compressRepair({
      id: "repair_001",
      repair_intent: "Fix variable scope",
      changed_files: ["Article.jsx"],
      fixed_error_type: "ReferenceError",
      remaining_risks: ["rerun frontend tests"],
    });

    expectSummaryArtifact(artifact);
    expect(artifact.value).toMatchObject({
      repair_intent: "Fix variable scope",
      changed_files: ["Article.jsx"],
      fixed_error_type: "ReferenceError",
      remaining_risks: ["rerun frontend tests"],
    });
  });

  test("generates stable hashes for equivalent input regardless of key order", () => {
    const summarizer = createSummarizer();
    const first = summarizer.compressPlan({
      id: "plan_001",
      steps: ["A"],
      target_files: ["Article.jsx"],
    });
    const second = summarizer.compressPlan({
      target_files: ["Article.jsx"],
      steps: ["A"],
      id: "plan_001",
    });

    expect(first.source_artifact_hash).toBe(second.source_artifact_hash);
    expect(first.output_hash).toBe(second.output_hash);
  });

  test("buildDependencySummary summarizes dependency chain with source node ids", () => {
    const traceView = {
      nodes: [
        { id: "dsl_001", type: "final_dsl", summary: "在文章详情页显示字数统计", metadata: { payload: "ignored" } },
        { id: "plan_001", type: "plan", summary: "只修改前端文章详情页展示逻辑", metadata: { fullPlan: "ignored" } },
        { id: "patch_001", type: "patch", summary: "新增 wordCount 计算和 UI 展示", metadata: { diff: "FULL_DIFF_SHOULD_NOT_APPEAR" } },
        {
          id: "sandbox_001",
          type: "sandbox_result",
          summary: "ReferenceError: wordCount is not defined",
          metadata: {
            likely_cause: "Repair should inspect variable scope",
            log: "FULL_LOG_SHOULD_NOT_APPEAR",
          },
        },
      ],
      edges: [
        { id: "edge_plan_dsl", from_node_id: "plan_001", to_node_id: "dsl_001", relation: "depends_on" },
        { id: "edge_patch_plan", from_node_id: "patch_001", to_node_id: "plan_001", relation: "depends_on" },
        { id: "edge_sandbox_patch", from_node_id: "sandbox_001", to_node_id: "patch_001", relation: "depends_on" },
      ],
    };

    const artifact = createSummarizer().buildDependencySummary({
      taskId: "task_001",
      targetNodeId: "sandbox_001",
      traceView,
    });

    expectSummaryArtifact(artifact);
    expect(artifact.value).toMatchObject({
      requirement: "在文章详情页显示字数统计",
      plan: "只修改前端文章详情页展示逻辑",
      patch: "新增 wordCount 计算和 UI 展示",
      failure: "ReferenceError: wordCount is not defined",
      next_action_hint: "Repair should inspect variable scope",
      source_node_ids: ["sandbox_001", "patch_001", "plan_001", "dsl_001"],
    });
    expect(JSON.stringify(artifact)).not.toContain("FULL_DIFF_SHOULD_NOT_APPEAR");
    expect(JSON.stringify(artifact)).not.toContain("FULL_LOG_SHOULD_NOT_APPEAR");
    expect(JSON.stringify(artifact)).not.toContain("ignored");
  });

  test("buildDependencySummary hashes are stable for the same trace view", () => {
    const summarizer = createSummarizer();
    const traceView = {
      nodes: [
        { id: "plan_001", type: "plan", summary: "Plan", metadata: { rank: 1 } },
        { id: "patch_001", type: "patch", summary: "Patch", metadata: { rank: 2 } },
      ],
      edges: [
        { id: "edge_patch_plan", from_node_id: "patch_001", to_node_id: "plan_001", relation: "depends_on" },
      ],
    };

    const first = summarizer.buildDependencySummary({ taskId: "task_001", targetNodeId: "patch_001", traceView });
    const second = summarizer.buildDependencySummary({ taskId: "task_001", targetNodeId: "patch_001", traceView });

    expect(first.source_artifact_hash).toBe(second.source_artifact_hash);
    expect(first.output_hash).toBe(second.output_hash);
  });
});
