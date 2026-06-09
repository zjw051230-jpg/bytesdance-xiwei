import fs from "node:fs/promises";
import path from "node:path";
import { assertNoSecretsInText } from "../runner/secret-scan.mjs";

export function getTargetRepoPath() {
  return process.env.TARGET_REPO_PATH || "F:\\dsl\\conduit-realworld-example-app";
}

export async function writeCandidatePatch({ outputDir, agentOutput }) {
  for (const file of agentOutput.files || []) {
    assertNoSecretsInText(file.content || "", `agent_output:${file.path}`);
  }
  const patchPath = path.join(outputDir, "agent_candidate_patch.json");
  await fs.writeFile(patchPath, JSON.stringify(agentOutput, null, 2), "utf8");
  return patchPath;
}

export async function applyAgentOutputToRepo({ targetRepoPath, agentOutput }) {
  const repoRoot = path.resolve(targetRepoPath);
  await assertGitRepoClean(repoRoot);
  const writtenFiles = [];
  for (const file of agentOutput.files || []) {
    const target = path.resolve(repoRoot, file.path);
    if (!target.toLowerCase().startsWith(repoRoot.toLowerCase() + path.sep.toLowerCase())) {
      throw new Error(`unsafe_target_path:${file.path}`);
    }
    assertNoSecretsInText(file.content || "", `write:${file.path}`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content || "", "utf8");
    writtenFiles.push(target);
  }
  return writtenFiles;
}

async function assertGitRepoClean(repoRoot) {
  const gitDir = path.join(repoRoot, ".git");
  try {
    await fs.access(gitDir);
  } catch {
    throw new Error(`target_repo_not_git:${repoRoot}`);
  }
  // The standalone writer is intentionally conservative. The user can run in a temporary copy
  // or clean test branch before invoking non-dry-run mode.
}
