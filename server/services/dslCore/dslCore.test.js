import { describe, expect, it } from "vitest";
import {
  activateRiskFactors,
  activateSchema,
  computeEvpiLiteGate,
  computeGapVector,
  evaluateDslCore,
  routeRequirementType,
  scoreRequirementDsl,
  validateRequirementDsl
} from "./index.js";

const validDsl = {
  title: "Login failure guidance",
  summary: "Make login failure messages actionable.",
  requirements: ["Improve login failure prompt for password and locked-account cases."],
  acceptance_criteria: ["User sees a clear next action after a login failure."],
  risks: ["Test oracle needs PM confirmation."],
  ready_for_agent: false,
  handoff_decision: "clarify_first"
};

describe("standalone DSL core modules", () => {
  it("validates RequirementDSL v0 and rejects missing required fields", () => {
    expect(validateRequirementDsl(validDsl).valid).toBe(true);

    const invalid = { ...validDsl };
    delete invalid.acceptance_criteria;
    const result = validateRequirementDsl(invalid);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.field === "acceptance_criteria")).toBe(true);
  });

  it("activates structured risk factors including test_oracle_unclear", () => {
    const result = activateRiskFactors({
      text: "登录失败提示太模糊，希望用户知道下一步怎么做，但验收标准还没明确。"
    });

    expect(result.activated_risk_factors.map((factor) => factor.factor_id)).toContain("test_oracle_unclear");
    expect(result.activated_risk_factors[0]).toHaveProperty("category");
    expect(result.dictionary_version).toBe("dsl_core_v0");
  });

  it("routes UI style and favorite interaction requirements", () => {
    const style = routeRequirementType({ text: "调整文章卡片主题样式和按钮文案，让 UI 更清楚。" });
    const favorite = routeRequirementType({ text: "给文章详情页加收藏交互，用户可以取消收藏并看到状态变化。" });

    expect(style.requirement_types).toContain("ui_style");
    expect(style.module_activation.ui_ux).toBeGreaterThan(0);
    expect(favorite.requirement_types).toContain("favorite_interaction");
    expect(favorite.module_activation.ui_ux).toBeGreaterThan(0);
  });

  it("activates testing, ui, and error_state schema fields for login failure needs", () => {
    const risks = activateRiskFactors({ text: "登录失败提示太模糊，希望用户知道下一步怎么做。" }).activated_risk_factors;
    const router = routeRequirementType({ text: "登录失败提示太模糊，希望用户知道下一步怎么做。", activatedRiskFactors: risks });
    const activation = activateSchema({ routerResult: router, activatedRiskFactors: risks });

    expect(activation.required_fields).toEqual(expect.arrayContaining([
      "evaluation_atoms.acceptance_case",
      "change_atoms.ui_copy",
      "evaluation_atoms.negative_case"
    ]));
    expect(activation.deep_modules).toEqual(expect.arrayContaining(["evaluation_atoms", "change_atoms"]));
  });

  it("computes covered, partial, and missing gap coverage", () => {
    const risks = activateRiskFactors({ text: "登录失败提示太模糊，希望用户知道下一步怎么做。" }).activated_risk_factors;
    const router = routeRequirementType({ text: "登录失败提示太模糊，希望用户知道下一步怎么做。", activatedRiskFactors: risks });
    const activation = activateSchema({ routerResult: router, activatedRiskFactors: risks });
    const gap = computeGapVector({
      dsl: {
        ...validDsl,
        acceptance_criteria: ["密码错误时提示用户重试或找回密码。"],
        risks: []
      },
      schemaActivation: activation,
      activatedRiskFactors: risks
    });

    expect(gap.coverage.covered.length).toBeGreaterThan(0);
    expect(gap.coverage.partial.length).toBeGreaterThan(0);
    expect(gap.coverage.missing.length).toBeGreaterThan(0);
    expect(gap.top_gap_factors[0]).toHaveProperty("coverage_status");
  });

  it("scores raw DSL quality with breakdown and preserves clarify_first when acceptance is weak", () => {
    const risks = activateRiskFactors({ text: "登录失败提示太模糊。" }).activated_risk_factors;
    const router = routeRequirementType({ text: "登录失败提示太模糊。", activatedRiskFactors: risks });
    const activation = activateSchema({ routerResult: router, activatedRiskFactors: risks });
    const gap = computeGapVector({
      dsl: { ...validDsl, acceptance_criteria: [] },
      schemaActivation: activation,
      activatedRiskFactors: risks
    });
    const score = scoreRequirementDsl({
      dsl: { ...validDsl, acceptance_criteria: [] },
      gapVector: gap,
      activatedRiskFactors: risks,
      schemaActivation: activation
    });

    expect(score.rawScore).toBeLessThan(86);
    expect(score.breakdown).toHaveProperty("acceptance");
    expect(score.ready_for_agent).toBe(false);
    expect(score.handoff_decision).toBe("clarify_first");
  });

  it("keeps EVPI-lite clarify_first when key acceptance standard is missing", () => {
    const gate = computeEvpiLiteGate({
      scoring: {
        rawScore: 61,
        ready_for_agent: false,
        handoff_decision: "clarify_first",
        blocking_reasons: ["acceptance_case_missing"]
      },
      gapVector: {
        coverage: { missing: ["evaluation_atoms.acceptance_case"], partial: [], covered: [] },
        top_gap_factors: [{ factor_id: "test_oracle_unclear", missing_fields: ["evaluation_atoms.acceptance_case"] }]
      }
    });

    expect(gate.clarification_gate.ready_for_agent).toBe(false);
    expect(gate.clarification_gate.handoff_decision).toBe("clarify_first");
    expect(gate.ranked_questions[0].question).toMatch(/[?？]$/);
  });

  it("evaluates the full core chain without depending on dsl-v2 or pm_dsl_runner", () => {
    const result = evaluateDslCore({
      pmText: "登录失败提示太模糊，希望用户知道下一步怎么做。",
      dsl: validDsl
    });

    expect(result.router.requirement_types.length).toBeGreaterThan(0);
    expect(result.schemaActivation.required_fields.length).toBeGreaterThan(0);
    expect(result.gapVector.coverage).toHaveProperty("missing");
    expect(result.scoring).toHaveProperty("rawScore");
    expect(result.evpi.clarification_gate.handoff_decision).toBe("clarify_first");
    expect(JSON.stringify(result)).not.toMatch(/F:\\dsl-v2|pm_dsl_runner/i);
  });
});
