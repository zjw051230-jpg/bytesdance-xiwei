import { Clipboard, Code2, FileDown, FileText, X } from "lucide-react";
import { useEffect } from "react";
import ReportQualityPanel from "./ReportQualityPanel.jsx";

export default function RequirementReportModal({ onClose, onToast, uiState, runState }) {
  const report = uiState?.humanReport || {};
  const summary = report.summary || {};
  const scope = report.scope || { inScope: [], outOfScope: [] };
  const riskCards = report.riskCards || [];
  const runFailed = ["failed", "timeout"].includes(runState?.status);
  const draftReportMode = runFailed && ["done", "fallback"].includes(runState?.skillStatus);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="report-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="requirement-report-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="requirement-report-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="report-modal-header">
          <div className="report-title-group">
            <span className="report-title-icon" aria-hidden="true"><FileText size={28} /></span>
            <div>
              <h2 id="requirement-report-title">{draftReportMode ? "草稿报告（人类可读版）" : "需求报告（人类可读版）"}</h2>
              <p>{draftReportMode ? `由快速澄清草稿生成，完整 artifacts 尚未成功：${runState.runId}` : (runState?.runId ? `由真实 artifacts 映射生成：${runState.runId}` : "尚未生成真实 DSL，当前显示 fallback 报告")}</p>
            </div>
          </div>
          <div className="report-modal-actions">
            <button type="button" onClick={() => onToast("已复制报告")}><Clipboard size={16} />复制报告</button>
            <button type="button" onClick={() => onToast("已导出 JSON（mock）")}><Code2 size={16} />导出 JSON</button>
            <button type="button" onClick={() => onToast("已导出 Markdown（mock）")}><FileDown size={16} />导出 Markdown</button>
            <button type="button" onClick={() => onToast(`Artifacts: ${Object.keys(runState?.artifacts || {}).filter((key) => runState.artifacts[key]?.exists).length} 个可用`)}><Code2 size={16} />查看本轮 artifacts</button>
            <button type="button" onClick={onClose}><X size={16} />关闭</button>
          </div>
        </header>

        <div className="report-modal-body">
          <nav className="report-nav" aria-label="需求报告章节">
            <button className="active" type="button">需求摘要</button>
            <button type="button">范围说明</button>
            <button type="button">风险与待确认</button>
          </nav>

          <main className="report-main">
            <section className="report-card report-summary-card">
              <div className="report-step">1</div>
              <div className="report-meta-grid">
                <span><small>状态</small><strong>{draftReportMode ? "草稿可审阅" : (runFailed ? "生成失败" : (summary.status || "需要澄清"))}</strong></span>
                <span><small>Run</small><strong>{runState?.runId || "尚未生成"}</strong></span>
                <span><small>来源</small><strong>{summary.source || "fallback"}</strong></span>
              </div>
              <h3>需求摘要</h3>
              {runFailed ? <p className="report-error">{draftReportMode ? "完整 artifacts 生成失败，当前展示 fast skill 草稿：" : "真实 run 失败："}{runState.error?.message}</p> : null}
              <small>标题</small>
              <h4>{summary.title}</h4>
              <small>摘要</small>
              <p>{summary.text}</p>
            </section>

            <section className="report-card report-scope-card">
              <div className="report-step">2</div>
              <h3>范围说明</h3>
              <div className="scope-grid">
                <div>
                  <strong>本次要做什么（In Scope）</strong>
                  <ul>{scope.inScope.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
                <div>
                  <strong>本次不做什么（Out of Scope）</strong>
                  <ul>{scope.outOfScope.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              </div>
              <div className="small-report-cards">
                <article><strong>输出目录</strong><p>{runState?.relativeOutputDir || "runs\\<runId>"}</p></article>
                <article><strong>真实 DSL</strong><p>{runState?.runId ? "enabled" : "尚未运行"}</p></article>
                <article><strong>边界</strong><p>PM→DSL draft only；不进入 Agent Handoff</p></article>
              </div>
            </section>

            <section className="report-card report-risks-card">
              <div className="report-step">3</div>
              <h3>风险与待确认</h3>
              <div className="risk-confirm-grid">
                {riskCards.map((card) => (
                  <article key={card.title}>
                    <strong>{card.title}</strong>
                    <ul>{card.points.map((point) => <li key={point}>{point}</li>)}</ul>
                  </article>
                ))}
              </div>
            </section>
          </main>

          <ReportQualityPanel reportQuality={uiState?.reportQuality} note={report.note} />
        </div>
      </section>
    </div>
  );
}
