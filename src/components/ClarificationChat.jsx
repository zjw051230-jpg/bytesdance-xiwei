import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { recommendedQuestions } from "../data/dslWorkbenchData.js";

const suggestionIntervals = [6, 8, 10, 7];

export default function ClarificationChat({
  messages,
  onSendAnswer,
  onAdoptSuggestion,
  onToast,
  realSuggestion,
  runId,
  onContinueRefine,
  onStartConstruction
}) {
  const [draft, setDraft] = useState("");
  const enterSubmitRef = useRef(false);
  const composingRef = useRef(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [messageCount, setMessageCount] = useState(0);
  const [nextSuggestionAt, setNextSuggestionAt] = useState(suggestionIntervals[0]);
  const [intervalIndex, setIntervalIndex] = useState(0);
  const [dismissedRealRunId, setDismissedRealRunId] = useState("");
  const fallbackQuestion = {
    ...recommendedQuestions[questionIndex % recommendedQuestions.length],
    source: "本地 fallback"
  };
  const hasRealSuggestion = realSuggestion?.source === "EVPI-lite" && runId && dismissedRealRunId !== runId;
  const question = hasRealSuggestion ? realSuggestion : fallbackQuestion;
  const shouldShowSuggestion = hasRealSuggestion || messageCount >= nextSuggestionAt;

  useEffect(() => {
    if (runId && dismissedRealRunId && runId !== dismissedRealRunId) {
      setDismissedRealRunId("");
    }
  }, [dismissedRealRunId, runId]);

  const scheduleNextSuggestion = (baseCount) => {
    const nextIntervalIndex = intervalIndex + 1;
    const nextInterval = suggestionIntervals[nextIntervalIndex % suggestionIntervals.length];
    setIntervalIndex(nextIntervalIndex);
    setNextSuggestionAt(baseCount + nextInterval);
  };

  const sendAnswer = async () => {
    const text = draft.trim();
    if (!text) return;
    setMessageCount((current) => current + 1);
    setDraft("");
    await Promise.resolve(onSendAnswer(text));
  };

  const handleInputKeyDown = async (event) => {
    if (event.key !== "Enter" || event.shiftKey || composingRef.current || event.nativeEvent?.isComposing) return;
    event.preventDefault();
    if (enterSubmitRef.current) return;
    enterSubmitRef.current = true;
    try {
      await sendAnswer();
    } finally {
      enterSubmitRef.current = false;
    }
  };

  const rotateQuestion = () => {
    setQuestionIndex((current) => current + 1);
    onToast("已切换推荐问题");
  };

  const adoptQuestion = () => {
    onAdoptSuggestion(question);
    if (hasRealSuggestion) setDismissedRealRunId(runId);
    scheduleNextSuggestion(messageCount);
    onToast("已采用推荐问题");
  };

  const skipQuestion = () => {
    if (hasRealSuggestion) setDismissedRealRunId(runId);
    scheduleNextSuggestion(messageCount);
    onToast("已暂时跳过");
  };

  const renderCompletionActions = () => (
    <div className="clarification-complete-actions">
      <button type="button" onClick={() => onContinueRefine?.()}>继续完善需求</button>
      <button type="button" onClick={() => onStartConstruction?.()}>开始施工</button>
    </div>
  );

  return (
    <section className={`clarification-chat ${shouldShowSuggestion ? "has-suggestion" : ""}`} aria-label="需求澄清对话区">
      <div className="chat-stream">
        {messages.length === 0 ? (
          <article className="chat-message system">
            <div className="chat-avatar" aria-hidden="true">✦</div>
            <div className="chat-copy">
              <div className="chat-meta">
                <strong>系统澄清</strong>
                <time>空状态</time>
              </div>
              <p>暂无澄清历史。输入 PM 需求后会保存到后端数据库。</p>
            </div>
          </article>
        ) : null}
        {messages.map((message) => (
          <article className={`chat-message ${message.role}`} key={message.id}>
            <div className="chat-avatar" aria-hidden="true">{message.role === "pm" ? "PM" : "✦"}</div>
            <div className="chat-copy">
              <div className="chat-meta">
                <strong>{message.author}</strong>
                <time>{message.time}</time>
              </div>
              <p>{message.text}</p>
              {message.kind === "clarification_complete" ? renderCompletionActions() : null}
            </div>
          </article>
        ))}
      </div>

      {shouldShowSuggestion ? (
        <div className="suggested-question" data-testid="suggested-question">
          <div className="suggested-icon" aria-hidden="true">?</div>
          <div className="suggested-copy">
            <strong>{question.title}</strong>
            <p>{question.text}</p>
            <span>原因：{question.reason}</span>
            <span>来源：{question.source}</span>
          </div>
          <div className="suggested-actions">
            <button type="button" onClick={adoptQuestion}>采用这个问题</button>
            <button type="button" onClick={rotateQuestion}>换一个</button>
            <button type="button" onClick={skipQuestion}>暂时跳过</button>
          </div>
        </div>
      ) : null}

      <div className="chat-input-row">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleInputKeyDown}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          rows={1}
          style={{
            minWidth: 0,
            minHeight: 38,
            maxHeight: 76,
            border: 0,
            borderRadius: 10,
            padding: "9px 12px",
            color: "#f7fbff",
            background: "rgba(255, 255, 255, 0.04)",
            outline: "none",
            resize: "none",
            font: "inherit",
            lineHeight: "20px"
          }}
          placeholder="请输入你的补充回答，系统会继续更新 DSL..."
          aria-label="请输入你的补充回答，系统会继续更新 DSL"
        />
        <button type="button" onClick={sendAnswer} disabled={!draft.trim()}><Send size={16} />发送回答</button>
      </div>
    </section>
  );
}
