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
bind("exportBtn", "recorder:export-json");
bind("resetBtn", "recorder:reset");

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
  els.statusBadge.textContent = state.status || "idle";
  els.statusBadge.classList.toggle("recording", state.status === "recording");
  els.nodeCount.textContent = state.nodeCount || 0;
  els.tabCount.textContent = state.tabCount || 0;
}
