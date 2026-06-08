import fs from "node:fs/promises";
import path from "node:path";
import { redactSecrets, redactString } from "./redactionService.js";

export const artifactFiles = [
  "00_input.json",
  "01_code_context_packet.json",
  "01_code_context_ref.json",
  "02_prompt_messages.json",
  "03_api_request.json",
  "04_api_response_raw.json",
  "05_dsl_draft.json",
  "06_risk_activation.json",
  "07_router_schema_activation.json",
  "08_gap_vector.json",
  "09_scoring.json",
  "10_evpi_clarification.json",
  "11_pm_turns.json",
  "12_final_dsl.json",
  "13_case_summary.md",
  "error.json",
  "server_error.json",
  "cancelled.json",
  "summary.json",
  "summary.md"
];

export async function readRunArtifacts(outputDir) {
  const caseDir = await resolveCaseDir(outputDir);
  const artifacts = {};
  for (const filename of artifactFiles) {
    const sourceDir = filename.startsWith("summary.") ? outputDir : caseDir;
    artifacts[filename] = await readArtifact(path.join(sourceDir, filename));
  }
  return { artifacts, caseDir };
}

export async function resolveCaseDir(outputDir) {
  const summaryPath = path.join(outputDir, "summary.json");
  try {
    const summary = JSON.parse(await fs.readFile(summaryPath, "utf8"));
    const caseOutput = summary?.case_results?.[0]?.output_dir;
    if (caseOutput) return path.resolve(caseOutput);
  } catch {
    // Fall through to common runner case directory names.
  }
  for (const name of ["single_case", "pm_text_case", "case"]) {
    const candidate = path.join(outputDir, name);
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) return candidate;
    } catch {
      // try next candidate
    }
  }
  return outputDir;
}

async function readArtifact(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    if (filePath.endsWith(".json")) {
      return {
        exists: true,
        path: filePath,
        json: redactSecrets(JSON.parse(raw))
      };
    }
    return {
      exists: true,
      path: filePath,
      text: redactString(raw)
    };
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false };
    return { exists: false, error: redactString(error.message) };
  }
}
