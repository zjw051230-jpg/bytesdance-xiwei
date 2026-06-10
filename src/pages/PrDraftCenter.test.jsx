import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestEnvelope } from "../api/prDraftClient.js";
import PrDraftCenter, { buildPrMarkdown, evaluateReadiness } from "./PrDraftCenter.jsx";

describe("PrDraftCenter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the PR Draft Center page with mock fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    render(<PrDraftCenter requirementId="req-ready" projectId="codex-workbench" />);

    await waitFor(() => expect(screen.getByTestId("pr-draft-center")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "PR Draft Center" })).toBeInTheDocument();
    expect(screen.getByText("mock fallback")).toBeInTheDocument();
    expect(screen.getAllByText("Changed Files").length).toBeGreaterThan(0);
  });

  it("blocked review items make readiness blocked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    render(<PrDraftCenter requirementId="req-blocked-review" projectId="codex-workbench" />);

    await waitFor(() => expect(screen.getAllByText("blocked").length).toBeGreaterThan(0));
    expect(screen.getByText("Review item for src/pages/PrDraftCenter.jsx is changes_requested.")).toBeInTheDocument();
  });

  it("ready case shows ready", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    render(<PrDraftCenter requirementId="req-ready" projectId="codex-workbench" />);

    await waitFor(() => expect(screen.getAllByText("ready").length).toBeGreaterThan(0));
    expect(screen.getByText("This PR draft can be marked ready and copied.")).toBeInTheDocument();
  });

  it("copy button generates markdown", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    render(<PrDraftCenter requirementId="req-ready" projectId="codex-workbench" />);

    await waitFor(() => expect(screen.getAllByRole("button", { name: /Copy PR Description/ }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId("copy-pr-description-toolbar"));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toContain("## Summary");
    expect(writeText.mock.calls[0][0]).toContain("## Changed Files");
  });

  it("blocked copy shows warning confirmation", async () => {
    const confirm = vi.fn(() => false);
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("confirm", confirm);
    window.confirm = confirm;
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    render(<PrDraftCenter requirementId="req-blocked-review" projectId="codex-workbench" />);

    await waitFor(() => expect(screen.getAllByRole("button", { name: /Copy PR Description/ }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId("copy-pr-description-toolbar"));

    expect(confirm).toHaveBeenCalledWith("Current PR Draft still has unresolved blockers. Copy anyway?");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("checklist blocking item prevents ready", () => {
    const readiness = evaluateReadiness({
      requirement: { dslReadiness: "ready_for_agent" },
      agentRun: { status: "completed" },
      reviewItems: [],
      artifacts: [{ redactionState: "safe" }],
      prDraft: {
        changedFiles: [{ path: "src/App.jsx" }],
        tests: [{ status: "passed", required: true }],
        risks: [],
        checklist: [{ label: "Blocking", blocking: true, checked: false }]
      }
    });

    expect(readiness.status).toBe("blocked");
    expect(readiness.blockingReasons).toContain("Checklist blocking item is unresolved.");
  });

  it("secret_redacted artifact does not expose raw content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    render(<PrDraftCenter requirementId="req-ready" projectId="codex-workbench" />);

    await waitFor(() => expect(screen.getAllByText(/secret_redacted/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/raw token/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/raw \.env/i)).not.toBeInTheDocument();
  });

  it("API envelope success parses data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { id: "pr-1" }, error: null })
    })));

    await expect(requestEnvelope("/api/requirements/req-1/pr-draft")).resolves.toEqual({ id: "pr-1" });
  });

  it("API envelope error displays ErrorState when not eligible for fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 422,
      json: async () => ({ ok: false, data: null, error: { code: "validation_failed", message: "Invalid draft", details: {} } })
    })));

    render(<PrDraftCenter requirementId="req-validation" projectId="codex-workbench" />);

    await waitFor(() => expect(screen.getByTestId("pr-draft-error")).toBeInTheDocument());
    expect(screen.getAllByText(/validation_failed/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Invalid draft/)).toBeInTheDocument();
  });

  it("mock fallback is usable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    render(<PrDraftCenter requirementId="req-empty" projectId="codex-workbench" />);

    await waitFor(() => expect(screen.getByText("No changed files are recorded. Readiness is blocked.")).toBeInTheDocument());
    expect(screen.getByText("mock fallback")).toBeInTheDocument();
  });

  it("buildPrMarkdown includes blocked warning", () => {
    const context = {
      requirement: { title: "Req", dslReadiness: "not_ready", handoffDecision: "clarify_first" },
      prDraft: {
        title: "Draft",
        summary: ["One"],
        changedFiles: [],
        tests: [],
        risks: [],
        checklist: [],
        notes: ""
      }
    };

    expect(buildPrMarkdown(context, { status: "blocked" })).toContain("> Warning: This PR draft still has unresolved blockers.");
  });
});
