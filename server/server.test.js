// @vitest-environment node
import path from "node:path";
import fs from "node:fs/promises";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createAppServer } from "./index.js";
import { redactSecrets } from "./services/redactionService.js";
import { loadSkillPrompts } from "./services/skillPromptLoader.js";
import { runSkillTurn } from "./services/skillOrchestrator.js";
import { createChatCompletionWithLocalConfig, readOpenAiCompatibleConfig } from "./services/openAiCompatibleClient.js";
import {
  DEFAULT_DOUBAO_ARK_CONFIG_PATH,
  createDoubaoChatCompletionWithLocalConfig,
  readDoubaoArkConfig
} from "./services/doubaoArkClient.js";

const testRunsRoot = path.resolve("runs", "test-server");
const listeners = [];

async function startTestServer(options) {
  const runtimeRoot = path.join(testRunsRoot, "standalone-runtime");
  const apiConfigPath = path.join(testRunsRoot, "configs", "api_config.local.json");
  await ensureStandaloneServerFixtures(runtimeRoot, apiConfigPath);
  const server = createAppServer({
    runsRoot: testRunsRoot,
    dslRuntimeRoot: runtimeRoot,
    apiConfigPath,
    codeContextPath: path.resolve("e2e", "context", "default_code_context_packet.json"),
    ...options
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  listeners.push(server);
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

async function ensureStandaloneServerFixtures(runtimeRoot, apiConfigPath) {
  await fs.mkdir(runtimeRoot, { recursive: true });
  await fs.mkdir(path.dirname(apiConfigPath), { recursive: true });
  await fs.writeFile(apiConfigPath, JSON.stringify({
    provider: "doubao_ark",
    api_key: "db-test-fixture-secret",
    model: "ep-test-fixture"
  }, null, 2), "utf8");
}

async function startFakeOpenAiServer(handler) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let rawBody = "";
    request.on("data", (chunk) => {
      rawBody += chunk.toString("utf8");
    });
    request.on("end", async () => {
      const body = rawBody ? JSON.parse(rawBody) : {};
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body
      });
      const result = await handler({ request, body });
      response.writeHead(result.status || 200, { "content-type": "application/json" });
      response.end(JSON.stringify(result.body));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  listeners.push(server);
  const { port } = server.address();
  return { baseUrl: `http://127.0.0.1:${port}`, requests };
}

async function writeSkillApiConfig(filename, config) {
  const configDir = path.join(testRunsRoot, "configs");
  await fs.mkdir(configDir, { recursive: true });
  const configPath = path.join(configDir, filename);
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
  return configPath;
}

async function waitForJob(baseUrl, runId, terminalStatuses = ["passed", "failed", "timeout", "cancelled"], timeoutMs = 3000) {
  const started = Date.now();
  let latest = null;
  while (Date.now() - started < timeoutMs) {
    const response = await fetch(`${baseUrl}/api/dsl/runs/${runId}`);
    const payload = await response.json();
    latest = payload.data;
    if (terminalStatuses.includes(latest.status)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${runId}; latest=${JSON.stringify(latest)}`);
}

async function fakeStandaloneArtifactModel({ label }) {
  if (label === "pm_to_requirement_dsl") {
    return {
      content: JSON.stringify({
        title: "Login failure guidance",
        summary: "Improve visible login failure guidance without backend writes.",
        requirements: ["Show clearer login failure copy", "Keep safe dry-run boundary"],
        acceptance_criteria: ["User can see a clear next action", "No Agent real write happens"],
        risks: ["Backend error-code mapping still needs confirmation"],
        ready_for_agent: false,
        handoff_decision: "clarify_first"
      }),
      latencyMs: 1
    };
  }
  if (label === "context_readiness") {
    return {
      content: JSON.stringify({
        ready: false,
        reasons: ["PM confirmation is still required"],
        safe_to_write: false,
        recommended_files: ["src/components/LoginForm.jsx"],
        test_commands: ["npm test"]
      }),
      latencyMs: 1
    };
  }
  throw new Error(`unexpected_fake_standalone_label:${label}`);
}

afterEach(async () => {
  await Promise.all(
    listeners.splice(0).map((server) => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      const timer = setTimeout(resolve, 250);
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    }))
  );
});

describe("DSL backend API", () => {
  it("reads local OpenAI-compatible config and constructs SDK client with exact baseURL", async () => {
    const calls = { constructor: [], create: [] };
    class FakeOpenAI {
      constructor(options) {
        calls.constructor.push(options);
        this.chat = {
          completions: {
            create: async (body, options) => {
              calls.create.push({ body, options });
              return {
                id: "chatcmpl-sdk-test",
                choices: [{ message: { content: "{\"ok\":true}" } }]
              };
            }
          }
        };
      }
    }
    const configPath = await writeSkillApiConfig("sdk-client-test.json", {
      base_url: "http://127.0.0.1:8317/v1",
      api_key: "sk-sdk-secret-value",
      model: "gpt-sdk-test",
      chat_completions_path: "/chat/completions"
    });

    const config = await readOpenAiCompatibleConfig({ apiConfigPath: configPath });
    const result = await createChatCompletionWithLocalConfig({
      apiConfigPath: configPath,
      messages: [{ role: "user", content: "Return {\"ok\":true}" }],
      timeoutMs: 1000,
      OpenAIClass: FakeOpenAI
    });

    expect(config.baseURL).toBe("http://127.0.0.1:8317/v1");
    expect(config.model).toBe("gpt-sdk-test");
    expect(config.hasApiKey).toBe(true);
    expect(calls.constructor[0]).toMatchObject({
      baseURL: "http://127.0.0.1:8317/v1",
      apiKey: "sk-sdk-secret-value"
    });
    expect(calls.create[0].body.model).toBe("gpt-sdk-test");
    expect(calls.create[0].options.timeout).toBe(1000);
    expect(result.content).toBe("{\"ok\":true}");
    expect(result.source).toMatchObject({
      mode: "model_generated_real",
      client: "openai_sdk",
      model: "gpt-sdk-test"
    });
    expect(JSON.stringify(result.safeRequest)).not.toMatch(/sk-sdk-secret-value|api_key|Authorization|Bearer/i);
  });

  it("maps SDK errors into structured external blocked codes without leaking keys", async () => {
    class FailingOpenAI {
      constructor() {
        this.chat = {
          completions: {
            create: async () => {
              const error = new Error("401 invalid api key sk-sdk-secret-value");
              error.status = 401;
              throw error;
            }
          }
        };
      }
    }
    const configPath = await writeSkillApiConfig("sdk-client-error-test.json", {
      base_url: "http://127.0.0.1:8317/v1",
      api_key: "sk-sdk-secret-value",
      model: "gpt-sdk-test",
      chat_completions_path: "/chat/completions"
    });

    await expect(createChatCompletionWithLocalConfig({
      apiConfigPath: configPath,
      messages: [{ role: "user", content: "hello" }],
      timeoutMs: 1000,
      OpenAIClass: FailingOpenAI
    })).rejects.toMatchObject({
      code: "sdk_auth_failed",
      details: expect.objectContaining({ status: "external_blocked", model: "gpt-sdk-test" })
    });
  });

  it("reads Doubao Ark config, posts endpoint_id as model, and redacts request artifacts", async () => {
    const requests = [];
    const fakeArk = await startFakeOpenAiServer(async ({ request, body }) => {
      requests.push({ url: request.url, headers: request.headers, body });
      return {
        body: {
          id: "doubao-health-test",
          echo: "db-secret-value",
          choices: [{ message: { content: "{\"ok\":true}" } }]
        }
      };
    });
    const configPath = await writeSkillApiConfig("doubao-client-test.json", {
      provider: "doubao_ark",
      endpoint_id: "ep-doubao-test",
      api_key: "db-secret-value"
    });

    const config = await readDoubaoArkConfig({ configPath });
    const result = await createDoubaoChatCompletionWithLocalConfig({
      configPath,
      baseURL: `${fakeArk.baseUrl}/api/v3`,
      messages: [{ role: "user", content: "Return JSON only: {\"ok\": true}" }],
      timeoutMs: 1000
    });

    expect(config.provider).toBe("doubao_ark");
    expect(config.model).toBe("ep-doubao-test");
    expect(config.hasApiKey).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/api/v3/chat/completions");
    expect(requests[0].headers.authorization).toBe("Bearer db-secret-value");
    expect(requests[0].body.model).toBe("ep-doubao-test");
    expect(result.content).toBe("{\"ok\":true}");
    expect(result.source).toMatchObject({
      mode: "model_generated_real",
      provider: "doubao_ark",
      client: "doubao_ark",
      model: "ep-doubao-test"
    });
    expect(JSON.stringify(result.safeRequest)).not.toMatch(/db-secret-value|Authorization|Bearer|api_key/i);
    expect(JSON.stringify(result.safeResponse)).not.toMatch(/db-secret-value|Authorization|Bearer|api_key/i);
  });

  it("defaults Doubao Ark config to api_config.local.json and prefers model over endpoint_id", async () => {
    const configPath = path.join(testRunsRoot, "api_config.local.json");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      provider: "doubao_ark",
      api_key: "db-secret-value",
      model: "ep-model-preferred",
      endpoint_id: "ep-endpoint-fallback"
    }, null, 2), "utf8");

    const config = await readDoubaoArkConfig({ configPath });

    expect(DEFAULT_DOUBAO_ARK_CONFIG_PATH).toBe(path.resolve("configs", "api_config.local.json"));
    expect(config.configPath).toBe(configPath);
    expect(config.baseURL).toBe("https://ark.cn-beijing.volces.com/api/v3");
    expect(config.chatCompletionsPath).toBe("/chat/completions");
    expect(config.model).toBe("ep-model-preferred");
    expect(config.endpointId).toBe("ep-endpoint-fallback");
    expect(config.hasApiKey).toBe(true);
  });

  it("maps Doubao Ark auth errors into structured external blocked codes without leaking keys", async () => {
    const fakeArk = await startFakeOpenAiServer(async () => ({
      status: 401,
      body: { error: { message: "invalid api key db-secret-value" } }
    }));
    const configPath = await writeSkillApiConfig("doubao-auth-error-test.json", {
      provider: "doubao_ark",
      endpoint_id: "ep-doubao-test",
      api_key: "db-secret-value"
    });

    await expect(createDoubaoChatCompletionWithLocalConfig({
      configPath,
      baseURL: `${fakeArk.baseUrl}/api/v3`,
      messages: [{ role: "user", content: "hello" }],
      timeoutMs: 1000
    })).rejects.toMatchObject({
      code: "doubao_auth_failed",
      details: expect.objectContaining({
        status: "external_blocked",
        provider: "doubao_ark",
        model: "ep-doubao-test"
      })
    });
  });

  it("loads PM-to-DSL skill prompt files from project-local e2e prompts", async () => {
    const result = await loadSkillPrompts({
      dslRuntimeRoot: path.resolve("e2e"),
      skillNames: ["prd_to_dsl", "clarification", "code_context"]
    });

    expect(result.ok).toBe(true);
    expect(result.data.skills.prd_to_dsl.content).toContain("RequirementDSL");
    expect(result.data.skills.clarification.content).toContain("Clarification");
    expect(result.data.skills.code_context.content).toContain("Code Context");
  });

  it("returns a structured skill loader error when a required skill is missing", async () => {
    const result = await loadSkillPrompts({
      dslRuntimeRoot: path.resolve("e2e"),
      skillRoot: testRunsRoot,
      skillNames: ["prd_to_dsl"]
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("skill_prompt_missing");
    expect(result.error.details.skillName).toBe("prd_to_dsl");
  });

  it("runs a skill-orchestrated PM turn, saves artifacts, and keeps safety gates closed", async () => {
    const result = await runSkillTurn({
      projectId: "conduit-realworld-example-app",
      pmMessages: [
        {
          role: "pm",
          content: "文章详情页现在只有正文内容，我希望在正文下面加阅读信息提示，空正文不要报错，不改后端和数据库。"
        }
      ],
      evpiSignals: {
        ranked_questions: [
          {
            question: "你希望用什么用户可见现象或测试结果判断这个需求已经完成？",
            reason: "raw EVPI question should be a signal only"
          }
        ]
      }
    }, {
      runsRoot: testRunsRoot,
      dslRuntimeRoot: path.resolve("e2e"),
      skillModelMode: "mock"
    });

    expect(result.ok).toBe(true);
    expect(result.data.assistant_message).toContain("候选验收");
    expect(result.data.assistant_message).toContain("400");
    expect(result.data.assistant_message).not.toBe("你希望用什么用户可见现象或测试结果判断这个需求已经完成？");
    expect(result.data.risk_boundary.ready_for_agent).toBe(false);
    expect(result.data.risk_boundary.can_handoff_to_agent).toBe(false);
    expect(result.data.source.mode).toBe("mock");
    expect(result.data.source.skills_used).toEqual(expect.arrayContaining(["prd_to_dsl", "clarification", "code_context"]));

    const artifactRoot = path.join(testRunsRoot, result.data.runId);
    await expect(fs.access(path.join(artifactRoot, "skill_turn_input.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(artifactRoot, "skill_turn_prompt.md"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(artifactRoot, "skill_turn_response_raw.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(artifactRoot, "skill_turn_response_parsed.json"))).resolves.toBeUndefined();
  });

  it("defaults non-test skill turns to the OpenAI SDK local config and writes redacted SDK artifacts", async () => {
    const fakeApi = await startFakeOpenAiServer(async ({ body }) => ({
      body: {
        id: "chatcmpl-real-test",
        choices: [{
          message: {
            content: JSON.stringify({
              assistant_message: "REAL_MODEL_SENTINEL: 我会基于 PM 输入生成候选 DSL，并确认阅读时间计算口径。",
              dsl_patch: { candidate: true },
              current_dsl_summary: {
                title: "阅读信息提示",
                goal: "展示字数和预计阅读时间",
                scope: ["前端详情页展示阅读信息"],
                out_of_scope: ["后端接口变更", "Agent Plan", "Agent Handoff", "代码执行"],
                acceptance_criteria: ["有正文时展示字数和预计阅读时间"],
                unknowns: ["阅读速度口径"]
              },
              clarification: {
                should_ask: true,
                question: "预计阅读时间是否按每分钟 400 字估算？",
                reason: "需要 PM 确认验收口径",
                target_fields: ["test_oracle"],
                suggested_default: "每分钟 400 字"
              },
              risk_boundary: {
                ready_for_agent: false,
                can_handoff_to_agent: false,
                handoff_decision: "clarify_first",
                reasons: ["仍需 PM 确认阅读速度口径"]
              },
              human_report_patch: {
                summary: "候选需求来自真实模型响应。",
                in_scope: ["前端计算阅读信息"],
                out_of_scope: ["后端保存数据"],
                risks: ["阅读速度口径未确认"],
                pending_confirmations: ["确认阅读速度"],
                next_actions: ["等待 PM 确认"]
              },
              source: { mode: "model_generated", skills_used: [] }
            })
          }
        }],
        requestEchoModel: body.model
      }
    }));
    const configPath = await writeSkillApiConfig("real-api-test.json", {
      base_url: `${fakeApi.baseUrl}/v1`,
      api_key: "sk-real-secret-value",
      model: "gpt-test-real",
      chat_completions_path: "/chat/completions"
    });

    const result = await runSkillTurn({
      projectId: "conduit-realworld-example-app",
      pmMessages: [{ role: "pm", content: "文章详情页需要阅读信息提示；api_key=sk-real-secret-value。" }]
    }, {
      runsRoot: testRunsRoot,
      dslRuntimeRoot: path.resolve("e2e"),
      apiConfigPath: configPath,
      nodeEnv: "development"
    });

    expect(result.ok).toBe(true);
    expect(result.data.assistant_message).toContain("REAL_MODEL_SENTINEL");
    expect(result.data.source.mode).toBe("model_generated_real");
    expect(result.data.source.client).toBe("openai_sdk");
    expect(result.data.source.model).toBe("gpt-test-real");
    expect(fakeApi.requests).toHaveLength(1);
    expect(fakeApi.requests[0].url).toBe("/v1/chat/completions");
    expect(fakeApi.requests[0].headers.authorization).toBe("Bearer sk-real-secret-value");
    expect(fakeApi.requests[0].body.model).toBe("gpt-test-real");

    const artifactRoot = path.join(testRunsRoot, result.data.runId);
    const apiRequestText = await fs.readFile(path.join(artifactRoot, "skill_turn_sdk_request.json"), "utf8");
    const apiResponseText = await fs.readFile(path.join(artifactRoot, "skill_turn_sdk_response_raw.json"), "utf8");
    const parsedText = await fs.readFile(path.join(artifactRoot, "skill_turn_response_parsed.json"), "utf8");
    await expect(fs.access(path.join(artifactRoot, "skill_turn_response_raw.json"))).resolves.toBeUndefined();

    expect(apiRequestText).not.toMatch(/sk-real-secret-value|Bearer sk-real-secret-value|api_key/i);
    expect(apiResponseText).not.toMatch(/sk-real-secret-value|Bearer sk-real-secret-value|api_key/i);
    expect(parsedText).toContain("model_generated_real");
    expect(parsedText).not.toMatch(/sk-real-secret-value|Bearer sk-real-secret-value|api_key/i);
  });

  it("uses Doubao Ark for non-test skill turns when doubao provider config is present", async () => {
    const fakeArk = await startFakeOpenAiServer(async ({ body }) => ({
      body: {
        id: "doubao-real-test",
        choices: [{
          message: {
            content: JSON.stringify({
              assistant_message: "DOUBAO_MODEL_SENTINEL: candidate PM-to-DSL clarification reply.",
              dsl_patch: { candidate: true },
              current_dsl_summary: {
                title: "Reading info",
                goal: "Show article reading information",
                scope: ["frontend reading info"],
                out_of_scope: ["backend changes", "Agent Plan", "Agent Handoff", "code execution"],
                acceptance_criteria: ["show word count and reading minutes"],
                unknowns: ["reading speed"]
              },
              clarification: {
                should_ask: true,
                question: "Should reading speed default to 500 characters per minute?",
                reason: "PM confirmation is still required.",
                target_fields: ["test_oracle"],
                suggested_default: "500 characters per minute"
              },
              risk_boundary: {
                ready_for_agent: false,
                can_handoff_to_agent: false,
                handoff_decision: "clarify_first",
                reasons: ["PM must confirm reading speed"]
              },
              human_report_patch: {
                summary: "Doubao generated candidate DSL clarification.",
                in_scope: ["frontend calculation"],
                out_of_scope: ["backend persistence"],
                risks: ["reading speed unconfirmed"],
                pending_confirmations: ["reading speed"],
                next_actions: ["wait for PM confirmation"]
              },
              source: { mode: "model_generated", skills_used: [] },
              requestEchoModel: body.model
            })
          }
        }]
      }
    }));
    const configPath = await writeSkillApiConfig("doubao-real-api-test.json", {
      provider: "doubao_ark",
      endpoint_id: "ep-doubao-real",
      api_key: "db-real-secret"
    });

    const result = await runSkillTurn({
      projectId: "conduit-realworld-example-app",
      pmMessages: [{ role: "pm", content: "Article detail page needs reading info." }]
    }, {
      runsRoot: testRunsRoot,
      dslRuntimeRoot: path.resolve("e2e"),
      doubaoApiConfigPath: configPath,
      doubaoBaseURL: `${fakeArk.baseUrl}/api/v3`,
      nodeEnv: "development"
    });

    expect(result.ok).toBe(true);
    expect(result.data.assistant_message).toContain("DOUBAO_MODEL_SENTINEL");
    expect(result.data.source.mode).toBe("model_generated_real");
    expect(result.data.source.provider).toBe("doubao_ark");
    expect(result.data.source.client).toBe("doubao_ark");
    expect(result.data.source.model).toBe("ep-doubao-real");

    const artifactRoot = path.join(testRunsRoot, result.data.runId);
    const requestText = await fs.readFile(path.join(artifactRoot, "skill_turn_doubao_request.json"), "utf8");
    const responseText = await fs.readFile(path.join(artifactRoot, "skill_turn_doubao_response_raw.json"), "utf8");
    const parsedText = await fs.readFile(path.join(artifactRoot, "skill_turn_response_parsed.json"), "utf8");

    expect(requestText).toContain("doubao_ark");
    expect(responseText).toContain("doubao_ark");
    expect(parsedText).toContain("doubao_ark");
    expect(`${requestText}\n${responseText}\n${parsedText}`).not.toMatch(/db-real-secret|Bearer db-real-secret|api_key|Authorization/i);
  });

  it("reports Doubao Ark config errors without falling back to OpenAI-compatible when real mode has no SDK config", async () => {
    const missingDoubaoConfigPath = path.join(testRunsRoot, "missing-doubao-config.json");

    const result = await runSkillTurn({
      projectId: "conduit-realworld-example-app",
      pmMessages: [{ role: "pm", content: "Article detail page needs reading info." }]
    }, {
      runsRoot: testRunsRoot,
      dslRuntimeRoot: path.resolve("e2e"),
      doubaoApiConfigPath: missingDoubaoConfigPath,
      nodeEnv: "development"
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("doubao_config_missing");
    expect(result.error.details.provider).toBe("doubao_ark");
    expect(result.error.details.client).toBe("doubao_ark");
  });

  it("defaults NODE_ENV=test skill turns to mock without marking them as real model output", async () => {
    const result = await runSkillTurn({
      projectId: "conduit-realworld-example-app",
      pmMessages: [{ role: "pm", content: "文章详情页需要阅读信息提示。" }]
    }, {
      runsRoot: testRunsRoot,
      dslRuntimeRoot: path.resolve("e2e"),
      nodeEnv: "test"
    });

    expect(result.ok).toBe(true);
    expect(result.data.source.mode).toBe("mock");
    expect(result.data.source.provider).toBe("mock_model");
    expect(result.data.source.mode).not.toBe("model_generated_real");
  });

  it("gates greetings and short ambiguous PM inputs before model and artifact runs", async () => {
    const cases = [
      {
        text: "",
        intent: "too_short",
        reply: "请补充你想澄清或生成 DSL 的需求。"
      },
      {
        text: "hello",
        intent: "greeting",
        reply: "你好，请输入你想澄清或生成 DSL 的需求。"
      },
      {
        text: "你好",
        intent: "greeting",
        reply: "你好，请描述你要做的产品需求，我会帮你澄清并生成 DSL。"
      },
      {
        text: "加一个功能",
        intent: "ambiguous_requirement",
        reply: "你想加什么功能？请补充目标用户、使用场景和期望结果。"
      }
    ];

    for (const item of cases) {
      let modelCalls = 0;
      const runsRoot = path.join(testRunsRoot, `input-gate-${item.intent}`);
      await fs.rm(runsRoot, { recursive: true, force: true });

      const result = await runSkillTurn({
        projectId: "conduit-realworld-example-app",
        pmMessages: [
          { role: "pm", content: "登录失败提示太模糊，希望用户知道下一步怎么做。" },
          { role: "pm", content: item.text }
        ],
        currentDslDraft: {
          summary: { title: "登录失败提示优化" }
        }
      }, {
        runsRoot,
        dslRuntimeRoot: path.resolve("e2e"),
        nodeEnv: "development",
        modelClient: async () => {
          modelCalls += 1;
          throw new Error("model should not be called for gated input");
        }
      });

      expect(result.ok).toBe(true);
      expect(result.data.intent).toBe(item.intent);
      expect(result.data.skipDslGeneration).toBe(true);
      expect(result.data.assistant_message).toBe(item.reply);
      expect(result.data.runId).toBe("");
      expect(result.data.current_dsl_summary.title).toBe("");
      expect(result.data.risk_boundary.ready_for_agent).toBe(false);
      expect(result.data.risk_boundary.can_handoff_to_agent).toBe(false);
      expect(result.data.risk_boundary.handoff_decision).toBe("clarify_first");
      expect(modelCalls).toBe(0);
      await expect(fs.readdir(runsRoot)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("marks skill orchestration fallback explicitly when model generation fails", async () => {
    const result = await runSkillTurn({
      projectId: "conduit-realworld-example-app",
      pmMessages: [{ role: "pm", content: "需要登录失败提示优化" }]
    }, {
      runsRoot: testRunsRoot,
      dslRuntimeRoot: path.resolve("e2e"),
      modelClient: async () => {
        throw new Error("mock model offline");
      }
    });

    expect(result.ok).toBe(true);
    expect(result.data.source.mode).toBe("fallback_guardrail");
    expect(result.data.assistant_message).toContain("暂时无法完成模型编排");
    expect(result.data.risk_boundary.ready_for_agent).toBe(false);
  });

  it("returns model_invalid_json fallback guardrail when a model response cannot be parsed", async () => {
    const result = await runSkillTurn({
      projectId: "conduit-realworld-example-app",
      pmMessages: [{ role: "pm", content: "需要一个非 JSON 模型响应的防护测试。" }]
    }, {
      runsRoot: testRunsRoot,
      dslRuntimeRoot: path.resolve("e2e"),
      modelClient: async () => "this is not json"
    });

    expect(result.ok).toBe(true);
    expect(result.data.source.mode).toBe("fallback_guardrail");
    expect(result.data.source.errorCode).toBe("model_invalid_json");
    expect(result.data.assistant_message).toContain("模型返回内容不是有效 JSON");
    expect(result.data.source.mode).not.toBe("mock");
  });

  it("reports real API unavailability as external_blocked instead of falling back to mock", async () => {
    const configPath = await writeSkillApiConfig("unavailable-api-test.json", {
      base_url: "http://127.0.0.1:59999/v1",
      api_key: "sk-unavailable-secret",
      model: "gpt-unavailable",
      chat_completions_path: "/chat/completions"
    });

    const result = await runSkillTurn({
      projectId: "conduit-realworld-example-app",
      pmMessages: [{ role: "pm", content: "真实模型不可用时不能 mock 冒充成功。" }],
      maxLatencyMs: 500
    }, {
      runsRoot: testRunsRoot,
      dslRuntimeRoot: path.resolve("e2e"),
      apiConfigPath: configPath,
      nodeEnv: "development"
    });

    expect(result.ok).toBe(false);
    expect(["sdk_connection_failed", "sdk_timeout"]).toContain(result.error.code);
    expect(result.error.details.status).toBe("external_blocked");
    expect(JSON.stringify(result)).not.toMatch(/sk-unavailable-secret|Bearer|api_key/i);
  });

  it("keeps L1 reading-info skill turns in clarification instead of direct pass", async () => {
    const result = await runSkillTurn({
      projectId: "conduit-realworld-example-app",
      pmMessages: [{
        role: "pm",
        content: "文章详情页现在只有正文内容，我希望在正文下面加一个简单的阅读信息提示，比如“本文共 XXX 字，预计阅读 X 分钟”。先只在前端根据文章正文计算，不需要改后端，也不需要保存数据。希望空正文时不要报错，展示上也别太突兀。"
      }]
    }, {
      runsRoot: testRunsRoot,
      dslRuntimeRoot: path.resolve("e2e"),
      skillModelMode: "mock"
    });

    expect(result.ok).toBe(true);
    expect(result.data.assistant_message).toMatch(/候选验收口径|候选/);
    expect(result.data.assistant_message).toMatch(/400|字\/分钟|阅读时间|空正文/);
    expect(result.data.assistant_message).not.toMatch(/需求已完成|已经生成 DSL|可以继续|没有新的高优先级/);
    expect(result.data.clarification.should_ask).toBe(true);
    expect(result.data.clarification.questions[0].question).toMatch(/阅读|400|字\/分钟|空正文/);
    expect(result.data.risk_boundary.ready_for_agent).toBe(false);
  });

  it("keeps L2 cover-image skill turns in clarification and calls out cross-stack API data risk", async () => {
    const result = await runSkillTurn({
      projectId: "conduit-realworld-example-app",
      pmMessages: [{
        role: "pm",
        content: "我们想给文章加封面图。创建和编辑文章时可以填写一个封面图 URL，文章列表卡片和文章详情页都展示封面图。这个字段需要从后端保存和返回。封面图为空时不要显示破图，也不要影响原来的文章发布、编辑、列表和详情流程。"
      }]
    }, {
      runsRoot: testRunsRoot,
      dslRuntimeRoot: path.resolve("e2e"),
      skillModelMode: "mock"
    });

    expect(result.ok).toBe(true);
    expect(result.data.assistant_message).toMatch(/后端|API|接口|数据|字段/);
    expect(result.data.assistant_message).toMatch(/URL|空值|兼容|字段名|破图/);
    expect(result.data.assistant_message).not.toMatch(/需求已完成|已经生成 DSL|可以继续|没有新的高优先级/);
    expect(result.data.clarification.should_ask).toBe(true);
    expect(result.data.clarification.questions[0].question).toMatch(/字段名|URL|空值|兼容|破图/);
    expect(result.data.risk_boundary.ready_for_agent).toBe(false);
  });

  it("keeps L3 recommendation skill turns in clarification and asks for PM-owned recommendation rules", async () => {
    const result = await runSkillTurn({
      projectId: "conduit-realworld-example-app",
      pmMessages: [{
        role: "pm",
        content: "用户看完一篇文章后，希望系统能推荐一些相关内容，最好让用户继续阅读。你看现有代码自己判断怎么做，先做一个不要太复杂的版本。"
      }]
    }, {
      runsRoot: testRunsRoot,
      dslRuntimeRoot: path.resolve("e2e"),
      skillModelMode: "mock"
    });

    expect(result.ok).toBe(true);
    expect(result.data.assistant_message).toMatch(/推荐|相关内容|继续阅读/);
    expect(result.data.assistant_message).toMatch(/tag|标签|作者|热门|发布时间|规则/);
    expect(result.data.assistant_message).toMatch(/CodeContext|代码上下文|只能辅助|不能代替 PM/);
    expect(result.data.assistant_message).not.toMatch(/需求已完成|已经生成 DSL|可以继续|没有新的高优先级/);
    expect(result.data.clarification.should_ask).toBe(true);
    expect(result.data.clarification.questions[0].question).toMatch(/tag|标签|作者|热门|发布时间|规则/);
    expect(result.data.risk_boundary.ready_for_agent).toBe(false);
  });

  it("repairs model over-pass when clarification is false but key DSL fields are missing", async () => {
    const result = await runSkillTurn({
      projectId: "conduit-realworld-example-app",
      pmMessages: [{ role: "pm", content: "给文章详情页加一个小提示。" }]
    }, {
      runsRoot: testRunsRoot,
      dslRuntimeRoot: path.resolve("e2e"),
      modelClient: async () => JSON.stringify({
        assistant_message: "好的，需求已完成。",
        dsl_patch: { candidate: true },
        current_dsl_summary: {
          title: "提示",
          goal: "加提示",
          scope: [],
          out_of_scope: [],
          acceptance_criteria: [],
          unknowns: []
        },
        clarification: { should_ask: false, questions: [] },
        risk_boundary: {
          ready_for_agent: true,
          can_handoff_to_agent: true,
          handoff_decision: "ready"
        },
        human_report_patch: {
          summary: "已完成",
          in_scope: [],
          out_of_scope: [],
          risks: [],
          pending_confirmations: [],
          next_actions: []
        },
        source: { mode: "model_generated", skills_used: [] }
      })
    });

    expect(result.ok).toBe(true);
    expect(result.data.source.mode).toBe("fallback_guardrail");
    expect(result.data.clarification.should_ask).toBe(true);
    expect(result.data.clarification.questions[0].question).toMatch(/确认|候选|验收|口径|边界/);
    expect(result.data.assistant_message).not.toMatch(/需求已完成|可以继续|进入 Agent/);
    expect(result.data.risk_boundary.ready_for_agent).toBe(false);
    expect(result.data.risk_boundary.handoff_decision).toBe("clarify_first");
  });

  it("uses a compact fast skill prompt with recent six messages and lightweight response schema", async () => {
    let captured = {};
    const messages = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? "pm" : "system",
      content: `message-${index + 1}: reading info requirement details`
    }));

    const result = await runSkillTurn({
      projectId: "conduit-realworld-example-app",
      pmMessages: messages,
      previousUiState: {
        humanReport: { summary: { text: "x".repeat(4000) } },
        risks: Array.from({ length: 12 }, (_, index) => ({ description: `risk-${index}` }))
      }
    }, {
      runsRoot: testRunsRoot,
      dslRuntimeRoot: path.resolve("e2e"),
      modelClient: async ({ prompt, input }) => {
        captured = { prompt, input };
        return JSON.stringify({
          assistant_message: "我已整理候选 DSL，并需要确认一个关键口径。",
          clarification: {
            should_ask: true,
            question: "阅读速度是否默认按每分钟 400 字计算？",
            suggested_default: "每分钟 400 字",
            reason: "需要 PM 确认验收口径"
          },
          dsl_patch: {
            title: "阅读信息提示",
            goal: "展示字数和预计阅读时间",
            scope: ["前端计算阅读信息"],
            acceptance_criteria: ["有正文时展示字数和分钟数"],
            unknowns: ["阅读速度默认值"]
          },
          risk_boundary: {
            ready_for_agent: false,
            can_handoff_to_agent: false,
            handoff_decision: "clarify_first",
            reasons: ["需要 PM 确认"]
          },
          source: { mode: "model_generated_real", provider: "doubao_ark", client: "doubao_ark", model: "ep-test" }
        });
      }
    });

    expect(result.ok).toBe(true);
    expect(captured.input.pmMessages).toHaveLength(6);
    expect(captured.input.pmMessages[0].content).toContain("message-5");
    expect(captured.prompt.length).toBeLessThanOrEqual(6000);
    expect(captured.prompt).toContain("Return exactly this lightweight JSON shape");
    expect(captured.prompt).not.toMatch(/references[\\/]/i);
    expect(result.data.current_dsl_summary.title).toBe("阅读信息提示");
    expect(result.data.current_dsl_summary.scope).toEqual(["前端计算阅读信息"]);
    expect(result.data.human_report_patch.summary).toContain("阅读信息提示");

    const diagnostics = JSON.parse(await fs.readFile(
      path.join(testRunsRoot, result.data.runId, "skill_turn_diagnostics.json"),
      "utf8"
    ));
    expect(diagnostics.promptChars).toBeGreaterThan(0);
    expect(diagnostics.promptChars).toBeLessThanOrEqual(6000);
    expect(diagnostics.messageCount).toBe(2);
    expect(diagnostics.contextMessageCount).toBe(6);
    expect(diagnostics.status).toBe("passed");
    expect(diagnostics.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(diagnostics)).not.toMatch(/api_key|Authorization|Bearer|sk-/i);
  });

  it("uses timeout_seconds from Doubao api_config and writes timeout diagnostics without mock success", async () => {
    const fakeArk = await startFakeOpenAiServer(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return { body: { choices: [{ message: { content: "{\"ok\":true}" } }] } };
    });
    const configPath = await writeSkillApiConfig("doubao-timeout-seconds-test.json", {
      provider: "doubao_ark",
      endpoint_id: "ep-doubao-timeout",
      api_key: "db-timeout-secret",
      timeout_seconds: 0.05
    });

    const result = await runSkillTurn({
      projectId: "conduit-realworld-example-app",
      pmMessages: [{ role: "pm", content: "Article detail page needs reading info." }]
    }, {
      runsRoot: testRunsRoot,
      dslRuntimeRoot: path.resolve("e2e"),
      doubaoApiConfigPath: configPath,
      doubaoBaseURL: `${fakeArk.baseUrl}/api/v3`,
      nodeEnv: "development"
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("doubao_timeout");
    expect(result.error.details.timeoutMs).toBe(50);

    const diagnostics = JSON.parse(await fs.readFile(
      path.join(testRunsRoot, result.error.details.runId, "skill_turn_diagnostics.json"),
      "utf8"
    ));
    expect(diagnostics.status).toBe("doubao_timeout");
    expect(diagnostics.timeoutMs).toBe(50);
    expect(diagnostics.provider).toBe("doubao_ark");
    expect(diagnostics.model).toBe("ep-doubao-timeout");
    expect(JSON.stringify(diagnostics)).not.toMatch(/db-timeout-secret|api_key|Authorization|Bearer/i);
  });

  it("returns structured slow-response fallback when fast skill turn exceeds maxLatencyMs", async () => {
    const result = await Promise.race([
      runSkillTurn({
        mode: "fast",
        maxLatencyMs: 10,
        projectId: "conduit-realworld-example-app",
        pmMessages: [{ role: "pm", content: "给文章加一个推荐模块。" }]
      }, {
        runsRoot: testRunsRoot,
        dslRuntimeRoot: path.resolve("e2e"),
        modelClient: async () => new Promise(() => {})
      }),
      new Promise((resolve) => setTimeout(() => resolve({ timedOutWaitingForSkillTurn: true }), 200))
    ]);

    expect(result.timedOutWaitingForSkillTurn).not.toBe(true);
    expect(result.ok).toBe(true);
    expect(result.data.source.mode).toBe("slow_response");
    expect(result.data.source.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.data.risk_boundary.ready_for_agent).toBe(false);
    expect(result.data.clarification.should_ask).toBe(true);
  });

  it("serves skill PM turn API without leaking secrets or exposing raw EVPI text", async () => {
    const baseUrl = await startTestServer({
      runnerMode: "mock",
      skillModelMode: "mock"
    });

    const response = await fetch(`${baseUrl}/api/skill/pm-dsl-turn`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer hidden-token" },
      body: JSON.stringify({
        projectId: "conduit-realworld-example-app",
        pmMessages: [
          {
            role: "pm",
            content: "文章详情页需要阅读信息提示；api_key=sk-real-secret-value；空正文不要报错。"
          }
        ],
        evpiSignals: {
          ranked_questions: [
            { question: "你希望用什么用户可见现象或测试结果判断这个需求已经完成？" }
          ]
        }
      })
    });
    const text = await response.text();
    const payload = JSON.parse(text);

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.assistant_message).toContain("候选验收");
    expect(payload.data.assistant_message).not.toContain("sk-real-secret-value");
    expect(payload.data.assistant_message).not.toBe("你希望用什么用户可见现象或测试结果判断这个需求已经完成？");
    expect(payload.data.risk_boundary.ready_for_agent).toBe(false);
    expect(text).not.toMatch(/sk-real-secret-value|Bearer hidden-token/i);
  });

  it("routes real skill PM turns to Doubao Ark instead of the default DSL API config", async () => {
    const baseUrl = await startTestServer({
      runnerMode: "mock",
      skillModelMode: "real",
      doubaoApiConfigPath: path.join(testRunsRoot, "missing-route-doubao-config.json")
    });

    const response = await fetch(`${baseUrl}/api/skill/pm-dsl-turn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "conduit-realworld-example-app",
        pmMessages: [{ role: "pm", content: "Article detail page needs reading info." }]
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("doubao_config_missing");
    expect(payload.error.details.provider).toBe("doubao_ark");
    expect(payload.error.details.client).toBe("doubao_ark");
  });

  it("routes full DSL artifacts through standalone runner without legacy runtime dependency", async () => {
    const baseUrl = await startTestServer({
      runnerMode: "real",
      artifactModelClient: fakeStandaloneArtifactModel
    });

    const startResponse = await fetch(`${baseUrl}/api/dsl/runs/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "conduit-realworld-example-app",
        pmMessages: [{ role: "pm", content: "Login failure copy needs clearer next actions." }]
      })
    });
    const started = await startResponse.json();
    expect(startResponse.status).toBe(202);
    expect(started.ok).toBe(true);

    const finished = await waitForJob(baseUrl, started.data.runId);

    expect(finished.status).toBe("passed");
    expect(finished.artifactStatus).toBe("done");
    expect(finished.runner.adapter).toBe("standalone_artifact_runner");
    expect(finished.realLlmCalls).toBe(2);
    expect(finished.mockLlmUsed).toBe(false);
    expect(finished.realWritePerformed).toBe(false);
    expect(finished.fullArtifacts["12_final_dsl.json"].exists).toBe(true);
    expect(finished.fullArtifacts["13_case_summary.md"].exists).toBe(true);
    expect(JSON.stringify(finished)).not.toMatch(/pm_dsl_runner|runner_missing|F:\\dsl-v2|api_key|Authorization|Bearer|sk-/i);
  });

  it("returns standalone_artifact_failed details instead of legacy runner_missing when standalone generation fails", async () => {
    const failingModel = async () => {
      throw new Error("standalone test failure");
    };
    const baseUrl = await startTestServer({
      runnerMode: "real",
      artifactModelClient: failingModel
    });

    const startResponse = await fetch(`${baseUrl}/api/dsl/runs/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "conduit-realworld-example-app",
        pmMessages: [{ role: "pm", content: "Force standalone artifact failure." }]
      })
    });
    const started = await startResponse.json();
    const failed = await waitForJob(baseUrl, started.data.runId, ["failed"]);

    expect(failed.status).toBe("failed");
    expect(failed.error.code).toBe("standalone_artifact_failed");
    expect(failed.error.message).toContain("standalone test failure");
    expect(JSON.stringify(failed)).not.toMatch(/pm_dsl_runner|runner_missing|F:\\dsl-v2|api_key|Authorization|Bearer|sk-/i);

    const artifactsResponse = await fetch(`${baseUrl}/api/dsl/runs/${started.data.runId}/artifacts`);
    const artifactsPayload = await artifactsResponse.json();
    expect(artifactsResponse.status).toBe(200);
    expect(artifactsPayload.data.artifacts["error.json"].json.error.code).toBe("standalone_artifact_failed");
  });

  it("serves agent readiness from agent(1) inventory without enabling real writes", async () => {
    const baseUrl = await startTestServer({ runnerMode: "mock" });

    const response = await fetch(`${baseUrl}/api/agent/readiness`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "conduit-realworld-example-app",
        targetRepoPath: "F:\\safe-preview-target"
      })
    });
    const payload = await response.json();
    const text = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.status).toBe("ready");
    expect(payload.data.canRunDryRun).toBe(true);
    expect(payload.data.canRealWrite).toBe(false);
    expect(payload.data.boundaries).toContain("default dry-run only");
    expect(payload.data.entrypoints).toEqual(expect.arrayContaining(["agent/agent_core/main.py"]));
    expect(text).not.toMatch(/api_key|Authorization|Bearer|sk-/i);
  });

  it("creates agent dry-run artifacts and keeps realWritePerformed false", async () => {
    const baseUrl = await startTestServer({ runnerMode: "mock" });

    const response = await fetch(`${baseUrl}/api/agent/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "conduit-realworld-example-app",
        taskTitle: "Agent integration test",
        dryRun: true
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.runId).toMatch(/^RUN-/);
    expect(payload.data.dryRun).toBe(true);
    expect(payload.data.realWritePerformed).toBe(false);
    expect(payload.data.plan.mode).toBe("agent1_preview_adapter");
    expect(payload.data.review.status).toBe("needs_review");
    expect(payload.data.prDraft.title).toBeTruthy();
    expect(payload.data.artifacts["agent_context.json"].exists).toBe(true);

    const artifactsResponse = await fetch(`${baseUrl}/api/agent/runs/${payload.data.runId}/artifacts`);
    const artifactsPayload = await artifactsResponse.json();
    expect(artifactsResponse.status).toBe(200);
    expect(artifactsPayload.data.review.changedFiles.length).toBeGreaterThan(0);
    expect(artifactsPayload.data.prDraft.checklist).toContain("No API keys or local configs committed");
  });

  it("blocks requested agent real writes instead of calling the external writer", async () => {
    const baseUrl = await startTestServer({ runnerMode: "mock" });

    const response = await fetch(`${baseUrl}/api/agent/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "conduit-realworld-example-app",
        dryRun: false
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("agent_real_write_blocked");
    expect(JSON.stringify(payload)).not.toMatch(/AGENT_REPO_CONFIRM=YES|api_key|Authorization|Bearer|sk-/i);
  });

  it("returns health without leaking API config secrets", async () => {
    const baseUrl = await startTestServer({ runnerMode: "mock" });

    const response = await fetch(`${baseUrl}/api/health`);
    const payload = await response.json();
    const text = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.runnerAvailable).toBe(true);
    expect(payload.data.apiConfigExists).toBe(true);
    expect(text).not.toMatch(/api_key|authorization|Bearer|sk-/i);
  });

  it("routes preview status requests through the backend JSON envelope", async () => {
    const baseUrl = await startTestServer({ runnerMode: "mock" });

    const response = await fetch(`${baseUrl}/api/preview/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "preview-route-test",
        localPath: path.join(testRunsRoot, "missing-preview-project")
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.status).toBe("project_path_missing");
    expect(payload.data.available).toBe(false);
  });

  it("creates a successful DSL run with the mock runner", async () => {
    const baseUrl = await startTestServer({ runnerMode: "mock" });

    const response = await fetch(`${baseUrl}/api/dsl/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "conduit-realworld-example-app",
        pmMessages: [{ role: "pm", content: "登录失败提示太模糊，希望用户知道下一步怎么做。" }],
        maxRounds: 3
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.status).toBe("passed");
    expect(payload.data.runId).toMatch(/^RUN-/);
    expect(payload.data.uiState.readiness.ready_for_agent).toBe(false);
    expect(payload.data.uiState.recommendedQuestion.source).toBe("EVPI-lite");
    expect(payload.data.artifacts["12_final_dsl.json"].exists).toBe(true);
  });

  it("returns structured runner errors", async () => {
    const baseUrl = await startTestServer({ runnerMode: "mock-fail" });

    const response = await fetch(`${baseUrl}/api/dsl/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "conduit-realworld-example-app",
        pmMessages: [{ role: "pm", content: "fail this run" }]
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("runner_failed");
    expect(payload.error.message).toBeTruthy();
    expect(JSON.stringify(payload)).not.toMatch(/sk-|Bearer|api_key/i);
  });

  it("returns JSON for OPTIONS requests instead of an empty response", async () => {
    const baseUrl = await startTestServer({ runnerMode: "mock" });

    const response = await fetch(`${baseUrl}/api/dsl/runs`, { method: "OPTIONS" });
    const text = await response.text();
    const payload = JSON.parse(text);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    expect(payload).toEqual({ ok: true, data: { method: "OPTIONS" }, error: null });
  });

  it("returns structured JSON when request JSON is invalid", async () => {
    const baseUrl = await startTestServer({ runnerMode: "mock" });

    const response = await fetch(`${baseUrl}/api/dsl/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json"
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("bad_request");
    expect(JSON.stringify(payload)).not.toMatch(/<html|sk-|Bearer|api_key/i);
  });

  it("returns backend_exception JSON and writes server_error.json when the DSL route throws", async () => {
    const baseUrl = await startTestServer({
      runnerMode: "mock",
      forceDslRouteException: true
    });

    const response = await fetch(`${baseUrl}/api/dsl/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "conduit-realworld-example-app",
        pmMessages: [{ role: "pm", content: "trigger backend exception" }]
      })
    });
    const text = await response.text();
    const payload = JSON.parse(text);

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    expect(text).not.toBe("");
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("backend_exception");
    expect(payload.error.details.runId).toMatch(/^RUN-/);
    expect(text).not.toMatch(/sk-|Bearer|api_key|hidden-token/i);

    const serverErrorPath = path.join(testRunsRoot, payload.error.details.runId, "server_error.json");
    const serverError = JSON.parse(await fs.readFile(serverErrorPath, "utf8"));
    expect(serverError.error.code).toBe("backend_exception");
    expect(JSON.stringify(serverError)).not.toMatch(/sk-|Bearer|api_key|hidden-token/i);
  });

  it("returns backend_exception JSON when async DSL start throws", async () => {
    const baseUrl = await startTestServer({
      runnerMode: "mock",
      forceDslRouteException: true
    });

    const response = await fetch(`${baseUrl}/api/dsl/runs/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "conduit-realworld-example-app",
        pmMessages: [{ role: "pm", content: "trigger async backend exception" }]
      })
    });
    const text = await response.text();
    const payload = JSON.parse(text);

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    expect(text).not.toBe("");
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("backend_exception");
    expect(payload.error.details.runId).toMatch(/^RUN-/);

    const serverErrorPath = path.join(testRunsRoot, payload.error.details.runId, "server_error.json");
    const serverError = JSON.parse(await fs.readFile(serverErrorPath, "utf8"));
    expect(serverError.error.code).toBe("backend_exception");
    expect(JSON.stringify(serverError)).not.toMatch(/sk-|Bearer|api_key|hidden-token/i);
  });

  it("returns bad_request JSON for oversized request bodies instead of closing with an empty response", async () => {
    const baseUrl = await startTestServer({ runnerMode: "mock" });

    const response = await fetch(`${baseUrl}/api/dsl/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pmMessages: [{ role: "pm", content: "x".repeat(2_100_000) }]
      })
    });
    const text = await response.text();
    const payload = JSON.parse(text);

    expect(response.status).toBe(400);
    expect(text).not.toBe("");
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("bad_request");
    expect(payload.error.message).toBe("Invalid JSON body");
  });

  it("preserves system clarification context when merging PM messages for the runner", async () => {
    const baseUrl = await startTestServer({ runnerMode: "mock" });
    const question = "你希望用什么用户可见现象或测试结果判断这个需求已经完成？";
    const answer = "用户可见现象：进入文章详情页后能看到阅读信息，正文为空不展示，页面不报错。";

    const response = await fetch(`${baseUrl}/api/dsl/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "conduit-realworld-example-app",
        pmMessages: [
          { role: "pm", content: "文章详情页需要阅读信息提示。" },
          { role: "system_clarification", content: question, questionKey: "acceptance_visible_result" },
          { role: "pm", content: answer }
        ]
      })
    });
    const payload = await response.json();
    const pmText = payload.data.artifacts["00_input.json"].json.case.pm_text;

    expect(response.status).toBe(200);
    expect(pmText).toContain("[System clarification asked]");
    expect(pmText).toContain(question);
    expect(pmText).toContain("[PM answer]");
    expect(pmText).toContain(answer);
  });

  it("starts an async DSL run and immediately exposes a running job", async () => {
    const baseUrl = await startTestServer({ runnerMode: "mock", mockDelayMs: 500 });

    const response = await fetch(`${baseUrl}/api/dsl/runs/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "conduit-realworld-example-app",
        pmMessages: [{ role: "pm", content: "async run" }]
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(payload.ok).toBe(true);
    expect(payload.data.runId).toMatch(/^RUN-/);
    expect(payload.data.status).toBe("running");
    expect(payload.data.elapsedMs).toBeGreaterThanOrEqual(0);

    const statusResponse = await fetch(`${baseUrl}/api/dsl/runs/${payload.data.runId}`);
    const statusPayload = await statusResponse.json();
    expect(statusResponse.status).toBe(200);
    expect(statusPayload.data.status).toBe("running");

    const finished = await waitForJob(baseUrl, payload.data.runId);
    expect(finished.status).toBe("passed");
  });

  it("cancels a running async DSL run and writes cancelled.json", async () => {
    const baseUrl = await startTestServer({ runnerMode: "mock", mockDelayMs: 5000 });

    const startResponse = await fetch(`${baseUrl}/api/dsl/runs/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pmMessages: [{ role: "pm", content: "cancel this run" }],
        timeoutMs: 10000
      })
    });
    const started = (await startResponse.json()).data;

    const cancelResponse = await fetch(`${baseUrl}/api/dsl/runs/${started.runId}/cancel`, { method: "POST" });
    const cancelPayload = await cancelResponse.json();

    expect(cancelResponse.status).toBe(200);
    expect(cancelPayload.data.status).toBe("cancelled");
    expect(cancelPayload.data.pid).toBeNull();
    const cancelledPath = path.join(testRunsRoot, started.runId, "cancelled.json");
    const cancelled = JSON.parse(await fs.readFile(cancelledPath, "utf8"));
    expect(cancelled.status).toBe("cancelled");
  });

  it("marks async runs as timeout with structured runner_timeout errors", async () => {
    const baseUrl = await startTestServer({ runnerMode: "mock", mockDelayMs: 200 });

    const response = await fetch(`${baseUrl}/api/dsl/runs/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pmMessages: [{ role: "pm", content: "timeout this run" }],
        timeoutMs: 20
      })
    });
    const started = (await response.json()).data;
    const timedOut = await waitForJob(baseUrl, started.runId, ["timeout"]);

    expect(timedOut.status).toBe("timeout");
    expect(timedOut.error.code).toBe("runner_timeout");
    const errorPath = path.join(testRunsRoot, started.runId, "error.json");
    const errorJson = JSON.parse(await fs.readFile(errorPath, "utf8"));
    expect(errorJson.error.code).toBe("runner_timeout");
    expect(JSON.stringify(errorJson)).not.toMatch(/sk-|Bearer|api_key|hidden-token/i);
  });

  it("retries a failed async run with a new runId and preserves partial artifacts", async () => {
    const baseUrl = await startTestServer({ runnerMode: "mock-fail" });

    const response = await fetch(`${baseUrl}/api/dsl/runs/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pmMessages: [{ role: "pm", content: "fail then retry" }]
      })
    });
    const started = (await response.json()).data;
    const failed = await waitForJob(baseUrl, started.runId, ["failed"]);
    expect(failed.status).toBe("failed");

    const artifactsResponse = await fetch(`${baseUrl}/api/dsl/runs/${started.runId}/artifacts`);
    const artifactsPayload = await artifactsResponse.json();
    expect(artifactsResponse.status).toBe(200);
    expect(artifactsPayload.data.runId).toBe(started.runId);
    expect(artifactsPayload.data.artifacts["error.json"].exists).toBe(true);
    expect(artifactsPayload.data.partial).toBe(true);

    const retryResponse = await fetch(`${baseUrl}/api/dsl/runs/${started.runId}/retry`, { method: "POST" });
    const retryPayload = await retryResponse.json();
    expect(retryResponse.status).toBe(202);
    expect(retryPayload.data.originalRunId).toBe(started.runId);
    expect(retryPayload.data.runId).toMatch(/^RUN-/);
    expect(retryPayload.data.runId).not.toBe(started.runId);
  });
});

describe("redactSecrets", () => {
  it("masks keys, bearer tokens, authorization, passwords, and sk-style secrets", () => {
    const redacted = redactSecrets({
      api_key: "sk-real-secret-value",
      nested: {
        Authorization: "Bearer hidden-token",
        password: "open sesame",
        safe: "hello"
      },
      text: "token abc secret xyz sk-12345678901234567890"
    });

    const text = JSON.stringify(redacted);
    expect(text).toContain("***REDACTED***");
    expect(text).toContain("hello");
    expect(text).not.toContain("sk-real-secret-value");
    expect(text).not.toContain("hidden-token");
    expect(text).not.toContain("open sesame");
    expect(text).not.toContain("sk-12345678901234567890");
  });
});
