import { createPersistenceService } from "../services/persistence/persistenceService.js";

export function seedWorkbenchDatabase(database) {
  const service = createPersistenceService(database);
  if (service.projects.list().length > 0) return { seeded: false };

  const project = service.projects.create({
    id: "conduit-realworld-example-app",
    name: "conduit-realworld-example-app",
    description: "Conduit RealWorld sample app workspace",
    status: "pass",
    icon: "code",
    railSubtitle: "Recently opened"
  });
  service.projects.create({
    id: "codex-workbench",
    name: "Codex Workbench",
    description: "Local Codex Workbench project",
    status: "current",
    icon: "code",
    railSubtitle: "Workbench prototype"
  });
  const requirement = service.requirements.create(project.id, {
    id: "req-login-guidance",
    title: "Login failure guidance",
    rawPmInput: "Improve login failure copy by failure reason.",
    dslJson: {
      title: "Login failure guidance",
      ready_for_agent: false,
      handoff_decision: "clarify_first"
    },
    readinessStatus: "clarify_first",
    readyForAgent: false,
    handoffDecision: "clarify_first",
    completionPercent: 72
  });
  service.clarifications.create(requirement.id, {
    id: "turn-seed-pm",
    role: "pm",
    content: "Current login failure copy is too generic; make it clearer.",
    source: "seed"
  });
  service.clarifications.create(requirement.id, {
    id: "turn-seed-system",
    role: "system",
    content: "Which failure reasons need separate copy: account missing, wrong password, locked account, network issue?",
    source: "seed"
  });
  const plan = service.designPlans.upsert(requirement.id, {
    id: "plan-login-guidance",
    title: "Login guidance design plan",
    summary: "Clarify copy, implementation boundaries, and verification tasks.",
    currentStage: "design",
    overallProgress: 45
  });
  service.planningTasks.create(plan.id, {
    id: "workitem-login-copy-map",
    title: "Map login failure reasons",
    owner: "PM",
    status: "done",
    priority: "P0",
    progress: 100
  });
  service.planningTasks.create(plan.id, {
    id: "workitem-login-ui-copy",
    title: "Design frontend copy behavior",
    owner: "Frontend",
    status: "running",
    priority: "P1",
    progress: 40
  });
  const run = service.agentRuns.create({
    id: "RUN-seed-dry-run",
    requirementId: requirement.id,
    planId: plan.id,
    status: "completed",
    dryRun: true,
    realWritePerformed: false,
    resultSummary: "Seed dry-run record for persistence smoke."
  });
  service.agentArtifacts.create(run.id, {
    id: "artifact-seed-report",
    type: "report",
    name: "seed-summary.md",
    path: "runs\\RUN-seed-dry-run\\summary.md",
    summary: "Seed artifact index only."
  });
  service.reviewItems.create(run.id, {
    id: "review-seed-login",
    filePath: "src/components/LoginForm.jsx",
    changeSummary: "Review login failure guidance copy",
    reason: "Seed review item",
    requirementMapping: requirement.id,
    riskLevel: "P1",
    testStatus: "pending",
    humanStatus: "pending"
  });
  service.prDrafts.upsert(requirement.id, {
    id: "pr-seed-login",
    runId: run.id,
    title: "Improve login failure guidance",
    summary: "Seed PR draft persisted in SQLite.",
    body: "Persistence seed PR draft.",
    checklistJson: ["Dry-run reviewed"],
    status: "draft"
  });
  service.activity.create({
    id: "activity-seed-created",
    projectId: project.id,
    requirementId: requirement.id,
    runId: run.id,
    type: "seed",
    level: "info",
    message: "Seeded persistent workbench database.",
    payloadJson: { seeded: true }
  });
  return { seeded: true, projectId: project.id, requirementId: requirement.id };
}
