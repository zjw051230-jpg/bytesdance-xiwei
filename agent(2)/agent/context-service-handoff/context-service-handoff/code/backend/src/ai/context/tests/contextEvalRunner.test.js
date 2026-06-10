const { ContextEvalRunner } = require("../contextEvalRunner");

function createAgentContext(overrides = {}) {
  return {
    task_id: "task-1",
    agent_name: "repairAgent",
    current_node_id: "sandbox_001",
    source_node_ids: ["sandbox_001", "patch_001", "plan_001", "dsl_001"],
    source_event_ids: ["evt_1", "evt_2"],
    budget_report: { before_chars: 100, after_chars: 80, truncated_fields: [], removed_fields: [] },
    privacy_report: { redacted: false, redacted_field_count: 0, redacted_paths: [], sensitive_patterns_found: [] },
    context: {
      final_dsl_core: {
        value: [{ summary: "frontend_only no_backend_change" }],
        source_node_ids: ["dsl_001"],
      },
      dependency_summary: {
        value: {
          requirement: "在文章详情页显示字数统计",
          plan: "只修改前端文章详情页展示逻辑",
          patch: "新增 wordCount 计算和 UI 展示",
          failure: "ReferenceError: wordCount is not defined",
          source_node_ids: ["sandbox_001", "patch_001", "plan_001", "dsl_001"],
        },
        source_node_ids: ["sandbox_001", "patch_001", "plan_001", "dsl_001"],
      },
      active_constraints: {
        value: [{ constraints: ["frontend_only", "no_backend_change"] }],
        source_node_ids: ["dsl_001"],
      },
      sandbox_error_summary: {
        value: [{ summary: "ReferenceError: wordCount is not defined" }],
        source_node_ids: ["sandbox_001"],
      },
    },
    ...overrides,
  };
}

describe("ContextEvalRunner", () => {
  test("dependency_recall is 1 when all expected source nodes are recalled", () => {
    const runner = new ContextEvalRunner();

    expect(runner.calculateDependencyRecall(createAgentContext(), ["dsl_001", "plan_001"])).toBe(1);
  });

  test("dependency_recall is below 1 when expected source nodes are missing", () => {
    const runner = new ContextEvalRunner();

    expect(runner.calculateDependencyRecall(createAgentContext(), ["dsl_001", "missing_001"])).toBe(0.5);
  });

  test("noise_rate is greater than 0 when forbidden source nodes appear", () => {
    const runner = new ContextEvalRunner();

    expect(runner.calculateNoiseRate(createAgentContext(), ["patch_001"])).toBeGreaterThan(0);
  });

  test("constraint_recall is 1 when expected constraints appear in context", () => {
    const runner = new ContextEvalRunner();

    expect(runner.calculateConstraintRecall(createAgentContext(), ["frontend_only", "no_backend_change"])).toBe(1);
  });

  test("constraint_recall is below 1 when an expected constraint is missing", () => {
    const runner = new ContextEvalRunner();

    expect(runner.calculateConstraintRecall(createAgentContext(), ["frontend_only", "must_update_backend"])).toBe(0.5);
  });

  test("source_attribution_accuracy is 1 when attribution source ids cover expected nodes", () => {
    const runner = new ContextEvalRunner();

    expect(runner.calculateSourceAttributionAccuracy(createAgentContext(), [
      {
        context_path: "context.dependency_summary",
        expected_source_nodes: ["sandbox_001", "patch_001", "plan_001", "dsl_001"],
      },
    ])).toBe(1);
  });

  test("source_attribution_accuracy is below 1 when source_node_ids are missing", () => {
    const runner = new ContextEvalRunner();

    expect(runner.calculateSourceAttributionAccuracy(createAgentContext(), [
      {
        context_path: "context.sandbox_error_summary",
        expected_source_nodes: ["sandbox_001", "patch_001"],
      },
    ])).toBe(0);
  });

  test("runContextEvalCase fails with concrete reasons when metrics miss thresholds", () => {
    const runner = new ContextEvalRunner();

    const result = runner.runContextEvalCase({
      context: createAgentContext(),
      expected_source_nodes: ["dsl_001", "missing_001"],
      forbidden_source_nodes: ["patch_001"],
      expected_constraints: ["must_update_backend"],
      expected_attributions: [
        { context_path: "context.sandbox_error_summary", expected_source_nodes: ["patch_001"] },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.failed_reasons.join("\n")).toContain("dependency_recall");
    expect(result.failed_reasons.join("\n")).toContain("noise_rate");
    expect(result.failed_reasons.join("\n")).toContain("constraint_recall");
    expect(result.failed_reasons.join("\n")).toContain("source_attribution_accuracy");
  });

  test("privacy_leakage=true makes the eval case fail", () => {
    const runner = new ContextEvalRunner();
    const leakedContext = createAgentContext({
      context: {
        dependency_summary: { value: "Bearer leaked.token", source_node_ids: ["dsl_001"] },
      },
      source_node_ids: ["dsl_001"],
    });

    const result = runner.runContextEvalCase({
      context: leakedContext,
      expected_source_nodes: ["dsl_001"],
    });

    expect(result.metrics.privacy_leakage).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.failed_reasons.join("\n")).toContain("privacy_leakage");
  });

  test("replay_accuracy is a stable boolean for direct context eval", () => {
    const runner = new ContextEvalRunner();

    const result = runner.runContextEvalCase({
      context: createAgentContext(),
      expected_source_nodes: ["dsl_001"],
    });

    expect(result.metrics.replay_accuracy).toBe(true);
  });

  test("runContextEvalCase can build context through an injected AgentContextBuilder", () => {
    const agentContextBuilder = {
      buildContextForAgent: () => createAgentContext(),
    };
    const runner = new ContextEvalRunner({ agentContextBuilder });

    const result = runner.runContextEvalCase({
      task_id: "task-1",
      target_agent: "repairAgent",
      current_node_id: "sandbox_001",
      expected_source_nodes: ["dsl_001", "plan_001"],
      expected_constraints: ["frontend_only"],
      expected_attributions: [
        { context_path: "context.dependency_summary", expected_source_nodes: ["dsl_001", "plan_001"] },
      ],
    });

    expect(result.passed).toBe(true);
    expect(result.metrics.replay_accuracy).toBe(true);
  });

  test("runContextEvalSuite summarizes multiple cases", () => {
    const runner = new ContextEvalRunner();

    const suite = runner.runContextEvalSuite([
      {
        context: createAgentContext(),
        expected_source_nodes: ["dsl_001"],
        expected_constraints: ["frontend_only"],
      },
      {
        context: createAgentContext({
          context: {
            dependency_summary: { value: "sk-leakedtoken", source_node_ids: ["old_plan_001"] },
          },
          source_node_ids: ["old_plan_001"],
        }),
        expected_source_nodes: ["dsl_001"],
        forbidden_source_nodes: ["old_plan_001"],
      },
    ]);

    expect(suite.passed).toBe(false);
    expect(suite.case_results).toHaveLength(2);
    expect(suite.summary).toMatchObject({
      total: 2,
      passed: 1,
      failed: 1,
      privacy_leakage_count: 1,
    });
    expect(suite.summary.average_dependency_recall).toBeLessThan(1);
    expect(suite.summary.average_noise_rate).toBeGreaterThan(0);
  });

  test("calculateContextQualityReport maps metrics into quality dimensions", () => {
    const runner = new ContextEvalRunner();

    const report = runner.calculateContextQualityReport({
      dependency_recall: 1,
      noise_rate: 0,
      source_attribution_accuracy: 1,
    }, {
      context: createAgentContext().context,
      budget_report: { after_chars: 50 },
      max_chars: 100,
    });

    expect(report).toEqual({
      relevance: 1,
      sufficiency: 1,
      isolation: 1,
      economy: 1,
      provenance: 1,
      overall_score: 1,
    });
  });

  test("calculateContextQualityReport lowers economy when context is over budget", () => {
    const runner = new ContextEvalRunner();

    const report = runner.calculateContextQualityReport({
      dependency_recall: 1,
      noise_rate: 0,
      source_attribution_accuracy: 1,
    }, {
      budget_report: { after_chars: 200 },
      max_chars: 100,
    });

    expect(report.economy).toBe(0.5);
  });

  test("calculateContextQualityReport lowers isolation for forbidden raw fields", () => {
    const runner = new ContextEvalRunner();

    const report = runner.calculateContextQualityReport({
      dependency_recall: 1,
      noise_rate: 0,
      source_attribution_accuracy: 1,
    }, {
      context: { full_chat_history: ["raw"] },
    });

    expect(report.isolation).toBeLessThan(1);
  });

  test("calculateContextQualityReport uses stable weighted overall score", () => {
    const runner = new ContextEvalRunner();

    const report = runner.calculateContextQualityReport({
      dependency_recall: 0.5,
      noise_rate: 0.25,
      source_attribution_accuracy: 0.75,
    }, {
      isolation_score: 0.5,
      budget_report: { after_chars: 200 },
      max_chars: 100,
    });

    expect(report).toMatchObject({
      relevance: 0.75,
      sufficiency: 0.5,
      isolation: 0.5,
      economy: 0.5,
      provenance: 0.75,
      overall_score: 0.6,
    });
  });

  test("calculateContextQualityReport handles missing metrics without NaN", () => {
    const runner = new ContextEvalRunner();

    const report = runner.calculateContextQualityReport({}, {});

    for (const score of Object.values(report)) {
      expect(Number.isNaN(score)).toBe(false);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});
