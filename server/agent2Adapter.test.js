// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createAgent2DryRun, mapAgent2ResultToWorkbench } from "./services/agent2Adapter.js";

const sampleAgent2Result = {
  task_id: "demo_task",
  run_id: "run_demo_task",
  status: "success",
  raw_status: "SUCCESS",
  task_name: "Add article word count and reading time",
  selected_actions: [
    { selected_action: "plan_task", selected_tool: "make_plan", reason: "Plan from Requirement DSL" },
    { selected_action: "locate_files", selected_tool: "locate_files", reason: "Locate target files" },
    { selected_action: "review_patch", selected_tool: "review_patch", reason: "Review generated patch" }
  ],
  located_files: {
    files: [
      {
        relative_path: "frontend/src/routes/Article/Article.jsx",
        reason: "Real repository file matched locator search terms"
      }
    ]
  },
  patch_plan: {
    summary: "Prepare a low-risk frontend patch for article stats display.",
    patches: [
      {
        file: "frontend/src/routes/Article/Article.jsx",
        operation: "replace",
        changes: ["Add word count calculation", "Add reading time calculation"],
        reason: "Article detail page needs word count and reading time display",
        risk_level: "low"
      }
    ]
  },
  review_result: {
    approved: false,
    risk_level: "high",
    summary: "Patch plan has review issues that should be resolved before execution.",
    issues: ["Patch validation failed"]
  },
  execution_result: {
    executed: false,
    mode: "dry_run",
    summary: "Patch execution blocked because review was not approved"
  },
  verification_result: {
    passed: false,
    verified: false,
    reason: "Execution result missing or not executed"
  },
  pr_draft: {
    title: "Add article word count and reading time",
    summary: "Prepare a low-risk frontend patch for article stats display.",
    changed_files: [
      {
        file: "frontend/src/routes/Article/Article.jsx",
        operation: "replace",
        status: "planned",
        risk_level: "low"
      }
    ],
    test_commands: ["npm run lint", "npm test"],
    manual_checklist: ["Review generated patch preview before any real write."]
  },
  safety_gates: {
    repo_apply_enabled: false,
    repo_confirmed: false,
    test_run_enabled: false,
    test_confirmed: false,
    repo_mode: "mock"
  }
};

describe("Agent(2) dry-run adapter", () => {
  it("maps Agent(2) JSON output into the Workbench run shape without enabling writes", () => {
    const run = mapAgent2ResultToWorkbench(sampleAgent2Result, {
      runId: "RUN-agent2-test",
      projectId: "conduit-realworld-example-app",
      requirementId: "REQ-CONDUIT-L1-ARTICLE-STATS",
      taskTitle: "Article stats",
      targetRepoPath: "F:\\safe-preview-target"
    });

    expect(run.runId).toBe("RUN-agent2-test");
    expect(run.status).toBe("completed");
    expect(run.dryRun).toBe(true);
    expect(run.realWritePerformed).toBe(false);
    expect(run.plan.mode).toBe("agent2_dry_run_adapter");
    expect(run.plan.steps.map((step) => step.name)).toEqual(expect.arrayContaining([
      "Analyze RequirementDSL",
      "Locate Files",
      "Review Patch"
    ]));
    expect(run.review.changedFiles[0].file).toBe("frontend/src/routes/Article/Article.jsx");
    expect(run.prDraft.title).toBe("Add article word count and reading time");
    expect(run.prDraft.changedFiles).toContain("frontend/src/routes/Article/Article.jsx");
    expect(run.artifacts["agent2_result_preview.json"].json.safety.realWritePerformed).toBe(false);
    expect(run.context.executionBoundary.blockedModes).toEqual(expect.arrayContaining([
      "AGENT_REPO_CONFIRM=YES",
      "AGENT_TEST_CONFIRM=YES",
      "real_repo_apply"
    ]));
  });

  it("creates a deterministic dry-run preview when no Agent(2) runtime is called", () => {
    const run = createAgent2DryRun({
      projectId: "conduit-realworld-example-app",
      taskTitle: "Agent2 dry-run request",
      dryRun: false
    }, {
      runId: "RUN-forced-dry-run"
    });

    expect(run.runId).toBe("RUN-forced-dry-run");
    expect(run.dryRun).toBe(true);
    expect(run.realWritePerformed).toBe(false);
    expect(run.latestReturn).toContain("Agent(2) dry-run");
    expect(run.plan.mode).toBe("agent2_dry_run_adapter");
    expect(run.artifacts["agent2_result_preview.json"].json.source).toBe("workbench_fixture");
  });

  it("surfaces review-gated real execution as blocked instead of a successful write", () => {
    const run = mapAgent2ResultToWorkbench({
      ...sampleAgent2Result,
      patch_plan: {
        summary: "Prepare theme patch.",
        patches: [{ path: "frontend/src/index.css", operation: "replace_file", reason: "Theme update", risk_level: "low" }]
      },
      pr_draft: {
        title: "Apply Conduit theme",
        changed_files: [{ file: "frontend/src/index.css", operation: "replace_file", risk_level: "low" }]
      },
      review_result: {
        approved: false,
        risk_level: "high",
        issues: ["Patch plan does not target any located file candidate"]
      },
      execution_result: {
        executed: false,
        mode: "dry_run",
        files: [],
        summary: "Patch execution blocked because review was not approved"
      }
    }, {
      runId: "RUN-real-blocked",
      dryRun: false,
      realExecution: true,
      taskTitle: "Apply Conduit theme",
      targetRepoPath: "F:\\safe-real-target"
    });

    expect(run.dryRun).toBe(false);
    expect(run.realWritePerformed).toBe(false);
    expect(run.latestReturn).toContain("Patch execution blocked because review was not approved");
    expect(run.review.status).toBe("blocked");
    expect(run.executionResult.summary).toBe("Patch execution blocked because review was not approved");
    expect(run.review.changedFiles[0].file).toBe("frontend/src/index.css");
  });

  it("maps Agent(2) runtime failures to failed Workbench runs", () => {
    const run = mapAgent2ResultToWorkbench({
      status: "failed",
      raw_status: "FAILED",
      summary: {
        message: "[Errno 22] Invalid argument while saving state"
      },
      execution_result: {},
      review_result: {},
      patch_plan: {}
    }, {
      runId: "RUN-agent2-failed",
      dryRun: false,
      realExecution: true,
      taskTitle: "Apply Conduit theme",
      targetRepoPath: "F:\\safe-real-target"
    });

    expect(run.status).toBe("failed");
    expect(run.realWritePerformed).toBe(false);
    expect(run.latestReturn).toContain("[Errno 22] Invalid argument");
    expect(run.executionResult.summary).toContain("[Errno 22] Invalid argument");
    expect(run.review.status).toBe("blocked");
  });
});
