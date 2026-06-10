const express = require("express");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DEFAULT_TIMEOUT_MS = 120000;

function resolveAgentRoot() {
  return path.resolve(__dirname, "../../../../../..");
}

function normalizeMode(mode) {
  return mode === "preview" ? "preview" : "dry_run";
}

function buildAgentEnv({ repoPath, mode, skill } = {}) {
  const env = { ...process.env };

  env.AGENT_OUTPUT_JSON = "1";
  delete env.AGENT_REPO_CONFIRM;
  delete env.AGENT_TEST_RUN;
  delete env.AGENT_TEST_CONFIRM;
  delete env.AGENT_VERIFY;

  if (repoPath) {
    env.AGENT_REPO_MODE = "real";
    env.AGENT_REPO_ROOT = String(repoPath);
    if (normalizeMode(mode) === "preview") {
      env.AGENT_REPO_APPLY = "1";
    } else {
      delete env.AGENT_REPO_APPLY;
    }
  } else {
    delete env.AGENT_REPO_MODE;
    delete env.AGENT_REPO_ROOT;
    delete env.AGENT_REPO_APPLY;
  }

  if (skill) {
    env.AGENT_REQUESTED_SKILL = String(skill);
  } else {
    delete env.AGENT_REQUESTED_SKILL;
  }

  return env;
}

function parseAgentStdout(stdout) {
  const trimmed = String(stdout || "").trim();
  if (!trimmed) {
    throw new Error("Python agent did not emit JSON stdout");
  }
  return JSON.parse(trimmed);
}

function runPythonAgent({
  task,
  repoPath,
  skill,
  mode,
  agentRoot = resolveAgentRoot(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pythonCommand = process.env.PYTHON || "python",
  spawnImpl = spawn,
} = {}) {
  return new Promise((resolve) => {
    if (!task || typeof task !== "string" || !task.trim()) {
      resolve({
        ok: false,
        result: null,
        error: {
          code: "INVALID_TASK",
          message: "task is required",
        },
        stderr: "",
        exit_code: null,
      });
      return;
    }

    const child = spawnImpl(pythonCommand, ["agent_core/main.py"], {
      cwd: agentRoot,
      env: buildAgentEnv({ repoPath, mode, skill }),
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (child.kill) child.kill("SIGKILL");
      resolve({
        ok: false,
        result: null,
        error: {
          code: "PYTHON_AGENT_TIMEOUT",
          message: `Python agent timed out after ${timeoutMs}ms`,
        },
        stderr,
        exit_code: null,
      });
    }, timeoutMs);

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }
    if (child.stdin) {
      child.stdin.end(task);
    }

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        ok: false,
        result: null,
        error: {
          code: "PYTHON_AGENT_SPAWN_FAILED",
          message: error.message,
        },
        stderr,
        exit_code: null,
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      let parsed;
      try {
        parsed = parseAgentStdout(stdout);
      } catch (error) {
        resolve({
          ok: false,
          result: null,
          error: {
            code: "PYTHON_AGENT_JSON_PARSE_FAILED",
            message: error.message,
            stdout,
          },
          stderr,
          exit_code: code,
        });
        return;
      }

      if (code !== 0) {
        resolve({
          ok: false,
          result: parsed,
          error: {
            code: "PYTHON_AGENT_EXIT_NONZERO",
            message: `Python agent exited with code ${code}`,
          },
          stderr,
          exit_code: code,
        });
        return;
      }

      resolve({
        ok: true,
        result: parsed,
        error: null,
        stderr,
        exit_code: code,
      });
    });
  });
}

function createAgentRunRouter(options = {}) {
  const router = express.Router();
  const runner = options.runPythonAgent || ((payload) => runPythonAgent({ ...options, ...payload }));

  router.post("/api/agent/run", async (req, res) => {
    const body = req.body || {};
    const response = await runner({
      task: body.task,
      repoPath: body.repoPath,
      skill: body.skill,
      mode: body.mode,
    });
    res.status(response.ok ? 200 : 502).json({
      ok: response.ok,
      result: response.result || null,
      error: response.error || null,
      stderr: response.stderr || "",
    });
  });

  return router;
}

module.exports = {
  buildAgentEnv,
  createAgentRunRouter,
  parseAgentStdout,
  runPythonAgent,
};
