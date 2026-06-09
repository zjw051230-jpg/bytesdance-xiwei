import { runStandaloneE2E } from "../e2e/runner/standalone-e2e.mjs";

const dryRun = process.argv.includes("--dry-run");

try {
  const report = await runStandaloneE2E({
    dryRun,
    requireStandaloneConfig: true,
    allowExternalFallback: false
  });
  console.log(JSON.stringify({
    status: report.status,
    dryRun: report.dryRun,
    realLlmCalls: report.realLlmCalls,
    mockLlmUsed: report.mockLlmUsed,
    mockRepoUsed: report.mockRepoUsed,
    mockTestUsed: report.mockTestUsed,
    realWritePerformed: report.realWritePerformed,
    configSource: report.config.configSource,
    model: report.config.model,
    outputDir: report.outputDir
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    status: "failed",
    code: error.code || "standalone_e2e_failed",
    message: String(error.message || error),
    details: error.details || {}
  }, null, 2));
  process.exit(1);
}
