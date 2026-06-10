import { ArrowRight, CheckCircle2, ExternalLink, FileCheck2, Monitor, RefreshCw, RotateCcw, ShieldCheck, Smartphone, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPreviewStatus, startProjectPreview } from "../api/previewClient.js";
import {
  getAgentRunChangeDiff,
  getPrDraft,
  listAgentRunChanges,
  listReviewItems,
  resetAgentRunWorkspace,
  revertAgentRunFile,
  updateReviewItem
} from "../api/persistenceClient.js";

const DEFAULT_PREVIEW_TITLE = "Conduit login page";
const initialPreviewState = {
  status: "idle",
  available: false,
  previewUrl: "",
  port: null,
  projectRoot: "",
  requestedProjectRoot: "",
  runningProjectRoot: "",
  owner: "none",
  canRestart: false,
  actionRequired: "none",
  message: "",
  loading: false
};
const nonStartablePreviewStatuses = new Set([
  "project_path_missing",
  "project_path_not_absolute",
  "preview_not_supported",
  "port_in_use",
  "port_in_use_external"
]);
const humanStatusLabels = {
  pending: "待审阅",
  approved: "已通过",
  needs_change: "需修改",
  blocked: "阻塞",
  reverted: "已回退",
  resolved: "已解决"
};

export default function ReviewCheckWorkbench({
  activeProject,
  activeRequirement,
  agentWorkflow = {},
  onAgentWorkflowChange,
  onOpenPr
}) {
  const [runId, setRunId] = useState(agentWorkflow.runId || "");
  const [reviewItems, setReviewItems] = useState([]);
  const [changesState, setChangesState] = useState({ loading: false, error: "", data: null });
  const [selectedChangeId, setSelectedChangeId] = useState("");
  const [diffState, setDiffState] = useState({ loading: false, error: "", diff: null });
  const [reviewError, setReviewError] = useState("");
  const [loadingReview, setLoadingReview] = useState(false);
  const [previewState, setPreviewState] = useState(initialPreviewState);
  const [viewport, setViewport] = useState("desktop");
  const [previewKey, setPreviewKey] = useState(0);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [rollbackMessage, setRollbackMessage] = useState("");
  const workflowReview = agentWorkflow.review || null;
  const projectId = activeProject?.id || "active-project";
  const localPath = typeof activeProject?.localPath === "string" ? activeProject.localPath.trim() : "";
  const requestSequence = useRef(0);

  useEffect(() => {
    setRunId(agentWorkflow.runId || "");
  }, [agentWorkflow.runId]);

  useEffect(() => {
    let active = true;
    if (runId || !activeRequirement?.id) return () => {
      active = false;
    };
    getPrDraft(activeRequirement.id)
      .then((draft) => {
        if (!active) return;
        setRunId(draft.runId || "");
        onAgentWorkflowChange?.((current) => ({ ...current, runId: current.runId || draft.runId || "", prDraft: current.prDraft || draft }));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [activeRequirement?.id, runId, onAgentWorkflowChange]);

  const reloadChanges = useCallback(async () => {
    if (!runId) {
      setChangesState({ loading: false, error: "", data: null });
      return;
    }
    setChangesState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const data = await listAgentRunChanges(runId);
      setChangesState({ loading: false, error: "", data });
      const firstActive = data?.changes?.find((change) => change.status !== "reverted" && change.status !== "reset") || data?.changes?.[0];
      setSelectedChangeId((current) => current || firstActive?.id || "");
      onAgentWorkflowChange?.((current) => ({
        ...current,
        verificationStatus: data?.verificationStatus || current.verificationStatus
      }));
    } catch (error) {
      const code = error.payload?.error?.code || "";
      setChangesState({
        loading: false,
        error: code === "workspace_not_initialized"
          ? "该 Agent Run 没有 baseline workspace snapshot，无法回退。"
          : error.message || "变更记录加载失败",
        data: null
      });
    }
  }, [runId, onAgentWorkflowChange]);

  useEffect(() => {
    let active = true;
    setReviewError("");
    setReviewItems([]);
    if (!runId) return () => {
      active = false;
    };
    setLoadingReview(true);
    listReviewItems(runId)
      .then((items) => {
        if (!active) return;
        setReviewItems(Array.isArray(items) ? items : []);
      })
      .catch((error) => {
        if (!active) return;
        setReviewError(`审计项加载失败：${error.message || "Persistence API request failed"}`);
      })
      .finally(() => {
        if (active) setLoadingReview(false);
      });
    return () => {
      active = false;
    };
  }, [runId]);

  useEffect(() => {
    reloadChanges();
  }, [reloadChanges]);

  useEffect(() => {
    let active = true;
    if (!runId || !selectedChangeId) {
      setDiffState({ loading: false, error: "", diff: null });
      return () => {
        active = false;
      };
    }
    setDiffState({ loading: true, error: "", diff: null });
    getAgentRunChangeDiff(runId, selectedChangeId)
      .then((diff) => {
        if (active) setDiffState({ loading: false, error: "", diff });
      })
      .catch((error) => {
        if (active) setDiffState({ loading: false, error: error.message || "Diff 加载失败", diff: null });
      });
    return () => {
      active = false;
    };
  }, [runId, selectedChangeId]);

  const handleHumanStatusChange = async (itemId, humanStatus) => {
    setReviewItems((current) => current.map((item) => item.id === itemId ? { ...item, humanStatus } : item));
    try {
      const updated = await updateReviewItem(itemId, { humanStatus });
      setReviewItems((current) => current.map((item) => item.id === itemId ? { ...item, ...updated } : item));
    } catch (error) {
      setReviewError(`审阅状态保存失败：${error.message || "Persistence API request failed"}`);
    }
  };

  const performRollback = async () => {
    const action = confirmAction;
    if (!action || !runId) return;
    setRollbackMessage("");
    setConfirmAction(null);
    try {
      if (action.type === "file") {
        await revertAgentRunFile(runId, { changeId: action.change.id, reason: "Rejected from Review Check page." });
        setRollbackMessage(`已回退 ${action.change.filePath}。验证状态已标记为 stale。`);
      } else {
        await resetAgentRunWorkspace(runId, { reason: "Reset from Review Check page." });
        setRollbackMessage("已重置整个 run workspace。验证状态已标记为 stale。");
      }
      await reloadChanges();
      const items = await listReviewItems(runId).catch(() => null);
      if (Array.isArray(items)) setReviewItems(items);
    } catch (error) {
      setRollbackMessage(`回退失败：${error.message || "Persistence API request failed"}`);
    }
  };

  const normalizedWorkflowItems = normalizeWorkflowReviewItems(workflowReview?.changedFiles || []);
  const displayItems = reviewItems.length > 0 ? reviewItems : normalizedWorkflowItems;
  const changes = changesState.data?.changes || [];
  const selectedChange = changes.find((change) => change.id === selectedChangeId) || changes[0] || null;
  const reviewForAudit = useMemo(() => ({
    status: reviewItems.length > 0 ? summarizeHumanStatus(reviewItems) : workflowReview?.status || "not_generated",
    summary: reviewItems.length > 0
      ? (agentWorkflow.review?.summary || `${reviewItems.length} 个 review item 来自持久化 API。`)
      : normalizedWorkflowItems.length > 0
        ? workflowReview?.summary || `${normalizedWorkflowItems.length} 个 review item 来自 Agent real-run。`
        : loadingReview
          ? "正在读取持久化 review items..."
          : "暂无 Agent real-run 审计结果。请先在设计规划页生成 real-run。",
    changedFiles: displayItems.map(reviewItemToAuditFile),
    tests: buildTests(displayItems, workflowReview),
    manualConfirmations: buildConfirmations(displayItems, workflowReview)
  }), [agentWorkflow.review?.summary, displayItems, workflowReview, loadingReview, normalizedWorkflowItems.length, reviewItems]);

  const auditModel = useMemo(() => buildAuditModel(reviewForAudit, previewState.previewUrl), [reviewForAudit, previewState.previewUrl]);
  const changedFileCount = changes.length || auditModel.changedFiles.length;
  const verificationStatus = changesState.data?.verificationStatus || agentWorkflow.verificationStatus || "unknown";
  const rollbackStatus = getRollbackSummaryStatus(runId, changesState);
  const selectedFileLabel = selectedChange?.filePath || auditModel.selectedFile || "未选择文件";
  const changedFileRows = changes.length
    ? changes.map((change) => ({ id: change.id, filePath: change.filePath, status: change.status }))
    : auditModel.changedFiles.map((file) => ({ id: file.id || file.file, filePath: file.file, status: file.humanStatus || file.risk || "pending" }));

  const loadPreview = useCallback(async () => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;

    if (!localPath) {
      setPreviewState({
        ...initialPreviewState,
        status: "project_path_missing",
        projectRoot: localPath,
        requestedProjectRoot: localPath,
        message: "该项目未绑定本地路径。"
      });
      return;
    }

    const requestPayload = { projectId, localPath };
    setPreviewState((current) => ({
      ...current,
      loading: true,
      available: false,
      projectRoot: current.projectRoot || localPath,
      requestedProjectRoot: localPath,
      message: "正在检查 Conduit preview..."
    }));

    try {
      const statusResult = await getPreviewStatus(requestPayload);
      const startResult = !statusResult.available && shouldStartPreview(statusResult.status)
        ? await startProjectPreview(requestPayload)
        : statusResult;
      if (requestSequence.current !== sequence) return;
      setPreviewState(normalizePreviewResult(startResult, localPath));
      if (startResult.available) setPreviewKey((current) => current + 1);
    } catch (error) {
      if (requestSequence.current !== sequence) return;
      setPreviewState({
        ...initialPreviewState,
        status: "api_error",
        projectRoot: localPath,
        requestedProjectRoot: localPath,
        message: error?.payload?.error?.message || error?.message || "Preview API request failed."
      });
    }
  }, [localPath, projectId]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  const refreshPreview = () => {
    if (previewState.available) {
      setPreviewKey((current) => current + 1);
      return;
    }
    loadPreview();
  };

  const openPreview = () => {
    if (!auditModel.previewUrl) return;
    window.open(auditModel.previewUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <main className="review-check-workbench" data-testid="review-check-workbench">
      <header className="audit-overview-header">
        <div>
          <span>Agent real-run audit</span>
          <h1>审计页面</h1>
          <p>{reviewForAudit.summary}</p>
        </div>
        <dl className="audit-run-metrics" aria-label="Agent run 审计状态">
          <div><dt>项目</dt><dd>{activeProject?.name || activeProject?.id || "未选择"}</dd></div>
          <div><dt>runId</dt><dd>{runId || "no run"}</dd></div>
          <div><dt>realWritePerformed</dt><dd>{String(Boolean(agentWorkflow.realWritePerformed))}</dd></div>
          <div><dt>changed files</dt><dd>{changedFileCount}</dd></div>
          <div><dt>verification</dt><dd>{verificationStatus}</dd></div>
          <div><dt>rollback</dt><dd>{rollbackStatus}</dd></div>
        </dl>
      </header>

      <div className="audit-workspace-grid">
        <section className="audit-main-panel" aria-label="变更文件和 diff">
          <section className="audit-section audit-file-section audit-primary-files">
            <header className="audit-section-heading-row">
              <h2><FileCheck2 size={16} />Changed Files</h2>
              <strong>{changedFileCount}</strong>
            </header>
            <div className="audit-file-list">
              {changes.length ? changes.map((change) => (
                <ChangeCard
                  key={change.id}
                  change={change}
                  selected={selectedChangeId === change.id}
                  onSelect={() => setSelectedChangeId(change.id)}
                  onRevert={() => setConfirmAction({ type: "file", change })}
                />
              )) : auditModel.changedFiles.length ? auditModel.changedFiles.map((file) => (
                <ReviewFileCard
                  key={file.file}
                  file={file}
                  onHumanStatusChange={handleHumanStatusChange}
                />
              )) : <p className="audit-empty-state">暂无变更文件。请先运行真实 Agent，或确认 changed files 是否返回。</p>}
            </div>
          </section>

          <section className="audit-diff-viewer" aria-label="Diff Viewer">
            <header>
              <div>
                <span>Diff Viewer</span>
                <h2>{selectedFileLabel}</h2>
              </div>
              <small>{diffState.loading ? "loading" : selectedChange?.status || "empty"}</small>
            </header>
            {diffState.error ? <p className="run-error-text" role="alert">{diffState.error}</p> : null}
            <pre>{diffState.diff?.unifiedDiff || "暂无 diff。请先运行真实 Agent，或确认 changed files 是否返回。"}</pre>
          </section>
        </section>

        <aside className="audit-side-panel" aria-label="审计说明">
          <header className="audit-side-heading">
            <div>
              <span>Audit summary</span>
              <h2>审计结论</h2>
              <p>{changedFileCount ? `${changedFileCount} 个文件等待审阅，diff 和回退状态在左侧可直接查看。` : "暂无变更文件，等待 Agent real-run 输出。"}</p>
            </div>
            <strong>{reviewForAudit.status}</strong>
          </header>
          {reviewError ? <p className="run-error-text" role="alert">{reviewError}</p> : null}
          {rollbackMessage ? <p className="run-status-panel" role="status">{rollbackMessage}</p> : null}

          <RollbackInspector
            runId={runId}
            changesState={changesState}
            onReset={() => setConfirmAction({ type: "run" })}
          />

          <section className="audit-section audit-file-summary-section">
            <header className="audit-section-heading-row">
              <h2><FileCheck2 size={16} />Changed Files</h2>
              <strong>{changedFileCount}</strong>
            </header>
            {changedFileRows.length ? (
              <ul className="audit-compact-list">
                {changedFileRows.map((file) => (
                  <li key={file.id || file.filePath}>
                    <span>{file.filePath}</span>
                    <small>{file.status}</small>
                  </li>
                ))}
              </ul>
            ) : <p className="audit-empty-state">暂无 changed files。</p>}
          </section>

          <section className="audit-section audit-visible-change">
            <h2><ShieldCheck size={16} />用户可见变化</h2>
            <ul>{auditModel.visibleChanges.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>

          <section className="audit-section">
            <h2><CheckCircle2 size={16} />验收点映射</h2>
            {auditModel.acceptanceMappings.length ? (
              <dl className="audit-mapping-list">
                {auditModel.acceptanceMappings.map((item) => (
                  <div key={item.label}>
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
            ) : <p className="audit-empty-state">暂无验收映射。</p>}
          </section>

          <section className="audit-section audit-test-section">
            <h2><CheckCircle2 size={16} />测试证据</h2>
            {reviewForAudit.tests.length ? reviewForAudit.tests.map((test) => (
              <p key={test.command}><code>{test.command}</code><span>{test.status}</span></p>
            )) : <p><code>暂无测试证据</code><span>pending</span></p>}
          </section>

          <section className="audit-section audit-risk-section">
            <h2><TriangleAlert size={16} />Rollback History</h2>
            <ul>
              {(changesState.data?.rollbackHistory || []).length
                ? changesState.data.rollbackHistory.map((item) => <li key={item.id}>{item.operationType}: {item.status}</li>)
                : <li>暂无回退记录</li>}
            </ul>
          </section>

          <button className="audit-pr-button" type="button" onClick={onOpenPr}>进入 PR 页面 <ArrowRight size={15} /></button>
        </aside>
      </div>

      <section className={`audit-preview-pane ${previewExpanded ? "expanded" : "collapsed"}`} aria-label="页面预览">
        <header className="audit-preview-collapse-header">
          <div>
            <span>页面预览</span>
            <p>{previewState.available && auditModel.previewUrl ? auditModel.previewUrl : "暂无可用页面预览，请查看 diff 和审计结果。"}</p>
          </div>
          <button type="button" onClick={() => setPreviewExpanded((current) => !current)}>
            {previewExpanded ? "收起预览" : "展开预览"}
          </button>
        </header>
        {previewExpanded ? (
          <>
            <PreviewToolbar
              auditModel={auditModel}
              localPath={localPath}
              previewState={previewState}
              viewport={viewport}
              onViewportChange={setViewport}
              onRefresh={refreshPreview}
              onOpenPreview={openPreview}
            />
            <div className={`audit-browser-frame ${viewport}`} data-testid="audit-preview-frame">
              {previewState.available && auditModel.previewUrl ? (
                <iframe
                  key={`${previewKey}-${viewport}-${auditModel.previewUrl}`}
                  title={auditModel.previewTitle}
                  src={auditModel.previewUrl}
                  onError={() => setPreviewState((current) => ({
                    ...current,
                    available: false,
                    status: "iframe_error",
                    message: "iframe 无法加载后端返回的预览地址。"
                  }))}
                />
              ) : null}
              {!previewState.available ? (
                <PreviewUnavailable
                  isLoading={previewState.loading}
                  message={previewState.message}
                  path={previewState.requestedProjectRoot || previewState.projectRoot || localPath}
                  runningPath={previewState.runningProjectRoot}
                  owner={previewState.owner}
                  actionRequired={previewState.actionRequired}
                  port={previewState.port}
                  status={previewState.status}
                  url={auditModel.previewUrl}
                  onOpenPreview={openPreview}
                  onRetry={loadPreview}
                />
              ) : null}
            </div>
          </>
        ) : null}
      </section>

      {confirmAction ? (
        <div className="rollback-confirm-backdrop">
          <section className="rollback-confirm-modal" role="dialog" aria-modal="true" aria-label="确认回退">
            <h2>{confirmAction.type === "file" ? "确认回退单个文件" : "确认重置整个 Agent Run"}</h2>
            <p>
              此操作只会修改 Workbench 创建的 run workspace，并恢复到本次 run 开始前的 baseline snapshot。
              不会对原始 Conduit 仓库执行 git reset 或覆盖写入。
            </p>
            {confirmAction.change ? <code>{confirmAction.change.filePath}</code> : <code>{runId || "no run"}</code>}
            <div>
              <button type="button" onClick={() => setConfirmAction(null)}>取消</button>
              <button type="button" className="danger" onClick={performRollback}>确认回退</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function RollbackInspector({ runId, changesState, onReset }) {
  const data = changesState.data;
  const unavailableReason = getRollbackUnavailableReason(runId, changesState);
  const unavailable = Boolean(unavailableReason);
  return (
    <section className="audit-section rollback-inspector">
      <h2><RotateCcw size={16} />Rollback Inspector</h2>
      {changesState.error ? <p className="run-error-text">{changesState.error}</p> : null}
      {data?.verificationStatus === "stale" ? <p className="verification-stale-warning">Verification stale：回退后测试和 PR readiness 已失效，需要重新验证。</p> : null}
      <dl>
        <div><dt>run</dt><dd>{runId || "no run"}</dd></div>
        <div><dt>baseline</dt><dd>{data?.baselineSnapshot?.id || "not initialized"}</dd></div>
        <div><dt>adapter</dt><dd>{data?.baselineSnapshot?.adapterType || "unknown"}</dd></div>
        <div><dt>verification</dt><dd>{data?.verificationStatus || "unknown"}</dd></div>
      </dl>
      {unavailableReason ? (
        <p className="rollback-disabled-reason" id="rollback-reset-disabled-reason">
          {unavailableReason}
        </p>
      ) : null}
      <button
        type="button"
        className="rollback-reset-button"
        disabled={unavailable}
        aria-describedby={unavailableReason ? "rollback-reset-disabled-reason" : undefined}
        title={unavailableReason || "Reset this run workspace to its baseline snapshot"}
        onClick={onReset}
      >
        Reset Run Workspace
      </button>
    </section>
  );
}

function getRollbackUnavailableReason(runId, changesState) {
  const data = changesState.data;
  if (!runId) return "当前没有关联 Agent Run，无法重置 run workspace。";
  if (changesState.loading) return "正在加载 run workspace 状态，请稍后再试。";
  if (changesState.error) return "回退状态加载失败，请先刷新审计页面或重新进入当前 run。";
  if (!data) return "尚未读取到 run workspace 状态。";
  if (data.available === false && data.reason === "workspace_not_initialized") {
    return "当前 run 没有 baseline snapshot，通常是旧 run 或后端重启前生成的 run。请重新执行一次 real Agent run 后再使用 Reset Run Workspace。";
  }
  if (data.available === false) {
    return data.reason ? `当前 run workspace 不可回退：${data.reason}` : "当前 run workspace 不可回退。";
  }
  return "";
}

function getRollbackSummaryStatus(runId, changesState) {
  if (!runId) return "no run";
  if (changesState.loading) return "loading";
  if (changesState.error) return "unavailable";
  const data = changesState.data;
  if (!data) return "pending";
  if (data.available === false) return "unavailable";
  if (data?.baselineSnapshot?.id) return "ready";
  return "unknown";
}

function ChangeCard({ change, selected, onSelect, onRevert }) {
  const reverted = change.status === "reverted" || change.status === "reset";
  return (
    <div className="audit-file-card-shell">
      <button
        type="button"
        className={`audit-file-card ${selected ? "selected" : ""} ${reverted ? "reverted" : ""}`}
        aria-pressed={selected}
        onClick={onSelect}
      >
        <strong>{change.filePath}</strong>
        <span>{change.changeSummary || change.changeType || "changed"}</span>
        <small>{change.status}</small>
      </button>
      <button type="button" className="rollback-file-button" disabled={!change.canRevert || reverted} onClick={onRevert}>
        Revert File
      </button>
    </div>
  );
}

function ReviewFileCard({ file, onHumanStatusChange }) {
  return (
    <div className="audit-file-card-shell">
      <button type="button" className="audit-file-card">
        <strong>{file.file}</strong>
        <span>{file.changeSummary}</span>
        <small>{file.risk}</small>
      </button>
      {file.id ? (
        <label className="audit-human-status">
          <span>人工状态</span>
          <select
            aria-label={`人工审阅状态 ${file.file}`}
            value={file.humanStatus || "pending"}
            onChange={(event) => onHumanStatusChange(file.id, event.target.value)}
          >
            {Object.entries(humanStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
      ) : null}
    </div>
  );
}

function PreviewToolbar({ auditModel, localPath, previewState, viewport, onViewportChange, onRefresh, onOpenPreview }) {
  const boundPath = previewState.requestedProjectRoot || previewState.projectRoot || localPath || "未绑定本地路径";
  const previewLine = auditModel.previewUrl || "预览 URL 待返回";
  const runningLine = previewState.runningProjectRoot
    ? `运行路径：${previewState.runningProjectRoot}${previewState.owner === "external_verified" ? "（外部可信复用）" : ""}`
    : previewState.owner === "external"
      ? "运行路径：外部进程占用，Workbench 无法确认"
      : "运行路径：未启动";
  return (
    <header className="audit-preview-toolbar">
      <div className="preview-toolbar-lines">
        <span>{auditModel.previewTitle}</span>
        <code title={boundPath}>绑定路径：{boundPath}</code>
        <code title={previewLine}>{previewState.loading ? "正在准备预览..." : `预览 URL：${previewLine}`}</code>
        <code title={runningLine}>{runningLine}</code>
      </div>
      <nav aria-label="审计预览操作">
        <button type="button" aria-label="桌面视口" className={viewport === "desktop" ? "selected" : ""} onClick={() => onViewportChange("desktop")}><Monitor size={15} /></button>
        <button type="button" aria-label="移动视口" className={viewport === "mobile" ? "selected" : ""} onClick={() => onViewportChange("mobile")}><Smartphone size={15} /></button>
        <button type="button" aria-label="刷新 Conduit 预览" onClick={onRefresh}><RefreshCw size={15} /></button>
        <button type="button" aria-label="打开 Conduit 页面" disabled={!auditModel.previewUrl} onClick={onOpenPreview}><ExternalLink size={15} /></button>
      </nav>
    </header>
  );
}

function PreviewUnavailable({ isLoading, message, path, runningPath, owner, actionRequired, port, status, url, onOpenPreview, onRetry }) {
  const displayMessage = getPreviewUnavailableMessage({ status, message, port });
  return (
    <div className="audit-preview-unavailable" role="status" data-testid="audit-preview-unavailable">
      <strong>{isLoading ? "正在启动 Conduit preview" : "Conduit preview unavailable"}</strong>
      {displayMessage ? <span>{displayMessage}</span> : null}
      {path ? <code title={path}>绑定路径：{path}</code> : null}
      {runningPath ? <code title={runningPath}>运行路径：{runningPath}</code> : null}
      {url ? <span>预览 URL：{url}</span> : null}
      <small>{[status, owner, actionRequired].filter(Boolean).join(" / ")}</small>
      <div className="audit-preview-actions">
        <button type="button" onClick={onRetry}>重试 <RefreshCw size={14} /></button>
        <button type="button" disabled={!url} onClick={onOpenPreview}>打开新窗口 <ExternalLink size={14} /></button>
      </div>
    </div>
  );
}

function normalizeWorkflowReviewItems(items) {
  return items.map((file, index) => ({
    id: file.id || "",
    filePath: file.file || file.filePath || `review-${index + 1}`,
    changeSummary: file.changeSummary || "",
    reason: file.why || file.reason || "",
    requirementMapping: file.requirementPoint || file.requirementMapping || "",
    riskLevel: file.risk || file.riskLevel || "",
    humanStatus: file.humanStatus || "pending",
    testStatus: file.testStatus || "pending"
  }));
}

function reviewItemToAuditFile(item) {
  return {
    id: item.id || "",
    file: item.filePath || item.file || "",
    changeSummary: item.changeSummary || "",
    why: item.reason || item.why || "",
    requirementPoint: item.requirementMapping || item.requirementPoint || "",
    risk: item.riskLevel || item.risk || "",
    humanStatus: item.humanStatus || "pending",
    testStatus: item.testStatus || "pending"
  };
}

function summarizeHumanStatus(items) {
  if (items.every((item) => item.humanStatus === "approved" || item.humanStatus === "resolved")) return "approved";
  if (items.some((item) => item.humanStatus === "needs_change")) return "needs_change";
  if (items.some((item) => item.humanStatus === "blocked")) return "blocked";
  if (items.every((item) => item.humanStatus === "reverted")) return "reverted";
  return "needs_review";
}

function buildTests(items, fallbackReview) {
  if (items.length === 0) return fallbackReview?.tests || [];
  return items.map((item, index) => ({ command: `review evidence ${index + 1}`, status: item.testStatus || "pending" }));
}

function buildConfirmations(items, fallbackReview) {
  if (items.length === 0) return fallbackReview?.manualConfirmations || ["请先生成 Agent real-run 审计结果。"];
  return items.map((item) => `${item.filePath || item.file}: ${humanStatusLabels[item.humanStatus || "pending"]}`);
}

function buildAuditModel(review, previewUrl) {
  const changedFiles = Array.isArray(review.changedFiles) && review.changedFiles.length
    ? review.changedFiles
    : [];
  const hasChangedFiles = changedFiles.length > 0;
  return {
    changedFiles,
    previewUrl: previewUrl || "",
    previewTitle: DEFAULT_PREVIEW_TITLE,
    selectedFile: changedFiles[0]?.file || "",
    visibleChanges: hasChangedFiles ? changedFiles.map((file) => file.changeSummary || file.requirementPoint || file.file) : ["暂无用户可见变更，等待 Agent real-run 输出。"],
    acceptanceMappings: changedFiles.map((file, index) => ({
      label: `验收点 ${index + 1}`,
      value: file.why || file.requirementPoint || "Mapped to RequirementDSL acceptance criteria."
    }))
  };
}

function shouldStartPreview(status) {
  return !nonStartablePreviewStatuses.has(status);
}

function normalizePreviewResult(result, fallbackPath) {
  return {
    status: result?.status || "unknown",
    available: Boolean(result?.available),
    previewUrl: result?.previewUrl || "",
    port: result?.port ?? null,
    projectRoot: result?.projectRoot || fallbackPath || "",
    requestedProjectRoot: result?.requestedProjectRoot || result?.projectRoot || fallbackPath || "",
    runningProjectRoot: result?.runningProjectRoot || "",
    owner: result?.owner || "none",
    canRestart: Boolean(result?.canRestart),
    actionRequired: result?.actionRequired || "none",
    message: result?.message || "",
    loading: false
  };
}

function getPreviewUnavailableMessage({ status, message, port }) {
  if (status === "port_in_use_external") {
    const label = port ? `${port}` : "目标端口";
    return `${label} 被外部进程占用，未打开当前项目`;
  }
  return message || "";
}
