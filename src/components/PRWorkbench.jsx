import { Copy, GitPullRequest } from "lucide-react";
import { fallbackPrDraft } from "../data/agentWorkflowData.js";

export default function PRWorkbench({ agentWorkflow }) {
  const prDraft = agentWorkflow.prDraft || fallbackPrDraft;
  const copyDescription = () => {
    navigator.clipboard?.writeText?.(buildPrDescription(prDraft));
  };

  return (
    <main className="pr-workbench" data-testid="pr-workbench">
      <section className="pr-main">
        <header className="pr-page-heading">
          <div><h1>PR 页面</h1><p>准备 PR 描述，不自动创建远端 PR。</p></div>
          <span>{agentWorkflow.runId || "no run"}</span>
        </header>
        <section className="pr-title-card">
          <GitPullRequest size={26} />
          <div><small>PR 标题</small><h2>{prDraft.title}</h2></div>
        </section>
        <section className="pr-section"><h2>PR 摘要</h2><ul>{prDraft.summary.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></section>
        <section className="pr-section"><h2>变更文件</h2><ul>{prDraft.changedFiles.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></section>
      </section>
      <aside className="pr-side">
        <section><h2>测试结果</h2>{prDraft.tests.map((item) => <p key={item.command}>{item.command}: {item.status}</p>)}</section>
        <section><h2>风险</h2><ul>{prDraft.risks.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></section>
        <section><h2>合并前 checklist</h2><ul>{prDraft.checklist.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></section>
        <button type="button" onClick={copyDescription}><Copy size={15} />复制 PR 描述</button>
      </aside>
    </main>
  );
}

function buildPrDescription(prDraft) {
  return [
    `# ${prDraft.title}`,
    "",
    "## Summary",
    ...prDraft.summary.map((item) => `- ${item}`),
    "",
    "## Changed Files",
    ...prDraft.changedFiles.map((item) => `- ${item}`),
    "",
    "## Tests",
    ...prDraft.tests.map((item) => `- ${item.command}: ${item.status}`),
    "",
    "## Risks",
    ...prDraft.risks.map((item) => `- ${item}`)
  ].join("\n");
}
