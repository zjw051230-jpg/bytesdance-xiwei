import { ArrowRight, CheckCircle2, FileWarning } from "lucide-react";
import { useEffect, useState } from "react";
import { getPrDraft, listReviewItems, updateReviewItem } from "../api/persistenceClient.js";
import { fallbackAgentReview } from "../data/agentWorkflowData.js";

const humanStatusLabels = {
  pending: "待审阅",
  approved: "已通过",
  needs_change: "需修改",
  blocked: "阻塞"
};

export default function ReviewCheckWorkbench({
  activeRequirement,
  agentWorkflow = {},
  onAgentWorkflowChange,
  onOpenPr
}) {
  const [runId, setRunId] = useState(agentWorkflow.runId || "");
  const [reviewItems, setReviewItems] = useState([]);
  const [reviewError, setReviewError] = useState("");
  const [loading, setLoading] = useState(false);
  const fallbackReview = agentWorkflow.review || fallbackAgentReview;

  useEffect(() => {
    setRunId(agentWorkflow.runId || "");
  }, [agentWorkflow.runId]);

  useEffect(() => {
    let active = true;
    if (runId || !activeRequirement?.id) return () => {
      active = false;
    };
    getPrDraft(activeRequirement.id)
      .then((draft) => {
        if (!active) return;
        setRunId(draft.runId || "");
        onAgentWorkflowChange?.((current) => ({ ...current, runId: current.runId || draft.runId || "", prDraft: current.prDraft || draft }));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [activeRequirement?.id, runId, onAgentWorkflowChange]);

  useEffect(() => {
    let active = true;
    setReviewError("");
    setReviewItems([]);
    if (!runId) return () => {
      active = false;
    };
    setLoading(true);
    listReviewItems(runId)
      .then((items) => {
        if (!active) return;
        if (Array.isArray(items)) {
          setReviewItems(items);
        } else if (Array.isArray(items?.review?.changedFiles)) {
          setReviewItems(normalizeWorkflowReviewItems(items.review.changedFiles));
        } else {
          setReviewItems([]);
        }
      })
      .catch((error) => {
        if (!active) return;
        setReviewError(`审阅检查加载失败：${error.message || "Persistence API request failed"}`);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [runId]);

  const handleHumanStatusChange = async (itemId, humanStatus) => {
    setReviewItems((current) => current.map((item) => item.id === itemId ? { ...item, humanStatus } : item));
    try {
      const updated = await updateReviewItem(itemId, { humanStatus });
      setReviewItems((current) => current.map((item) => item.id === itemId ? { ...item, ...updated } : item));
    } catch (error) {
      setReviewError(`审阅状态保存失败：${error.message || "Persistence API request failed"}`);
    }
  };

  const normalizedFallbackItems = normalizeWorkflowReviewItems(fallbackReview.changedFiles || []);
  const displayItems = reviewItems.length > 0 ? reviewItems : normalizedFallbackItems;
  const status = reviewItems.length > 0
    ? summarizeHumanStatus(reviewItems)
    : fallbackReview.status;
  const summary = reviewItems.length > 0
    ? (agentWorkflow.review?.summary || `${reviewItems.length} 个 review item 来自持久化 API。`)
    : normalizedFallbackItems.length > 0
      ? fallbackReview.summary
      : loading
        ? "正在读取持久化 review items..."
        : fallbackReview.summary;

  return (
    <main className="review-check-workbench" data-testid="review-check-workbench">
      <section className="review-main">
        <header className="review-page-heading">
          <div><h1>审阅检查</h1><p>把 Agent dry-run 里该懂的地方打开给用户看。</p></div>
          <span>{status}</span>
        </header>
        {reviewError ? <p className="run-error-text" role="alert">{reviewError}</p> : null}
        <section className="review-summary-panel">
          <FileWarning size={24} />
          <div><h2>Agent 修改摘要</h2><p>{summary}</p></div>
        </section>
        <section className="review-file-list">
          {displayItems.length === 0 ? (
            <article>
              <div><strong>暂无 review items</strong><p>{runId ? "当前 run 暂无持久化审阅项。" : "请先在设计规划页生成 dry-run，或等待 PR 草稿提供 runId。"}</p></div>
            </article>
          ) : displayItems.map((file) => (
            <article key={file.id || file.filePath}>
              <div><strong>{file.filePath}</strong><p>{file.changeSummary}</p></div>
              <dl>
                <div><dt>为什么改这里</dt><dd>{file.reason}</dd></div>
                <div><dt>对应需求点</dt><dd>{file.requirementMapping}</dd></div>
                <div><dt>风险说明</dt><dd>{file.riskLevel}</dd></div>
              </dl>
              {file.id ? (
                <label>
                  <span>人工状态</span>
                  <select
                    aria-label={`人工审阅状态 ${file.filePath}`}
                    value={file.humanStatus || "pending"}
                    onChange={(event) => handleHumanStatusChange(file.id, event.target.value)}
                  >
                    {Object.entries(humanStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select>
                </label>
              ) : null}
            </article>
          ))}
        </section>
      </section>
      <aside className="review-side">
        <section><h2>测试结果</h2>{buildTests(reviewItems, fallbackReview).map((test) => <p key={test.command}><CheckCircle2 size={15} />{test.command}: {test.status}</p>)}</section>
        <section><h2>需要人工确认</h2><ul>{buildConfirmations(reviewItems, fallbackReview).map((item) => <li key={item}>{item}</li>)}</ul></section>
        <button type="button" onClick={onOpenPr}>进入 PR 页面 <ArrowRight size={15} /></button>
      </aside>
    </main>
  );
}

function normalizeWorkflowReviewItems(items) {
  return items.map((file, index) => ({
    id: "",
    filePath: file.file || file.filePath || `review-${index + 1}`,
    changeSummary: file.changeSummary || "",
    reason: file.why || file.reason || "",
    requirementMapping: file.requirementPoint || file.requirementMapping || "",
    riskLevel: file.risk || file.riskLevel || "",
    humanStatus: file.humanStatus || "pending",
    testStatus: file.testStatus || "pending"
  }));
}

function summarizeHumanStatus(items) {
  if (items.every((item) => item.humanStatus === "approved")) return "approved";
  if (items.some((item) => item.humanStatus === "needs_change")) return "needs_change";
  if (items.some((item) => item.humanStatus === "blocked")) return "blocked";
  return "needs_review";
}

function buildTests(items, fallbackReview) {
  if (items.length === 0) return fallbackReview.tests || [];
  return items.map((item) => ({ command: item.filePath, status: item.testStatus || "pending" }));
}

function buildConfirmations(items, fallbackReview) {
  if (items.length === 0) return fallbackReview.manualConfirmations || [];
  return items.map((item) => `${item.filePath}: ${humanStatusLabels[item.humanStatus || "pending"]}`);
}
