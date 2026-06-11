import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestEnvelope } from "../api/prDraftClient.js";
import PrDraftCenter, { buildPrMarkdown, evaluateReadiness } from "./PrDraftCenter.jsx";

describe("PrDraftCenter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders with live API envelopes and no mock fallback", async () => {
    const fetchMock = liveFetch();
    vi.stubGlobal("fetch", fetchMock);

    render(<PrDraftCenter requirementId="req-live" projectId="codex-workbench" />);

    await waitFor(() => expect(screen.getByTestId("pr-draft-center")).toBeInTheDocument());
    expect(screen.getByText("Live API")).toBeInTheDocument();
    expect(screen.queryByText("mock fallback")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /View Changed Files/ })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/requirements/req-live/pr-draft", undefined);
  });

  it("shows EmptyState when no prDraft exists", async () => {
    vi.stubGlobal("fetch", liveFetch({
      "/api/requirements/req-empty/pr-draft": jsonError("pr_draft_not_found", "No draft", 404)
    }));

    render(<PrDraftCenter requirementId="req-empty" projectId="codex-workbench" />);

    await waitFor(() => expect(screen.getByTestId("pr-draft-empty")).toBeInTheDocument());
    expect(screen.getByText(/EmptyState/)).toBeInTheDocument();
  });

  it("shows ErrorState for validation envelope errors", async () => {
    vi.stubGlobal("fetch", liveFetch({
      "/api/requirements/req-live/pr-draft": jsonError("validation_failed", "Invalid draft", 422)
    }));

    render(<PrDraftCenter requirementId="req-live" projectId="codex-workbench" />);

    await waitFor(() => expect(screen.getByTestId("pr-draft-error")).toBeInTheDocument());
    expect(screen.getByText(/Invalid draft/)).toBeInTheDocument();
  });

  it("shows UnavailableState when the backend is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    render(<PrDraftCenter requirementId="req-live" projectId="codex-workbench" />);

    await waitFor(() => expect(screen.getByTestId("pr-draft-unavailable")).toBeInTheDocument());
    expect(screen.getByText(/network_error/)).toBeInTheDocument();
  });

  it("blocked review items prevent ready", async () => {
    vi.stubGlobal("fetch", liveFetch({
      "/api/agent/runs/RUN-live/review": jsonOk([{ id: "review-1", filePath: "src/pages/PrDraftCenter.jsx", status: "changes_requested", required: true, message: "Needs changes." }])
    }));

    render(<PrDraftCenter requirementId="req-live" projectId="codex-workbench" />);

    await waitFor(() => expect(screen.getAllByText("Review item for src/pages/PrDraftCenter.jsx is changes_requested.").length).toBeGreaterThan(0));
    expect(screen.getAllByText("blocked").length).toBeGreaterThan(0);
  });

  it("missing tests prevent ready", () => {
    const readiness = evaluateReadiness(liveContext({ prDraft: { ...livePrDraft(), tests: [] } }));

    expect(readiness.status).toBe("blocked");
    expect(readiness.blockingReasons).toContain("Required test result is missing.");
  });

  it("unacknowledged high risk prevents ready", () => {
    const readiness = evaluateReadiness(liveContext({
      prDraft: {
        ...livePrDraft(),
        risks: [{ id: "risk-high", level: "high", message: "Release risk", mitigation: "Owner review", acknowledged: false }]
      }
    }));

    expect(readiness.status).toBe("blocked");
    expect(readiness.blockingReasons).toContain("High risk is not acknowledged.");
  });

  it("copying a blocked PR shows a warning and does not copy when cancelled", async () => {
    const confirm = vi.fn(() => false);
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("confirm", confirm);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("fetch", liveFetch({
      "/api/agent/runs/RUN-live/review": jsonOk([{ id: "review-1", filePath: "src/pages/PrDraftCenter.jsx", status: "blocked", required: true, message: "Blocked." }])
    }));

    render(<PrDraftCenter requirementId="req-live" projectId="codex-workbench" />);

    await waitFor(() => expect(screen.getByTestId("copy-pr-description-toolbar")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("copy-pr-description-toolbar"));

    expect(confirm).toHaveBeenCalledWith("Current PR Draft still has unresolved blockers. Copy anyway?");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copying a ready PR writes markdown and PATCHes copiedAt", async () => {
    const writeText = vi.fn(async () => {});
    const fetchMock = liveFetch();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("fetch", fetchMock);

    render(<PrDraftCenter requirementId="req-live" projectId="codex-workbench" />);

    await waitFor(() => expect(screen.getByText("This PR draft can be marked ready and copied.")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("copy-pr-description-toolbar"));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toContain("## Changed Files");
    expect(fetchMock).toHaveBeenCalledWith("/api/pr-drafts/pr-live", expect.objectContaining({ method: "PATCH" }));
  });

  it("regenerate calls the live POST endpoint", async () => {
    const fetchMock = liveFetch();
    vi.stubGlobal("fetch", fetchMock);

    render(<PrDraftCenter requirementId="req-live" projectId="codex-workbench" />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Regenerate Draft/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Regenerate Draft/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/requirements/req-live/pr-draft", expect.objectContaining({ method: "POST" })));
  });

  it("markdown preview is generated from live draft data", async () => {
    vi.stubGlobal("fetch", liveFetch());

    render(<PrDraftCenter requirementId="req-live" projectId="codex-workbench" />);

    await waitFor(() => expect(screen.getAllByRole("button", { name: /View Markdown Preview/ }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole("button", { name: /View Markdown Preview/ })[0]);

    await waitFor(() => expect(screen.getByText((_, element) => element?.tagName === "PRE" && element.textContent.includes("# Live PR Draft"))).toBeInTheDocument());
    expect(screen.getByText((_, element) => element?.tagName === "PRE" && element.textContent.includes("src/pages/PrDraftCenter.jsx"))).toBeInTheDocument();
  });

  it("production PR page code does not import mock modules", async () => {
    const [pageSource, clientSource] = await Promise.all([
      readFile("src/pages/PrDraftCenter.jsx", "utf8"),
      readFile("src/api/prDraftClient.js", "utf8")
    ]);
    expect(`${pageSource}\n${clientSource}`).not.toMatch(/mocks\/|mockPrDraft|fallbackMock|dummyData|staticData|regenerateMockPrDraft|getMockPrDraftContext/);
  });

  it("API envelope success parses data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonOk({ id: "pr-1" })));

    await expect(requestEnvelope("/api/requirements/req-1/pr-draft")).resolves.toEqual({ id: "pr-1" });
  });
});

function liveFetch(overrides = {}) {
  const routes = {
    "/api/requirements/req-live": jsonOk(liveRequirement()),
    "/api/requirements/req-empty": jsonOk(liveRequirement({ id: "req-empty" })),
    "/api/requirements/req-live/pr-draft": jsonOk(livePrDraft()),
    "/api/agent/runs/RUN-live": jsonOk(liveRun()),
    "/api/agent/runs/RUN-live/review": jsonOk([]),
    "/api/agent/runs/RUN-live/artifacts": jsonOk({ runId: "RUN-live", artifactList: liveArtifacts() }),
    "/api/agent/runs/RUN-live/changes": jsonOk({ runId: "RUN-live", changes: [{ id: "chg-1", filePath: "src/pages/PrDraftCenter.jsx", status: "changed" }], verificationStatus: "current" }),
    "/api/projects/codex-workbench/activity": jsonOk([{ id: "act-1", actor: "Agent", action: "Draft reviewed", createdAt: "2026-06-10T10:00:00.000Z" }]),
    "/api/pr-drafts/pr-live": jsonOk({ ...livePrDraft(), status: "copied", copiedAt: "2026-06-10T11:00:00.000Z" }),
    ...overrides
  };
  return vi.fn(async (url, options) => {
    if (options?.method === "POST" && String(url).endsWith("/pr-draft")) return jsonOk({ ...livePrDraft(), title: "Regenerated Live PR Draft" }, 201);
    if (options?.method === "PATCH") return routes["/api/pr-drafts/pr-live"];
    return routes[String(url)] || jsonError("not_found", `No test route for ${url}`, 404);
  });
}

function liveContext(overrides = {}) {
  return {
    requirement: liveRequirement(),
    agentRun: liveRun(),
    prDraft: livePrDraft(),
    reviewItems: [],
    artifacts: liveArtifacts(),
    changeRecords: { changes: [{ id: "chg-1", status: "changed" }], verificationStatus: "current" },
    ...overrides
  };
}

function liveRequirement(overrides = {}) {
  return {
    id: "req-live",
    projectId: "codex-workbench",
    title: "Live delivery review",
    goal: "Review live PR readiness.",
    dslReadiness: "ready_for_agent",
    handoffDecision: "handoff_to_agent",
    points: ["Use live APIs"],
    ...overrides
  };
}

function liveRun() {
  return { id: "RUN-live", runId: "RUN-live", status: "completed", summary: "Run completed.", completedAt: "2026-06-10T09:00:00.000Z", verificationStatus: "current" };
}

function livePrDraft() {
  return {
    id: "pr-live",
    requirementId: "req-live",
    runId: "RUN-live",
    title: "Live PR Draft",
    summary: ["Uses live data"],
    changedFiles: [{ id: "file-1", path: "src/pages/PrDraftCenter.jsx", changeSummary: "Live page", why: "Delivery review", requirementPoint: "Use live APIs", risk: "Low", testStatus: "passed", reviewStatus: "approved" }],
    tests: [{ id: "test-1", name: "npm test", status: "passed", source: "vitest", required: true }],
    risks: [{ id: "risk-1", level: "high", message: "Release coordination", mitigation: "Documented", acknowledged: true }],
    checklist: [{ id: "check-1", label: "Blocking gate reviewed", checked: true, blocking: true }],
    notes: "Live note",
    status: "draft"
  };
}

function liveArtifacts() {
  return [{ id: "artifact-1", name: "test-report.md", type: "report", redactionState: "safe", contentPreview: "All good.", createdAt: "2026-06-10T09:30:00.000Z" }];
}

function jsonOk(data, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => ({ ok: true, data, error: null })
  };
}

function jsonError(code, message, status = 400) {
  return {
    ok: false,
    status,
    json: async () => ({ ok: false, data: null, error: { code, message, details: {} } })
  };
}
