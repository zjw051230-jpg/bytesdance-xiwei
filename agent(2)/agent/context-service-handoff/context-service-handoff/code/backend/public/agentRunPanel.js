(function attachAgentRunPanel(global) {
  function buildAgentRunPayload(formValues) {
    const payload = {
      task: String(formValues.task || "").trim(),
      mode: formValues.mode === "dry_run" ? "dry_run" : "preview",
    };
    const repoPath = String(formValues.repoPath || "").trim();
    const skill = String(formValues.skill || "").trim();
    if (repoPath) payload.repoPath = repoPath;
    if (skill) payload.skill = skill;
    return payload;
  }

  function formatJson(value) {
    return JSON.stringify(value || {}, null, 2);
  }

  function section(title, value) {
    return `
      <article class="result-section">
        <h2 class="section-title">${escapeHtml(title)}</h2>
        <pre>${escapeHtml(formatJson(value))}</pre>
      </article>
    `;
  }

  function metric(label, value) {
    return `
      <div class="metric">
        <div class="metric-label">${escapeHtml(label)}</div>
        <div class="metric-value">${escapeHtml(value == null || value === "" ? "None" : String(value))}</div>
      </div>
    `;
  }

  function renderAgentResult(apiResponse) {
    const result = apiResponse && apiResponse.result ? apiResponse.result : {};
    const error = apiResponse && apiResponse.error ? apiResponse.error : null;
    const stderr = apiResponse && apiResponse.stderr ? apiResponse.stderr : "";
    return `
      <div class="summary-row">
        ${metric("Status", result.status)}
        ${metric("Task", result.task_name)}
        ${metric("Steps", result.steps)}
        ${metric("Events", result.events_count)}
      </div>
      ${section("Selected Actions", result.selected_actions)}
      ${section("Located Files", result.located_files)}
      ${section("Patch Plan", result.patch_plan)}
      ${section("Review Result", result.review_result)}
      ${section("Execution Result", result.execution_result)}
      ${section("Verification Result", result.verification_result)}
      ${section("Risks", result.risks)}
      ${error ? section("Error", error) : ""}
      ${stderr ? section("stderr", stderr) : ""}
    `;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function postAgentRun(payload, fetchImpl) {
    const response = await fetchImpl("/api/agent/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.json();
  }

  function initAgentRunPanel(documentRef, fetchImpl) {
    const form = documentRef.getElementById("agent-run-form");
    if (!form) return;

    const status = documentRef.getElementById("agent-run-status");
    const button = documentRef.getElementById("agent-run-button");
    const empty = documentRef.getElementById("agent-empty-state");
    const errorBox = documentRef.getElementById("agent-error");
    const resultBox = documentRef.getElementById("agent-result");

    function setStatus(label, className) {
      status.textContent = label;
      status.className = `status-pill ${className}`;
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = buildAgentRunPayload({
        task: documentRef.getElementById("agent-task").value,
        repoPath: documentRef.getElementById("agent-repo-path").value,
        skill: documentRef.getElementById("agent-skill").value,
        mode: documentRef.getElementById("agent-mode").value,
      });

      if (!payload.task) {
        empty.hidden = true;
        resultBox.hidden = true;
        errorBox.hidden = false;
        errorBox.textContent = "Task is required.";
        setStatus("Error", "error");
        return;
      }

      button.disabled = true;
      empty.hidden = true;
      errorBox.hidden = true;
      resultBox.hidden = true;
      resultBox.innerHTML = "";
      setStatus("Running", "loading");

      try {
        const apiResponse = await postAgentRun(payload, fetchImpl);
        resultBox.innerHTML = renderAgentResult(apiResponse);
        resultBox.hidden = false;
        if (apiResponse.ok) {
          setStatus("Done", "success");
        } else {
          setStatus("Error", "error");
        }
      } catch (error) {
        errorBox.hidden = false;
        errorBox.textContent = error && error.message ? error.message : "Request failed.";
        setStatus("Error", "error");
      } finally {
        button.disabled = false;
      }
    });
  }

  const api = {
    buildAgentRunPayload,
    escapeHtml,
    initAgentRunPanel,
    postAgentRun,
    renderAgentResult,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.AgentRunPanel = api;
    global.addEventListener("DOMContentLoaded", () => {
      initAgentRunPanel(global.document, global.fetch.bind(global));
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
