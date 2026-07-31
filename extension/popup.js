const els = {
  statusBadge: document.getElementById("statusBadge"),
  nodeCount: document.getElementById("nodeCount"),
  tabCount: document.getElementById("tabCount"),
  startBtn: document.getElementById("startBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  resumeBtn: document.getElementById("resumeBtn"),
  stopBtn: document.getElementById("stopBtn"),
  viewerBtn: document.getElementById("viewerBtn"),
  exportBtn: document.getElementById("exportBtn"),
  resetBtn: document.getElementById("resetBtn"),
  historyList: document.getElementById("historyList")
};

bind("startBtn", "recorder:start");
bind("pauseBtn", "recorder:pause");
bind("resumeBtn", "recorder:resume");
bind("stopBtn", "recorder:stop");
bind("viewerBtn", "recorder:open-viewer");
bind("resetBtn", "recorder:reset");
els.exportBtn.addEventListener("click", exportJsonWithPrivacyConfirm);

els.historyList?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-history-action]");
  if (!button) return;
  const id = button.dataset.historyId;
  if (!id) return;

  button.disabled = true;
  if (button.dataset.historyAction === "open") {
    const response = await chrome.runtime.sendMessage({ type: "recorder:open-recording", payload: { id } });
    if (response?.ok) {
      await chrome.runtime.sendMessage({ type: "recorder:open-viewer" });
      window.close();
      return;
    }
    window.alert(response?.error || "打开历史 SOP 失败");
    button.disabled = false;
    return;
  }

  if (button.dataset.historyAction === "delete") {
    if (!window.confirm("删除这篇历史 SOP？")) {
      button.disabled = false;
      return;
    }
    const response = await chrome.runtime.sendMessage({ type: "recorder:delete-recording", payload: { id } });
    if (response?.ok) renderHistory(response.recordings || []);
    else button.disabled = false;
  }
});

refresh();

function bind(buttonKey, type) {
  els[buttonKey].addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type });
    if (response?.ok) {
      render(response);
      if (type === "recorder:stop") await refresh();
    }
    if (type === "recorder:open-viewer" || type === "recorder:export-json") refresh();
  });
}

async function refresh() {
  const [state, history] = await Promise.all([
    chrome.runtime.sendMessage({ type: "recorder:get-state" }),
    chrome.runtime.sendMessage({ type: "recorder:list-recordings" })
  ]);
  render(state);
  renderHistory(history?.recordings || []);
}

function render(state) {
  const status = state.status || "idle";
  els.statusBadge.textContent = status;
  els.statusBadge.classList.toggle("recording", status === "recording");
  els.statusBadge.classList.toggle("paused", status === "paused");
  els.nodeCount.textContent = state.nodeCount || 0;
  els.tabCount.textContent = state.tabCount || 0;

  const isRecording = status === "recording";
  const isPaused = status === "paused";
  const hasSession = Boolean(state.session);
  els.startBtn.disabled = isRecording || isPaused;
  els.pauseBtn.disabled = !isRecording;
  els.resumeBtn.disabled = !isPaused;
  els.stopBtn.disabled = !(isRecording || isPaused);
  els.viewerBtn.disabled = !hasSession;
  els.exportBtn.disabled = !hasSession;
  els.resetBtn.disabled = !hasSession;
}

function renderHistory(recordings) {
  if (!els.historyList) return;
  if (!recordings.length) {
    els.historyList.innerHTML = "<p class=\"empty-history\">暂无历史文章</p>";
    return;
  }

  els.historyList.innerHTML = recordings.map((recording) => `
    <article class="history-item">
      <button type="button" class="history-open" data-history-action="open" data-history-id="${escapeHtml(recording.id)}">
        <span class="history-title">${escapeHtml(recording.title || recording.id)}</span>
        <span class="history-time">${escapeHtml(formatTime(recording.updatedAt || recording.endedAt || recording.startedAt))}</span>
        <span class="history-meta">${escapeHtml(recording.status || "已保存")} · ${Number(recording.nodeCount || 0)} 节点 · ${Number(recording.tabCount || 0)} 标签页</span>
      </button>
      <button type="button" class="history-delete" data-history-action="delete" data-history-id="${escapeHtml(recording.id)}" title="删除">删除</button>
    </article>
  `).join("");
}

function formatTime(value) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function exportJsonWithPrivacyConfirm() {
  const audit = await chrome.runtime.sendMessage({ type: "recorder:get-privacy-audit" });
  if (!confirmPrivacyBeforeExport(audit, "录制 JSON")) return;

  const response = await chrome.runtime.sendMessage({ type: "recorder:export-json" });
  if (response?.ok) refresh();
}

function confirmPrivacyBeforeExport(audit = {}, exportName) {
  if (!audit.sensitiveCount) return true;

  const message = audit.unmaskedCount
    ? `将导出${exportName}。\n\n检测到 ${audit.sensitiveCount} 个步骤含敏感信息，其中 ${audit.unmaskedCount} 个步骤尚未手动打码。录制 JSON 会移除敏感步骤原始截图，但仍建议先打开预览确认内容。\n\n仍要继续导出吗？`
    : `将导出${exportName}。\n\n检测到 ${audit.sensitiveCount} 个步骤含敏感信息，录制 JSON 会移除敏感步骤原始截图。仍建议先打开预览确认截图遮挡正确。\n\n继续导出吗？`;
  return window.confirm(message);
}
