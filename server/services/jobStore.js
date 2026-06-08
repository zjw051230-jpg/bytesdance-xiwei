const jobs = new Map();
const runtimes = new Map();

export function createJob(job) {
  const now = new Date().toISOString();
  const record = {
    runId: job.runId,
    originalRunId: job.originalRunId || "",
    status: job.status || "running",
    startedAt: job.startedAt || now,
    finishedAt: "",
    elapsedMs: 0,
    outputDir: job.outputDir,
    relativeOutputDir: job.relativeOutputDir,
    pid: job.pid ?? null,
    lastMessage: job.lastMessage || "DSL runner started",
    error: null,
    artifacts: job.artifacts || { available: [], partial: true },
    requestBody: job.requestBody || {}
  };
  jobs.set(record.runId, record);
  return publicJob(record);
}

export function updateJob(runId, patch) {
  const current = jobs.get(runId);
  if (!current) return null;
  const next = {
    ...current,
    ...patch,
    elapsedMs: elapsedMs(current.startedAt, patch.finishedAt)
  };
  jobs.set(runId, next);
  return publicJob(next);
}

export function getJob(runId) {
  const job = jobs.get(runId);
  if (!job) return null;
  return publicJob({
    ...job,
    elapsedMs: elapsedMs(job.startedAt, job.finishedAt)
  });
}

export function getInternalJob(runId) {
  return jobs.get(runId) || null;
}

export function listJobs() {
  return [...jobs.values()].map((job) => getJob(job.runId));
}

export function markFinished(runId, patch = {}) {
  clearJobRuntime(runId);
  return updateJob(runId, {
    ...patch,
    status: patch.status || "passed",
    finishedAt: patch.finishedAt || new Date().toISOString(),
    pid: null,
    lastMessage: patch.lastMessage || "DSL runner finished"
  });
}

export function markFailed(runId, error, patch = {}) {
  clearJobRuntime(runId);
  return updateJob(runId, {
    ...patch,
    status: "failed",
    finishedAt: patch.finishedAt || new Date().toISOString(),
    pid: null,
    error,
    lastMessage: patch.lastMessage || "DSL runner failed"
  });
}

export function markTimeout(runId, error, patch = {}) {
  clearJobRuntime(runId);
  return updateJob(runId, {
    ...patch,
    status: "timeout",
    finishedAt: patch.finishedAt || new Date().toISOString(),
    pid: null,
    error,
    lastMessage: patch.lastMessage || "DSL runner timed out"
  });
}

export function markCancelled(runId, patch = {}) {
  clearJobRuntime(runId);
  return updateJob(runId, {
    ...patch,
    status: "cancelled",
    finishedAt: patch.finishedAt || new Date().toISOString(),
    pid: null,
    error: patch.error || {
      code: "runner_cancelled",
      message: "Run was cancelled by user",
      details: {}
    },
    lastMessage: patch.lastMessage || "DSL runner cancelled"
  });
}

export function setJobRuntime(runId, runtime) {
  runtimes.set(runId, runtime);
}

export function getJobRuntime(runId) {
  return runtimes.get(runId) || null;
}

export function clearJobRuntime(runId) {
  const runtime = runtimes.get(runId);
  if (runtime?.clear) runtime.clear();
  runtimes.delete(runId);
}

export function resetJobStore() {
  for (const runtime of runtimes.values()) {
    if (runtime?.clear) runtime.clear();
  }
  runtimes.clear();
  jobs.clear();
}

function publicJob(job) {
  const { requestBody, ...safe } = job;
  return { ...safe };
}

function elapsedMs(startedAt, finishedAt) {
  const start = Date.parse(startedAt || "");
  if (!Number.isFinite(start)) return 0;
  const end = finishedAt ? Date.parse(finishedAt) : Date.now();
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, end - start);
}
