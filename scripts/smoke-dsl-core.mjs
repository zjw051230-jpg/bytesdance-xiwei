import { evaluateDslCore } from "../server/services/dslCore/index.js";

const result = evaluateDslCore({
  pmText: "登录失败提示太模糊，希望用户知道下一步怎么做。",
  dsl: {
    title: "Login failure guidance",
    summary: "Make login failure messages actionable.",
    requirements: ["Improve login failure prompt for password and locked-account cases."],
    acceptance_criteria: ["User sees a clear next action after a login failure."],
    risks: ["Test oracle needs PM confirmation."],
    ready_for_agent: false,
    handoff_decision: "clarify_first"
  }
});

const text = JSON.stringify(result);
const checks = {
  schemaValid: result.validation.valid === true,
  riskActivated: result.riskActivation.activated_risk_factors.some((factor) => factor.factor_id === "test_oracle_unclear"),
  routerActivated: result.router.module_activation.ui_ux > 0,
  schemaActivation: result.schemaActivation.required_fields.length > 0,
  gapVector: Array.isArray(result.gapVector.coverage.missing),
  rawScore: Number.isFinite(result.scoring.rawScore),
  evpiClarifyFirst: result.evpi.clarification_gate.handoff_decision === "clarify_first",
  noDslV2RuntimePath: !/F:\\dsl-v2/i.test(text),
  noPmDslRunner: !/pm_dsl_runner/i.test(text)
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length > 0) {
  console.error(JSON.stringify({ ok: false, failed, checks }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checks }, null, 2));
