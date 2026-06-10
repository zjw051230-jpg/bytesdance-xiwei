const { ContextBenchmark } = require("../contextBenchmark");

function contextWith({ sourceNodeIds, constraints = [], extraContext = {} }) {
  return {
    source_node_ids: sourceNodeIds,
    budget_report: { after_chars: 500 },
    context: {
      dependency_summary: {
        value: { constraints },
        source_node_ids: sourceNodeIds,
      },
      ...extraContext,
    },
  };
}

function benchmarkCase(strategies = ["recent_messages", "global_summary", "dependency_chain"]) {
  return {
    task_id: "task_001",
    current_node_id: "sandbox_001",
    target_agent: "repairAgent",
    strategies,
    expected_source_nodes: ["dsl_001", "plan_001", "patch_001", "sandbox_001"],
    forbidden_source_nodes: ["old_plan_draft_001", "unrelated_tool_result_003"],
    expected_constraints: ["no_backend_change"],
  };
}

function contextsByStrategy() {
  return {
    recent_messages: contextWith({
      sourceNodeIds: ["patch_001", "sandbox_001", "old_plan_draft_001", "unrelated_tool_result_003"],
      constraints: [],
      extraContext: { raw: "recent messages".repeat(20) },
    }),
    global_summary: contextWith({
      sourceNodeIds: ["dsl_001", "plan_001", "old_plan_draft_001"],
      constraints: ["no_backend_change"],
      extraContext: { raw: "global summary".repeat(10) },
    }),
    dependency_chain: contextWith({
      sourceNodeIds: ["dsl_001", "plan_001", "patch_001", "sandbox_001"],
      constraints: ["no_backend_change"],
    }),
  };
}

describe("ContextBenchmark", () => {
  test("benchmarks recent_messages, global_summary, and dependency_chain", () => {
    const benchmark = new ContextBenchmark();

    const result = benchmark.benchmarkContextStrategies(benchmarkCase(), {
      contextsByStrategy: contextsByStrategy(),
      max_chars: 1000,
    });

    expect(Object.keys(result)).toEqual([
      "recent_messages",
      "global_summary",
      "dependency_chain",
      "winner",
    ]);
  });

  test("dependency_chain fixture has better recall and lower noise", () => {
    const benchmark = new ContextBenchmark();

    const result = benchmark.benchmarkContextStrategies(benchmarkCase(), {
      contextsByStrategy: contextsByStrategy(),
      max_chars: 1000,
    });

    expect(result.dependency_chain.dependency_recall).toBeGreaterThan(result.global_summary.dependency_recall);
    expect(result.dependency_chain.noise_rate).toBeLessThan(result.recent_messages.noise_rate);
  });

  test("outputs quality_report for each strategy", () => {
    const benchmark = new ContextBenchmark();

    const result = benchmark.benchmarkContextStrategies(benchmarkCase(), {
      contextsByStrategy: contextsByStrategy(),
      max_chars: 1000,
    });

    expect(result.recent_messages.quality_report).toEqual(expect.objectContaining({ overall_score: expect.any(Number) }));
    expect(result.global_summary.quality_report).toEqual(expect.objectContaining({ overall_score: expect.any(Number) }));
    expect(result.dependency_chain.quality_report).toEqual(expect.objectContaining({ overall_score: expect.any(Number) }));
  });

  test("winner is the strategy with highest overall score", () => {
    const benchmark = new ContextBenchmark();

    const result = benchmark.benchmarkContextStrategies(benchmarkCase(), {
      contextsByStrategy: contextsByStrategy(),
      max_chars: 1000,
    });

    expect(result.winner).toBe("dependency_chain");
  });

  test("winner tie-breaker chooses smaller context size", () => {
    const benchmark = new ContextBenchmark();

    const result = benchmark.benchmarkContextStrategies(benchmarkCase(["recent_messages", "dependency_chain"]), {
      contextsByStrategy: {
        recent_messages: contextWith({
          sourceNodeIds: ["dsl_001", "plan_001", "patch_001", "sandbox_001"],
          constraints: ["no_backend_change"],
          extraContext: { verbose: "x".repeat(1000) },
        }),
        dependency_chain: contextWith({
          sourceNodeIds: ["dsl_001", "plan_001", "patch_001", "sandbox_001"],
          constraints: ["no_backend_change"],
        }),
      },
      max_chars: 10000,
    });

    expect(result.winner).toBe("dependency_chain");
  });

  test("vector_top_k is not supported", () => {
    const benchmark = new ContextBenchmark();

    expect(() => benchmark.benchmarkContextStrategies(benchmarkCase(["vector_top_k"]), {
      contextsByStrategy: { vector_top_k: contextWith({ sourceNodeIds: [], constraints: [] }) },
    })).toThrow(/Unsupported context strategy/);
  });
});
