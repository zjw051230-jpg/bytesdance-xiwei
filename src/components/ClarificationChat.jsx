import { Send } from "lucide-react";
import { useEffect, useState } from "react";
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

  const sendAnswer = () => {
    const text = draft.trim();
    setMessageCount((current) => current + 1);
    setDraft("");
    onSendAnswer(text);
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
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="请输入你的补充回答，系统会继续更新 DSL..."
          aria-label="请输入你的补充回答，系统会继续更新 DSL"
        />
        <button type="button" onClick={sendAnswer}><Send size={16} />发送回答</button>
      </div>
    </section>
  );
}
