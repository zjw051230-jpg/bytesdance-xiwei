const { ContextEvalRunner } = require("../contextEvalRunner");
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

function benchmarkFixture() {
  return {
    benchmarkCase: {
      strategies: ["recent_messages", "global_summary", "dependency_chain"],
      expected_source_nodes: ["dsl_001", "plan_001", "patch_001", "sandbox_001"],
      forbidden_source_nodes: ["noise_001", "noise_002"],
      expected_constraints: ["frontend only"],
      expected_attributions: [
        {
          context_path: "context.dependency_summary",
          expected_source_nodes: ["dsl_001", "plan_001", "patch_001", "sandbox_001"],
        },
      ],
    },
    contextsByStrategy: {
      recent_messages: contextWith({
        sourceNodeIds: ["patch_001", "sandbox_001", "noise_001", "noise_002"],
        constraints: [],
        extraContext: { raw_recent: "noisy recent messages" },
      }),
      global_summary: contextWith({
        sourceNodeIds: ["dsl_001", "plan_001"],
        constraints: ["frontend only"],
        extraContext: { compact_summary: "Missing patch and sandbox attribution" },
      }),
      dependency_chain: contextWith({
        sourceNodeIds: ["dsl_001", "plan_001", "patch_001", "sandbox_001"],
        constraints: ["frontend only"],
      }),
    },
  };
}

describe("Context Service quality", () => {
  test("dependency_chain outperforms recent_messages and global_summary on quality fixture", () => {
    const runner = new ContextEvalRunner();
    const benchmark = new ContextBenchmark({ contextEvalRunner: runner });
    const { benchmarkCase, contextsByStrategy } = benchmarkFixture();

    const result = benchmark.benchmarkContextStrategies(benchmarkCase, {
      contextsByStrategy,
      max_chars: 2000,
    });

    expect(result.dependency_chain.dependency_recall).toBeGreaterThanOrEqual(result.recent_messages.dependency_recall);
    expect(result.dependency_chain.noise_rate).toBeLessThanOrEqual(result.recent_messages.noise_rate);
    expect(result.dependency_chain.source_attribution_accuracy).toBeGreaterThanOrEqual(
      result.global_summary.source_attribution_accuracy,
    );
    expect(result.dependency_chain.quality_report.overall_score).toBeGreaterThan(
      result.recent_messages.quality_report.overall_score,
    );
    expect(result.dependency_chain.quality_report.overall_score).toBeGreaterThan(
      result.global_summary.quality_report.overall_score,
    );
    expect(result.winner).toBe("dependency_chain");
  });

  test("quality_report contains all dimensions and scores stay within 0..1", () => {
    const benchmark = new ContextBenchmark();
    const { benchmarkCase, contextsByStrategy } = benchmarkFixture();

    const result = benchmark.benchmarkContextStrategies(benchmarkCase, {
      contextsByStrategy,
      max_chars: 2000,
    });

    for (const strategy of benchmarkCase.strategies) {
      expect(Object.keys(result[strategy].quality_report).sort()).toEqual([
        "economy",
        "isolation",
        "overall_score",
        "provenance",
        "relevance",
        "sufficiency",
      ]);
      for (const score of Object.values(result[strategy].quality_report)) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    }
  });
});
