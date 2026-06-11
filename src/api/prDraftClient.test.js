import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPrDraftCenterContext, requestEnvelope, requestEnvelopeResult } from "./prDraftClient.js";

describe("prDraftClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses standard success envelopes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonOk({ ok: "data" })));

    await expect(requestEnvelope("/api/test")).resolves.toEqual({ ok: "data" });
  });

  it("throws standard error envelopes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonError("not_found", "Missing", 404)));

    await expect(requestEnvelope("/api/test")).rejects.toMatchObject({
      payload: { error: { code: "not_found" } }
    });
  });

  it("returns unavailable instead of mock fallback when backend is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    const result = await loadPrDraftCenterContext({ requirementId: "req-ready", projectId: "codex-workbench" });

    expect(result.state).toBe("unavailable");
    expect(result.context).toBeNull();
    expect(result.error.code).toBe("network_error");
  });

  it("returns empty when the live PR draft is absent", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).endsWith("/pr-draft")) return jsonError("pr_draft_not_found", "No draft", 404);
      return jsonOk({ id: "req-1", title: "Requirement", dslReadiness: "ready_for_agent" });
    }));

    const result = await loadPrDraftCenterContext({ requirementId: "req-1", projectId: "codex-workbench" });

    expect(result.state).toBe("empty");
    expect(result.reason.code).toBe("pr_draft_not_found");
  });

  it("wraps optional source failures as unavailable without creating fake data", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const target = String(url);
      if (target.endsWith("/req-1")) return jsonOk({ id: "req-1", title: "Requirement", dslReadiness: "ready_for_agent" });
      if (target.endsWith("/req-1/pr-draft")) return jsonOk({ id: "pr-1", requirementId: "req-1", runId: "RUN-1", title: "Draft" });
      return jsonError("agent_run_not_found", "Missing run", 404);
    }));

    const result = await loadPrDraftCenterContext({ requirementId: "req-1", projectId: "codex-workbench" });

    expect(result.state).toBe("success");
    expect(result.context.agentRun.status).toBe("");
    expect(result.context.sources.agentRun.state).toBe("unavailable");
    expect(result.context.prDraft.changedFiles).toEqual([]);
  });

  it("requestEnvelopeResult classifies network errors as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    await expect(requestEnvelopeResult("/api/test")).resolves.toMatchObject({
      state: "unavailable",
      error: { code: "network_error" }
    });
  });
});

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
