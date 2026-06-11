import { ArrowRight, CheckCircle2, ExternalLink, FileCheck2, Monitor, RefreshCw, RotateCcw, ShieldCheck, Smartphone, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPreviewStatus, startProjectPreview } from "../api/previewClient.js";
import {
  applyAgentRunToSource,
  getAgentRunChangeDiff,
  getPersistentAgentRun,
  getPrDraft,
  listAgentRunChanges,
  listProjectActivity,
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
  const initialRunId = isWorkflowProjectMismatch(agentWorkflow, activeProject, activeRequirement) ? "" : agentWorkflow.runId || "";
  const [runId, setRunId] = useState(initialRunId);
  const [reviewItems, setReviewItems] = useState([]);
  const [changesState, setChangesState] = useState({ loading: false, error: "", data: null });
  const [selectedChangeId, setSelectedChangeId] = useState("");
  const [diffState, setDiffState] = useState({ loading: false, error: "", diff: null });
  const [reviewError, setReviewError] = useState("");
  const [loadingReview, setLoadingReview] = useState(false);
  const [previewState, setPreviewState] = useState(initialPreviewState);
  const [viewport, setViewport] = useState("desktop");
  const [previewKey, setPreviewKey] = useState(0);
  const [rollbackRefreshKey, setRollbackRefreshKey] = useState(0);
  const [confirmAction, setConfirmAction] = useState(null);
  const [rollbackMessage, setRollbackMessage] = useState("");
  const workflowReview = agentWorkflow.review || null;
  const projectId = activeProject?.id || "active-project";
  const requirementId = activeRequirement?.id || "";
  const projectLocalPath = typeof activeProject?.localPath === "string" ? activeProject.localPath.trim() : "";
  const workflowProjectMismatch = isWorkflowProjectMismatch(agentWorkflow, activeProject, activeRequirement);
  const workspacePreviewPath = workflowProjectMismatch ? "" : resolveWorkflowWorkspacePath(agentWorkflow);
  const sourcePreviewActive = shouldPreviewSourceRepo(changesState.data);
  const previewDependencyPath = !sourcePreviewActive && workspacePreviewPath ? resolveWorkflowSourcePath(agentWorkflow, activeProject) : "";
  const activeRunId = workflowProjectMismatch ? "" : (runId || agentWorkflow.runId || "");
  const localPath = activeRunId ? (sourcePreviewActive ? projectLocalPath : (workspacePreviewPath || projectLocalPath)) : "";
  const previewProjectId = `${projectId}:review:${activeRunId || "no-run"}:${sourcePreviewActive ? "source" : "workspace"}`;
  const previewSessionId = buildAuditPreviewSessionId({
    projectId,
    requirementId,
    runId: activeRunId,
    targetPath: localPath,
    sourcePreviewActive
  });
  const requestSequence = useRef(0);

  useEffect(() => {
    setRunId(workflowProjectMismatch ? "" : agentWorkflow.runId || "");
  }, [agentWorkflow.runId, workflowProjectMismatch]);

  useEffect(() => {
    setRunId(workflowProjectMismatch ? "" : agentWorkflow.runId || "");
    setReviewItems([]);
    setChangesState({ loading: false, error: "", data: null });
    setSelectedChangeId("");
    setDiffState({ loading: false, error: "", diff: null });
    setReviewError("");
    setPreviewState(initialPreviewState);
    setPreviewKey((current) => current + 1);
    setRollbackMessage("");
    setConfirmAction(null);
  }, [projectId, requirementId, agentWorkflow.runId, workflowProjectMismatch]);

  useEffect(() => {
    let active = true;
    if (runId || !activeRequirement?.id) return () => {
      active = false;
    };
    resolveLatestReviewRun({ projectId, requirementId: activeRequirement.id, activeProject })
      .then((latestRun) => {
        if (!active) return;
        if (latestRun?.runId) {
          setRunId(latestRun.runId);
          onAgentWorkflowChange?.((current) => mergePersistentRunIntoWorkflow(current, latestRun));
          return;
        }
        return getPrDraft(activeRequirement.id).then((draft) => {
          if (!active) return;
          setRunId(draft.runId || "");
          onAgentWorkflowChange?.((current) => ({ ...current, runId: current.runId || draft.runId || "", prDraft: current.prDraft || draft }));
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [activeRequirement?.id, activeProject, projectId, runId, onAgentWorkflowChange]);

  const reloadChanges = useCallback(async () => {
    if (workflowProjectMismatch || !runId) {
      setChangesState({ loading: false, error: "", data: null });
      return;
    }
    setChangesState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const data = await listAgentRunChanges(runId);
      setChangesState({ loading: false, error: "", data });
      const firstActive = data?.changes?.find((change) => change.status !== "reverted" && change.status !== "reset") || data?.changes?.[0];
      setSelectedChangeId((current) => current || firstActive?.id || "");
      onAgentWorkflowChange?.((current) => {
        const verificationStatus = data?.verificationStatus || current.verificationStatus;
        if (!verificationStatus || current.verificationStatus === verificationStatus) return current;
        return {
          ...current,
          verificationStatus
        };
      });
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
  }, [runId, workflowProjectMismatch, onAgentWorkflowChange]);

  useEffect(() => {
    let active = true;
    setReviewError("");
    setReviewItems([]);
    if (workflowProjectMismatch || !runId) return () => {
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
  }, [runId, workflowProjectMismatch]);

  useEffect(() => {
    reloadChanges();
  }, [reloadChanges]);

  useEffect(() => {
    let active = true;
    if (workflowProjectMismatch || !runId || !selectedChangeId) {
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
  }, [runId, selectedChangeId, rollbackRefreshKey, workflowProjectMismatch]);

  const handleHumanStatusChange = async (itemId, humanStatus) => {
    setReviewItems((current) => current.map((item) => item.id === itemId ? { ...item, humanStatus } : item));
    try {
      const updated = await updateReviewItem(itemId, { humanStatus });
      setReviewItems((current) => current.map((item) => item.id === itemId ? { ...item, ...updated } : item));
    } catch (error) {
      setReviewError(`审阅状态保存失败：${error.message || "Persistence API request failed"}`);
    }
  };

  const performReviewAction = async () => {
    const action = confirmAction;
    if (!action || !runId) return;
    setRollbackMessage("");
    setConfirmAction(null);
    try {
      const target = shouldUseSourceRollback(changesState.data) ? "source" : "workspace";
      if (action.type === "apply") {
        await applyAgentRunToSource(runId, { reason: "Confirmed from Review Check page." });
        setRollbackMessage("Confirmed: run workspace has been applied to the real Conduit source repo. Future rollback actions target the real source baseline.");
      } else if (action.type === "file") {
        const payload = {
          changeId: action.change.id,
          reason: target === "source" ? "Rejected from real source after apply." : "Rejected from Review Check page."
        };
        if (target === "source") payload.target = "source";
        await revertAgentRunFile(runId, payload);
        setRollbackMessage(`${target === "source" ? "Real source file reverted" : "Workspace file reverted"}: ${action.change.filePath}. Verification is stale.`);
      } else {
        const payload = {
          reason: target === "source" ? "Reset real source from Review Check page." : "Reset from Review Check page."
        };
        if (target === "source") payload.target = "source";
        await resetAgentRunWorkspace(runId, payload);
        setRollbackMessage(target === "source"
          ? "Real Conduit source repo has been reset to the pre-apply baseline. Verification is stale."
          : "Run workspace has been reset to baseline. Verification is stale.");
      }
      await reloadChanges();
      const items = await listReviewItems(runId).catch(() => null);
      if (Array.isArray(items)) setReviewItems(items);
      setRollbackRefreshKey((current) => current + 1);
      setPreviewKey((current) => current + 1);
    } catch (error) {
      setRollbackMessage(`Operation failed: ${error.message || "Persistence API request failed"}`);
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

  const loadPreview = useCallback(async () => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;

    if (!activeRunId) {
      setPreviewState({
        ...initialPreviewState,
        status: workflowProjectMismatch ? "run_project_mismatch" : "no_review_run",
        message: workflowProjectMismatch
          ? "已阻止旧工程 Agent Run 预览。请先为当前工程执行 Agent。"
          : "当前工程暂无 Agent Run 审计预览。请先在设计规划页执行 Agent。"
      });
      return;
    }

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

    const requestPayload = {
      projectId: previewProjectId,
      requirementId,
      runId: activeRunId,
      previewSessionId,
      localPath
    };
    if (previewDependencyPath || sourcePreviewActive) {
      requestPayload.dependencyPath = previewDependencyPath;
      requestPayload.allowPortFallback = true;
      requestPayload.previewMode = "audit_workspace";
    }
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
      const startResult = !statusResult.available && shouldStartPreview(statusResult.status, Boolean(previewDependencyPath))
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
  }, [activeRunId, localPath, previewDependencyPath, previewProjectId, previewSessionId, requirementId, sourcePreviewActive, workflowProjectMismatch]);

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

  const handleApplyToSource = async () => {
    if (!runId) return;
    if (typeof window !== "undefined" && !window.confirm("确认把当前 run workspace 的代码写入真实 Conduit 源仓库？写入前会创建源仓库快照。")) return;
    setRollbackMessage("");
    try {
      await applyAgentRunToSource(runId, { reason: "Confirmed from Review Check page." });
      setRollbackMessage("Confirmed: run workspace has been applied to the real Conduit source repo.");
      await reloadChanges();
      setPreviewKey((current) => current + 1);
    } catch (error) {
      setRollbackMessage(`Apply failed: ${error.message || "Persistence API request failed"}`);
    }
  };

  const handleResetSource = async () => {
    if (!runId) return;
    if (typeof window !== "undefined" && !window.confirm("确认把真实 Conduit 源仓库回退到本次确认写入前的快照？")) return;
    setRollbackMessage("");
    try {
      await resetAgentRunWorkspace(runId, { target: "source", reason: "Reset real source from Review Check page." });
      setRollbackMessage("Real Conduit source repo has been reset to the pre-apply baseline.");
      await reloadChanges();
      setPreviewKey((current) => current + 1);
    } catch (error) {
      setRollbackMessage(`Real source reset failed: ${error.message || "Persistence API request failed"}`);
    }
  };

  return (
    <main className="review-check-workbench" data-testid="review-check-workbench">
      <section className="audit-preview-pane" aria-label="Conduit 页面预览">
        <PreviewToolbar
          auditModel={auditModel}
          localPath={localPath}
          projectLocalPath={projectLocalPath}
          previewState={previewState}
          viewport={viewport}
          onViewportChange={setViewport}
          onRefresh={refreshPreview}
          onOpenPreview={openPreview}
        />
        <div className={`audit-browser-frame ${viewport}`} data-testid="audit-preview-frame">
          {previewState.available && auditModel.previewUrl ? (
            <iframe
              key={`${projectId}-${requirementId || "no-requirement"}-${activeRunId || "no-run"}-${hashString(localPath)}-${previewKey}-${viewport}-${auditModel.previewUrl}`}
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

        <section className="audit-diff-viewer" aria-label="Diff Viewer">
          <header>
            <div>
              <span>Diff Viewer</span>
              <h2>{selectedChange?.filePath || "未选择文件"}</h2>
            </div>
            <small>{diffState.loading ? "loading" : selectedChange?.status || "empty"}</small>
          </header>
          {diffState.error ? <p className="run-error-text" role="alert">{diffState.error}</p> : null}
          <pre>{diffState.diff?.unifiedDiff || "暂无 diff。旧 run 没有 baseline 时无法展示可回退 diff。"}</pre>
        </section>
      </section>

      <aside className="audit-side-panel" aria-label="审计说明">
        <header className="audit-side-heading">
          <div>
            <span>Agent real-run audit</span>
            <h1>审计页面</h1>
            <p>{reviewForAudit.summary}</p>
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

        <SourceApplyPanel
          changesState={changesState}
          runId={runId}
          sourcePath={projectLocalPath}
          onApply={handleApplyToSource}
          onResetSource={handleResetSource}
        />

        <section className="audit-section audit-file-section">
          <h2><FileCheck2 size={16} />Changed Files</h2>
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
            )) : <p className="audit-empty-state">暂无变更文件</p>}
          </div>
        </section>

        <section className="audit-section audit-visible-change">
          <h2><ShieldCheck size={16} />用户可见变化</h2>
          <ul>{auditModel.visibleChanges.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>

        <section className="audit-section">
          <h2><CheckCircle2 size={16} />验收点映射</h2>
          <dl className="audit-mapping-list">
            {auditModel.acceptanceMappings.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="audit-section audit-test-section">
          <h2><CheckCircle2 size={16} />测试证据</h2>
          {reviewForAudit.tests.length ? reviewForAudit.tests.map((test) => (
            <p key={test.command}><code>{test.command}</code><span>{test.status}</span></p>
          )) : <p><code>npm test</code><span>pending</span></p>}
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
              <button type="button" className="danger" onClick={performReviewAction}>确认回退</button>
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

function SourceApplyPanel({ changesState, runId, sourcePath, onApply, onResetSource }) {
  const data = changesState.data;
  const sourceState = data?.sourceState || {};
  const sourceRollbackActive = shouldUseSourceRollback(data);
  const sourcePreviewed = shouldPreviewSourceRepo(data);
  const canApply = Boolean(runId && data?.canApplyToSource && sourcePath && !sourceRollbackActive);
  const canResetSource = Boolean(runId && data?.canRollbackSource && sourcePath);
  return (
    <section className="audit-section source-apply-panel">
      <h2><ShieldCheck size={16} />真实 Conduit 写入</h2>
      <p>{sourceRollbackActive
        ? "当前 run 已确认写入真实 Conduit。回退会恢复到写入前快照。"
        : sourcePreviewed
          ? "真实 Conduit 已回退到写入前快照，审计预览正在展示真实源仓库。"
          : "当前预览仍来自 run workspace。确认后才会写入真实 Conduit 源仓库。"}
      </p>
      <dl>
        <div><dt>source</dt><dd>{sourcePath || "not bound"}</dd></div>
        <div><dt>state</dt><dd>{sourceState.status || "not_applied"}</dd></div>
      </dl>
      <div className="source-apply-actions">
        <button type="button" disabled={!canApply || changesState.loading} onClick={onApply}>
          Apply to Real Conduit Source
        </button>
        <button type="button" disabled={!canResetSource || changesState.loading} onClick={onResetSource}>
          Reset Real Conduit Source
        </button>
      </div>
    </section>
  );
}

function getRollbackUnavailableReason(runId, changesState) {
  const data = changesState.data;
  if (!runId) return "当前没有关联 Agent Run，无法重置 run workspace。";
  if (changesState.loading && !data) return "正在加载 run workspace 状态，请稍后再试。";
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

function PreviewToolbar({ auditModel, localPath, projectLocalPath, previewState, viewport, onViewportChange, onRefresh, onOpenPreview }) {
  const boundPath = previewState.requestedProjectRoot || previewState.projectRoot || localPath || "未绑定本地路径";
  const previewLine = auditModel.previewUrl || "预览 URL 待返回";
  const userPreviewLine = projectLocalPath ? "用户 Conduit: http://127.0.0.1:3000" : "";
  const runningLine = previewState.runningProjectRoot
    ? `运行路径：${previewState.runningProjectRoot}${previewState.owner === "external_verified" ? "（外部可信复用）" : ""}`
    : previewState.owner === "external"
      ? "运行路径：外部进程占用，Workbench 无法确认"
      : "运行路径：未启动";
  return (
    <header className="audit-preview-toolbar">
      <div className="preview-toolbar-lines">
        <span>{auditModel.previewTitle}</span>
        {userPreviewLine ? <code title={projectLocalPath}>{userPreviewLine}</code> : null}
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

function shouldPreviewSourceRepo(changesData) {
  return ["applied", "partially_reverted", "reset"].includes(changesData?.sourceState?.status);
}

function shouldUseSourceRollback(changesData) {
  return ["applied", "partially_reverted"].includes(changesData?.sourceState?.status);
}

function buildAuditPreviewSessionId({ projectId, requirementId, runId, targetPath, sourcePreviewActive }) {
  const raw = [
    "audit",
    projectId || "no-project",
    requirementId || "no-requirement",
    runId || "no-run",
    sourcePreviewActive ? "source" : "workspace",
    hashString(targetPath || "")
  ].join(":");
  return raw.replace(/[^\w:.-]/g, "_");
}

function hashString(value) {
  let hash = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function normalizeLocalPathForCompare(value) {
  return String(value || "").trim().replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

function isWorkflowProjectMismatch(workflow = {}, activeProject = {}, activeRequirement = {}) {
  if (!workflow?.runId) return false;
  const projectPath = normalizeLocalPathForCompare(activeProject?.localPath);
  const sourcePath = normalizeLocalPathForCompare(resolveWorkflowSourcePath(workflow, {}));
  if (projectPath && sourcePath && projectPath !== sourcePath) return true;

  const workflowRequirementId = workflow.requirementId || workflow.context?.requirementId || workflow.context?.requirement_id;
  if (activeRequirement?.id && workflowRequirementId && String(workflowRequirementId) !== String(activeRequirement.id)) return true;

  const projectId = activeProject?.id || "";
  const workflowProjectId = workflow.projectId || workflow.context?.projectId || workflow.context?.project_id;
  if (projectId && workflowProjectId && String(workflowProjectId) !== String(projectId)) return true;

  return false;
}

function resolveWorkflowWorkspacePath(workflow = {}) {
  const candidates = [
    workflow.workspacePath,
    workflow.workspace?.workspacePath,
    workflow.context?.workspacePath,
    workflow.context?.executionBoundary?.isolatedWorkspacePath
  ];
  return candidates
    .map((value) => typeof value === "string" ? value.trim() : "")
    .find(Boolean) || "";
}

function resolveWorkflowSourcePath(workflow = {}, project = {}) {
  const candidates = [
    workflow.sourceRepoPath,
    workflow.workspace?.sourceRepoPath,
    workflow.context?.sourceRepoPath,
    workflow.context?.executionBoundary?.sourceRepoPath,
    project.localPath
  ];
  return candidates
    .map((value) => typeof value === "string" ? value.trim() : "")
    .find(Boolean) || "";
}

async function resolveLatestReviewRun({ projectId, requirementId, activeProject }) {
  const activity = await listProjectActivity(projectId).catch(() => []);
  const candidates = (Array.isArray(activity) ? activity : [])
    .filter((item) => item.requirementId === requirementId && item.runId)
    .filter((item) => item.projectId === projectId || !item.projectId)
    .filter((item) => item.type === "WORKSPACE_SNAPSHOT_CREATED" || item.payloadJson?.workspacePath || item.type === "agent_dry_run_completed")
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  for (const item of candidates) {
    const run = await getPersistentAgentRun(item.runId).catch(() => null);
    if (!run) continue;
    if (!isRunOwnedByCurrentProject(run, activeProject, requirementId)) continue;
    return normalizePersistentRun(run, item.runId);
  }
  return null;
}

function normalizePersistentRun(run, fallbackRunId = "") {
  return {
    runId: run.id || fallbackRunId,
    status: run.status,
    dryRun: run.dryRun,
    realWritePerformed: run.realWritePerformed,
    latestReturn: run.resultSummary,
    workspacePath: run.workspacePath,
    sourceRepoPath: run.sourceRepoPath,
    targetRepoPath: run.targetRepoPath,
    context: run.contextSnapshot || {}
  };
}

function isRunOwnedByCurrentProject(run = {}, activeProject = {}, requirementId = "") {
  if (requirementId && String(run.requirementId || "") !== String(requirementId)) return false;
  const projectId = activeProject?.id || "";
  const runProjectId = run.contextSnapshot?.projectId || run.contextSnapshot?.project_id || run.projectId || "";
  if (projectId && runProjectId && String(runProjectId) !== String(projectId)) return false;
  const projectPath = normalizeLocalPathForCompare(activeProject?.localPath);
  const sourcePath = normalizeLocalPathForCompare(run.sourceRepoPath || run.contextSnapshot?.sourceRepoPath || run.contextSnapshot?.source_repo_path);
  if (projectPath && sourcePath && projectPath !== sourcePath) return false;
  return Boolean(run.workspacePath || run.contextSnapshot?.workspacePath || run.contextSnapshot?.executionBoundary?.isolatedWorkspacePath);
}

function mergePersistentRunIntoWorkflow(current = {}, run = {}) {
  return {
    ...current,
    status: run.status || current.status,
    runId: run.runId || current.runId || "",
    latestReturn: run.latestReturn || current.latestReturn,
    dryRun: run.dryRun ?? current.dryRun,
    realWritePerformed: run.realWritePerformed ?? current.realWritePerformed,
    workspacePath: run.workspacePath || current.workspacePath || "",
    sourceRepoPath: run.sourceRepoPath || current.sourceRepoPath || "",
    targetRepoPath: run.targetRepoPath || current.targetRepoPath || "",
    context: {
      ...(current.context || {}),
      ...(run.context || {}),
      workspacePath: run.workspacePath || run.context?.workspacePath || current.context?.workspacePath || "",
      sourceRepoPath: run.sourceRepoPath || run.context?.sourceRepoPath || current.context?.sourceRepoPath || "",
      targetRepoPath: run.targetRepoPath || run.context?.targetRepoPath || current.context?.targetRepoPath || ""
    }
  };
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

function shouldStartPreview(status, allowPortFallback = false) {
  if (allowPortFallback && status === "port_in_use_external") return true;
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
