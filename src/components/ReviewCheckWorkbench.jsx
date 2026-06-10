import { ArrowRight, CheckCircle2, ExternalLink, FileCheck2, Monitor, RefreshCw, ShieldCheck, Smartphone, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPreviewStatus, startProjectPreview } from "../api/previewClient.js";
import { getPrDraft, listReviewItems, updateReviewItem } from "../api/persistenceClient.js";

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
  blocked: "阻塞"
};

const emptyReviewSummary = "暂无 Agent dry-run 审计结果。请先在设计规划页生成 dry-run。";

export default function ReviewCheckWorkbench({
  activeProject,
  activeRequirement,
  agentWorkflow = {},
  onAgentWorkflowChange,
  onOpenPr
}) {
  const [runId, setRunId] = useState(agentWorkflow.runId || "");
  const [reviewItems, setReviewItems] = useState([]);
  const [reviewError, setReviewError] = useState("");
  const [loadingReview, setLoadingReview] = useState(false);
  const [previewState, setPreviewState] = useState(initialPreviewState);
  const [viewport, setViewport] = useState("desktop");
  const [previewKey, setPreviewKey] = useState(0);
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
        if (Array.isArray(items)) {
          setReviewItems(items);
        } else if (Array.isArray(items?.review?.changedFiles)) {
          setReviewItems(normalizeWorkflowReviewItems(items.review.changedFiles));
        } else {
          setReviewItems([]);
        }
      })
      .catch((error) => {
        if (!active) return;
        setReviewError(`审计页面加载失败：${error.message || "Persistence API request failed"}`);
      })
      .finally(() => {
        if (active) setLoadingReview(false);
      });
    return () => {
      active = false;
    };
  }, [runId]);

  const handleHumanStatusChange = async (itemId, humanStatus) => {
    setReviewItems((current) => current.map((item) => item.id === itemId ? { ...item, humanStatus } : item));
    try {
      const updated = await updateReviewItem(itemId, { humanStatus });
      setReviewItems((current) => current.map((item) => item.id === itemId ? { ...item, ...updated } : item));
    } catch (error) {
      setReviewError(`审阅状态保存失败：${error.message || "Persistence API request failed"}`);
    }
  };

  const normalizedWorkflowItems = normalizeWorkflowReviewItems(workflowReview?.changedFiles || []);
  const displayItems = reviewItems.length > 0 ? reviewItems : normalizedWorkflowItems;
  const reviewForAudit = useMemo(() => ({
    status: reviewItems.length > 0 ? summarizeHumanStatus(reviewItems) : workflowReview?.status || "not_generated",
    summary: reviewItems.length > 0
      ? (agentWorkflow.review?.summary || `${reviewItems.length} 个 review item 来自持久化 API。`)
      : normalizedWorkflowItems.length > 0
        ? workflowReview?.summary || `${normalizedWorkflowItems.length} 个 review item 来自 Agent dry-run。`
        : loadingReview
          ? "正在读取持久化 review items..."
          : emptyReviewSummary,
    changedFiles: displayItems.map(reviewItemToAuditFile),
    tests: buildTests(displayItems, workflowReview),
    manualConfirmations: buildConfirmations(displayItems, workflowReview)
  }), [agentWorkflow.review?.summary, displayItems, workflowReview, loadingReview, normalizedWorkflowItems.length, reviewItems]);

  const auditModel = useMemo(() => buildAuditModel(reviewForAudit, previewState.previewUrl), [reviewForAudit, previewState.previewUrl]);
  const [selectedFile, setSelectedFile] = useState(auditModel.selectedFile);

  useEffect(() => {
    if (!auditModel.changedFiles.some((file) => file.file === selectedFile)) {
      setSelectedFile(auditModel.selectedFile);
    }
  }, [auditModel.changedFiles, auditModel.selectedFile, selectedFile]);

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
      <section className="audit-preview-pane" aria-label="Conduit 页面预览">
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
      </section>

      <aside className="audit-side-panel" aria-label="审计说明">
        <header className="audit-side-heading">
          <div>
            <span>Agent dry-run audit</span>
            <h1>审计页面</h1>
            <p>{reviewForAudit.summary}</p>
          </div>
          <strong>{reviewForAudit.status}</strong>
        </header>
        {reviewError ? <p className="run-error-text" role="alert">{reviewError}</p> : null}

        <section className="audit-section audit-visible-change">
          <h2><ShieldCheck size={16} />用户可见变化</h2>
          <ul>
            {auditModel.visibleChanges.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>

        <section className="audit-section audit-file-section">
          <h2><FileCheck2 size={16} />变更文件</h2>
          <div className="audit-file-list">
            {auditModel.changedFiles.length ? auditModel.changedFiles.map((file) => (
              <div className="audit-file-card-shell" key={file.file}>
                <button
                  type="button"
                  className={`audit-file-card ${selectedFile === file.file ? "selected" : ""}`}
                  aria-pressed={selectedFile === file.file}
                  onClick={() => setSelectedFile(file.file)}
                >
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
                      onChange={(event) => handleHumanStatusChange(file.id, event.target.value)}
                    >
                      {Object.entries(humanStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                    </select>
                  </label>
                ) : null}
              </div>
            )) : <p className="audit-empty-state">暂无变更文件</p>}
          </div>
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
          <h2><TriangleAlert size={16} />需要人工确认</h2>
          <ul>{reviewForAudit.manualConfirmations.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>

        <button className="audit-pr-button" type="button" onClick={onOpenPr}>进入 PR 页面 <ArrowRight size={15} /></button>
      </aside>
    </main>
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
      <small>{[status, owner, actionRequired].filter(Boolean).join(" · ")}</small>
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
  if (items.every((item) => item.humanStatus === "approved")) return "approved";
  if (items.some((item) => item.humanStatus === "needs_change")) return "needs_change";
  if (items.some((item) => item.humanStatus === "blocked")) return "blocked";
  return "needs_review";
}

function buildTests(items, fallbackReview) {
  if (items.length === 0) return fallbackReview?.tests || [];
  return items.map((item, index) => ({ command: `review evidence ${index + 1}`, status: item.testStatus || "pending" }));
}

function buildConfirmations(items, fallbackReview) {
  if (items.length === 0) return fallbackReview?.manualConfirmations || ["请先生成 Agent dry-run 审计结果。"];
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
    visibleChanges: hasChangedFiles ? changedFiles.map((file) => file.changeSummary || file.requirementPoint || file.file) : ["暂无用户可见变更，等待 Agent dry-run 输出。"],
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
