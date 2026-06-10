const now = "2026-06-11T01:20:00.000Z";

const baseRequirement = {
  id: "req-pr-draft-center",
  projectId: "codex-workbench",
  title: "PR Draft Center delivery review",
  goal: "Generate, inspect, save, and copy PR draft descriptions without creating a remote PR.",
  readiness: "ready_for_agent",
  dslReadiness: "ready_for_agent",
  handoffDecision: "handoff_to_agent",
  points: [
    "Show what changed and why.",
    "Map changes back to requirement points.",
    "Block ready state when review, tests, risks, artifacts, or checklist gates fail."
  ]
};

const baseAgentRun = {
  id: "RUN-pr-draft-center",
  runId: "RUN-pr-draft-center",
  status: "completed",
  summary: "Agent run produced implementation evidence for the PR draft review flow.",
  completedAt: now
};

const baseChangedFiles = [
  {
    path: "src/pages/PrDraftCenter.jsx",
    changeSummary: "Implemented the PR Draft Center workbench page and editor.",
    why: "The PR draft flow needs a delivery review surface before copying the PR description.",
    requirementPoint: "PR Draft page implementation",
    risk: "State transitions must not allow blocked drafts to become ready.",
    testStatus: "covered",
    reviewStatus: "approved"
  },
  {
    path: "src/api/prDraftClient.js",
    changeSummary: "Added envelope-aware API client with mock fallback.",
    why: "Page code must not scatter fetch calls and must run when the backend is unavailable.",
    requirementPoint: "API client and mock fallback",
    risk: "Fallback should not hide real validation errors.",
    testStatus: "covered",
    reviewStatus: "approved"
  }
];

const baseTests = [
  { id: "test-render", name: "PR Draft Center render", status: "passed", source: "vitest", required: true },
  { id: "test-copy", name: "Copy markdown generation", status: "passed", source: "vitest", required: true }
];

const baseRisks = [
  {
    id: "risk-readiness",
    level: "medium",
    message: "Readiness gate logic can drift from review data.",
    mitigation: "Centralized gate evaluator drives inspector and actions.",
    acknowledged: true
  }
];

const baseArtifacts = [
  {
    id: "artifact-summary",
    type: "report",
    name: "agent-summary.md",
    contentPreview: "Summary of changed files, tests, and review evidence.",
    redactionState: "safe",
    createdAt: now
  },
  {
    id: "artifact-secret",
    type: "log",
    name: "secret_redacted.env",
    contentPreview: "[redacted preview withheld]",
    redactionState: "redacted",
    createdAt: now
  }
];

const baseActivity = [
  { id: "act-1", actor: "Agent", action: "Generated draft evidence", createdAt: "2026-06-11T01:10:00.000Z" },
  { id: "act-2", actor: "Reviewer", action: "Approved implementation scope", createdAt: "2026-06-11T01:14:00.000Z" }
];

const baseChecklist = [
  { id: "check-summary", label: "Summary describes the user-visible change", checked: true, blocking: true, system: true },
  { id: "check-review", label: "Review blockers are resolved", checked: true, blocking: true, system: true },
  { id: "check-notes", label: "Release notes are not required", checked: false, blocking: false, system: false }
];

export const prDraftMockCases = {
  ready: buildCase({
    id: "pr-ready",
    status: "ready",
    reviewItems: [
      { id: "review-approved", filePath: "src/pages/PrDraftCenter.jsx", status: "approved", required: true, message: "Ready after evidence review." },
      { id: "review-resolved", filePath: "src/api/prDraftClient.js", status: "resolved", required: false, message: "Fallback behavior documented." }
    ]
  }),
  blocked_review: buildCase({
    id: "pr-blocked-review",
    status: "draft",
    reviewItems: [
      { id: "review-change", filePath: "src/pages/PrDraftCenter.jsx", status: "changes_requested", required: true, message: "Copy warning needs explicit blocked-state text." },
      { id: "review-blocked", filePath: "src/api/prDraftClient.js", status: "blocked", required: true, message: "API error envelope handling is incomplete." },
      { id: "review-pending", filePath: "src/components/PRWorkbench.jsx", status: "pending", required: true, message: "Wrapper route needs verification." }
    ]
  }),
  blocked_tests: buildCase({
    id: "pr-blocked-tests",
    status: "draft",
    tests: [{ id: "test-required", name: "Required regression suite", status: "missing", source: "vitest", required: true, errorSummary: "No required test result was found." }],
    checklist: [{ id: "check-tests", label: "Required tests are present", checked: false, blocking: true, system: true }]
  }),
  copied: buildCase({
    id: "pr-copied",
    status: "copied",
    copiedAt: "2026-06-11T01:18:00.000Z"
  }),
  empty: buildCase({
    id: "pr-empty",
    status: "draft",
    title: "",
    summary: [],
    changedFiles: [],
    tests: [],
    risks: [],
    checklist: [],
    reviewItems: [],
    artifacts: []
  })
};

export function getMockPrDraftContext(requirementId = "req-pr-draft-center") {
  const key = String(requirementId).includes("blocked-tests")
    ? "blocked_tests"
    : String(requirementId).includes("copied")
      ? "copied"
      : String(requirementId).includes("empty")
        ? "empty"
        : String(requirementId).includes("ready")
          ? "ready"
          : "blocked_review";
  return clone({ ...prDraftMockCases[key], mockCase: key });
}

export function regenerateMockPrDraft(requirementId, runId) {
  const context = getMockPrDraftContext(String(requirementId).includes("ready") ? requirementId : "req-ready");
  return {
    ...context.prDraft,
    id: `mock-regenerated-${Date.now()}`,
    requirementId,
    runId: runId || context.prDraft.runId,
    status: "draft",
    copiedAt: null,
    updatedAt: new Date().toISOString(),
    title: context.prDraft.title || "Regenerated PR draft"
  };
}

function buildCase(overrides = {}) {
  const id = overrides.id || "pr-ready";
  const requirementId = overrides.requirementId || "req-pr-draft-center";
  const runId = overrides.runId || baseAgentRun.runId;
  return {
    requirement: { ...baseRequirement, id: requirementId },
    agentRun: { ...baseAgentRun, runId, id: runId },
    prDraft: {
      id,
      requirementId,
      runId,
      title: overrides.title ?? "Ship PR Draft Center",
      summary: overrides.summary ?? [
        "Adds a real PR Draft Center page with editable title, summary, checklist, and markdown preview.",
        "Connects readiness gates to requirement, agent run, review, tests, risks, artifacts, and checklist evidence.",
        "Provides mock fallback data so the page remains usable without backend availability."
      ],
      changedFiles: overrides.changedFiles ?? baseChangedFiles,
      tests: overrides.tests ?? baseTests,
      risks: overrides.risks ?? baseRisks,
      checklist: overrides.checklist ?? baseChecklist,
      notes: "No remote PR is created from this surface.",
      status: overrides.status || "draft",
      copiedAt: overrides.copiedAt || null,
      updatedAt: now
    },
    reviewItems: overrides.reviewItems ?? [
      { id: "review-approved", filePath: "src/pages/PrDraftCenter.jsx", status: "approved", required: true, message: "Implementation is aligned with the requested evidence model." },
      { id: "review-resolved", filePath: "src/api/prDraftClient.js", status: "resolved", required: false, message: "Envelope parsing and fallback are covered." }
    ],
    artifacts: overrides.artifacts ?? baseArtifacts,
    activity: overrides.activity ?? baseActivity
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
