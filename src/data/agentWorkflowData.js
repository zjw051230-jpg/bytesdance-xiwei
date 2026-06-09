export const initialAgentWorkflowState = {
  status: "idle",
  runId: "",
  latestReturn: "No agent dry-run has been started.",
  readiness: null,
  context: null,
  plan: null,
  review: null,
  prDraft: null,
  artifacts: {},
  error: null
};

export const agentStatusLabels = {
  idle: "idle",
  ready: "ready",
  running: "running",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  needs_review: "needs_review"
};

export const fallbackAgentReview = {
  status: "needs_review",
  summary: "No agent dry-run result yet. Start from the Design Planning page to generate reviewable artifacts.",
  changedFiles: [],
  tests: [],
  manualConfirmations: ["Generate a dry-run plan before review."]
};

export const fallbackPrDraft = {
  title: "Agent dry-run PR draft pending",
  summary: ["Generate a dry-run result before preparing PR copy."],
  changedFiles: [],
  tests: [],
  risks: [],
  checklist: ["Dry-run artifacts reviewed"]
};
