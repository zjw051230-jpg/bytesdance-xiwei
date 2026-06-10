const { ContextEvalRunner } = require("./contextEvalRunner");

const SUPPORTED_CONTEXT_STRATEGIES = ["recent_messages", "global_summary", "dependency_chain"];

class ContextBenchmark {
  constructor({ contextEvalRunner } = {}) {
    this.contextEvalRunner = contextEvalRunner || new ContextEvalRunner();
  }

  benchmarkContextStrategies(benchmarkCase, options = {}) {
    const strategies = benchmarkCase.strategies || SUPPORTED_CONTEXT_STRATEGIES;
    for (const strategy of strategies) {
      if (!SUPPORTED_CONTEXT_STRATEGIES.includes(strategy)) {
        throw new Error(`Unsupported context strategy "${strategy}".`);
      }
    }

    const results = {};
    for (const strategy of strategies) {
      const context = options.contextsByStrategy?.[strategy];
      if (!context) {
        throw new Error(`Missing context for strategy "${strategy}".`);
      }

      const metrics = {
        dependency_recall: this.contextEvalRunner.calculateDependencyRecall(context, benchmarkCase.expected_source_nodes || []),
        noise_rate: this.contextEvalRunner.calculateNoiseRate(context, benchmarkCase.forbidden_source_nodes || []),
        constraint_recall: this.contextEvalRunner.calculateConstraintRecall(context, benchmarkCase.expected_constraints || []),
        source_attribution_accuracy: this.contextEvalRunner.calculateSourceAttributionAccuracy(context, benchmarkCase.expected_attributions || []),
      };
      const contextSizeChars = JSON.stringify(context).length;
      const qualityReport = this.contextEvalRunner.calculateContextQualityReport(metrics, {
        context,
        context_size_chars: contextSizeChars,
        max_chars: options.maxCharsByStrategy?.[strategy] || options.max_chars,
        budget_report: context.budget_report,
        isolation_score: options.isolationScoresByStrategy?.[strategy],
        agent_context_overlap: options.agentContextOverlapByStrategy?.[strategy],
      });

      results[strategy] = {
        ...metrics,
        context_size_chars: contextSizeChars,
        quality_report: qualityReport,
      };
    }

    return {
      ...results,
      winner: chooseWinner(strategies, results),
    };
  }
}

function chooseWinner(strategies, results) {
  return [...strategies].sort((left, right) => {
    const scoreDelta = results[right].quality_report.overall_score - results[left].quality_report.overall_score;
    if (scoreDelta !== 0) return scoreDelta;
    const sizeDelta = results[left].context_size_chars - results[right].context_size_chars;
    if (sizeDelta !== 0) return sizeDelta;
    return strategies.indexOf(left) - strategies.indexOf(right);
  })[0];
}

const defaultBenchmark = new ContextBenchmark();

module.exports = {
  ContextBenchmark,
  SUPPORTED_CONTEXT_STRATEGIES,
  benchmarkContextStrategies: defaultBenchmark.benchmarkContextStrategies.bind(defaultBenchmark),
};
