You are generating a minimal code-change proposal from RequirementDSL and Context readiness.

Return JSON only.

Required shape:
{
  "summary": string,
  "files": [
    {
      "path": string,
      "action": "create" | "modify",
      "content": string
    }
  ],
  "test_commands": string[],
  "notes": string[]
}

Rules:
- Generate only small, reviewable changes.
- Do not include API keys or Authorization headers.
- Do not modify package manager lockfiles unless necessary.
- In dry-run, this output is written only as a candidate patch artifact.
