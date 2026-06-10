const { ContextBudgetManager } = require("../contextBudgetManager");

describe("ContextBudgetManager", () => {
  test("does not truncate final_dsl_core", () => {
    const manager = new ContextBudgetManager({ maxCharsByAgent: { repairAgent: 200 } });
    const longDsl = "dsl".repeat(500);

    const result = manager.applyContextBudget("repairAgent", {
      final_dsl_core: { value: longDsl, source_node_ids: ["dsl_001"] },
      other: "x".repeat(5000),
    });

    expect(result.context.final_dsl_core.value).toBe(longDsl);
  });

  test("does not truncate active_interrupts", () => {
    const manager = new ContextBudgetManager({ maxCharsByAgent: { planAgent: 200 } });
    const interrupts = { value: ["interrupt".repeat(100)], source_node_ids: ["interrupt_001"] };

    const result = manager.applyContextBudget("planAgent", {
      active_interrupts: interrupts,
      other: "x".repeat(5000),
    });

    expect(result.context.active_interrupts).toEqual(interrupts);
  });

  test("removes full_chat_history, full_sandbox_log, and full_patch_diff", () => {
    const manager = new ContextBudgetManager();
    const result = manager.applyContextBudget("repairAgent", {
      full_chat_history: ["raw chat"],
      full_sandbox_log: "raw log",
      full_patch_diff: "raw diff",
      safe: "summary",
    });

    expect(result.context).toEqual({ safe: "summary" });
    expect(result.budget_report.removed_fields).toEqual(
      expect.arrayContaining(["$.full_chat_history", "$.full_sandbox_log", "$.full_patch_diff"]),
    );
  });

  test("truncates long unprotected fields and records budget usage", () => {
    const manager = new ContextBudgetManager({ maxCharsByAgent: { deliveryAgent: 1000 } });
    const result = manager.applyContextBudget("deliveryAgent", {
      summary: "x".repeat(3000),
    });

    expect(result.context.summary).toContain("[TRUNCATED]");
    expect(result.budget_report.before_chars).toBeGreaterThan(result.budget_report.after_chars);
    expect(result.budget_report.truncated_fields).toContain("$.summary");
    expect(result.budget_report.removed_fields).toEqual([]);
  });

  test("rankContextItemsByImportance prioritizes durable constraints and summaries", () => {
    const manager = new ContextBudgetManager();

    const ranked = manager.rankContextItemsByImportance([
      { key: "misc" },
      { key: "final_dsl_core" },
      { key: "dependency_summary" },
    ]);

    expect(ranked.map((item) => item.key)).toEqual(["final_dsl_core", "dependency_summary", "misc"]);
  });
});
