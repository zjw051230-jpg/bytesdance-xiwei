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
    expect(screen.getByTestId("workspace-shell")).toBeInTheDocument();

    await screen.findByRole("button", { name: "Refresh Survives" });
    expect(fetchMock.mock.calls.some(([url, options]) => String(url) === "/api/projects" && options?.method === "POST")).toBe(true);
  });

  it("patches a design planning task status", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith("/requirements/req-1") && !target.endsWith("/design-plan")) {
        return ok({ ...requirement, goal: "Persisted requirement goal", status: "ready" });
      }
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

  it("renders design planning requirement, plan, and tasks from live API envelopes", async () => {
    const fetchMock = vi.fn(async (url) => {
      const target = String(url);
      if (target.endsWith("/requirements/req-1") && !target.endsWith("/design-plan")) {
        return ok({
          ...requirement,
          title: "Live requirement",
          goal: "Live backend goal",
          status: "ready",
          readiness: "ready_for_agent",
          handoffDecision: "handoff_to_agent"
        });
      }
      if (target.endsWith("/design-plan")) {
        return ok({
          id: "plan-live",
          title: "Live design plan",
          status: "in_progress",
          currentStage: "architecture",
          owner: "Design Lead",
          overallProgress: 64,
          milestones: [{ title: "API mapping", status: "running", description: "Wire live APIs" }],
          blockers: [{ title: "Schema gap" }],
          watchedRisks: [{ title: "Backend field missing" }],
          nextActions: [{ title: "Review UI states", priority: "P1" }],
          latestFeedback: "Backend feedback is visible",
          updatedAt: "2026-06-11"
        });
      }
      if (target.endsWith("/tasks")) {
        return ok([
          { id: "task-live-1", title: "Render live task", owner: "Frontend", status: "running", dueDate: "2026-06-12", priority: "P1" },
          { id: "task-live-2", title: "Verify empty states", owner: "QA", status: "done", dueDate: "2026-06-13", priority: "P2" }
        ]);
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

    await screen.findByText("Live requirement");
    expect(screen.getByText("Live backend goal")).toBeInTheDocument();
    expect(screen.getByText("handoff_to_agent")).toBeInTheDocument();
    expect(screen.getByText("Live design plan")).toBeInTheDocument();
    expect(screen.getByText("architecture")).toBeInTheDocument();
    expect(screen.getByText("Design Lead")).toBeInTheDocument();
    expect(screen.getByText("API mapping")).toBeInTheDocument();
    expect(screen.getByText("Backend field missing")).toBeInTheDocument();
    expect(screen.getByText("Review UI states")).toBeInTheDocument();
    expect(screen.getByText("Backend feedback is visible")).toBeInTheDocument();
    expect(screen.getByText("Render live task")).toBeInTheDocument();
    expect(screen.getByText("Verify empty states")).toBeInTheDocument();
    expect(screen.getAllByText("64%").length).toBeGreaterThan(0);
  });

  it("shows empty states when design plan or planning tasks are absent", async () => {
    const fetchMock = vi.fn(async (url) => {
      const target = String(url);
      if (target.endsWith("/requirements/req-1") && !target.endsWith("/design-plan")) return ok(requirement);
      if (target.endsWith("/design-plan")) {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: async () => ({ ok: false, data: null, error: { code: "design_plan_not_found", message: "Design plan not found" } })
        };
      }
      return ok([]);
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

    await screen.findByTestId("design-plan-empty");
    expect(screen.getAllByText("No design plan yet").length).toBeGreaterThan(0);
    expect(screen.getByTestId("planning-tasks-empty")).toHaveTextContent("No planning tasks yet");
  });

  it("shows planning task empty state for an existing plan with no tasks", async () => {
    const fetchMock = vi.fn(async (url) => {
      const target = String(url);
      if (target.endsWith("/requirements/req-1") && !target.endsWith("/design-plan")) return ok(requirement);
      if (target.endsWith("/design-plan")) return ok({ id: "plan-empty-tasks", title: "Plan with no tasks", currentStage: "design" });
      if (target.endsWith("/tasks")) return ok([]);
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

    await screen.findByText("Plan with no tasks");
    expect(screen.getByTestId("planning-tasks-empty")).toHaveTextContent("No planning tasks yet");
  });

  it("creates a design plan through the live POST API", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith("/requirements/req-1") && !target.endsWith("/design-plan")) return ok(requirement);
      if (target.endsWith("/design-plan") && options?.method === "POST") {
        return ok({ id: "plan-created", title: "Persist login guidance", currentStage: "design", overallProgress: 0 }, 201);
      }
      if (target.endsWith("/design-plan")) {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: async () => ({ ok: false, data: null, error: { code: "design_plan_not_found", message: "Design plan not found" } })
        };
      }
      if (target.endsWith("/tasks")) return ok([]);
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

    fireEvent.click(await screen.findByRole("button", { name: /Create Design Plan/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/requirements/req-1/design-plan", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("Persist login guidance")
    })));
    await waitFor(() => expect(screen.getAllByText("Persist login guidance").length).toBeGreaterThan(0));
  });

  it("keeps the real Agent run entry enabled and calls the live Agent API", async () => {
    const projectWithPath = { ...project, localPath: "C:\\Users\\www30\\Desktop\\repo" };
    const fetchMock = vi.fn(async (url) => {
      const target = String(url);
      if (target.endsWith("/requirements/req-1") && !target.endsWith("/design-plan")) return ok(requirement);
      if (target.endsWith("/design-plan")) return ok({ id: "plan-agent", title: "Agent plan", currentStage: "design" });
      if (target.endsWith("/tasks")) return ok([]);
      if (target.endsWith("/api/agent/run")) return ok({ runId: "RUN-live", status: "completed", artifacts: {} });
      if (target.endsWith("/api/agent/runs/RUN-live")) return ok({ runId: "RUN-live", status: "completed", latestReturn: "Agent finished" });
      if (target.endsWith("/api/agent/runs/RUN-live/artifacts")) return ok({ artifacts: {} });
      return ok({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <DesignPlanningWorkbench
        activeProject={projectWithPath}
        activeRequirement={requirement}
        agentWorkflow={{ status: "idle", latestReturn: "No run", artifacts: {} }}
        onAgentWorkflowChange={() => {}}
      />
    );

    const runButtons = await screen.findAllByRole("button", { name: /Start real Agent run/ });
    expect(runButtons[0]).not.toBeDisabled();
    fireEvent.click(runButtons[0]);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/agent/run", expect.objectContaining({ method: "POST" })));
    const runBody = JSON.parse(fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/agent/run"))[1].body);
    expect(runBody.dryRun).toBe(false);
    expect(runBody.agentProvider).toBe("agent2");
    expect(runBody.targetRepoPath).toBe("C:\\Users\\www30\\Desktop\\repo");
  });

  it("does not import design planning mocks or use mock fallback in production page code", () => {
    const pageSource = fs.readFileSync("src/components/DesignPlanningWorkbench.jsx", "utf8");
    expect(pageSource).not.toMatch(/from\s+["'][^"']*mocks|mockData|fallbackMock|dummyData|staticData|sampleData/);
    expect(pageSource).not.toMatch(/\|\|\s*mock|catch[\s\S]{0,120}mock/i);
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

  it("shows an empty review state instead of hardcoded audit files when no review data exists", async () => {
    render(
      <ReviewCheckWorkbench
        activeProject={project}
        activeRequirement={null}
        agentWorkflow={{ runId: "", review: null }}
        onOpenPr={() => {}}
      />
    );

    expect(screen.queryByText("src/components/LoginForm.jsx")).not.toBeInTheDocument();
    expect(screen.queryByText("src/components/ErrorMessage.jsx")).not.toBeInTheDocument();
    expect(screen.getByText(/暂无 Agent real-run 审计结果/)).toBeInTheDocument();
    expect(screen.getByText("暂无变更文件")).toBeInTheDocument();
  });

  it("maps review changed files from agent dry-run data when persistence data is unavailable", async () => {
    render(
      <ReviewCheckWorkbench
        activeProject={project}
        activeRequirement={null}
        agentWorkflow={{
          runId: "",
          review: {
            status: "needs_review",
            summary: "Agent review from dry-run output",
            changedFiles: [
              {
                file: "src/features/LoginNotice.jsx",
                changeSummary: "Render actionable failure guidance",
                why: "Maps to DSL acceptance",
                risk: "Copy must not leak account existence",
                requirementPoint: "login failure guidance"
              }
            ],
            tests: [{ command: "npm test", status: "passed" }],
            manualConfirmations: ["Review copy with PM"]
          }
        }}
        onOpenPr={() => {}}
      />
    );

    expect(screen.getByText("src/features/LoginNotice.jsx")).toBeInTheDocument();
    expect(screen.queryByText("src/components/LoginForm.jsx")).not.toBeInTheDocument();
  });

  it("shows rollback diff and reverted state in the Review page", async () => {
    let reverted = false;
    const fetchMock = vi.fn(async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith("/review")) {
        return ok([{ id: "review-1", filePath: "src/App.jsx", changeSummary: "Theme update", reason: "Maps to DSL", requirementMapping: "theme", riskLevel: "P1", testStatus: "pending", humanStatus: reverted ? "reverted" : "pending" }]);
      }
      if (target.endsWith("/changes") && !options?.method) {
        return ok({
          runId: "RUN-rollback-ui",
          available: true,
          verificationStatus: reverted ? "stale" : "fresh",
          baselineSnapshot: { id: "snapshot-RUN-rollback-ui-baseline", adapterType: "copy" },
          changes: [{
            id: "change-app",
            filePath: "src/App.jsx",
            status: reverted ? "reverted" : "changed",
            changeType: "modified",
            changeSummary: "Theme update",
            canRevert: !reverted
          }],
          rollbackHistory: reverted ? [{ id: "rollback-1", operationType: "file_revert", status: "completed" }] : []
        });
      }
      if (target.endsWith("/changes/change-app/diff")) {
        return ok({ filePath: "src/App.jsx", unifiedDiff: "--- a/src/App.jsx\n+++ b/src/App.jsx\n-old\n+new" });
      }
      if (target.endsWith("/rollback/file") && options?.method === "POST") {
        reverted = true;
        return ok({ runId: "RUN-rollback-ui", change: { id: "change-app", filePath: "src/App.jsx", status: "reverted" }, verificationStatus: "stale" });
      }
      return ok({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReviewCheckWorkbench
        activeProject={project}
        activeRequirement={requirement}
        agentWorkflow={{ runId: "RUN-rollback-ui" }}
        onOpenPr={() => {}}
      />
    );

    await waitFor(() => expect(screen.getAllByText("src/App.jsx").length).toBeGreaterThan(0));
    await screen.findByText(/-old/);
    fireEvent.click(screen.getByRole("button", { name: "Revert File" }));
    fireEvent.click(screen.getByRole("button", { name: "确认回退" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/agent/runs/RUN-rollback-ui/rollback/file", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ changeId: "change-app", reason: "Rejected from Review Check page." })
    })));
    await screen.findByText(/Workspace file reverted: src\/App\.jsx/);
    expect(screen.getByText(/Verification stale/)).toBeInTheDocument();
    expect(screen.getAllByText("reverted").length).toBeGreaterThan(0);
  });

  it("disables rollback controls for old Review runs without a baseline snapshot", async () => {
    const fetchMock = vi.fn(async (url) => {
      const target = String(url);
      if (target.endsWith("/review")) return ok([]);
      if (target.endsWith("/changes")) {
        return ok({
          runId: "RUN-old",
          available: false,
          reason: "workspace_not_initialized",
          verificationStatus: "unknown",
          changes: [],
          rollbackHistory: []
        });
      }
      return ok({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReviewCheckWorkbench
        activeProject={project}
        activeRequirement={requirement}
        agentWorkflow={{ runId: "RUN-old" }}
        onOpenPr={() => {}}
      />
    );

    await screen.findByText("not initialized");
    expect(screen.getByRole("button", { name: "Reset Run Workspace" })).toBeDisabled();
  });

  it("blocks stale project workflow from driving the Review preview", async () => {
    const fetchMock = vi.fn(async (url) => {
      const target = String(url);
      if (target.includes("/api/agent/runs/RUN-project-a")) {
        throw new Error(`stale run should not be requested: ${target}`);
      }
      if (target.endsWith("/projects/project-b/activity")) return ok([]);
      return ok({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReviewCheckWorkbench
        activeProject={{ ...project, id: "project-b", localPath: "C:\\repo\\conduit-b" }}
        activeRequirement={{ ...requirement, id: "req-b", projectId: "project-b" }}
        agentWorkflow={{
          runId: "RUN-project-a",
          sourceRepoPath: "C:\\repo\\conduit-a",
          workspacePath: "C:\\runs\\RUN-project-a\\workspace"
        }}
        onOpenPr={() => {}}
      />
    );

    await screen.findByText(/已阻止旧工程 Agent Run 预览/);
    expect(screen.queryByTitle("Conduit login page")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/agent/runs/RUN-project-a"))).toBe(false);
  });

  it("saves PR draft edits through the live PR API", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (String(url).endsWith("/requirements/req-1") && !String(url).endsWith("/pr-draft")) {
        return ok({
          id: "req-1",
          projectId: "project-1",
          title: "Persisted requirement",
          goal: "Persisted PR review",
          dslReadiness: "ready_for_agent",
          handoffDecision: "handoff_to_agent"
        });
      }
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
      if (String(url).endsWith("/agent/runs/RUN-1")) {
        return ok({ id: "RUN-1", runId: "RUN-1", status: "completed", verificationStatus: "current" });
      }
      if (String(url).endsWith("/agent/runs/RUN-1/review")) {
        return ok([]);
      }
      if (String(url).endsWith("/agent/runs/RUN-1/artifacts")) {
        return ok({ runId: "RUN-1", artifactList: [{ id: "artifact-1", name: "report.md", type: "report", redactionState: "safe" }] });
      }
      if (String(url).endsWith("/agent/runs/RUN-1/changes")) {
        return ok({ runId: "RUN-1", changes: [{ id: "change-1", filePath: "src/App.jsx", status: "changed" }], verificationStatus: "current" });
      }
      if (String(url).endsWith("/projects/project-1/activity")) {
        return ok([]);
      }
      if (String(url).endsWith("/requirements/req-1/pr-draft") && options?.method === "POST") {
        return ok({ id: "pr-1", title: "Saved title", checklistJson: [{ text: "Dry-run reviewed", checked: true }] });
      }
      return ok({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PRWorkbench activeRequirement={requirement} agentWorkflow={{ runId: "RUN-1" }} />);

    const titleInput = await screen.findByLabelText("PR title");
    fireEvent.change(titleInput, { target: { value: "Saved title" } });
    fireEvent.click(screen.getByRole("button", { name: /Save Draft/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/requirements/req-1/pr-draft", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("Saved title")
    })));
    const patchBody = JSON.parse(fetchMock.mock.calls.find(([url, options]) =>
      String(url).endsWith("/requirements/req-1/pr-draft") && options?.method === "POST"
    )[1].body);
    expect(patchBody.checklistJson).toEqual([{ text: "Dry-run reviewed", checked: false, blocking: false }]);
  });

  it("shows an empty PR state instead of fallback PR draft when no draft exists", async () => {
    render(<PRWorkbench activeRequirement={null} agentWorkflow={{ runId: "", prDraft: null }} />);

    expect(screen.queryByText("Agent dry-run PR draft pending")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Dry-run artifacts reviewed")).not.toBeInTheDocument();
    await screen.findByTestId("pr-draft-empty");
    expect(screen.getByText(/EmptyState/)).toBeInTheDocument();
    expect(screen.queryByText("鏆傛棤 checklist")).not.toBeInTheDocument();
  });

  it("does not map PR draft from agent dry-run data when persistence data is unavailable", async () => {
    render(
      <PRWorkbench
        activeRequirement={null}
        agentWorkflow={{
          runId: "RUN-DRY-1",
          prDraft: {
            title: "Improve login failure guidance",
            summary: ["Clarifies next steps for failed login"],
            body: "Dry-run PR body",
            changedFiles: ["src/features/LoginNotice.jsx"],
            checklist: ["PM reviewed failure copy"]
          }
        }}
      />
    );

    await screen.findByTestId("pr-draft-empty");
    expect(screen.queryByDisplayValue("Improve login failure guidance")).not.toBeInTheDocument();
    expect(screen.queryByText("src/features/LoginNotice.jsx")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("PM reviewed failure copy")).not.toBeInTheDocument();
    expect(screen.queryByText("Agent dry-run PR draft pending")).not.toBeInTheDocument();
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
