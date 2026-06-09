import { ArrowRight, CheckCircle2, FileWarning } from "lucide-react";
import { fallbackAgentReview } from "../data/agentWorkflowData.js";

export default function ReviewCheckWorkbench({ agentWorkflow, onOpenPr }) {
  const review = agentWorkflow.review || fallbackAgentReview;
  return (
    <main className="review-check-workbench" data-testid="review-check-workbench">
      <section className="review-main">
        <header className="review-page-heading">
          <div><h1>审阅检查</h1><p>把 Agent dry-run 里该懂的地方打开给用户看。</p></div>
          <span>{review.status}</span>
        </header>
        <section className="review-summary-panel">
          <FileWarning size={24} />
          <div><h2>Agent 修改摘要</h2><p>{review.summary}</p></div>
        </section>
        <section className="review-file-list">
          {review.changedFiles.map((file) => (
            <article key={file.file}>
              <div><strong>{file.file}</strong><p>{file.changeSummary}</p></div>
              <dl>
                <div><dt>为什么改这里</dt><dd>{file.why}</dd></div>
                <div><dt>对应需求点</dt><dd>{file.requirementPoint}</dd></div>
                <div><dt>风险说明</dt><dd>{file.risk}</dd></div>
              </dl>
            </article>
          ))}
        </section>
      </section>
      <aside className="review-side">
        <section><h2>测试结果</h2>{review.tests.map((test) => <p key={test.command}><CheckCircle2 size={15} />{test.command}: {test.status}</p>)}</section>
        <section><h2>需要人工确认</h2><ul>{review.manualConfirmations.map((item) => <li key={item}>{item}</li>)}</ul></section>
        <button type="button" onClick={onOpenPr}>进入 PR 页面 <ArrowRight size={15} /></button>
      </aside>
    </main>
  );
}
