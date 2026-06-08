const acceptanceKey = "acceptance_visible_result";
const noNewQuestionText = "当前没有新的高优先级澄清问题，可以继续补充细节或打开需求报告审阅。";

export function normalizeQuestionKey(questionText) {
  const text = normalizeText(questionText);
  if (!text) return "";
  if (
    text.includes("用户可见现象") ||
    text.includes("测试结果") ||
    text.includes("验收标准") ||
    text.includes("判断这个需求已经完成") ||
    text.includes("完成后用户能看到") ||
    text.includes("需求完成后用户能看到") ||
    text.includes("证明需求完成")
  ) {
    return acceptanceKey;
  }
  return `question:${text.slice(0, 80)}`;
}

export function isQuestionAnswered(questionKey, pmAnswerText) {
  const text = normalizeText(pmAnswerText);
  if (!questionKey || !text) return false;
  if (questionKey === acceptanceKey) {
    return [
      "看到",
      "显示",
      "展示",
      "不展示",
      "页面不报错",
      "不出现nan",
      "预计阅读",
      "本文共",
      "测试",
      "打开文章详情页",
      "进入文章详情页",
      "正文为空"
    ].some((keyword) => text.includes(normalizeText(keyword)));
  }
  return false;
}

export function buildAnsweredQuestionKeys(messages) {
  const answeredKeys = new Set();
  const pendingQuestions = [];

  for (const message of messages || []) {
    const role = normalizedRole(message);
    const text = messageText(message);
    if (role === "system" || role === "system_clarification") {
      const key = message.questionKey || normalizeQuestionKey(message.questionText || text);
      if (key) {
        pendingQuestions.push({ key, text });
        if (pendingQuestions.length > 8) pendingQuestions.shift();
      }
      continue;
    }

    if (role === "pm") {
      for (const question of pendingQuestions) {
        if (isQuestionAnswered(question.key, text)) {
          answeredKeys.add(question.key);
        }
      }
    }
  }

  return answeredKeys;
}

export function recentSystemQuestionKeys(messages, limit = 3) {
  return (messages || [])
    .filter((message) => ["system", "system_clarification"].includes(normalizedRole(message)))
    .slice(-limit)
    .map((message) => message.questionKey || normalizeQuestionKey(message.questionText || messageText(message)))
    .filter(Boolean);
}

export function filterAnsweredRecommendation(recommendation, answeredKeys, recentQuestionKeys = []) {
  if (!recommendation?.text) return null;
  const key = recommendation.questionKey || normalizeQuestionKey(recommendation.text);
  if (!key) return recommendation;
  if (answeredKeys?.has?.(key)) return null;
  if (recentQuestionKeys.includes(key)) return null;
  return { ...recommendation, questionKey: key };
}

export function applyClarificationDedupToUiState(uiState, messages) {
  const answeredKeys = buildAnsweredQuestionKeys(messages);
  const recentKeys = recentSystemQuestionKeys(messages);
  const recommendedQuestion = filterAnsweredRecommendation(uiState?.recommendedQuestion, answeredKeys, recentKeys);
  const acknowledgedAcceptance = answeredKeys.has(acceptanceKey);

  return {
    ...uiState,
    recommendedQuestion,
    humanReport: acknowledgedAcceptance && !recommendedQuestion
      ? withNoNewQuestionReport(uiState?.humanReport)
      : uiState?.humanReport
  };
}

export function answeredKeyDiff(previousMessages, nextMessages) {
  const previous = buildAnsweredQuestionKeys(previousMessages);
  const next = buildAnsweredQuestionKeys(nextMessages);
  return [...next].filter((key) => !previous.has(key));
}

export function acknowledgementForKeys(answeredKeys) {
  if (answeredKeys.includes(acceptanceKey)) {
    return "已记录你的验收标准：文章详情页正文下方展示“本文共 XXX 字，预计阅读 X 分钟”；空正文时不展示，且不出现 NaN 或异常内容。当前不再重复询问验收标准。";
  }
  return "";
}

export function noNewQuestionMessage() {
  return noNewQuestionText;
}

function withNoNewQuestionReport(humanReport) {
  if (!humanReport?.riskCards) return humanReport;
  return {
    ...humanReport,
    riskCards: humanReport.riskCards.map((card) => {
      if (card.title !== "下一步建议动作") return card;
      return {
        ...card,
        points: [noNewQuestionText, ...(card.points || []).slice(1)]
      };
    })
  };
}

function messageText(message) {
  return String(message?.text ?? message?.content ?? "");
}

function normalizedRole(message) {
  const role = String(message?.role || "");
  if (role === "system_clarification") return role;
  if (role === "system") return "system";
  return "pm";
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。！？?；;：“”"'.、（）()]/g, "");
}
