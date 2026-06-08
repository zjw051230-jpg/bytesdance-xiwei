import { describe, expect, it } from "vitest";
import { artifactsToUiState } from "./dslArtifactAdapter.js";

describe("artifactsToUiState", () => {
  it("maps scoring, readiness, risks, EVPI question, and report from real artifacts", () => {
    const uiState = artifactsToUiState({
      "09_scoring.json": {
        exists: true,
        json: {
          dsl_completion_score: 0.82,
          ready_for_agent: false,
          handoff_decision: "clarify_first"
        }
      },
      "06_risk_activation.json": {
        exists: true,
        json: {
          activated_risk_factors: [
            {
              factor_id: "test_oracle_unclear",
              severity: "P0",
              reason: "验收标准不完整",
              category: "oracle",
              impact: "高影响"
            }
          ]
        }
      },
      "10_evpi_clarification.json": {
        exists: true,
        json: {
          clarification_gate: {
            ready_for_agent: false,
            handoff_decision: "clarify_first"
          },
          ranked_questions: [
            {
              question: "是否需要区分密码错误和账户锁定？",
              reason: "影响错误提示策略",
              factor_ids: ["test_oracle_unclear"]
            }
          ]
        }
      },
      "12_final_dsl.json": {
        exists: true,
        json: {
          requirement: {
            title: "登录失败提示优化",
            summary: "让用户理解登录失败原因和下一步动作。"
          },
          execution_atoms: {
            agent_plan_generated: false,
            agent_handoff_entered: false
          }
        }
      },
      "13_case_summary.md": {
        exists: true,
        text: "# Case Summary\n- scope: PM-to-DSL draft only"
      }
    });

    expect(uiState.dslCompletion.value).toBe(82);
    expect(uiState.readiness.ready_for_agent).toBe(false);
    expect(uiState.readiness.handoff_decision).toBe("clarify_first");
    expect(uiState.risks[0].key).toBe("test_oracle_unclear");
    expect(uiState.recommendedQuestion.text).toBe("是否需要区分密码错误和账户锁定？");
    expect(uiState.recommendedQuestion.source).toBe("EVPI-lite");
    expect(uiState.humanReport.summary.title).toBe("登录失败提示优化");
    expect(uiState.boundaries.agentPlanGenerated).toBe(false);
  });

  it("uses safe readiness defaults and fallback suggestion when artifacts are incomplete", () => {
    const uiState = artifactsToUiState({
      "12_final_dsl.json": { exists: true, json: {} }
    });

    expect(uiState.readiness.ready_for_agent).toBe(false);
    expect(uiState.readiness.handoff_decision).toBe("clarify_first");
    expect(uiState.readiness.source).toBe("fallback_safe_default");
    expect(uiState.recommendedQuestion.source).toBe("本地 fallback");
  });
});
