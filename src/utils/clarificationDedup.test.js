import { describe, expect, it } from "vitest";
import {
  buildAnsweredQuestionKeys,
  filterAnsweredRecommendation,
  isQuestionAnswered,
  normalizeQuestionKey
} from "./clarificationDedup.js";

const acceptanceQuestion = "你希望用什么用户可见现象或测试结果判断这个需求已经完成？";
const acceptanceAnswer = "用户可见现象：进入文章详情页后，在正文下方能看到一行阅读信息，格式类似“本文共 XXX 字，预计阅读 X 分钟”。如果正文为空，就不展示这行信息，页面不报错、不出现 NaN 或 0 分钟这类异常内容。";

describe("clarification dedup helpers", () => {
  it("normalizes acceptance-style questions into one key", () => {
    expect(normalizeQuestionKey(acceptanceQuestion)).toBe("acceptance_visible_result");
    expect(normalizeQuestionKey("请补充验收标准。")).toBe("acceptance_visible_result");
    expect(normalizeQuestionKey("这个需求完成后用户能看到什么？")).toBe("acceptance_visible_result");
    expect(normalizeQuestionKey("用什么测试结果证明需求完成？")).toBe("acceptance_visible_result");
  });

  it("detects the L1 acceptance answer as resolved", () => {
    expect(isQuestionAnswered("acceptance_visible_result", acceptanceAnswer)).toBe(true);
  });

  it("builds answered keys from system clarification followed by PM answer", () => {
    const answeredKeys = buildAnsweredQuestionKeys([
      {
        role: "system",
        text: `系统澄清：建议继续确认：${acceptanceQuestion}`,
        questionKey: "acceptance_visible_result"
      },
      {
        role: "pm",
        text: acceptanceAnswer
      }
    ]);

    expect(answeredKeys.has("acceptance_visible_result")).toBe(true);
  });

  it("filters repeated EVPI questions after the answer is resolved", () => {
    const result = filterAnsweredRecommendation(
      {
        title: "推荐澄清问题",
        text: acceptanceQuestion,
        reason: "验收标准仍不明确",
        source: "EVPI-lite"
      },
      new Set(["acceptance_visible_result"]),
      []
    );

    expect(result).toBeNull();
  });
});
