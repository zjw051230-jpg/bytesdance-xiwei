const GREETING_SET = new Set([
  "hi",
  "hello",
  "hey",
  "\u55e8",
  "\u4f60\u597d",
  "\u60a8\u597d",
  "\u54c8\u55bd",
  "\u5728\u5417",
  "\u5728\u4e0d\u5728"
]);

const AMBIGUOUS_REQUIREMENT_PATTERNS = [
  /^(?:\u5e2e\u6211)?(?:\u52a0|\u52a0\u4e2a|\u52a0\u4e00\u4e2a|\u65b0\u589e|\u505a|\u505a\u4e2a|\u505a\u4e00\u4e2a|\u641e|\u5f04)(?:\u65b0)?(?:\u529f\u80fd|\u6a21\u5757|\u9875\u9762|\u6309\u94ae|\u5165\u53e3|\u9700\u6c42)$/,
  /^(?:\u6211\u8981|\u6211\u60f3|\u60f3\u8981|\u9700\u8981)?(?:\u4e00\u4e2a|\u4e2a)?(?:\u529f\u80fd|\u6a21\u5757|\u9875\u9762|\u6309\u94ae|\u5165\u53e3)$/,
  /^(?:\u4f18\u5316|\u6539\u4e00\u4e0b|\u8c03\u6574\u4e00\u4e0b|\u5904\u7406\u4e00\u4e0b)$/
];

export function detectInputIntent(text) {
  const normalized = normalizeIntentText(text);
  if (!normalized) return "too_short";
  if (GREETING_SET.has(normalized)) return "greeting";
  if (isTooShort(normalized)) return "too_short";
  if (AMBIGUOUS_REQUIREMENT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "ambiguous_requirement";
  }
  return "requirement_candidate";
}

export function buildInputGateReply(intent, text = "") {
  const normalized = normalizeIntentText(text);
  if (intent === "greeting") {
    if (normalized === "\u4f60\u597d" || normalized === "\u60a8\u597d") {
      return "\u4f60\u597d\uff0c\u8bf7\u63cf\u8ff0\u4f60\u8981\u505a\u7684\u4ea7\u54c1\u9700\u6c42\uff0c\u6211\u4f1a\u5e2e\u4f60\u6f84\u6e05\u5e76\u751f\u6210 DSL\u3002";
    }
    return "\u4f60\u597d\uff0c\u8bf7\u8f93\u5165\u4f60\u60f3\u6f84\u6e05\u6216\u751f\u6210 DSL \u7684\u9700\u6c42\u3002";
  }
  if (intent === "ambiguous_requirement") {
    return "\u4f60\u60f3\u52a0\u4ec0\u4e48\u529f\u80fd\uff1f\u8bf7\u8865\u5145\u76ee\u6807\u7528\u6237\u3001\u4f7f\u7528\u573a\u666f\u548c\u671f\u671b\u7ed3\u679c\u3002";
  }
  return "\u8bf7\u8865\u5145\u4f60\u60f3\u6f84\u6e05\u6216\u751f\u6210 DSL \u7684\u9700\u6c42\u3002";
}

export function shouldGateInputIntent(intent) {
  return ["greeting", "too_short", "ambiguous_requirement"].includes(intent);
}

function normalizeIntentText(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[\s,.!?;:，。！？；：、"'“”‘’（）()【】\[\]]+/g, "");
}

function isTooShort(normalized) {
  const chars = Array.from(normalized);
  if (chars.length <= 2) return true;
  if (/^[a-z0-9]+$/i.test(normalized) && chars.length <= 4) return true;
  return false;
}
