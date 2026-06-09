import { afterEach, describe, expect, it, vi } from "vitest";
import { createDslRun } from "./dslClient.js";

const samplePayload = {
  projectId: "conduit-realworld-example-app",
  pmMessages: [{ role: "pm", content: "文章详情页需要阅读信息提示。" }]
};

describe("createDslRun", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns data from a successful JSON envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({
        ok: true,
        data: { runId: "RUN-test", status: "passed" },
        error: null
      })
    })));

    await expect(createDslRun(samplePayload)).resolves.toEqual({ runId: "RUN-test", status: "passed" });
  });

  it("turns an empty response body into a structured empty_response error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      text: async () => ""
    })));

    await expect(createDslRun(samplePayload)).rejects.toMatchObject({
      payload: {
        ok: false,
        error: {
          code: "empty_response",
          details: { status: 502 }
        }
      }
    });
  });

  it("turns non-JSON response bodies into a structured invalid_json_response error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "<html>backend crashed</html>"
    })));

    await expect(createDslRun(samplePayload)).rejects.toMatchObject({
      payload: {
        ok: false,
        error: {
          code: "invalid_json_response",
          details: {
            status: 500,
            bodyPreview: "<html>backend crashed</html>"
          }
        }
      }
    });
  });

  it("preserves structured backend error envelopes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => JSON.stringify({
        ok: false,
        data: null,
        error: {
          code: "standalone_artifact_failed",
          message: "standalone artifact runner failed"
        }
      })
    })));

    await expect(createDslRun(samplePayload)).rejects.toMatchObject({
      message: "standalone artifact runner failed",
      payload: {
        error: { code: "standalone_artifact_failed" }
      }
    });
  });
});
