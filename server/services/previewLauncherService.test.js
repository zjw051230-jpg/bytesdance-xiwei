// @vitest-environment node
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPreviewStatus,
  resetPreviewLauncherForTests,
  startPreview,
  stopPreview
} from "./previewLauncherService.js";

const tempRoots = [];

afterEach(async () => {
  resetPreviewLauncherForTests();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("previewLauncherService", () => {
  it("returns project_path_missing for a missing project path", async () => {
    const result = await getPreviewStatus({
      projectId: "missing",
      localPath: path.join(os.tmpdir(), `missing-preview-${Date.now()}`)
    });

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("project_path_missing");
    expect(result.data.available).toBe(false);
  });

  it("returns preview_not_supported for a non-Conduit directory", async () => {
    const projectRoot = await createTempRoot();

    const result = await getPreviewStatus({ projectId: "plain", localPath: projectRoot });

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("preview_not_supported");
    expect(result.data.available).toBe(false);
  });

  it("does not reuse an external HTML preview without a Workbench record", async () => {
    const projectRoot = await createConduitFixture({ port: 3111 });
    const spawnImpl = vi.fn();
    const fetchImpl = vi.fn(async () => htmlResponse());

    const result = await startPreview(
      { projectId: "available", localPath: projectRoot },
      {},
      { fetchImpl, spawnImpl }
    );

    expect(result.data.status).toBe("port_in_use_external");
    expect(result.data.available).toBe(false);
    expect(result.data.owner).toBe("external");
    expect(result.data.actionRequired).toBe("close_external_port");
    expect(result.data.previewUrl).toBe("http://127.0.0.1:3111/#/login");
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it("reuses an external HTML preview when the port command line matches the requested project path", async () => {
    const projectRoot = await createConduitFixture({ port: 3113 });
    const spawnImpl = vi.fn();
    const fetchImpl = vi.fn(async () => htmlResponse());
    const portProcessResolver = vi.fn(async () => [{
      pid: 24680,
      commandLine: `"${process.execPath}" "${path.join(projectRoot, "node_modules", "vite", "bin", "vite.js")}" --host 127.0.0.1 --port 3113`
    }]);

    const result = await startPreview(
      { projectId: "external-owned", localPath: projectRoot },
      {},
      { fetchImpl, portProcessResolver, spawnImpl }
    );

    expect(result.data.status).toBe("external_verified");
    expect(result.data.available).toBe(true);
    expect(result.data.owner).toBe("external_verified");
    expect(result.data.runningProjectRoot).toBe(projectRoot);
    expect(result.data.previewUrl).toBe("http://127.0.0.1:3113/#/login");
    expect(portProcessResolver).toHaveBeenCalledWith(3113);
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it("reports an available preview only when the Workbench record matches the requested path", async () => {
    const projectRoot = await createConduitFixture({ port: 3112 });
    const child = createMockChild();
    const spawnImpl = vi.fn(() => child);
    let fetchCalls = 0;
    const fetchImpl = vi.fn(async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) throw new Error("closed");
      return htmlResponse();
    });

    await startPreview(
      { projectId: "owned", localPath: projectRoot },
      { previewStartupTimeoutMs: 100, previewPollIntervalMs: 1 },
      { fetchImpl, portCheckImpl: async () => false, spawnImpl }
    );
    const status = await getPreviewStatus(
      { projectId: "owned", localPath: projectRoot },
      {},
      { fetchImpl: async () => htmlResponse() }
    );

    expect(status.data.status).toBe("running");
    expect(status.data.available).toBe(true);
    expect(status.data.owner).toBe("workbench");
    expect(status.data.requestedProjectRoot).toBe(projectRoot);
    expect(status.data.runningProjectRoot).toBe(projectRoot);
    expect(spawnImpl).toHaveBeenCalledTimes(1);
  });

  it("starts the root Vite binary with fixed spawn arguments", async () => {
    const projectRoot = await createConduitFixture({ port: 3222 });
    const child = createMockChild();
    const spawnImpl = vi.fn(() => child);
    let fetchCalls = 0;
    const fetchImpl = vi.fn(async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) throw new Error("closed");
      return htmlResponse();
    });

    const result = await startPreview(
      { projectId: "start", localPath: projectRoot },
      { previewStartupTimeoutMs: 100, previewPollIntervalMs: 1 },
      { fetchImpl, portCheckImpl: async () => false, spawnImpl }
    );

    const viteBin = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
    expect(result.data.status).toBe("running");
    expect(result.data.available).toBe(true);
    expect(spawnImpl).toHaveBeenCalledWith(
      process.execPath,
      [viteBin, "--host", "127.0.0.1", "--port", "3222", "--strictPort"],
      expect.objectContaining({
        cwd: path.join(projectRoot, "frontend"),
        shell: false,
        windowsHide: true
      })
    );
  });

  it("isolates audit workspace previews by previewSessionId", async () => {
    const projectRoot = await createConduitFixture({ port: 3000 });
    const firstChild = createMockChild();
    const secondChild = createMockChild();
    const activePorts = new Set();
    const spawnImpl = vi.fn((command, args) => {
      activePorts.add(Number(args[args.indexOf("--port") + 1]));
      return activePorts.size === 1 ? firstChild : secondChild;
    });
    const fetchImpl = vi.fn(async (url) => {
      const port = Number(new URL(url).port);
      if (activePorts.has(port)) return htmlResponse();
      throw new Error("closed");
    });
    const portProcessResolver = vi.fn(async () => []);

    const first = await startPreview(
      {
        projectId: "audit-project",
        requirementId: "REQ-1",
        runId: "RUN-1",
        previewSessionId: "audit:a:REQ-1:RUN-1:path",
        previewMode: "audit_workspace",
        allowPortFallback: true,
        localPath: projectRoot
      },
      { auditPreviewPortStart: 3100, auditPreviewPortEnd: 3102, previewStartupTimeoutMs: 100, previewPollIntervalMs: 1 },
      { fetchImpl, portCheckImpl: async (port) => activePorts.has(port), portProcessResolver, spawnImpl }
    );
    const second = await startPreview(
      {
        projectId: "audit-project",
        requirementId: "REQ-2",
        runId: "RUN-2",
        previewSessionId: "audit:b:REQ-2:RUN-2:path",
        previewMode: "audit_workspace",
        allowPortFallback: true,
        localPath: projectRoot
      },
      { auditPreviewPortStart: 3100, auditPreviewPortEnd: 3102, previewStartupTimeoutMs: 100, previewPollIntervalMs: 1 },
      { fetchImpl, portCheckImpl: async (port) => activePorts.has(port), portProcessResolver, spawnImpl }
    );
    const reused = await getPreviewStatus(
      {
        projectId: "audit-project",
        requirementId: "REQ-1",
        runId: "RUN-1",
        previewSessionId: "audit:a:REQ-1:RUN-1:path",
        previewMode: "audit_workspace",
        allowPortFallback: true,
        localPath: projectRoot
      },
      { auditPreviewPortStart: 3100, auditPreviewPortEnd: 3102 },
      { fetchImpl, portCheckImpl: async (port) => activePorts.has(port), portProcessResolver }
    );

    expect(first.data.previewUrl).toBe("http://127.0.0.1:3100/#/login");
    expect(second.data.previewUrl).toBe("http://127.0.0.1:3101/#/login");
    expect(reused.data.previewUrl).toBe("http://127.0.0.1:3100/#/login");
    expect(reused.data.previewSessionId).toBe("audit:a:REQ-1:RUN-1:path");
    expect(spawnImpl).toHaveBeenCalledTimes(2);
  });

  it("stops a different Workbench-owned project on the same port before starting the requested path", async () => {
    const firstProjectRoot = await createConduitFixture({ port: 3444 });
    const secondProjectRoot = await createConduitFixture({ port: 3444 });
    const firstChild = createMockChild();
    const secondChild = createMockChild();
    let activeProject = "none";
    let spawnCount = 0;
    const spawnImpl = vi.fn(() => {
      spawnCount += 1;
      activeProject = spawnCount === 1 ? "first" : "second";
      return spawnCount === 1 ? firstChild : secondChild;
    });
    const fetchImpl = vi.fn(async () => {
      if (activeProject === "none") throw new Error("closed");
      return htmlResponse();
    });

    await startPreview(
      { projectId: "first", localPath: firstProjectRoot },
      { previewStartupTimeoutMs: 100, previewPollIntervalMs: 1 },
      {
        fetchImpl,
        portCheckImpl: async () => activeProject !== "none",
        spawnImpl
      }
    );

    firstChild.kill.mockImplementationOnce(() => {
      firstChild.killed = true;
      activeProject = "none";
      firstChild.emit("exit", 0);
    });
    const restarted = await startPreview(
      { projectId: "second", localPath: secondProjectRoot },
      { previewStartupTimeoutMs: 100, previewPollIntervalMs: 1, previewRestartReleaseTimeoutMs: 100 },
      {
        fetchImpl,
        portCheckImpl: async () => activeProject !== "none",
        spawnImpl
      }
    );

    expect(firstChild.kill).toHaveBeenCalledTimes(1);
    expect(spawnImpl).toHaveBeenCalledTimes(2);
    expect(restarted.data.status).toBe("running");
    expect(restarted.data.available).toBe(true);
    expect(restarted.data.owner).toBe("workbench");
    expect(restarted.data.requestedProjectRoot).toBe(secondProjectRoot);
    expect(restarted.data.runningProjectRoot).toBe(secondProjectRoot);
  });

  it("stops only the Workbench-owned preview process", async () => {
    const projectRoot = await createConduitFixture({ port: 3333 });
    const child = createMockChild();
    const spawnImpl = vi.fn(() => child);
    let fetchCalls = 0;
    const fetchImpl = vi.fn(async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) throw new Error("closed");
      return htmlResponse();
    });

    await startPreview(
      { projectId: "owned", localPath: projectRoot },
      { previewStartupTimeoutMs: 100, previewPollIntervalMs: 1 },
      { fetchImpl, portCheckImpl: async () => false, spawnImpl }
    );
    const stopped = await stopPreview(
      { projectId: "owned", localPath: projectRoot },
      {},
      { fetchImpl: async () => { throw new Error("closed"); }, portCheckImpl: async () => false }
    );

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(stopped.data.status).toBe("stopped");

    resetPreviewLauncherForTests();
    const external = await stopPreview(
      { projectId: "external", localPath: projectRoot },
      {},
      { fetchImpl: async () => htmlResponse(), portCheckImpl: async () => true }
    );

    expect(external.data.status).toBe("port_in_use_external");
    expect(external.data.available).toBe(false);
    expect(external.data.owner).toBe("external");
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});

async function createTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "preview-launcher-"));
  tempRoots.push(root);
  return root;
}

async function createConduitFixture({ port }) {
  const projectRoot = await createTempRoot();
  const frontendRoot = path.join(projectRoot, "frontend");
  const viteBinRoot = path.join(projectRoot, "node_modules", "vite", "bin");
  await fs.mkdir(frontendRoot, { recursive: true });
  await fs.mkdir(viteBinRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ private: true }), "utf8");
  await fs.writeFile(path.join(frontendRoot, "package.json"), JSON.stringify({ private: true }), "utf8");
  await fs.writeFile(
    path.join(frontendRoot, "vite.config.js"),
    `export default { server: { port: ${port} } };\n`,
    "utf8"
  );
  await fs.writeFile(path.join(viteBinRoot, "vite.js"), "console.log('vite fixture');\n", "utf8");
  return projectRoot;
}

function htmlResponse() {
  return {
    headers: { get: () => "text/html; charset=utf-8" },
    text: async () => "<!doctype html><html><body><div id=\"root\"></div></body></html>"
  };
}

function createMockChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 12345;
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    child.emit("exit", 0);
  });
  return child;
}
