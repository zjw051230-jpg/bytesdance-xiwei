const tabs = [
  { id: "dsl", label: "DSL 澄清台" },
  { id: "design", label: "设计规划" },
  { id: "review", label: "审阅检查" },
  { id: "pr", label: "PR 页面" }
];

export default function WorkspaceTopTabs({ activePage, onPageChange }) {
  return (
    <nav className="workspace-top-tabs" aria-label="工作台页面切换">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`workspace-top-tab ${activePage === tab.id ? "selected" : ""}`}
          aria-pressed={activePage === tab.id}
          onClick={() => onPageChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
