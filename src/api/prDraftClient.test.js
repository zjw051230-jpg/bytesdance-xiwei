import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPrDraftCenterContext, requestEnvelope } from "./prDraftClient.js";

describe("prDraftClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses standard success envelopes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { ok: "data" }, error: null })
    })));

    await expect(requestEnvelope("/api/test")).resolves.toEqual({ ok: "data" });
  });

  it("throws standard error envelopes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ ok: false, data: null, error: { code: "not_found", message: "Missing", details: {} } })
    })));

    await expect(requestEnvelope("/api/test")).rejects.toMatchObject({
      payload: { error: { code: "not_found" } }
    });
  });

  it("falls back to mock context when backend is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    const context = await loadPrDraftCenterContext({ requirementId: "req-ready", projectId: "codex-workbench" });

    expect(context.usedMockFallback).toBe(true);
    expect(context.prDraft.changedFiles.length).toBeGreaterThan(0);
  });

  it("falls back for backend not-found variants", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ ok: false, data: null, error: { code: "requirement_not_found", message: "requirement not found", details: {} } })
    })));

    const context = await loadPrDraftCenterContext({ requirementId: "req-ready", projectId: "codex-workbench" });

    expect(context.usedMockFallback).toBe(true);
    expect(context.prDraft.title).toBe("Ship PR Draft Center");
  });
});
