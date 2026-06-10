const SENSITIVE_KEYS = [
  "password",
  "passwd",
  "pwd",
  "token",
  "apikey",
  "api_key",
  "secret",
  "authorization",
  "cookie",
  "privatekey",
  "private_key",
  "clientsecret",
  "client_secret",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
];

const TEXT_PATTERNS = [
  { name: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+/g },
  { name: "openai_key", pattern: /\bsk-[A-Za-z0-9_-]{8,}\b/g },
  { name: "github_token", pattern: /\bghp_[A-Za-z0-9_]{8,}\b/g },
  { name: "private_key_block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: "database_url", pattern: /\b(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^\s"'`]+/gi },
  {
    name: "env_secret",
    pattern: /(^|\n)\s*[A-Z0-9_]*(?:PASSWORD|PASSWD|PWD|TOKEN|API_KEY|SECRET|PRIVATE_KEY|CLIENT_SECRET|ACCESS_TOKEN|REFRESH_TOKEN)[A-Z0-9_]*\s*=\s*[^\n]+/gi,
  },
];

class PrivacyFilter {
  redactSensitiveText(text, report = createPrivacyReport(), path = "$") {
    if (typeof text !== "string") return text;

    let redactedText = text;
    for (const { name, pattern } of TEXT_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(redactedText)) {
        pattern.lastIndex = 0;
        redactedText = redactedText.replace(pattern, (match, prefix) => {
          report.redacted = true;
          report.sensitive_patterns_found.push(name);
          report.redacted_field_count += 1;
          addRedactedPath(report, path);
          if (name === "env_secret" && typeof prefix === "string") return `${prefix}[REDACTED]`;
          return "[REDACTED]";
        });
      }
    }
    return redactedText;
  }

  redactSensitiveObject(obj) {
    const report = createPrivacyReport();
    const value = this.redactValue(obj, "$", report);
    report.sensitive_patterns_found = [...new Set(report.sensitive_patterns_found)];
    return { value, privacy_report: report };
  }

  detectSensitiveKeys(key) {
    const normalizedKey = String(key || "").replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
    return SENSITIVE_KEYS.some((sensitiveKey) => normalizedKey === sensitiveKey || normalizedKey.endsWith(sensitiveKey));
  }

  redactValue(value, currentPath, report) {
    if (typeof value === "string") {
      return this.redactSensitiveText(value, report, currentPath);
    }
    if (Array.isArray(value)) {
      return value.map((item, index) => this.redactValue(item, `${currentPath}[${index}]`, report));
    }
    if (!value || typeof value !== "object") {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => {
        const entryPath = `${currentPath}.${key}`;
        if (this.detectSensitiveKeys(key)) {
          report.redacted = true;
          report.redacted_field_count += 1;
          report.sensitive_patterns_found.push("sensitive_key");
          addRedactedPath(report, entryPath);
          return [key, "[REDACTED]"];
        }
        return [key, this.redactValue(entryValue, entryPath, report)];
      }),
    );
  }
}

function createPrivacyReport() {
  return {
    redacted: false,
    redacted_field_count: 0,
    redacted_paths: [],
    sensitive_patterns_found: [],
  };
}

function addRedactedPath(report, path) {
  report.redacted_paths.push(path);
}

const defaultPrivacyFilter = new PrivacyFilter();

module.exports = {
  PrivacyFilter,
  redactSensitiveText: defaultPrivacyFilter.redactSensitiveText.bind(defaultPrivacyFilter),
  redactSensitiveObject: defaultPrivacyFilter.redactSensitiveObject.bind(defaultPrivacyFilter),
  detectSensitiveKeys: defaultPrivacyFilter.detectSensitiveKeys.bind(defaultPrivacyFilter),
};
