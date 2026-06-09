import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppShell from "./AppShell.jsx";
import DesignPlanningWorkbench from "./DesignPlanningWorkbench.jsx";
import PRWorkbench from "./PRWorkbench.jsx";
import ReviewCheckWorkbench from "./ReviewCheckWorkbench.jsx";
import "../styles.css";

const project = {
  id: "project-1",
  name: "Persistent Project",
  description: "Loaded from API",
  status: "current",
  icon: "code",
  railSubtitle: "API"
};

const requirement = {
  id: "req-1",
  projectId: "project-1",
  title: "Persist login guidance",
  dslJson: { title: "Persist login guidance" },
  readinessStatus: "clarify_first",
  readyForAgent: false,
  handoffDecision: "clarify_first",
  completionPercent: 70
};

describe("frontend persistence wiring", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a project through the API and shows it after a refresh", async () => {
    const persistedProjects = [project];
    const fetchMock = vi.fn(async (url, options = {}) => {
      const target = String(url);
      if (target === "/api/projects" && options?.method === "POST") {
        const body = JSON.parse(options.body);
        const created = {
          id: "project-new",
          name: body.name,
          description: body.description,
          status: "current",
          icon: "folder",
          railSubtitle: body.railSubtitle
        };
        persistedProjects.unshift(created);
        return ok(created, 201);
      }
      if (target === "/api/projects") return ok([...persistedProjects]);
      if (target.includes("/requirements")) return ok([]);
      return ok({});
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = render(<AppShell />);
    fireEvent.click(screen.getByRole("button", { name: "工作台" }));
    await screen.findByRole("button", { name: "Persistent Project" });
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "Refresh Survives" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await screen.findByRole("button", { name: "Refresh Survives" });
    first.unmount();

    render(<AppShell />);
    fireEvent.click(screen.getByRole("button", { name: "工作台" }));

    await screen.findByRole("button", { name: "Refresh Survives" });
    expect(fetchMock.mock.calls.some(([url, options]) => String(url) === "/api/projects" && options?.method === "POST")).toBe(true);
  });

  it("patches a design planning task status", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith("/design-plan")) {
        return ok({ id: "plan-1", requirementId: "req-1", title: "Persistent design", summary: "Plan from database", currentStage: "design", overallProgress: 42 });
      }
      if (target.endsWith("/tasks")) {
        return ok([{ id: "task-1", title: "Persist task", owner: "Frontend", status: "todo", dueDate: "06-12", progress: 0 }]);
      }
      if (target.endsWith("/planning-tasks/task-1") && options?.method === "PATCH") {
        return ok({ id: "task-1", title: "Persist task", owner: "Frontend", status: "done", dueDate: "06-12", progress: 100 });
      }
      return ok({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <DesignPlanningWorkbench
        activeProject={project}
        activeRequirement={requirement}
        agentWorkflow={{ status: "idle", latestReturn: "No run", artifacts: {} }}
        onAgentWorkflowChange={() => {}}
      />
    );

    await screen.findByText("Persistent design");
    fireEvent.change(screen.getByLabelText("任务状态 Persist task"), { target: { value: "done" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/planning-tasks/task-1", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ status: "done" })
    })));
    expect(screen.getByLabelText("任务状态 Persist task")).toHaveValue("done");
  });

  it("patches manual review item status", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (String(url).endsWith("/review")) {
        return ok([{ id: "review-1", filePath: "src/LoginForm.jsx", changeSummary: "Copy change", reason: "Maps to DSL", requirementMapping: "login", riskLevel: "P1", testStatus: "pending", humanStatus: "pending" }]);
      }
      if (String(url).endsWith("/review-items/review-1") && options?.method === "PATCH") {
        return ok({ id: "review-1", humanStatus: "approved", humanComment: "" });
      }
      return ok({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReviewCheckWorkbench
        activeRequirement={requirement}
        agentWorkflow={{ runId: "RUN-1" }}
        onOpenPr={() => {}}
      />
    );

    await screen.findByText("src/LoginForm.jsx");
    fireEvent.change(screen.getByLabelText("人工审阅状态 src/LoginForm.jsx"), { target: { value: "approved" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/review-items/review-1", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ humanStatus: "approved" })
    })));
    expect(screen.getByLabelText("人工审阅状态 src/LoginForm.jsx")).toHaveValue("approved");
  });

  it("saves PR draft edits and checklist state", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (String(url).endsWith("/pr-draft") && !options?.method) {
        return ok({
          id: "pr-1",
          requirementId: "req-1",
          runId: "RUN-1",
          title: "Draft title",
          summary: "Line one",
          body: "Initial body",
          checklistJson: [{ text: "Dry-run reviewed", checked: false }],
          status: "draft"
        });
      }
      if (String(url).endsWith("/requirements/req-1/pr-draft") && options?.method === "POST") {
        return ok({ id: "pr-1", title: "Saved title", checklistJson: [{ text: "Dry-run reviewed", checked: true }] });
      }
      return ok({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PRWorkbench activeRequirement={requirement} agentWorkflow={{ runId: "RUN-1" }} />);

    const titleInput = await screen.findByLabelText("PR 标题");
    fireEvent.change(titleInput, { target: { value: "Saved title" } });
    fireEvent.click(screen.getByLabelText("Dry-run reviewed"));
    fireEvent.click(screen.getByRole("button", { name: "保存 PR 草稿" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/requirements/req-1/pr-draft", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("Saved title")
    })));
    const patchBody = JSON.parse(fetchMock.mock.calls.find(([url, options]) =>
      String(url).endsWith("/requirements/req-1/pr-draft") && options?.method === "POST"
    )[1].body);
    expect(patchBody.checklistJson).toEqual([{ text: "Dry-run reviewed", checked: true }]);
  });

  it("shows readable API errors and keeps the page shell scroll locked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ ok: false, data: null, error: { code: "db_failed", message: "database is locked" } })
    })));

    render(
      <DesignPlanningWorkbench
        activeProject={project}
        activeRequirement={requirement}
        agentWorkflow={{ status: "idle", latestReturn: "No run", artifacts: {} }}
        onAgentWorkflowChange={() => {}}
      />
    );

    await screen.findByText(/设计规划加载失败：database is locked/);

    const css = fs.readFileSync("src/styles.css", "utf8");
    expect(css).toMatch(/html,\s*body,\s*#root\s*{[\s\S]*overflow:\s*hidden;/);
    expect(css).toMatch(/\.workspace-shell\s*{[\s\S]*overflow:\s*hidden;/);
  });
});

function ok(data, status = 200) {
  return {
    ok: true,
    status,
    statusText: "OK",
    json: async () => ({ ok: true, data, error: null })
  };
}
