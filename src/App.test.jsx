import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import App from "./App.jsx";
import DSLStatusConsole from "./components/DSLStatusConsole.jsx";

describe("monitor console and workspace picker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("renders the monitor console shell by default", () => {
    render(<App />);

    expect(screen.getByText("Codex Workbench")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "监控台" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "工作台" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("monitor-console-view")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-project-picker")).not.toBeInTheDocument();
  });

  it("keeps the requested monitor information architecture", () => {
    render(<App />);

    expect(screen.getAllByText("conduit-realworld-example-app").length).toBeGreaterThan(0);
    expect(screen.getAllByText("RUN-20250524-0A7F").length).toBeGreaterThan(0);
    expect(screen.getByText("Artifacts (4)")).toBeInTheDocument();
  });

  it("switches 工作台 into the project picker and shows top page tabs", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "工作台" }));

    expect(screen.getByRole("button", { name: "DSL 澄清台" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "设计规划" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "审计页面" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PR 页面" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "选择你的项目" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建项目" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "conduit-realworld-example-app" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Codex Workbench" })).toBeInTheDocument();
    expect(screen.getByTestId("project-rail")).toHaveAttribute("data-state", "collapsed");
    expect(screen.queryByTestId("monitor-console-view")).not.toBeInTheDocument();
  });

  it("switches between the DSL page, design planning page, and placeholder pages from top tabs", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "工作台" }));
    fireEvent.click(screen.getByRole("button", { name: "设计规划" }));

    expect(screen.getByTestId("design-planning-workbench")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "设计规划" })).toBeInTheDocument();
    expect(screen.getByText("实施阶段 / 里程碑")).toBeInTheDocument();
    expect(screen.getByText("任务拆解清单")).toBeInTheDocument();
    expect(screen.getByText("执行摘要 / 最新进展")).toBeInTheDocument();
    expect(screen.getByText("总体进度")).toBeInTheDocument();
    expect(screen.getByText("风险 / 阻塞项")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "DSL 状态控制台" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设计规划" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "DSL 澄清台" }));
    expect(screen.getByTestId("dsl-workbench")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "需求澄清工作台" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "DSL 状态控制台" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "审计页面" }));
    expect(screen.getByTestId("review-check-workbench")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "审计页面" })).toBeInTheDocument();
    expect(screen.queryByTitle("Conduit login page")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("该项目未绑定本地路径。")).toBeInTheDocument());
    expect(screen.getByText("用户可见变化")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "PR 页面" }));
    expect(screen.getByTestId("pr-workbench")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "PR 页面" })).toBeInTheDocument();
    expect(screen.getByText("PR 摘要")).toBeInTheDocument();
  });

  it("runs the agent dry-run workflow from design planning into review and PR pages", async () => {
    const readiness = {
      status: "ready",
      canRunDryRun: true,
      canRealWrite: false,
      entrypoints: ["agent/agent_core/main.py"],
      boundaries: ["default dry-run only"]
    };
    const run = {
      runId: "RUN-agent-ui",
      status: "completed",
      dryRun: true,
      realWritePerformed: false,
      latestReturn: "Dry-run plan generated; no target repo writes performed.",
      context: {
        projectId: "conduit-realworld-example-app",
        boundary: "dry-run preview only",
        agent1EntryPoints: ["agent/agent_core/main.py"]
      },
      plan: {
        mode: "agent1_preview_adapter",
        steps: [
          { name: "Analyze RequirementDSL", owner: "planner_agent", output: "implementation intent" },
          { name: "Generate patch preview", owner: "coder_agent", output: "diff preview only" }
        ]
      },
      review: {
        status: "needs_review",
        summary: "Agent dry-run prepared a human-reviewable patch plan.",
        changedFiles: [
          {
            file: "src/components/LoginForm.jsx",
            changeSummary: "Add clearer login failure copy.",
            why: "Maps to RequirementDSL acceptance criteria.",
            requirementPoint: "Login failure guidance",
            risk: "Copy must match backend error codes."
          }
        ],
        tests: [{ command: "npm test", status: "planned" }],
        manualConfirmations: ["Confirm backend error-code taxonomy."]
      },
      prDraft: {
        title: "Improve login failure guidance",
        summary: ["Adds clearer user-facing login failure messaging."],
        changedFiles: ["src/components/LoginForm.jsx"],
        tests: [{ command: "npm test", status: "planned" }],
        risks: ["Copy must match backend error codes."],
        checklist: ["Dry-run artifacts reviewed", "No API keys or local configs committed"]
      },
      artifacts: {
        "agent_context.json": { exists: true }
      }
    };
    const fetchMock = vi.fn(async (url) => {
      const target = String(url);
      const data = target.endsWith("/readiness") ? readiness : run;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ ok: true, data, error: null })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(document.querySelectorAll(".mode-tab")[1]);
    fireEvent.click(document.querySelectorAll(".workspace-top-tab")[1]);

    expect(screen.getByTestId("design-planning-workbench")).toBeInTheDocument();
    expect(screen.getByText("Agent Execution Orchestrator")).toBeInTheDocument();
    expect(screen.getByText("Awaiting readiness check")).toBeInTheDocument();

    fireEvent.click(document.querySelectorAll(".agent-action-row button")[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent/readiness",
      expect.objectContaining({ method: "POST" })
    ));
    expect(screen.getByTestId("agent-context-preview")).toHaveTextContent("dry-run preview only");
    expect(screen.getByText("Ready for dry-run preview")).toBeInTheDocument();

    fireEvent.click(document.querySelectorAll(".agent-action-row button")[1]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent/run",
      expect.objectContaining({ method: "POST" })
    ));
    await waitFor(() => expect(screen.getByText("Analyze RequirementDSL")).toBeInTheDocument());
    expect(screen.getByText("Dry-run plan generated; no target repo writes performed.")).toBeInTheDocument();
    expect(screen.getByText("diff preview only")).toBeInTheDocument();
    const runBody = JSON.parse(fetchMock.mock.calls.find(([url]) => String(url).endsWith("/run"))[1].body);
    expect(runBody.dryRun).toBe(true);

    fireEvent.click(document.querySelectorAll(".agent-action-row button")[3]);
    expect(screen.getByTestId("review-check-workbench")).toBeInTheDocument();
    expect(screen.getAllByText("src/components/LoginForm.jsx").length).toBeGreaterThan(0);
    expect(screen.getByText("Agent dry-run prepared a human-reviewable patch plan.")).toBeInTheDocument();
    expect(screen.queryByTitle("Conduit login page")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("该项目未绑定本地路径。")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /src\/components\/LoginForm\.jsx/ }));

    fireEvent.click(document.querySelector(".audit-pr-button"));
    expect(screen.getByTestId("pr-workbench")).toBeInTheDocument();
    expect(screen.getByText("RUN-agent-ui")).toBeInTheDocument();
    expect(screen.getByText("Improve login failure guidance")).toBeInTheDocument();
    expect(screen.getByText("No API keys or local configs committed")).toBeInTheDocument();
  });

  it("selects a project and shows a local toast", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "工作台" }));
    fireEvent.click(screen.getByRole("button", { name: "AI Agent Framework" }));

    expect(screen.getByRole("button", { name: "AI Agent Framework" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("已选择 AI Agent Framework");
  });

  it("expands, collapses, and switches projects from the project rail", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "工作台" }));
    expect(screen.getByTestId("project-rail")).toHaveAttribute("data-state", "collapsed");

    fireEvent.click(screen.getByRole("button", { name: "展开项目切换栏" }));

    expect(screen.getByTestId("project-rail")).toHaveAttribute("data-state", "expanded");
    expect(screen.getByRole("button", { name: "切换到 conduit-realworld-example-app" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "切换到 Data Pipeline" }));

    expect(screen.getByRole("button", { name: "切换到 Data Pipeline" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Data Pipeline" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("已切换到 Data Pipeline");

    fireEvent.click(screen.getByRole("button", { name: "收起项目切换栏" }));
    expect(screen.getByTestId("project-rail")).toHaveAttribute("data-state", "collapsed");
  });

  it("syncs project rail selection when the picker card changes", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "工作台" }));
    fireEvent.click(screen.getByRole("button", { name: "展开项目切换栏" }));
    fireEvent.click(screen.getByRole("button", { name: "AI Agent Framework" }));

    expect(screen.getByRole("button", { name: "AI Agent Framework" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "切换到 AI Agent Framework" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("已选择 AI Agent Framework");
  });

  it("opens, cancels, and mock-creates a project without filesystem work", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "工作台" }));
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));

    expect(screen.getByRole("dialog", { name: "新建项目" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "新建项目" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "Research Workspace" } });
    fireEvent.change(screen.getByLabelText("本地路径"), { target: { value: "F:\\Projects\\Research Workspace" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    expect(screen.queryByRole("dialog", { name: "新建项目" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Research Workspace" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("已创建 Research Workspace");
  });

  it("keeps the created project localPath and starts the audit preview from it", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      const target = String(url);
      const body = JSON.parse(options.body);
      const data = target.endsWith("/status")
        ? {
            status: "not_running",
            available: false,
            previewUrl: "http://127.0.0.1:4555/#/login",
            port: 4555,
            projectRoot: body.localPath,
            message: "not running"
          }
        : {
            status: "running",
            available: true,
            previewUrl: "http://127.0.0.1:4555/#/login",
            port: 4555,
            projectRoot: body.localPath,
            message: "started"
          };
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ ok: true, data, error: null })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "工作台" }));
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "Conduit Local" } });
    fireEvent.change(screen.getByLabelText("本地路径"), {
      target: { value: "C:\\Users\\www30\\Desktop\\conduit-realworld-example-app" }
    });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    fireEvent.click(screen.getByRole("button", { name: "审计页面" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/preview/status",
      expect.objectContaining({ method: "POST" })
    ));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/preview/start",
      expect.objectContaining({ method: "POST" })
    ));
    const statusBody = JSON.parse(fetchMock.mock.calls.find(([url]) => String(url).endsWith("/status"))[1].body);
    expect(statusBody).toMatchObject({
      projectId: expect.stringMatching(/^mock-/),
      localPath: "C:\\Users\\www30\\Desktop\\conduit-realworld-example-app"
    });
    await waitFor(() => expect(screen.getByTitle("Conduit login page")).toHaveAttribute("src", "http://127.0.0.1:4555/#/login"));
    fireEvent.click(screen.getByRole("button", { name: /src\/components\/LoginForm\.jsx/ }));
    expect(screen.getByRole("button", { name: /src\/components\/LoginForm\.jsx/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("reloads preview status when the active project localPath changes", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      const body = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          ok: true,
          data: {
            status: "running",
            available: true,
            previewUrl: body.localPath.includes("conduit-a")
              ? "http://127.0.0.1:4556/#/login"
              : "http://127.0.0.1:4557/#/login",
            port: body.localPath.includes("conduit-a") ? 4556 : 4557,
            projectRoot: body.localPath,
            requestedProjectRoot: body.localPath,
            runningProjectRoot: body.localPath,
            owner: "workbench",
            actionRequired: "none",
            message: "running"
          },
          error: null
        })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "工作台" }));
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "Conduit A" } });
    fireEvent.change(screen.getByLabelText("本地路径"), {
      target: { value: "C:\\Users\\www30\\Desktop\\conduit-a" }
    });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "Conduit B" } });
    fireEvent.change(screen.getByLabelText("本地路径"), {
      target: { value: "C:\\Users\\www30\\Desktop\\conduit-b" }
    });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    fireEvent.click(screen.getByRole("button", { name: "审计页面" }));

    await waitFor(() => expect(screen.getByTitle("Conduit login page")).toHaveAttribute("src", "http://127.0.0.1:4557/#/login"));

    fireEvent.click(screen.getByRole("button", { name: "展开项目切换栏" }));
    fireEvent.click(screen.getByRole("button", { name: "切换到 Conduit A" }));

    await waitFor(() => expect(screen.getByTitle("Conduit login page")).toHaveAttribute("src", "http://127.0.0.1:4556/#/login"));
    const statusBodies = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith("/api/preview/status"))
      .map(([, options]) => JSON.parse(options.body));
    expect(statusBodies.map((body) => body.localPath)).toEqual([
      "C:\\Users\\www30\\Desktop\\conduit-b",
      "C:\\Users\\www30\\Desktop\\conduit-a"
    ]);
  });

  it("does not render the iframe when the preview port is owned by an external process", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      const body = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          ok: true,
          data: {
            status: "port_in_use_external",
            available: false,
            previewUrl: "http://127.0.0.1:3000/#/login",
            port: 3000,
            projectRoot: body.localPath,
            requestedProjectRoot: body.localPath,
            runningProjectRoot: "",
            owner: "external",
            actionRequired: "close_external_port",
            message: "Port 3000 is already used by an external process."
          },
          error: null
        })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "工作台" }));
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "External Port Conduit" } });
    fireEvent.change(screen.getByLabelText("本地路径"), {
      target: { value: "C:\\Users\\www30\\Desktop\\external-port-conduit" }
    });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    fireEvent.click(screen.getByRole("button", { name: "审计页面" }));

    await waitFor(() => expect(screen.getByTestId("audit-preview-unavailable")).toHaveTextContent("3000 被外部进程占用，未打开当前项目"));
    expect(screen.queryByTitle("Conduit login page")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/preview/start"))).toBe(false);
  });

  it("renders the iframe when the external preview process is verified against the project path", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      const body = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          ok: true,
          data: {
            status: "external_verified",
            available: true,
            previewUrl: "http://127.0.0.1:3000/#/login",
            port: 3000,
            projectRoot: body.localPath,
            requestedProjectRoot: body.localPath,
            runningProjectRoot: body.localPath,
            owner: "external_verified",
            actionRequired: "none",
            message: "External preview process matches the requested project path."
          },
          error: null
        })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "工作台" }));
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "Verified External Conduit" } });
    fireEvent.change(screen.getByLabelText("本地路径"), {
      target: { value: "C:\\Users\\www30\\Desktop\\conduit-realworld-example-app" }
    });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    fireEvent.click(screen.getByRole("button", { name: "审计页面" }));

    await waitFor(() => expect(screen.getByTitle("Conduit login page")).toHaveAttribute("src", "http://127.0.0.1:3000/#/login"));
    expect(screen.getByText(/外部可信复用/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/preview/start"))).toBe(false);
  });

  it("starts a new preview when Workbench reports another project on the same port", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      const target = String(url);
      const body = JSON.parse(options.body);
      const data = target.endsWith("/status")
        ? {
            status: "workbench_project_mismatch",
            available: false,
            previewUrl: "http://127.0.0.1:4777/#/login",
            port: 4777,
            projectRoot: body.localPath,
            requestedProjectRoot: body.localPath,
            runningProjectRoot: "C:\\Users\\www30\\Desktop\\old-conduit",
            owner: "workbench",
            canRestart: true,
            actionRequired: "none",
            message: "Workbench is running a different project."
          }
        : {
            status: "running",
            available: true,
            previewUrl: "http://127.0.0.1:4777/#/login",
            port: 4777,
            projectRoot: body.localPath,
            requestedProjectRoot: body.localPath,
            runningProjectRoot: body.localPath,
            owner: "workbench",
            actionRequired: "none",
            message: "switched"
          };
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ ok: true, data, error: null })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "工作台" }));
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "Switchable Conduit" } });
    fireEvent.change(screen.getByLabelText("本地路径"), {
      target: { value: "C:\\Users\\www30\\Desktop\\switchable-conduit" }
    });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    fireEvent.click(screen.getByRole("button", { name: "审计页面" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/preview/start",
      expect.objectContaining({ method: "POST" })
    ));
    await waitFor(() => expect(screen.getByTitle("Conduit login page")).toHaveAttribute("src", "http://127.0.0.1:4777/#/login"));
  });

  it("shows the audit preview fallback when backend startup fails", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      const body = JSON.parse(options.body);
      const data = String(url).endsWith("/status")
        ? {
            status: "not_running",
            available: false,
            previewUrl: "http://127.0.0.1:4666/#/login",
            port: 4666,
            projectRoot: body.localPath,
            message: "not running"
          }
        : {
            status: "dependency_missing",
            available: false,
            previewUrl: "http://127.0.0.1:4666/#/login",
            port: 4666,
            projectRoot: body.localPath,
            message: "Vite binary was not found."
          };
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ ok: true, data, error: null })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "工作台" }));
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "Broken Conduit" } });
    fireEvent.change(screen.getByLabelText("本地路径"), {
      target: { value: "C:\\Users\\www30\\Desktop\\broken-conduit" }
    });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    fireEvent.click(screen.getByRole("button", { name: "审计页面" }));

    await waitFor(() => expect(screen.getByTestId("audit-preview-unavailable")).toHaveTextContent("Vite binary was not found."));
    expect(screen.getByText("用户可见变化")).toBeInTheDocument();
    expect(screen.queryByTitle("Conduit login page")).not.toBeInTheDocument();
  });

  it("enters the DSL workbench from the project picker", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "工作台" }));
    fireEvent.click(screen.getByRole("button", { name: "进入工作台" }));

    expect(screen.getByTestId("dsl-workbench")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "需求澄清工作台" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "DSL 状态控制台" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /打开需求报告/ })).toBeInTheDocument();
    expect(screen.getByText("conduit-realworld-example-app")).toBeInTheDocument();
    expect(document.querySelector(".report-cta")).not.toHaveTextContent("conduit-realworld-example-app");
  });

  it("labels skill reply source as real, fallback, or mock in the status console", () => {
    const handlers = {
      onOpenReport: vi.fn(),
      onCancelRun: vi.fn(),
      onRetryRun: vi.fn(),
      onOpenPartialArtifacts: vi.fn()
    };
    const uiState = {
      dslCompletion: { value: 78 },
      coverageItems: { covered: [], pending: [] },
      risks: [],
      readiness: { ready_for_agent: false, handoff_decision: "clarify_first", source: "skill_safety_boundary" }
    };
    const { rerender } = render(
      <DSLStatusConsole
        {...handlers}
        uiState={uiState}
        runState={{ runId: "RUN-source", status: "skill_turn", skillStatus: "done", skillSourceMode: "model_generated_real", skillClient: "openai_sdk", skillModel: "gpt-5.5" }}
      />
    );

    expect(screen.getByText("回复来源：Real model · openai_sdk · gpt-5.5")).toBeInTheDocument();

    rerender(
      <DSLStatusConsole
        {...handlers}
        uiState={uiState}
        runState={{ runId: "RUN-source", status: "skill_turn", skillStatus: "fallback", skillSourceMode: "fallback_guardrail" }}
      />
    );
    expect(screen.getByText("回复来源：Fallback guardrail")).toBeInTheDocument();

    rerender(
      <DSLStatusConsole
        {...handlers}
        uiState={uiState}
        runState={{ runId: "RUN-source", status: "skill_turn", skillStatus: "done", skillSourceMode: "mock" }}
      />
    );
    expect(screen.getByText("回复来源：Mock model")).toBeInTheDocument();

    rerender(
      <DSLStatusConsole
        {...handlers}
        uiState={uiState}
        runState={{ runId: "RUN-source", status: "failed", skillStatus: "failed", skillSourceMode: "external_blocked", skillClient: "openai_sdk", skillModel: "gpt-5.5" }}
      />
    );
    expect(screen.getByText("回复来源：External blocked · openai_sdk · gpt-5.5")).toBeInTheDocument();
  });

  it("keeps the report CTA mapped to report readiness instead of the selected project", () => {
    const onOpenReport = vi.fn();
    render(
      <DSLStatusConsole
        uiState={{ coverageItems: { covered: [], pending: [] }, risks: [] }}
        runState={{ runId: "", status: "idle", artifacts: {} }}
        onOpenReport={onOpenReport}
        onCancelRun={vi.fn()}
        onRetryRun={vi.fn()}
        onOpenPartialArtifacts={vi.fn()}
      />
    );

    const reportCta = screen.getByRole("button", { name: /打开需求报告/ });
    expect(reportCta).toBeDisabled();
    expect(reportCta).toHaveTextContent("当前还没有可打开的 DSL 报告");
    expect(reportCta).toHaveTextContent("未生成");
    expect(reportCta).not.toHaveTextContent("conduit-realworld-example-app");

    fireEvent.click(reportCta);
    expect(onOpenReport).not.toHaveBeenCalled();
  });

  it("opens the current run report only when the report CTA is ready", () => {
    const onOpenReport = vi.fn();
    render(
      <DSLStatusConsole
        uiState={{ coverageItems: { covered: [], pending: [] }, risks: [] }}
        runState={{
          runId: "RUN-report-ready",
          status: "passed",
          artifactStatus: "done",
          artifacts: { "13_case_summary.md": { exists: true } }
        }}
        onOpenReport={onOpenReport}
        onCancelRun={vi.fn()}
        onRetryRun={vi.fn()}
        onOpenPartialArtifacts={vi.fn()}
      />
    );

    const reportCta = screen.getByRole("button", { name: /打开需求报告/ });
    expect(reportCta).toBeEnabled();
    expect(reportCta).toHaveTextContent("以人类可读方式审阅当前 DSL");
    expect(reportCta).toHaveTextContent("DSL run passed");
    fireEvent.click(reportCta);
    expect(onOpenReport).toHaveBeenCalledTimes(1);
  });

  it("cleans up the DSL workbench bottom input and shows suggestions by interval", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "工作台" }));
    fireEvent.click(screen.getByRole("button", { name: "进入工作台" }));

    expect(screen.getByPlaceholderText("请输入你的补充回答，系统会继续更新 DSL...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送回答" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "生成 DSL" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新生成问题" })).not.toBeInTheDocument();
    expect(screen.queryByText("推荐澄清问题")).not.toBeInTheDocument();

    for (let index = 0; index < 5; index += 1) {
      fireEvent.change(screen.getByPlaceholderText("请输入你的补充回答，系统会继续更新 DSL..."), {
        target: { value: `Login failure hint needs clearer next action ${index + 1}.` }
      });
      fireEvent.click(screen.getByRole("button", { name: "发送回答" }));
    }

    expect(screen.queryByText("推荐澄清问题")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("请输入你的补充回答，系统会继续更新 DSL..."), {
      target: { value: "Login failure hint needs clearer next action 6." }
    });
    fireEvent.click(screen.getByRole("button", { name: "发送回答" }));

    expect(screen.getByRole("status")).toHaveTextContent("已追加 PM 回答");
    expect(screen.getByText("推荐澄清问题")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "采用这个问题" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "换一个" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "暂时跳过" })).toBeInTheDocument();
  });

  it("supports suggestion skip and keeps report unavailable before a DSL run", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "工作台" }));
    fireEvent.click(screen.getByRole("button", { name: "进入工作台" }));

    for (let index = 0; index < 6; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "发送回答" }));
    }

    expect(screen.getByText("推荐澄清问题")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "暂时跳过" }));
    expect(screen.getByRole("status")).toHaveTextContent("已暂时跳过");
    expect(screen.queryByText("推荐澄清问题")).not.toBeInTheDocument();

    const reportCta = screen.getByRole("button", { name: /打开需求报告/ });
    expect(reportCta).toBeDisabled();
    expect(reportCta).toHaveTextContent("当前还没有可打开的 DSL 报告");
    expect(reportCta).toHaveTextContent("未生成");
    expect(screen.queryByRole("dialog", { name: "需求报告（人类可读版）" })).not.toBeInTheDocument();
  });

  it("sends PM answers through skill orchestration before updating runner status", async () => {
    const passedJob = {
      runId: "RUN-test-api",
      status: "passed",
      outputDir: "F:\\byte-contest\\final-app\\runs\\RUN-test-api",
      relativeOutputDir: "runs\\RUN-test-api",
      fullArtifacts: {},
      uiState: {
        dslCompletion: { rawScore: 81, displayScore: 86, value: 86, source: "real_score" },
        readiness: {
          ready_for_agent: false,
          handoff_decision: "clarify_first",
          source: "artifact"
        },
        risks: [],
        recommendedQuestion: {
          title: "Skill suggestion",
          text: "Should error codes map to user-facing copy?",
          reason: "Generated by skill orchestration",
          source: "skill_model"
        },
        humanReport: {}
      }
    };
    const skillTurn = {
      runId: "RUN-skill-ui",
      status: "skill_turn",
      outputDir: "F:\\byte-contest\\final-app\\runs\\RUN-skill-ui",
      relativeOutputDir: "runs\\RUN-skill-ui",
      assistant_message: "Skill generated candidate acceptance criteria: the user sees a clearer login failure hint and understands the next action. Confirm whether each error code maps to specific copy.",
      risk_boundary: {
        ready_for_agent: false,
        can_handoff_to_agent: false,
        handoff_decision: "clarify_first"
      },
      source: { mode: "model_generated_real", client: "openai_sdk", model: "gpt-5.5", skills_used: ["prd_to_dsl", "clarification", "code_context"] },
      uiState: {
        dslCompletion: { value: 78, source: "skill_orchestrated_model" },
        readiness: {
          ready_for_agent: false,
          handoff_decision: "clarify_first",
          source: "skill_safety_boundary"
        },
        risks: [],
        recommendedQuestion: {
          title: "Skill suggestion",
          text: "Should error codes map to user-facing copy?",
          reason: "Generated by skill orchestration",
          source: "skill_model"
        },
        humanReport: {
          summary: {
            title: "Login failure hint",
            text: "Candidate requirement summary",
            status: "needs clarification",
            source: "model_generated_real"
          },
          scope: { inScope: ["login failure hint"], outOfScope: ["Agent Plan"] },
          riskCards: [{ title: "Candidate acceptance criteria", points: ["User understands failure reason"] }]
        }
      }
    };
    const fetchMock = vi.fn(async (url) => {
      const target = String(url);
      const data = target.endsWith("/pm-dsl-turn")
        ? skillTurn
        : target.endsWith("/start")
          ? { ...passedJob, status: "running", elapsedMs: 0 }
          : passedJob;
      return {
        ok: true,
        status: target.endsWith("/start") ? 202 : 200,
        statusText: "OK",
        text: async () => JSON.stringify({ ok: true, data, error: null })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(document.querySelectorAll(".mode-tab")[1]);
    fireEvent.click(document.querySelector(".enter-workbench-button"));
    fireEvent.change(document.querySelector(".chat-input-row input"), {
      target: { value: "Login failure hint is too vague; PM wants a clearer next action." }
    });
    fireEvent.click(document.querySelector(".chat-input-row button"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/skill/pm-dsl-turn",
      expect.objectContaining({ method: "POST" })
    ));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dsl/runs/start",
      expect.objectContaining({ method: "POST" })
    );

    const skillCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/pm-dsl-turn"));
    const requestBody = JSON.parse(skillCall[1].body);
    expect(requestBody.pmMessages.at(-1).content).toBe("Login failure hint is too vague; PM wants a clearer next action.");

    await waitFor(() => expect(screen.getByText("RUN-test-api")).toBeInTheDocument());
    expect(screen.getByText("快速澄清")).toBeInTheDocument();
    expect(screen.getByText("完整 DSL artifacts")).toBeInTheDocument();
    expect(screen.getByText("回复来源：Real model · openai_sdk · gpt-5.5")).toBeInTheDocument();
    expect(screen.getByText("86%")).toBeInTheDocument();
    expect(screen.getByText(/candidate acceptance criteria/i)).toBeInTheDocument();
    expect(screen.queryByText(/DSL draft/)).not.toBeInTheDocument();
    expect(screen.queryByText(/EVPI-lite/)).not.toBeInTheDocument();
  });

  it("walks DSL clarification one question at a time before offering design planning", async () => {
    const questions = [
      "浏览量去重规则按什么算？比如同一用户 24 小时内多次访问同一篇文章只算 1 次，还是每次刷新都累计？",
      "未登录用户的浏览量是否也要统计？如果统计，按 IP、设备还是 session 去重？",
      "验收时你希望用哪些标准判断这个需求完成？"
    ];
    const skillTurns = [
      buildSkillTurn({ message: `我先记录候选需求。还需要确认一个关键口径：${questions[0]}`, question: questions[0], score: 62, asked: 1, remaining: 2 }),
      buildSkillTurn({ message: `已更新 DSL。还需要确认一个关键口径：${questions[1]}`, question: questions[1], score: 72, asked: 2, remaining: 1 }),
      buildSkillTurn({ message: `已更新 DSL。还需要确认一个关键口径：${questions[2]}`, question: questions[2], score: 82, asked: 3, remaining: 0, isFinalQuestion: true }),
      buildSkillTurn({
        message: "当前需求已经具备进入设计规划的基础信息。你可以继续补充细节，也可以开始施工。",
        score: 91,
        complete: true
      })
    ];
    let turnIndex = 0;
    const fetchMock = vi.fn(async (url) => {
      const target = String(url);
      if (target.endsWith("/pm-dsl-turn")) {
        const data = skillTurns[Math.min(turnIndex, skillTurns.length - 1)];
        turnIndex += 1;
        return jsonResponse(data);
      }
      if (target.endsWith("/start")) {
        return jsonResponse({ ...runnerJobForTurn(skillTurns[Math.max(0, turnIndex - 1)]), status: "running", elapsedMs: 0 }, 202);
      }
      if (target.includes("/api/agent")) {
        throw new Error(`agent execution should not be called: ${target}`);
      }
      return jsonResponse(runnerJobForTurn(skillTurns[Math.max(0, turnIndex - 1)]));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(document.querySelectorAll(".mode-tab")[1]);
    fireEvent.click(document.querySelector(".enter-workbench-button"));

    await sendWorkbenchAnswer("文章详情页要增加浏览量统计，同时改前后端。");
    await waitFor(() => expect(screen.getByText(questions[0])).toBeInTheDocument());
    expect(screen.queryByText("我还需要确认几个问题：")).not.toBeInTheDocument();
    expect(screen.queryByText(questions[1])).not.toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument();

    await sendWorkbenchAnswer("同一用户 24 小时内多次访问同一篇文章只算 1 次。");
    await waitFor(() => expect(screen.getByText(questions[1])).toBeInTheDocument());
    expect(screen.queryByText(questions[2])).not.toBeInTheDocument();
    expect(screen.getByText("72%")).toBeInTheDocument();

    await sendWorkbenchAnswer("未登录也统计，按 session 去重。");
    await waitFor(() => expect(screen.getByText(questions[2])).toBeInTheDocument());
    expect(screen.getByText("82%")).toBeInTheDocument();

    await sendWorkbenchAnswer("详情页刷新后数字可见增长，重复访问按规则去重。");
    await waitFor(() => expect(screen.getByText("当前需求已经具备进入设计规划的基础信息。你可以继续补充细节，也可以开始施工。")).toBeInTheDocument());
    expect(screen.getByText("91%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "继续完善需求" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始施工" })).toBeInTheDocument();
    expect(screen.getByText("ready_for_design")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "继续完善需求" }));
    expect(screen.getByTestId("dsl-workbench")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "开始施工" }));
    await waitFor(() => expect(screen.getByTestId("design-planning-workbench")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "设计规划" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/agent"))).toBe(false);
  });

  it("does not start DSL artifacts when the skill turn gates greeting input", async () => {
    const fetchMock = vi.fn(async (url) => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({ ok: true, data: [], error: null })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(document.querySelectorAll(".mode-tab")[1]);
    fireEvent.click(document.querySelector(".enter-workbench-button"));
    fireEvent.change(document.querySelector(".chat-input-row input"), {
      target: { value: "hello" }
    });
    fireEvent.click(document.querySelector(".chat-input-row button"));

    await waitFor(() => expect(screen.getByText("你好，请输入你想澄清或生成 DSL 的需求。")).toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/skill/pm-dsl-turn"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/dsl/runs/start"))).toBe(false);
    expect(screen.queryByText("登录失败提示优化")).not.toBeInTheDocument();
  });

  it("shows an immediate fast-skill loading state before the skill response resolves", async () => {
    let resolveSkillTurn;
    const skillTurnPromise = new Promise((resolve) => {
      resolveSkillTurn = resolve;
    });
    const skillTurn = {
      runId: "RUN-skill-loading",
      status: "skill_turn",
      outputDir: "F:\\byte-contest\\final-app\\runs\\RUN-skill-loading",
      relativeOutputDir: "runs\\RUN-skill-loading",
      assistant_message: "Candidate acceptance criteria recorded. Confirm whether 400 characters per minute is acceptable.",
      risk_boundary: { ready_for_agent: false, can_handoff_to_agent: false, handoff_decision: "clarify_first" },
      source: { mode: "model_generated_real", client: "openai_sdk", model: "gpt-5.5", skills_used: ["prd_to_dsl", "clarification", "code_context"] },
      uiState: {
        dslCompletion: { value: 78, source: "skill_orchestrated_model" },
        readiness: { ready_for_agent: false, handoff_decision: "clarify_first", source: "skill_safety_boundary" },
        risks: [],
        recommendedQuestion: { title: "Skill suggestion", text: "Use 400 characters per minute?", reason: "Generated by skill orchestration", source: "skill_model" },
        humanReport: {}
      }
    };
    const passedJob = {
      runId: "RUN-runner-after-skill",
      status: "passed",
      outputDir: "F:\\byte-contest\\final-app\\runs\\RUN-runner-after-skill",
      relativeOutputDir: "runs\\RUN-runner-after-skill",
      fullArtifacts: {},
      uiState: { dslCompletion: { value: 82 }, readiness: { ready_for_agent: false, handoff_decision: "clarify_first", source: "artifact" }, risks: [], humanReport: {} }
    };
    const fetchMock = vi.fn(async (url) => {
      const target = String(url);
      if (target.endsWith("/pm-dsl-turn")) {
        const data = await skillTurnPromise;
        return { ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify({ ok: true, data, error: null }) };
      }
      const data = target.endsWith("/start") ? { ...passedJob, status: "running", elapsedMs: 0 } : passedJob;
      return {
        ok: true,
        status: target.endsWith("/start") ? 202 : 200,
        statusText: "OK",
        text: async () => JSON.stringify({ ok: true, data, error: null })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(document.querySelectorAll(".mode-tab")[1]);
    fireEvent.click(document.querySelector(".enter-workbench-button"));
    fireEvent.change(document.querySelector(".chat-input-row input"), {
      target: { value: "Article details should show reading time." }
    });
    fireEvent.click(document.querySelector(".chat-input-row button"));

    expect(screen.getAllByText("正在理解需求并更新 DSL...").length).toBeGreaterThan(0);
    expect(screen.getByText("understanding")).toBeInTheDocument();

    resolveSkillTurn(skillTurn);
    await waitFor(() => expect(screen.getByText(/Candidate acceptance criteria/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("RUN-runner-after-skill")).toBeInTheDocument());
  });

  it("shows a system reply and structured right-panel error when the DSL API fails", async () => {
    const error = {
      code: "backend_exception",
      message: "Forced DSL route exception for empty response regression",
      details: {
        runId: "RUN-backend-exception",
        relativeOutputDir: "runs\\RUN-backend-exception"
      }
    };
    const fetchMock = vi.fn(async (url) => ({
      ok: true,
      status: String(url).endsWith("/start") ? 202 : 200,
      statusText: "OK",
      text: async () => JSON.stringify({
        ok: true,
        data: String(url).endsWith("/start")
          ? {
              runId: "RUN-backend-exception",
              status: "running",
              outputDir: "F:\\字节比赛\\最终程序\\runs\\RUN-backend-exception",
              relativeOutputDir: "runs\\RUN-backend-exception",
              elapsedMs: 0,
              error: null
            }
          : {
              runId: "RUN-backend-exception",
              status: "failed",
              outputDir: "F:\\字节比赛\\最终程序\\runs\\RUN-backend-exception",
              relativeOutputDir: "runs\\RUN-backend-exception",
              elapsedMs: 10,
              error
            },
        error: null
      })
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "工作台" }));
    fireEvent.click(screen.getByRole("button", { name: "进入工作台" }));
    fireEvent.change(screen.getByLabelText("请输入你的补充回答，系统会继续更新 DSL"), {
      target: { value: "文章详情页需要阅读信息提示。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "发送回答" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/完整 DSL artifacts 后台生成失败/)).toBeInTheDocument());
    expect(screen.getByText("RUN-backend-exception")).toBeInTheDocument();
    expect(screen.getAllByText(/backend_exception/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/empty_response/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Unexpected end of JSON input/)).not.toBeInTheDocument();
  });

  it("keeps fast skill success visible when the background artifacts runner fails", async () => {
    const skillTurn = {
      runId: "RUN-skill-done",
      status: "skill_turn",
      outputDir: "F:\\byte-contest\\final-app\\runs\\RUN-skill-done",
      relativeOutputDir: "runs\\RUN-skill-done",
      assistant_message: "快速澄清已完成：先确认登录失败原因映射，不进入 Agent 执行。",
      risk_boundary: { ready_for_agent: false, can_handoff_to_agent: false, handoff_decision: "clarify_first" },
      source: { mode: "model_generated_real", provider: "doubao_ark", client: "doubao_ark", model: "ep-20260514110933-mzh58" },
      uiState: {
        dslCompletion: { value: 78, source: "skill_orchestrated_model" },
        readiness: { ready_for_agent: false, can_handoff_to_agent: false, handoff_decision: "clarify_first", source: "skill_safety_boundary" },
        risks: [],
        recommendedQuestion: { title: "Skill suggestion", text: "错误码和用户文案是否一一映射？", reason: "确认验收口径", source: "skill_model" },
        humanReport: {
          summary: { title: "登录失败提示优化", text: "草稿：按账号不存在、密码错误、账号锁定、网络异常区分提示。", status: "needs clarification", source: "model_generated_real" },
          scope: { inScope: ["登录失败提示"], outOfScope: ["Agent Plan", "Agent Handoff", "code execution"] },
          riskCards: [{ title: "Why no handoff", points: ["ready_for_agent=false", "handoff_decision=clarify_first"] }]
        }
      }
    };
    const failedJob = {
      runId: "RUN-full-failed",
      status: "failed",
      outputDir: "F:\\byte-contest\\final-app\\runs\\RUN-full-failed",
      relativeOutputDir: "runs\\RUN-full-failed",
      elapsedMs: 12,
      artifactStatus: "failed",
      artifacts: { available: ["error.json"], partial: true },
      error: { code: "standalone_artifact_failed", message: "standalone artifact runner failed", details: { runId: "RUN-full-failed" } }
    };
    const retryPassedJob = {
      ...failedJob,
      runId: "RUN-retry-artifacts",
      originalRunId: "RUN-full-failed",
      status: "passed",
      artifactStatus: "done",
      error: null,
      artifacts: { available: ["12_final_dsl.json", "13_case_summary.md"], partial: false },
      fullArtifacts: {
        "12_final_dsl.json": { exists: true, json: { title: "Login failure guidance" } },
        "13_case_summary.md": { exists: true, text: "standalone artifact runner passed" }
      },
      uiState: {
        dslCompletion: { value: 82, source: "real_score" },
        readiness: { ready_for_agent: false, can_handoff_to_agent: false, handoff_decision: "clarify_first", source: "artifact" },
        risks: [],
        recommendedQuestion: { title: "Skill suggestion", text: "Confirm acceptance result?", reason: "standalone runner", source: "EVPI-lite" },
        humanReport: {}
      }
    };
    const artifactPayload = {
      runId: "RUN-full-failed",
      status: "failed",
      available: ["error.json", "summary.md"],
      partial: true,
      artifacts: {
        "error.json": { exists: true, json: { error: { code: "standalone_artifact_failed", message: "standalone artifact runner failed" } } }
      }
    };
    const fetchMock = vi.fn(async (url) => {
      const target = String(url);
      const data = target.endsWith("/pm-dsl-turn")
        ? skillTurn
        : target.endsWith("/start")
          ? { ...failedJob, status: "running", elapsedMs: 0, error: null }
          : target.endsWith("/artifacts")
            ? artifactPayload
            : target.endsWith("/retry")
              ? { ...retryPassedJob, status: "running", elapsedMs: 0, error: null }
              : target.includes("RUN-retry-artifacts")
                ? retryPassedJob
                : failedJob;
      return {
        ok: true,
        status: target.endsWith("/start") || target.endsWith("/retry") ? 202 : 200,
        statusText: "OK",
        text: async () => JSON.stringify({ ok: true, data, error: null })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(document.querySelectorAll(".mode-tab")[1]);
    fireEvent.click(document.querySelector(".enter-workbench-button"));
    fireEvent.change(document.querySelector(".chat-input-row input"), {
      target: { value: "登录失败文案需要按失败原因区分。" }
    });
    fireEvent.click(document.querySelector(".chat-input-row button"));

    await waitFor(() => expect(screen.getByText(/快速澄清已完成，完整 DSL artifacts 后台生成失败/)).toBeInTheDocument());
    expect(screen.getByText("RUN-full-failed")).toBeInTheDocument();
    expect(screen.getByText("done")).toBeInTheDocument();
    expect(screen.getAllByText("failed").length).toBeGreaterThan(0);
    await waitFor(() => expect(document.body.textContent).toContain("standalone_artifact_failed"));
    expect(document.body.textContent).not.toContain("pm_dsl_runner");
    expect(document.body.textContent).not.toContain("runner_missing");
    expect(screen.getByText("not ready")).toBeInTheDocument();
    expect(screen.getByText("clarify_first")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /打开需求报告/ })).toHaveTextContent("report ready");
    expect(screen.queryByText(/本轮 DSL 生成失败/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /打开需求报告/ }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "草稿报告（人类可读版）" })).toBeInTheDocument());
    expect(screen.getByText("草稿可审阅")).toBeInTheDocument();
    expect(screen.getByText(/fast skill 草稿/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });

    const skillCallsBeforeRetry = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/pm-dsl-turn")).length;
    fireEvent.click(screen.getByRole("button", { name: "重试完整 artifacts" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/retry"))).toBe(true));
    await waitFor(() => expect(screen.getByText("RUN-retry-artifacts")).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByText("done").length).toBeGreaterThanOrEqual(2));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/pm-dsl-turn")).length).toBe(skillCallsBeforeRetry);
  });

  it("shows running run id and lets the PM cancel the current async run", async () => {
    const fetchMock = vi.fn(async (url) => {
      const text = async () => JSON.stringify({
        ok: true,
        data: String(url).endsWith("/cancel")
          ? {
              runId: "RUN-cancel-ui",
              status: "cancelled",
              outputDir: "F:\\字节比赛\\最终程序\\runs\\RUN-cancel-ui",
              relativeOutputDir: "runs\\RUN-cancel-ui",
              elapsedMs: 50,
              error: { code: "runner_cancelled", message: "Run was cancelled by user", details: {} }
            }
          : {
              runId: "RUN-cancel-ui",
              status: "running",
              outputDir: "F:\\字节比赛\\最终程序\\runs\\RUN-cancel-ui",
              relativeOutputDir: "runs\\RUN-cancel-ui",
              elapsedMs: 100,
              error: null
            },
        error: null
      });
      return {
        ok: true,
        status: String(url).endsWith("/start") ? 202 : 200,
        statusText: "OK",
        text
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "工作台" }));
    fireEvent.click(screen.getByRole("button", { name: "进入工作台" }));
    fireEvent.change(screen.getByLabelText("请输入你的补充回答，系统会继续更新 DSL"), {
      target: { value: "需要验证 cancel flow。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "发送回答" }));

    await waitFor(() => expect(screen.getByText("RUN-cancel-ui")).toBeInTheDocument());
    expect(screen.getAllByText("running").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "取消本轮" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "取消本轮" }));

    await waitFor(() => expect(screen.getAllByText("cancelled").length).toBeGreaterThan(0));
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/cancel"))).toBe(true);
    expect(screen.getAllByText(/Run cancelled/).length).toBeGreaterThan(0);
  });

  it("shows retry and partial artifacts controls after timeout", async () => {
    const artifactPayload = {
      runId: "RUN-timeout-ui",
      status: "timeout",
      available: ["error.json", "summary.md"],
      partial: true,
      artifacts: {
        "error.json": {
          exists: true,
          json: { error: { code: "runner_timeout", message: "runner exceeded 1s" } }
        },
        "summary.md": { exists: true, text: "# partial" }
      }
    };
    const fetchMock = vi.fn(async (url) => {
      const target = String(url);
      const data = target.endsWith("/artifacts")
        ? artifactPayload
        : target.endsWith("/retry")
          ? {
              runId: "RUN-retry-ui",
              originalRunId: "RUN-timeout-ui",
              status: "running",
              outputDir: "F:\\字节比赛\\最终程序\\runs\\RUN-retry-ui",
              relativeOutputDir: "runs\\RUN-retry-ui",
              elapsedMs: 0,
              error: null
            }
          : target.includes("RUN-retry-ui")
            ? {
                runId: "RUN-retry-ui",
                originalRunId: "RUN-timeout-ui",
                status: "running",
                outputDir: "F:\\瀛楄妭姣旇禌\\鏈€缁堢▼搴廫\runs\\RUN-retry-ui",
                relativeOutputDir: "runs\\RUN-retry-ui",
                elapsedMs: 50,
                error: null
              }
          : target.endsWith("/start")
            ? {
                runId: "RUN-timeout-ui",
                status: "running",
                outputDir: "F:\\字节比赛\\最终程序\\runs\\RUN-timeout-ui",
                relativeOutputDir: "runs\\RUN-timeout-ui",
                elapsedMs: 0,
                error: null
              }
            : {
                runId: "RUN-timeout-ui",
                status: "timeout",
                outputDir: "F:\\字节比赛\\最终程序\\runs\\RUN-timeout-ui",
                relativeOutputDir: "runs\\RUN-timeout-ui",
                elapsedMs: 1000,
                error: { code: "runner_timeout", message: "runner exceeded 1s", details: {} }
              };
      return {
        ok: true,
        status: target.endsWith("/start") || target.endsWith("/retry") ? 202 : 200,
        statusText: "OK",
        text: async () => JSON.stringify({ ok: true, data, error: null })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "工作台" }));
    fireEvent.click(screen.getByRole("button", { name: "进入工作台" }));
    fireEvent.change(screen.getByLabelText("请输入你的补充回答，系统会继续更新 DSL"), {
      target: { value: "需要验证 timeout flow。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "发送回答" }));

    await waitFor(() => expect(screen.getAllByText("timeout").length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: "重试完整 artifacts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看错误详情" })).toBeInTheDocument();
    expect(screen.getAllByText(/runner_timeout/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "查看错误详情" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "partial artifacts" })).toBeInTheDocument());
    expect(screen.getByText("error.json")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试完整 artifacts" }));
    await waitFor(() => expect(screen.getByText("RUN-retry-ui")).toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/retry"))).toBe(true);
  });

  it("shows skill-generated L1 assistant message instead of raw EVPI question", async () => {
    const rawEvpiQuestion = "\u4f60\u5e0c\u671b\u7528\u4ec0\u4e48\u7528\u6237\u53ef\u89c1\u73b0\u8c61\u6216\u6d4b\u8bd5\u7ed3\u679c\u5224\u65ad\u8fd9\u4e2a\u9700\u6c42\u5df2\u7ecf\u5b8c\u6210\uff1f";
    const l1Input = "\u6587\u7ae0\u8be6\u60c5\u9875\u73b0\u5728\u53ea\u6709\u6b63\u6587\u5185\u5bb9\uff0c\u6211\u5e0c\u671b\u5728\u6b63\u6587\u4e0b\u9762\u52a0\u4e00\u4e2a\u7b80\u5355\u7684\u9605\u8bfb\u4fe1\u606f\u63d0\u793a\uff0c\u6bd4\u5982\u201c\u672c\u6587\u5171 XXX \u5b57\uff0c\u9884\u8ba1\u9605\u8bfb X \u5206\u949f\u201d\u3002\u5148\u53ea\u5728\u524d\u7aef\u6839\u636e\u6587\u7ae0\u6b63\u6587\u8ba1\u7b97\uff0c\u4e0d\u9700\u8981\u6539\u540e\u7aef\uff0c\u4e5f\u4e0d\u9700\u8981\u4fdd\u5b58\u6570\u636e\u3002\u5e0c\u671b\u7a7a\u6b63\u6587\u65f6\u4e0d\u8981\u62a5\u9519\uff0c\u5c55\u793a\u4e0a\u4e5f\u522b\u592a\u7a81\u5140\u3002";
    const assistantMessage = "\u6211\u5148\u6309\u4f60\u7684\u63cf\u8ff0\u6c89\u6dc0\u4e00\u4e2a\u5019\u9009\u9a8c\u6536\u53e3\u5f84\uff1a\u6709\u6b63\u6587\u65f6\uff0c\u5728\u6587\u7ae0\u8be6\u60c5\u9875\u6b63\u6587\u4e0b\u65b9\u5c55\u793a\u201c\u672c\u6587\u5171 XXX \u5b57\uff0c\u9884\u8ba1\u9605\u8bfb X \u5206\u949f\u201d\uff1b\u6b63\u6587\u4e3a\u7a7a\u6216\u7f3a\u5931\u65f6\u9690\u85cf\u8be5\u4fe1\u606f\uff0c\u9875\u9762\u4e0d\u62a5\u9519\uff0c\u4e0d\u51fa\u73b0 NaN \u6216\u5f02\u5e38\u65f6\u95f4\uff1b\u672c\u8f6e\u4e0d\u6d89\u53ca\u540e\u7aef\u5b57\u6bb5\u3001\u6570\u636e\u5e93\u6216\u63a5\u53e3\u53d8\u66f4\u3002\u8fd8\u9700\u8981\u786e\u8ba4\u4e00\u4e2a\u4ea7\u54c1\u53e3\u5f84\uff1a\u9884\u8ba1\u9605\u8bfb\u65f6\u95f4\u6309\u591a\u5c11\u5b57/\u5206\u949f\u8ba1\u7b97\uff1f\u5982\u679c\u4f60\u6ca1\u6709\u7279\u522b\u8981\u6c42\uff0c\u53ef\u4ee5\u5148\u6309\u6bcf\u5206\u949f 400 \u4e2a\u4e2d\u6587\u5b57\u4f30\u7b97\u3002";
    const skillTurn = {
      runId: "RUN-skill-l1",
      status: "skill_turn",
      outputDir: "F:\\byte-contest\\final-app\\runs\\RUN-skill-l1",
      relativeOutputDir: "runs\\RUN-skill-l1",
      assistant_message: assistantMessage,
      risk_boundary: { ready_for_agent: false, can_handoff_to_agent: false, handoff_decision: "clarify_first" },
      source: { mode: "model_generated_real", client: "openai_sdk", model: "gpt-5.5", skills_used: ["prd_to_dsl", "clarification", "code_context"] },
      uiState: {
        dslCompletion: { value: 78, source: "skill_orchestrated_model" },
        readiness: { ready_for_agent: false, can_handoff_to_agent: false, handoff_decision: "clarify_first", source: "skill_safety_boundary" },
        risks: [{ priority: "P0", key: "test_oracle_unclear", description: "acceptance criteria need PM confirmation", impact: "medium" }],
        recommendedQuestion: { title: "Skill suggestion", text: "Use 400 Chinese characters per minute?", reason: "Generated by skill orchestration", source: "skill_model" },
        humanReport: {
          summary: { title: "Reading information hint", text: "Candidate requirement: show word count and estimated reading time below article body.", status: "needs clarification", source: "model_generated_real" },
          scope: { inScope: ["frontend reading info", "empty body guard"], outOfScope: ["Agent Plan", "Agent Handoff", "code execution", "backend change"] },
          riskCards: [
            { title: "Candidate acceptance criteria", points: ["Show ??? XXX ?????? X ?? when body exists", "Hide reading info for empty body", "No NaN or abnormal time"] },
            { title: "Why no handoff", points: ["ready_for_agent=false", "handoff_decision=clarify_first"] }
          ],
          note: "Generated by Skill-driven model turn."
        },
        coverageItems: { covered: ["frontend reading info"], pending: ["confirm 400 chars/minute"] },
        reportQuality: [],
        boundaries: { agentPlanGenerated: false, agentHandoffEntered: false, codeExecutionEntered: false, postEvalEntered: false }
      }
    };
    const runnerJob = {
      runId: "RUN-l1-runner",
      status: "passed",
      outputDir: "F:\\byte-contest\\final-app\\runs\\RUN-l1-runner",
      relativeOutputDir: "runs\\RUN-l1-runner",
      artifacts: {},
      fullArtifacts: {},
      uiState: {
        dslCompletion: { value: 83, source: "real_score" },
        readiness: { ready_for_agent: false, can_handoff_to_agent: false, handoff_decision: "clarify_first", source: "artifact" },
        risks: [],
        recommendedQuestion: { title: "EVPI raw signal", text: rawEvpiQuestion, reason: "raw EVPI should stay a signal", source: "EVPI-lite" },
        humanReport: {}
      }
    };
    const fetchMock = vi.fn(async (url) => {
      const target = String(url);
      const data = target.endsWith("/pm-dsl-turn") ? skillTurn : target.endsWith("/start") ? { ...runnerJob, status: "running", elapsedMs: 0 } : runnerJob;
      return { ok: true, status: target.endsWith("/start") ? 202 : 200, statusText: "OK", text: async () => JSON.stringify({ ok: true, data, error: null }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(document.querySelectorAll(".mode-tab")[1]);
    fireEvent.click(document.querySelector(".enter-workbench-button"));
    fireEvent.change(document.querySelector(".chat-input-row input"), { target: { value: l1Input } });
    fireEvent.click(document.querySelector(".chat-input-row button"));

    await waitFor(() => expect(screen.getByText(/\u5019\u9009\u9a8c\u6536\u53e3\u5f84/)).toBeInTheDocument());
    expect(screen.getAllByText(/XXX/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/400/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(rawEvpiQuestion)).not.toBeInTheDocument();
    expect(screen.getByText("not ready")).toBeInTheDocument();
    expect(screen.getByText("clarify_first")).toBeInTheDocument();
    expect(screen.getByText("回复来源：Real model · openai_sdk · gpt-5.5")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("RUN-l1-runner")).toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/pm-dsl-turn"))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/start"))).toBe(true);

    fireEvent.click(document.querySelector(".report-cta"));
    await waitFor(() => expect(document.querySelector(".requirement-report-modal")).toBeTruthy());
    expect(screen.getByText("Candidate acceptance criteria")).toBeInTheDocument();
    expect(screen.getAllByText(/empty body/).length).toBeGreaterThanOrEqual(2);
  });
});

function buildSkillTurn({ message, question = "", score, asked = 0, remaining = 0, isFinalQuestion = false, complete = false }) {
  return {
    runId: `RUN-skill-${score}`,
    status: "skill_turn",
    outputDir: `F:\\byte-contest\\final-app\\runs\\RUN-skill-${score}`,
    relativeOutputDir: `runs\\RUN-skill-${score}`,
    assistant_message: message,
    clarification: {
      should_ask: !complete,
      questions: complete ? [] : [{ question, reason: "single-question flow", priority: "p0" }],
      currentQuestion: complete ? "" : question,
      remainingQuestionCount: remaining,
      askedQuestionCount: asked,
      isFinalQuestion,
      clarificationComplete: complete
    },
    risk_boundary: {
      ready_for_agent: false,
      can_handoff_to_agent: false,
      handoff_decision: complete ? "clarification_complete" : "clarify_first"
    },
    source: { mode: "model_generated_real", client: "openai_sdk", model: "gpt-5.5", skills_used: ["prd_to_dsl", "clarification", "code_context"] },
    uiState: {
      dslCompletion: { rawScore: 81, displayScore: score, value: score, source: "skill_orchestrated_model" },
      readiness: {
        ready_for_agent: false,
        can_handoff_to_agent: false,
        handoff_decision: complete ? "clarification_complete" : "clarify_first",
        source: "skill_safety_boundary"
      },
      risks: [],
      recommendedQuestion: complete ? null : { title: "Skill suggestion", text: question, reason: "single-question flow", source: "skill_model" },
      humanReport: {
        summary: {
          title: "文章浏览量统计",
          text: "候选需求摘要",
          status: complete ? "clarification_complete" : "needs clarification",
          source: "model_generated_real"
        }
      },
      coverageItems: { covered: ["浏览量统计"], pending: complete ? [] : [question] },
      boundaries: { agentPlanGenerated: false, agentHandoffEntered: false, codeExecutionEntered: false, postEvalEntered: false }
    }
  };
}

function runnerJobForTurn(skillTurn) {
  const runId = skillTurn?.runId?.replace("RUN-skill", "RUN-runner") || "RUN-runner";
  return {
    runId,
    status: "passed",
    outputDir: `F:\\byte-contest\\final-app\\runs\\${runId}`,
    relativeOutputDir: `runs\\${runId}`,
    fullArtifacts: {},
    uiState: skillTurn?.uiState || {}
  };
}

function jsonResponse(data, status = 200) {
  return {
    ok: true,
    status,
    statusText: status === 202 ? "Accepted" : "OK",
    text: async () => JSON.stringify({ ok: true, data, error: null })
  };
}

async function sendWorkbenchAnswer(text) {
  fireEvent.change(document.querySelector(".chat-input-row input"), { target: { value: text } });
  fireEvent.click(document.querySelector(".chat-input-row button"));
}
