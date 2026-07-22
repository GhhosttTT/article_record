const els = {
  status: document.getElementById("status"),
  nodeCount: document.getElementById("nodeCount"),
  tabCount: document.getElementById("tabCount"),
  flowMeta: document.getElementById("flowMeta"),
  steps: document.getElementById("steps"),
  exportBtn: document.getElementById("exportBtn"),
  articleBtn: document.getElementById("articleBtn"),
  timelineBtn: document.getElementById("timelineBtn")
};

let currentState = null;
let currentTabs = [];
let currentSteps = [];

els.exportBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "recorder:export-json" });
});

els.articleBtn.addEventListener("click", () => {
  if (!currentState) return;
  const html = renderArticleHtml(currentState, currentTabs, currentSteps);
  downloadTextFile(`sop-article-${currentState.session?.id || Date.now()}.html`, "text/html", html);
});

els.timelineBtn.addEventListener("click", () => {
  const timeline = buildVideoTimeline(currentSteps);
  downloadTextFile(`sop-video-timeline-${currentState?.session?.id || Date.now()}.json`, "application/json", JSON.stringify(timeline, null, 2));
});

load();

async function load() {
  const state = await chrome.runtime.sendMessage({ type: "recorder:get-full-state" });
  const nodes = state.nodes || [];
  const tabs = Object.values(state.tabContexts || {});
  const steps = buildArticleSteps(nodes);

  currentState = state;
  currentTabs = tabs;
  currentSteps = steps;

  els.status.textContent = state.status || "idle";
  els.nodeCount.textContent = nodes.length;
  els.tabCount.textContent = tabs.length;

  renderMeta(state.session, tabs);
  renderSteps(nodes);
}

function renderMeta(session, tabs) {
  els.flowMeta.innerHTML = `
    <h2>${escapeHtml(session?.id || "尚未录制")}</h2>
    <div class="tabs">
      ${tabs.map((tab) => `<span class="tab-pill">${escapeHtml(tab.tabAlias)} · ${escapeHtml(tab.domain || "unknown")}</span>`).join("") || "<span class=\"tab-pill\">暂无标签页</span>"}
    </div>
  `;
}

function renderSteps(nodes) {
  if (!nodes.length) {
    els.steps.innerHTML = `<div class="empty">暂无操作节点。点击插件图标开始录制。</div>`;
    return;
  }
  els.steps.innerHTML = nodes.map(renderStep).join("");
}

function renderStep(node) {
  const isTab = node.action?.startsWith("tab_");
  const title = isTab ? renderTabTitle(node) : renderOperationTitle(node);
  const description = node.generatedInstruction || "";
  return `
    <article class="step">
      <header class="step-header">
        <div>
          <h3>${escapeHtml(node.sequence || "-")}. ${escapeHtml(title)}</h3>
          <p>${escapeHtml(description)}</p>
          ${node.tab?.tabAlias ? `<p>${escapeHtml(node.tab.tabAlias)} · ${escapeHtml(node.tab.domain || "")}</p>` : ""}
        </div>
        <span class="step-kind ${isTab ? "tab" : ""}">${isTab ? "标签页切换" : escapeHtml(node.action || "operation")}</span>
      </header>
      ${renderScreenshot(node)}
    </article>
  `;
}

function renderOperationTitle(node) {
  return SopArtifactShared.operationTitle(node);
}

function renderTabTitle(node) {
  return SopArtifactShared.tabTitle(node);
}

function renderScreenshot(node) {
  const shot = node.screenshot;
  if (!shot?.dataUrl) return "";
  const box = node.target?.boundingBox;
  const viewportWidth = shot.viewportWidth || shot.width;
  const viewportHeight = shot.viewportHeight || shot.height;
  const focus = box && viewportWidth && viewportHeight
    ? {
        left: `${Math.max(0, (box.x - 12) / viewportWidth * 100)}%`,
        top: `${Math.max(0, (box.y - 12) / viewportHeight * 100)}%`,
        width: `${Math.max(48, box.width + 24) / viewportWidth * 100}%`,
        height: `${Math.max(32, box.height + 24) / viewportHeight * 100}%`
      }
    : null;
  return `
    <div class="screenshot-wrap">
      <img src="${shot.dataUrl}" alt="步骤截图">
      ${focus ? `<div class="focus-box" style="left:${focus.left};top:${focus.top};width:${focus.width};height:${focus.height}"></div>` : ""}
    </div>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
