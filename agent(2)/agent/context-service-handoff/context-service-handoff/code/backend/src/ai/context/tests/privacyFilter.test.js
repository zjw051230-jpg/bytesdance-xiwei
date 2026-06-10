const { PrivacyFilter } = require("../privacyFilter");

describe("PrivacyFilter", () => {
  test("redacts password, token, apiKey, and secret fields", () => {
    const filter = new PrivacyFilter();
    const result = filter.redactSensitiveObject({
      password: "pw",
      token: "token",
      apiKey: "key",
      secret: "secret",
    });

    expect(result.value).toEqual({
      password: "[REDACTED]",
      token: "[REDACTED]",
      apiKey: "[REDACTED]",
      secret: "[REDACTED]",
    });
    expect(result.privacy_report.redacted_field_count).toBe(4);
  });

  test("redacts authorization, cookie, and privateKey fields", () => {
    const filter = new PrivacyFilter();
    const result = filter.redactSensitiveObject({
      authorization: "Bearer abc",
      cookie: "sid=123",
      privateKey: "private",
    });

    expect(result.value.authorization).toBe("[REDACTED]");
    expect(result.value.cookie).toBe("[REDACTED]");
    expect(result.value.privateKey).toBe("[REDACTED]");
  });

  test("redacts Bearer, sk-, and ghp_ tokens in text", () => {
    const filter = new PrivacyFilter();
    const text = filter.redactSensitiveText("Bearer abc.def sk-1234567890 ghp_1234567890abcdef");

    expect(text).not.toContain("Bearer abc.def");
    expect(text).not.toContain("sk-1234567890");
    expect(text).not.toContain("ghp_1234567890abcdef");
    expect(text).toContain("[REDACTED]");
  });

  test("redacts private key blocks", () => {
    const filter = new PrivacyFilter();
    const text = filter.redactSensitiveText(`-----BEGIN PRIVATE KEY-----
abc
-----END PRIVATE KEY-----`);

    expect(text).toBe("[REDACTED]");
  });

  test("redacts .env-style sensitive content and database urls", () => {
    const filter = new PrivacyFilter();
    const text = filter.redactSensitiveText("API_KEY=abc\nDATABASE_URL=postgres://user:pass@localhost/db");

    expect(text).not.toContain("API_KEY=abc");
    expect(text).not.toContain("postgres://user:pass@localhost/db");
    expect(text).toContain("[REDACTED]");
  });

  test("recursively redacts objects and arrays with report paths", () => {
    const filter = new PrivacyFilter();
    const result = filter.redactSensitiveObject({
      nested: [{ accessToken: "abc" }, { text: "Bearer nested.token" }],
    });

    expect(result.value.nested[0].accessToken).toBe("[REDACTED]");
    expect(result.value.nested[1].text).toBe("[REDACTED]");
    expect(result.privacy_report.redacted).toBe(true);
    expect(result.privacy_report.redacted_field_count).toBeGreaterThanOrEqual(2);
    expect(result.privacy_report.redacted_paths).toEqual(
      expect.arrayContaining(["$.nested[0].accessToken", "$.nested[1].text"]),
    );
  });

  test("detectSensitiveKeys identifies known sensitive key names", () => {
    const filter = new PrivacyFilter();

    expect(filter.detectSensitiveKeys("clientSecret")).toBe(true);
    expect(filter.detectSensitiveKeys("refresh_token")).toBe(true);
    expect(filter.detectSensitiveKeys("summary")).toBe(false);
  });
});
