import { ArrowRight, CheckCircle2, ExternalLink, FileCheck2, Monitor, RefreshCw, ShieldCheck, Smartphone, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPreviewStatus, startProjectPreview } from "../api/previewClient.js";
import { fallbackAgentReview } from "../data/agentWorkflowData.js";

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

const defaultAuditChangedFiles = [
  {
    file: "src/components/LoginForm.jsx",
    changeSummary: "审计登录表单的用户可见输入、提交与失败引导状态。",
    why: "登录失败引导需求的主要用户触点在登录表单。",
    risk: "表单状态和后端错误码不一致时，用户仍可能无法理解下一步。",
    requirementPoint: "Login failure guidance"
  },
  {
    file: "src/components/ErrorMessage.jsx",
    changeSummary: "审计错误提示文案是否清晰、可操作、不会泄露账号枚举信息。",
    why: "失败提示是本次需求最关键的可见结果。",
    risk: "文案过细可能泄露账号存在性，文案过粗会降低可操作性。",
    requirementPoint: "Visible failure guidance"
  },
  {
    file: "src/App.test.jsx",
    changeSummary: "审计登录失败引导是否有自动化测试覆盖。",
    why: "测试证据决定该变更是否能进入 PR。",
    risk: "测试夹具缺少真实应用上下文时，审计结论只能保持 needs_review。",
    requirementPoint: "Acceptance coverage"
  }
];

export default function ReviewCheckWorkbench({ activeProject, agentWorkflow, onOpenPr }) {
  const review = agentWorkflow.review || fallbackAgentReview;
  const [previewState, setPreviewState] = useState(initialPreviewState);
  const [viewport, setViewport] = useState("desktop");
  const [previewKey, setPreviewKey] = useState(0);
  const projectId = activeProject?.id || "active-project";
  const localPath = typeof activeProject?.localPath === "string" ? activeProject.localPath.trim() : "";
  const requestSequence = useRef(0);
  const auditModel = useMemo(() => buildAuditModel(review, previewState.previewUrl), [review, previewState.previewUrl]);
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
            <p>{review.summary}</p>
          </div>
          <strong>{review.status}</strong>
        </header>

        <section className="audit-section audit-visible-change">
          <h2><ShieldCheck size={16} />用户可见变化</h2>
          <ul>
            {auditModel.visibleChanges.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>

        <section className="audit-section audit-file-section">
          <h2><FileCheck2 size={16} />变更文件</h2>
          <div className="audit-file-list">
            {auditModel.changedFiles.map((file) => (
              <button
                key={file.file}
                type="button"
                className={`audit-file-card ${selectedFile === file.file ? "selected" : ""}`}
                aria-pressed={selectedFile === file.file}
                onClick={() => setSelectedFile(file.file)}
              >
                <strong>{file.file}</strong>
                <span>{file.changeSummary}</span>
                <small>{file.risk}</small>
              </button>
            ))}
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
          {review.tests.length ? review.tests.map((test) => (
            <p key={test.command}><code>{test.command}</code><span>{test.status}</span></p>
          )) : <p><code>npm test</code><span>pending</span></p>}
        </section>

        <section className="audit-section audit-risk-section">
          <h2><TriangleAlert size={16} />需要人工确认</h2>
          <ul>{review.manualConfirmations.map((item) => <li key={item}>{item}</li>)}</ul>
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

function buildAuditModel(review, previewUrl) {
  const changedFiles = Array.isArray(review.changedFiles) && review.changedFiles.length
    ? review.changedFiles
    : defaultAuditChangedFiles;
  return {
    changedFiles,
    previewUrl: previewUrl || "",
    previewTitle: DEFAULT_PREVIEW_TITLE,
    selectedFile: changedFiles[0]?.file || "src/components/LoginForm.jsx",
    visibleChanges: [
      "登录页作为本次审计的主预览面，重点检查失败引导是否清晰。",
      "表单提交、错误提示和测试补充被拆成独立证据项，方便逐项确认。",
      "当前仍保持 dry-run 边界，不执行真实仓库写入。"
    ],
    acceptanceMappings: changedFiles.map((file) => ({
      label: file.file,
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
