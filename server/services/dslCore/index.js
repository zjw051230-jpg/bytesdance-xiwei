export { activateRiskFactors, getRiskFactorById, riskFactors } from "./riskFactorDictionary.js";
export { routeRequirementType } from "./requirementTypeRouter.js";
export { activateSchema } from "./schemaActivation.js";
export { validateRequirementDsl } from "./schemaValidator.js";
export { computeGapVector } from "./gapVector.js";
export { scoreRequirementDsl } from "./scoringEngine.js";
export { computeEvpiLiteGate } from "./evpiLiteGate.js";

import { activateRiskFactors } from "./riskFactorDictionary.js";
import { routeRequirementType } from "./requirementTypeRouter.js";
import { activateSchema } from "./schemaActivation.js";
import { computeGapVector } from "./gapVector.js";
import { scoreRequirementDsl } from "./scoringEngine.js";
import { computeEvpiLiteGate } from "./evpiLiteGate.js";
import { validateRequirementDsl } from "./schemaValidator.js";

export function evaluateDslCore({ pmText = "", dsl = {} } = {}) {
  const validation = validateRequirementDsl(dsl);
  const riskActivation = activateRiskFactors({ text: pmText, dsl });
  const router = routeRequirementType({
    text: pmText,
    activatedRiskFactors: riskActivation.activated_risk_factors
  });
  const schemaActivation = activateSchema({
    routerResult: router,
    activatedRiskFactors: riskActivation.activated_risk_factors
  });
  const gapVector = computeGapVector({
    dsl,
    schemaActivation,
    activatedRiskFactors: riskActivation.activated_risk_factors
  });
  const scoring = scoreRequirementDsl({
    dsl,
    gapVector,
    activatedRiskFactors: riskActivation.activated_risk_factors,
    schemaActivation
  });
  const evpi = computeEvpiLiteGate({
    scoring,
    gapVector,
    activatedRiskFactors: riskActivation.activated_risk_factors,
    schemaActivation
  });

  return {
    module_status: "standalone_dsl_core",
    validation,
    riskActivation,
    router,
    schemaActivation,
    gapVector,
    scoring,
    evpi
  };
}
