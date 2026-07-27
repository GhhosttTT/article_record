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
  resetBtn: document.getElementById("resetBtn")
};

bind("startBtn", "recorder:start");
bind("pauseBtn", "recorder:pause");
bind("resumeBtn", "recorder:resume");
bind("stopBtn", "recorder:stop");
bind("viewerBtn", "recorder:open-viewer");
bind("resetBtn", "recorder:reset");
els.exportBtn.addEventListener("click", exportJsonWithPrivacyConfirm);

refresh();

function bind(buttonKey, type) {
  els[buttonKey].addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type });
    if (response?.ok) render(response);
    if (type === "recorder:open-viewer" || type === "recorder:export-json") refresh();
  });
}

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "recorder:get-state" });
  render(state);
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
