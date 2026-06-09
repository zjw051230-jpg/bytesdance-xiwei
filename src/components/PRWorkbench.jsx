import { Copy, GitPullRequest, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getPrDraft, upsertPrDraft } from "../api/persistenceClient.js";
import { fallbackPrDraft } from "../data/agentWorkflowData.js";

export default function PRWorkbench({ activeRequirement, agentWorkflow = {}, onAgentWorkflowChange }) {
  const [draft, setDraft] = useState(() => normalizePrDraft(agentWorkflow.prDraft || fallbackPrDraft, agentWorkflow.runId));
  const [prError, setPrError] = useState("");
  const [saveState, setSaveState] = useState("");
  const titleInputRef = useRef(null);
  const summaryInputRef = useRef(null);
  const bodyInputRef = useRef(null);
  const checklistRefs = useRef([]);

  useEffect(() => {
    let active = true;
    setPrError("");
    if (!activeRequirement?.id) {
      setDraft(normalizePrDraft(agentWorkflow.prDraft || fallbackPrDraft, agentWorkflow.runId));
      return () => {
        active = false;
      };
    }

    getPrDraft(activeRequirement.id)
      .then((persistedDraft) => {
        if (!active) return;
        const normalized = normalizePrDraft(persistedDraft, persistedDraft.runId || agentWorkflow.runId);
        setDraft(normalized);
        onAgentWorkflowChange?.((current) => ({ ...current, runId: current.runId || normalized.runId || "", prDraft: normalized }));
      })
      .catch((error) => {
        if (!active) return;
        if (error.payload?.error?.code === "pr_draft_not_found") {
          setDraft(normalizePrDraft(agentWorkflow.prDraft || fallbackPrDraft, agentWorkflow.runId));
        } else {
          setPrError(`PR 草稿加载失败：${error.message || "Persistence API request failed"}`);
        }
      });
    return () => {
      active = false;
    };
  }, [activeRequirement?.id, agentWorkflow.runId, onAgentWorkflowChange]);

  const updateField = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setSaveState("");
  };

  const toggleChecklist = (index) => {
    setDraft((current) => ({
      ...current,
      checklistJson: current.checklistJson.map((item, itemIndex) =>
        itemIndex === index ? { ...item, checked: !item.checked } : item
      )
    }));
    setSaveState("");
  };

  const saveDraft = async () => {
    if (!activeRequirement?.id) {
      setPrError("PR 草稿保存失败：当前没有 requirementId");
      return;
    }
    const visibleSummary = summaryInputRef.current?.value ?? draft.summaryLines.join("\n");
    const visibleChecklist = draft.checklistJson.map((item, index) => ({
      ...item,
      checked: checklistRefs.current[index]?.checked ?? item.checked
    }));
    const payload = {
      runId: draft.runId || agentWorkflow.runId || null,
      title: titleInputRef.current?.value ?? draft.title,
      summary: visibleSummary,
      body: bodyInputRef.current?.value ?? draft.body,
      checklistJson: visibleChecklist,
      status: draft.status || "draft"
    };
    try {
      const saved = await upsertPrDraft(activeRequirement.id, payload);
      const normalized = normalizePrDraft({ ...draft, ...saved }, saved.runId || draft.runId);
      setDraft(normalized);
      onAgentWorkflowChange?.((current) => ({ ...current, runId: current.runId || normalized.runId || "", prDraft: normalized }));
      setSaveState("PR 草稿已保存");
    } catch (error) {
      setPrError(`PR 草稿保存失败：${error.message || "Persistence API request failed"}`);
    }
  };

  const copyDescription = () => {
    navigator.clipboard?.writeText?.(buildPrDescription(draft));
  };

  return (
    <main className="pr-workbench" data-testid="pr-workbench">
      <section className="pr-main">
        <header className="pr-page-heading">
          <div><h1>PR 页面</h1><p>准备 PR 描述，不自动创建远端 PR。</p></div>
          <span>{draft.runId || agentWorkflow.runId || "no run"}</span>
        </header>
        {prError ? <p className="run-error-text" role="alert">{prError}</p> : null}
        {saveState ? <p className="run-status-panel" role="status">{saveState}</p> : null}
        <section className="pr-title-card">
          <GitPullRequest size={26} />
          <label>
            <small>PR 标题</small>
            <h2>{draft.title}</h2>
            <input
              ref={titleInputRef}
              aria-label="PR 标题"
              value={draft.title}
              onChange={(event) => updateField("title", event.target.value)}
            />
          </label>
        </section>
        <section className="pr-section">
          <h2>PR 摘要</h2>
          <textarea
            ref={summaryInputRef}
            aria-label="PR 摘要"
            value={draft.summaryLines.join("\n")}
            onChange={(event) => updateField("summaryLines", event.target.value.split(/\r?\n/))}
            rows={4}
          />
        </section>
        <section className="pr-section">
          <h2>PR 正文</h2>
          <textarea
            ref={bodyInputRef}
            aria-label="PR 正文"
            value={draft.body}
            onChange={(event) => updateField("body", event.target.value)}
            rows={5}
          />
        </section>
        <section className="pr-section"><h2>变更文件</h2><ul>{draft.changedFiles.length ? draft.changedFiles.map((item, index) => <li key={`${index}-${item}`}>{item}</li>) : <li>暂无持久化变更文件列表</li>}</ul></section>
      </section>
      <aside className="pr-side">
        <section><h2>测试结果</h2>{draft.tests.length ? draft.tests.map((item) => <p key={item.command}>{item.command}: {item.status}</p>) : <p>暂无测试记录</p>}</section>
        <section><h2>风险</h2><ul>{draft.risks.length ? draft.risks.map((item, index) => <li key={`${index}-${item}`}>{item}</li>) : <li>暂无风险记录</li>}</ul></section>
        <section>
          <h2>合并前 checklist</h2>
          <ul>{draft.checklistJson.map((item, index) => (
            <li key={`${index}-${item.text}`}>
              <label>
                <input
                  ref={(element) => {
                    checklistRefs.current[index] = element;
                  }}
                  type="checkbox"
                  checked={item.checked}
                  onChange={() => toggleChecklist(index)}
                  aria-label={item.text}
                />
                {item.text}
              </label>
            </li>
          ))}</ul>
        </section>
        <button type="button" onClick={saveDraft}><Save size={15} />保存 PR 草稿</button>
        <button type="button" onClick={copyDescription}><Copy size={15} />复制 PR 描述</button>
      </aside>
    </main>
  );
}

function normalizePrDraft(input = {}, runId = "") {
  const summaryLines = Array.isArray(input.summary)
    ? input.summary
    : String(input.summary || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  const checklistJson = normalizeChecklist(input.checklistJson || input.checklist || []);
  return {
    id: input.id || "",
    requirementId: input.requirementId || "",
    runId: input.runId || input.sourceRun || runId || "",
    title: input.title || "Agent dry-run PR draft pending",
    summaryLines: summaryLines.length ? summaryLines : ["暂无持久化 PR 摘要"],
    body: input.body || "",
    changedFiles: input.changedFiles || [],
    tests: input.tests || [],
    risks: input.risks || [],
    checklistJson: checklistJson.length ? checklistJson : [{ text: "Dry-run artifacts reviewed", checked: false }],
    status: input.status || "draft"
  };
}

function normalizeChecklist(checklist) {
  return checklist.map((item) => {
    if (typeof item === "string") return { text: item, checked: false };
    return { text: item.text || item.label || "Checklist item", checked: Boolean(item.checked) };
  });
}

function buildPrDescription(prDraft) {
  return [
    `# ${prDraft.title}`,
    "",
    "## Summary",
    ...prDraft.summaryLines.map((item) => `- ${item}`),
    "",
    "## Body",
    prDraft.body || "No body yet.",
    "",
    "## Changed Files",
    ...(prDraft.changedFiles.length ? prDraft.changedFiles.map((item) => `- ${item}`) : ["- No persisted changed files"]),
    "",
    "## Tests",
    ...(prDraft.tests.length ? prDraft.tests.map((item) => `- ${item.command}: ${item.status}`) : ["- No test record"]),
    "",
    "## Risks",
    ...(prDraft.risks.length ? prDraft.risks.map((item) => `- ${item}`) : ["- No persisted risk record"]),
    "",
    "## Checklist",
    ...prDraft.checklistJson.map((item) => `- [${item.checked ? "x" : " "}] ${item.text}`)
  ].join("\n");
}
