import fs from "node:fs";

const requiredFiles = [
  "src/components/WorkspaceTopTabs.jsx",
  "src/components/DesignPlanningWorkbench.jsx",
  "src/data/planningWorkbenchData.js"
];

const missing = requiredFiles.filter((file) => !fs.existsSync(file));

if (missing.length > 0) {
  console.error(`Missing design planning smoke files: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("smoke: design planning workspace files present");
