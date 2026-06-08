const labels = {
  pass: "PASS",
  warn: "WARN",
  fail: "FAIL",
  current: "当前",
  pending: "待审批"
};

export default function StatusBadge({ status, children }) {
  return <span className={`status-badge status-${status}`}>{children ?? labels[status] ?? status}</span>;
}
