import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProject,
  getDesignPlan,
  listProjects,
  updatePlanningTask,
  updateReviewItem,
  upsertPrDraft
} from "./persistenceClient.js";

describe("persistence client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads projects from the real persistence endpoint", async () => {
    const fetchMock = vi.fn(async () => ok([{ id: "project-1", name: "Persistent Project" }]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listProjects()).resolves.toEqual([{ id: "project-1", name: "Persistent Project" }]);

    expect(fetchMock).toHaveBeenCalledWith("/api/projects", undefined);
  });

  it("creates projects through POST /api/projects", async () => {
    const fetchMock = vi.fn(async () => ok({ id: "project-new", name: "New Project" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createProject({ name: "New Project" })).resolves.toMatchObject({ id: "project-new" });

    expect(fetchMock).toHaveBeenCalledWith("/api/projects", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ name: "New Project" })
    }));
  });

  it("reads design plans and patches planning task status", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).endsWith("/design-plan")) return ok({ id: "plan-1", title: "Persistent design" });
      return ok({ id: "task-1", status: "done" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getDesignPlan("req-1")).resolves.toMatchObject({ id: "plan-1" });
    await expect(updatePlanningTask("task-1", { status: "done" })).resolves.toMatchObject({ status: "done" });

    expect(fetchMock).toHaveBeenCalledWith("/api/requirements/req-1/design-plan", undefined);
    expect(fetchMock).toHaveBeenCalledWith("/api/planning-tasks/task-1", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ status: "done" })
    }));
  });

  it("patches review items and saves PR drafts", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("/review-items/")) return ok({ id: "review-1", humanStatus: "approved" });
      return ok({ id: "pr-1", title: "Saved PR" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(updateReviewItem("review-1", { humanStatus: "approved" })).resolves.toMatchObject({ humanStatus: "approved" });
    await expect(upsertPrDraft("req-1", { title: "Saved PR" })).resolves.toMatchObject({ title: "Saved PR" });

    expect(fetchMock).toHaveBeenCalledWith("/api/review-items/review-1", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ humanStatus: "approved" })
    }));
    expect(fetchMock).toHaveBeenCalledWith("/api/requirements/req-1/pr-draft", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ title: "Saved PR" })
    }));
  });

  it("surfaces readable API errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({
        ok: false,
        data: null,
        error: { code: "db_failed", message: "database is locked" }
      })
    })));

    await expect(listProjects()).rejects.toThrow("database is locked");
  });
});

function ok(data) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ ok: true, data, error: null })
  };
}
