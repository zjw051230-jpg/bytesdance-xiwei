import fs from "node:fs";

const requiredFiles = [
  "dist/index.html",
  "src/App.jsx",
  "src/styles.css",
  "src/components/AppShell.jsx",
  "src/components/TaskInspector.jsx",
  "src/components/WorkspaceShell.jsx",
  "src/components/ProjectRail.jsx",
  "src/components/ProjectRailItem.jsx",
  "src/components/WorkspaceTopTabs.jsx",
  "src/components/DesignPlanningWorkbench.jsx",
  "src/components/ReviewCheckWorkbench.jsx",
  "src/components/PRWorkbench.jsx",
  "src/components/WorkspaceProjectPicker.jsx",
  "src/components/DSLWorkbench.jsx",
  "src/components/ClarificationChat.jsx",
  "src/components/DSLStatusConsole.jsx",
  "src/components/RequirementReportModal.jsx",
  "src/components/ReportQualityPanel.jsx",
  "src/api/dslClient.js",
  "src/api/agentClient.js",
  "src/adapters/dslArtifactAdapter.js",
  "src/data/agentWorkflowData.js",
  "src/components/ProjectSelectCard.jsx",
  "src/components/NewProjectModal.jsx",
  "src/data/workspaceProjects.js",
  "src/data/planningWorkbenchData.js",
  "src/data/dslWorkbenchData.js",
  "server/index.js",
  "server/routes/agentExecution.js",
  "server/routes/dslRuns.js",
  "server/routes/artifacts.js",
  "server/services/runnerService.js",
  "server/services/agentExecutionService.js",
  "server/services/artifactService.js",
  "server/services/redactionService.js",
  "server/services/runStore.js"
];

const missing = requiredFiles.filter((file) => !fs.existsSync(file));

if (missing.length > 0) {
  console.error(`Missing smoke files: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("smoke: monitor console, workspace picker, project rail, DSL workbench, and design planning files present");
