import { SendHorizontal } from "lucide-react";
import { useMemo, useState } from "react";

export default function RiskBlockerChat({ uiState, emptyState, onSubmit }) {
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const { activeQuestion, remainingCount } = useMemo(
    () => selectRiskQuestion(uiState, emptyState),
    [uiState, emptyState]
  );
  const canSend = Boolean(draft.trim()) && !submitting && activeQuestion;

  const submit = async () => {
    const answer = draft.trim();
    if (!answer || submitting || !activeQuestion) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit?.(answer, {
        source: "risk_blocker_chat",
        targetRiskId: activeQuestion.targetRiskId || "",
        targetField: activeQuestion.targetField || "",
        questionId: activeQuestion.id || activeQuestion.questionId || ""
      });
      setDraft("");
    } catch (submitError) {
      setError(submitError?.message || "回答保存失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key !== "Enter" || event.shiftKey || isComposing) return;
    event.preventDefault();
    submit();
  };

  return (
    <section className="dsl-panel risk-chat-panel" aria-label="风险澄清">
      <div className="risk-chat-header">
        <div>
          <h3>风险澄清</h3>
          <p>回答会进入当前 DSL 澄清上下文</p>
        </div>
        <span>dry-run safe</span>
      </div>

      {activeQuestion ? (
        <div className="risk-chat-body">
          <div className="risk-chat-system">
            <strong>系统</strong>
            <p>
              当前还有 {remainingCount + 1} 个关键信息需要确认，确认后会继续推进 DSL。
              {remainingCount > 0 ? ` 剩余 ${remainingCount} 个待确认。` : ""}
            </p>
          </div>
          <div className="risk-chat-question">
            <span>{activeQuestion.priority || "P1"}</span>
            <div>
              <strong>问题</strong>
              <p>{activeQuestion.text}</p>
              {activeQuestion.reason ? <small>{activeQuestion.reason}</small> : null}
            </div>
          </div>
          <label className="risk-chat-input">
            <span>回答这个问题</span>
            <textarea
              value={draft}
              rows={3}
              placeholder="输入答案，Enter 发送，Shift+Enter 换行"
              disabled={submitting}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
            />
          </label>
          {error ? <p className="risk-chat-error" role="alert">{error}</p> : null}
          <button type="button" onClick={submit} disabled={!canSend}>
            <SendHorizontal size={15} />
            {submitting ? "发送中" : "发送"}
          </button>
        </div>
      ) : (
        <div className="risk-chat-empty">
          <strong>暂无阻塞项</strong>
          <p>当前没有需要单独确认的风险问题。</p>
        </div>
      )}
    </section>
  );
}

function selectRiskQuestion(uiState = {}, emptyState = false) {
  if (emptyState) return { activeQuestion: null, remainingCount: 0 };
  const candidates = [
    normalizeQuestion(uiState.activeRiskQuestion, "active-risk", 0),
    ...normalizeList(uiState.blockerQuestions, "blocker"),
    ...normalizeList(uiState.clarificationQueue, "clarification").filter((item) => item.blocking),
    normalizeQuestion(uiState.recommendedQuestion, "recommended", 30),
    ...normalizeRiskQuestions(uiState.risks),
    ...normalizeMissingFieldQuestions(uiState.coverageItems?.pending),
    ...normalizeReadinessQuestions(uiState.readiness)
  ].filter(Boolean);
  return {
    activeQuestion: candidates[0] || null,
    remainingCount: Math.max(0, candidates.length - 1)
  };
}

function normalizeList(items, source) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => normalizeQuestion(item, `${source}-${index + 1}`, index + 10))
    .filter(Boolean);
}

function normalizeQuestion(item, fallbackId, order = 99) {
  if (!item) return null;
  const text = String(item.question || item.text || item.prompt || "").trim();
  if (!text) return null;
  return {
    id: String(item.id || item.questionId || fallbackId),
    questionId: String(item.questionId || item.id || fallbackId),
    text,
    reason: String(item.reason || item.description || item.source || "").trim(),
    priority: normalizePriority(item.priority || item.severity || item.level || "P1"),
    targetRiskId: item.targetRiskId || item.riskId || item.key || item.factor_id || "",
    targetField: item.targetField || item.field || firstItem(item.target_fields || item.factorIds) || "",
    blocking: item.blocking !== false,
    order
  };
}

function normalizeRiskQuestions(risks = []) {
  return (Array.isArray(risks) ? risks : [])
    .filter((risk) => ["P0", "P1"].includes(normalizePriority(risk.priority || risk.severity || risk.level)))
    .map((risk, index) => normalizeQuestion({
      id: risk.id || risk.key || `risk-${index + 1}`,
      question: risk.question || risk.prompt || `请确认：${risk.description || risk.reason || risk.key}`,
      reason: risk.impact || risk.category || "",
      priority: risk.priority || risk.severity || "P1",
      targetRiskId: risk.key || risk.id || risk.factor_id || "",
      targetField: risk.field || risk.category || ""
    }, `risk-${index + 1}`, index + 40));
}

function normalizeMissingFieldQuestions(fields = []) {
  return (Array.isArray(fields) ? fields : [])
    .map((field, index) => {
      const name = typeof field === "string" ? field : field?.label || field?.name || field?.field;
      if (!name) return null;
      return normalizeQuestion({
        id: `missing-${index + 1}`,
        question: `请补充「${name}」的确认信息。`,
        reason: "该字段仍在待补内容中",
        priority: "P1",
        targetField: name
      }, `missing-${index + 1}`, index + 60);
    })
    .filter(Boolean);
}

function normalizeReadinessQuestions(readiness = {}) {
  const blockers = readiness.blockers || readiness.reasons || readiness.pending_items || [];
  return (Array.isArray(blockers) ? blockers : [])
    .map((blocker, index) => normalizeQuestion({
      id: `readiness-${index + 1}`,
      question: typeof blocker === "string" ? `请确认：${blocker}` : blocker.question || blocker.reason || blocker.description,
      reason: "readiness blocker",
      priority: "P1",
      targetField: typeof blocker === "object" ? blocker.field : ""
    }, `readiness-${index + 1}`, index + 80))
    .filter(Boolean);
}

function normalizePriority(value) {
  const text = String(value || "").toUpperCase();
  if (["P0", "P1", "P2", "P3"].includes(text)) return text;
  if (text.includes("HIGH")) return "P0";
  if (text.includes("LOW")) return "P2";
  return "P1";
}

function firstItem(value) {
  return Array.isArray(value) && value.length ? value[0] : "";
}
