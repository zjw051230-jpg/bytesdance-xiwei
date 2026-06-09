import fs from "node:fs/promises";
import path from "node:path";

export async function readCodeContext(contextPath = path.resolve("e2e", "context", "default_code_context_packet.json")) {
  try {
    return JSON.parse(await fs.readFile(contextPath, "utf8"));
  } catch {
    return {
      repo: "unknown",
      scope: "fallback_context",
      files: [],
      constraints: ["Context file missing; use conservative readiness."]
    };
  }
}

export async function writeContextArtifact({ outputDir, requirementDsl, codeContext, readiness }) {
  const context = {
    generatedAt: new Date().toISOString(),
    requirementDsl,
    codeContext,
    readiness,
    readinessSummary: {
      ready: Boolean(readiness?.ready),
      safeToWrite: Boolean(readiness?.safe_to_write),
      recommendedFiles: readiness?.recommended_files || []
    }
  };
  const filePath = path.join(outputDir, "context_readiness.json");
  await fs.writeFile(filePath, JSON.stringify(context, null, 2), "utf8");
  return { filePath, context };
}
