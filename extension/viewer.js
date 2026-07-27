const els = {
  status: document.getElementById("status"),
  nodeCount: document.getElementById("nodeCount"),
  tabCount: document.getElementById("tabCount"),
  privacyAudit: document.getElementById("privacyAudit"),
  chapterList: document.getElementById("chapterList"),
  flowMeta: document.getElementById("flowMeta"),
  steps: document.getElementById("steps"),
  exportBtn: document.getElementById("exportBtn"),
  articleBtn: document.getElementById("articleBtn"),
  markdownBtn: document.getElementById("markdownBtn"),
  wordBtn: document.getElementById("wordBtn"),
  timelineBtn: document.getElementById("timelineBtn")
};

let currentState = null;
let currentTabs = [];
let currentSteps = [];

els.steps.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-node-action]");
  if (!button) return;

  const nodeId = button.dataset.nodeId;
  if (!nodeId) return;

  button.disabled = true;

  let state = null;
  if (button.dataset.nodeAction === "save-text") {
    const card = button.closest(".step");
    state = await chrome.runtime.sendMessage({
      type: "recorder:update-node-text",
      payload: {
        nodeId,
        title: card?.querySelector("[data-node-title]")?.value,
        description: card?.querySelector("[data-node-description]")?.value
      }
    });
  } else if (button.dataset.nodeAction === "clear-text") {
    state = await chrome.runtime.sendMessage({
      type: "recorder:update-node-text",
      payload: { nodeId, clear: true }
    });
  } else if (button.dataset.nodeAction === "save-focus") {
    const card = button.closest(".step");
    state = await chrome.runtime.sendMessage({
      type: "recorder:update-node-focus",
      payload: {
        nodeId,
        focusBox: {
          x: card?.querySelector("[data-focus-x]")?.value,
          y: card?.querySelector("[data-focus-y]")?.value,
          width: card?.querySelector("[data-focus-width]")?.value,
          height: card?.querySelector("[data-focus-height]")?.value
        }
      }
    });
  } else if (button.dataset.nodeAction === "clear-focus") {
    state = await chrome.runtime.sendMessage({
      type: "recorder:update-node-focus",
      payload: { nodeId, clear: true }
    });
  } else if (button.dataset.nodeAction === "save-duration") {
    const card = button.closest(".step");
    state = await chrome.runtime.sendMessage({
      type: "recorder:update-node-duration",
      payload: {
        nodeId,
        durationSeconds: Number(card?.querySelector("[data-node-duration]")?.value)
      }
    });
  } else if (button.dataset.nodeAction === "clear-duration") {
    state = await chrome.runtime.sendMessage({
      type: "recorder:update-node-duration",
      payload: { nodeId, clear: true }
    });
  } else if (button.dataset.nodeAction === "save-voiceover") {
    const card = button.closest(".step");
    state = await chrome.runtime.sendMessage({
      type: "recorder:update-node-voiceover",
      payload: {
        nodeId,
        voiceoverText: card?.querySelector("[data-node-voiceover]")?.value
      }
    });
  } else if (button.dataset.nodeAction === "clear-voiceover") {
    state = await chrome.runtime.sendMessage({
      type: "recorder:update-node-voiceover",
      payload: { nodeId, clear: true }
    });
  } else if (button.dataset.nodeAction === "save-mask") {
    const card = button.closest(".step");
    state = await chrome.runtime.sendMessage({
      type: "recorder:update-node-mask",
      payload: {
        nodeId,
        maskBox: {
          x: card?.querySelector("[data-mask-x]")?.value,
          y: card?.querySelector("[data-mask-y]")?.value,
          width: card?.querySelector("[data-mask-width]")?.value,
          height: card?.querySelector("[data-mask-height]")?.value
        }
      }
    });
  } else if (button.dataset.nodeAction === "clear-mask") {
    state = await chrome.runtime.sendMessage({
      type: "recorder:update-node-mask",
      payload: { nodeId, clear: true }
    });
  } else if (button.dataset.nodeAction === "move") {
    state = await chrome.runtime.sendMessage({
      type: "recorder:move-node",
      payload: {
        nodeId,
        direction: button.dataset.moveDirection
      }
    });
  } else if (button.dataset.nodeAction === "merge-next") {
    state = await chrome.runtime.sendMessage({
      type: "recorder:merge-node-next",
      payload: { nodeId }
    });
  } else if (button.dataset.nodeAction === "merge-form") {
    state = await chrome.runtime.sendMessage({
      type: "recorder:merge-form-fields",
      payload: { nodeId }
    });
  } else if (button.dataset.nodeAction === "split-merged") {
    state = await chrome.runtime.sendMessage({
      type: "recorder:split-merged-node",
      payload: { nodeId }
    });
  } else {
    const status = button.dataset.nodeStatus;
    if (!status) return;
    state = await chrome.runtime.sendMessage({
      type: "recorder:set-node-status",
      payload: { nodeId, status }
    });
  }

  if (state?.ok) applyState(state);
  else button.disabled = false;
});

els.exportBtn.addEventListener("click", () => {
  if (!confirmPrivacyBeforeExport("录制 JSON")) return;
  chrome.runtime.sendMessage({ type: "recorder:export-json" });
});

els.articleBtn.addEventListener("click", () => {
  if (!currentState) return;
  if (!confirmPrivacyBeforeExport("SOP 文章")) return;
  const exportSteps = buildPrivacySafeArticleSteps(currentSteps);
  const html = renderArticleHtml(currentState, currentTabs, exportSteps);
  downloadTextFile(`sop-article-${currentState.session?.id || Date.now()}.html`, "text/html", html);
});

els.markdownBtn.addEventListener("click", () => {
  if (!currentState) return;
  if (!confirmPrivacyBeforeExport("SOP Markdown")) return;
  const exportSteps = buildPrivacySafeArticleSteps(currentSteps);
  const markdown = renderArticleMarkdown(currentState, currentTabs, exportSteps);
  downloadTextFile(`sop-article-${currentState.session?.id || Date.now()}.md`, "text/markdown", markdown);
});

els.wordBtn.addEventListener("click", () => {
  if (!currentState) return;
  if (!confirmPrivacyBeforeExport("SOP Word")) return;
  const exportSteps = buildPrivacySafeArticleSteps(currentSteps);
  const word = renderArticleWordDocument(currentState, currentTabs, exportSteps);
  downloadTextFile(`sop-article-${currentState.session?.id || Date.now()}.doc`, "application/msword", word);
});

els.timelineBtn.addEventListener("click", () => {
  if (!confirmPrivacyBeforeExport("视频时间轴")) return;
  const exportSteps = buildPrivacySafeArticleSteps(currentSteps);
  const timeline = buildVideoTimeline(exportSteps);
  downloadTextFile(`sop-video-timeline-${currentState?.session?.id || Date.now()}.json`, "application/json", JSON.stringify(timeline, null, 2));
});

load();

async function load() {
  const state = await chrome.runtime.sendMessage({ type: "recorder:get-full-state" });
  applyState(state);
}

function applyState(state) {
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
  renderPrivacyAudit(steps);
  renderChapterList(steps);
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

function renderPrivacyAudit(steps) {
  const audit = getPrivacyAudit(steps);
  if (!audit.sensitiveCount) {
    els.privacyAudit.innerHTML = `
      <div class="privacy-card ok">
        <strong>隐私检查</strong>
        <span>未发现敏感步骤。</span>
      </div>
    `;
    return;
  }

  els.privacyAudit.innerHTML = `
    <div class="privacy-card warn">
      <strong>隐私检查</strong>
      <span>${audit.sensitiveCount} 个步骤含敏感信息，${audit.unmaskedCount} 个尚未手动打码。</span>
    </div>
  `;
}

function getPrivacyAudit(steps) {
  const sensitiveSteps = steps.filter((step) => step.privacyWarnings?.length);
  const unmaskedSteps = sensitiveSteps.filter((step) => !(step.privacyMaskBoxes || []).length);
  return {
    sensitiveCount: sensitiveSteps.length,
    unmaskedCount: unmaskedSteps.length
  };
}

function renderChapterList(steps) {
  const chapters = buildArticleChapters(steps);
  if (!chapters.length) {
    els.chapterList.innerHTML = `<p class="chapter-empty">暂无章节</p>`;
    return;
  }

  els.chapterList.innerHTML = chapters.map((chapter) => `
    <section class="chapter-group">
      <a class="chapter-link" href="#${escapeHtml(chapter.steps[0]?.nodeId || chapter.id)}">章节 ${chapter.sequence}：${escapeHtml(chapter.title)}</a>
      <div class="chapter-steps">
        ${chapter.steps.map((step) => `<a href="#${escapeHtml(step.nodeId)}">${step.sequence}. ${escapeHtml(step.title)}</a>`).join("")}
      </div>
    </section>
  `).join("");
}

function confirmPrivacyBeforeExport(exportName) {
  const audit = getPrivacyAudit(currentSteps);
  if (!audit.sensitiveCount) return true;

  const message = audit.unmaskedCount
    ? `将导出${exportName}。\n\n检测到 ${audit.sensitiveCount} 个步骤含敏感信息，其中 ${audit.unmaskedCount} 个步骤尚未手动打码。请确认截图中没有泄露隐私信息。\n\n仍要继续导出吗？`
    : `将导出${exportName}。\n\n检测到 ${audit.sensitiveCount} 个步骤含敏感信息，且都已设置手动打码。仍建议确认截图遮挡正确。\n\n继续导出吗？`;
  return window.confirm(message);
}

function renderSteps(nodes) {
  if (!nodes.length) {
    els.steps.innerHTML = `<div class="empty">暂无操作节点。点击插件图标开始录制。</div>`;
    return;
  }
  els.steps.innerHTML = nodes.map((node, index) => renderStep(node, index, nodes)).join("");
}

function renderStep(node, index, nodes) {
  const stepType = SopArtifactShared.articleStepType(node);
  const isTransition = stepType === "tab_transition" || stepType === "navigation";
  const title = node.titleOverride || (isTransition ? renderTransitionTitle(node) : renderOperationTitle(node));
  const description = node.descriptionOverride || node.generatedInstruction || "";
  const voiceoverText = node.voiceoverText || description;
  const durationSeconds = node.durationOverrideSeconds || getDefaultDurationSeconds(description, stepType);
  const focusBox = getNodeFocusBox(node);
  const maskBox = getNodeMaskBox(node, focusBox);
  const isDiscarded = node.status === "discarded";
  const isReviewed = node.status === "reviewed";
  const isMerged = Boolean(node.mergedNodeIds?.length);
  const hasNextActive = nodes.slice(index + 1).some((item) => item.status !== "discarded");
  const canMergeForm = canMergeFormFields(node, nodes.slice(index + 1));
  return `
    <article id="${escapeHtml(node.id)}" class="step ${isDiscarded ? "discarded" : ""}" data-node-id="${escapeHtml(node.id)}">
      <header class="step-header">
        <div>
          <h3>${escapeHtml(node.sequence || "-")}. ${escapeHtml(title)}</h3>
          <p>${escapeHtml(description)}</p>
          ${node.tab?.tabAlias ? `<p>${escapeHtml(node.tab.tabAlias)} · ${escapeHtml(node.tab.domain || "")}</p>` : ""}
        </div>
        <div class="step-side">
          <span class="step-kind ${isTransition ? "tab" : ""}">${escapeHtml(stepKindText(stepType, node.action))}</span>
          <span class="step-status">${statusText(node.status)}</span>
          <div class="step-actions">
            <button type="button" class="small secondary" data-node-action="move" data-node-id="${escapeHtml(node.id)}" data-move-direction="up" ${index === 0 ? "disabled" : ""}>上移</button>
            <button type="button" class="small secondary" data-node-action="move" data-node-id="${escapeHtml(node.id)}" data-move-direction="down" ${index === nodes.length - 1 ? "disabled" : ""}>下移</button>
            <button type="button" class="small secondary" data-node-action="merge-next" data-node-id="${escapeHtml(node.id)}" ${isDiscarded || !hasNextActive ? "disabled" : ""}>合并下步</button>
            <button type="button" class="small secondary" data-node-action="merge-form" data-node-id="${escapeHtml(node.id)}" ${isDiscarded || !canMergeForm ? "disabled" : ""}>合并表单字段</button>
            <button type="button" class="small secondary" data-node-action="split-merged" data-node-id="${escapeHtml(node.id)}" ${isDiscarded || !isMerged ? "disabled" : ""}>拆分合并</button>
            <button type="button" class="small secondary" data-node-action="status" data-node-id="${escapeHtml(node.id)}" data-node-status="reviewed" ${isReviewed || isDiscarded ? "disabled" : ""}>确认</button>
            <button type="button" class="small secondary" data-node-action="status" data-node-id="${escapeHtml(node.id)}" data-node-status="${isDiscarded ? "auto_generated" : "discarded"}">${isDiscarded ? "恢复" : "删除"}</button>
          </div>
        </div>
      </header>
      <section class="step-editor">
        <label>
          <span>步骤标题</span>
          <input data-node-title value="${escapeHtml(title)}" ${isDiscarded ? "disabled" : ""}>
        </label>
        <label>
          <span>步骤说明</span>
          <textarea data-node-description rows="3" ${isDiscarded ? "disabled" : ""}>${escapeHtml(description)}</textarea>
        </label>
        <div class="editor-actions">
          <button type="button" class="small" data-node-action="save-text" data-node-id="${escapeHtml(node.id)}" ${isDiscarded ? "disabled" : ""}>保存文案</button>
          <button type="button" class="small secondary" data-node-action="clear-text" data-node-id="${escapeHtml(node.id)}" ${isDiscarded || (!node.titleOverride && !node.descriptionOverride) ? "disabled" : ""}>恢复自动</button>
        </div>
        <div class="duration-editor">
          <label>
            <span>视频时长（秒）</span>
            <input type="number" min="1" max="120" step="0.5" data-node-duration value="${escapeHtml(durationSeconds)}" ${isDiscarded ? "disabled" : ""}>
          </label>
          <div class="inline-actions">
            <button type="button" class="small" data-node-action="save-duration" data-node-id="${escapeHtml(node.id)}" ${isDiscarded ? "disabled" : ""}>保存时长</button>
            <button type="button" class="small secondary" data-node-action="clear-duration" data-node-id="${escapeHtml(node.id)}" ${isDiscarded || !node.durationOverrideSeconds ? "disabled" : ""}>恢复自动</button>
          </div>
        </div>
        <div class="voiceover-editor">
          <label>
            <span>视频旁白</span>
            <textarea data-node-voiceover rows="2" maxlength="500" ${isDiscarded ? "disabled" : ""}>${escapeHtml(voiceoverText)}</textarea>
          </label>
          <div class="inline-actions">
            <button type="button" class="small" data-node-action="save-voiceover" data-node-id="${escapeHtml(node.id)}" ${isDiscarded ? "disabled" : ""}>保存旁白</button>
            <button type="button" class="small secondary" data-node-action="clear-voiceover" data-node-id="${escapeHtml(node.id)}" ${isDiscarded || !node.voiceoverTextOverridden ? "disabled" : ""}>恢复自动</button>
          </div>
        </div>
        ${focusBox ? renderFocusEditor(node, focusBox, isDiscarded) : ""}
        ${maskBox ? renderMaskEditor(node, maskBox, isDiscarded) : ""}
      </section>
      ${renderScreenshot(node)}
    </article>
  `;
}

function renderFocusEditor(node, box, isDiscarded) {
  return `
    <div class="focus-editor">
      <span>高亮区域</span>
      <div class="focus-grid">
        <label>X <input type="number" min="0" step="1" data-focus-x value="${escapeHtml(box.x)}" ${isDiscarded ? "disabled" : ""}></label>
        <label>Y <input type="number" min="0" step="1" data-focus-y value="${escapeHtml(box.y)}" ${isDiscarded ? "disabled" : ""}></label>
        <label>宽 <input type="number" min="1" step="1" data-focus-width value="${escapeHtml(box.width)}" ${isDiscarded ? "disabled" : ""}></label>
        <label>高 <input type="number" min="1" step="1" data-focus-height value="${escapeHtml(box.height)}" ${isDiscarded ? "disabled" : ""}></label>
      </div>
      <div class="editor-actions">
        <button type="button" class="small" data-node-action="save-focus" data-node-id="${escapeHtml(node.id)}" ${isDiscarded ? "disabled" : ""}>保存高亮</button>
        <button type="button" class="small secondary" data-node-action="clear-focus" data-node-id="${escapeHtml(node.id)}" ${isDiscarded || !node.focusBoxOverride ? "disabled" : ""}>恢复自动</button>
      </div>
    </div>
  `;
}

function renderMaskEditor(node, box, isDiscarded) {
  return `
    <div class="mask-editor">
      <span>打码区域</span>
      <div class="focus-grid">
        <label>X <input type="number" min="0" step="1" data-mask-x value="${escapeHtml(box.x)}" ${isDiscarded ? "disabled" : ""}></label>
        <label>Y <input type="number" min="0" step="1" data-mask-y value="${escapeHtml(box.y)}" ${isDiscarded ? "disabled" : ""}></label>
        <label>宽 <input type="number" min="1" step="1" data-mask-width value="${escapeHtml(box.width)}" ${isDiscarded ? "disabled" : ""}></label>
        <label>高 <input type="number" min="1" step="1" data-mask-height value="${escapeHtml(box.height)}" ${isDiscarded ? "disabled" : ""}></label>
      </div>
      <div class="editor-actions">
        <button type="button" class="small" data-node-action="save-mask" data-node-id="${escapeHtml(node.id)}" ${isDiscarded ? "disabled" : ""}>保存打码</button>
        <button type="button" class="small secondary" data-node-action="clear-mask" data-node-id="${escapeHtml(node.id)}" ${isDiscarded || !node.privacyMaskBoxes?.length ? "disabled" : ""}>清除打码</button>
      </div>
    </div>
  `;
}

function statusText(status) {
  if (status === "reviewed") return "已确认";
  if (status === "discarded") return "已删除，不参与导出";
  return "待确认";
}

function renderOperationTitle(node) {
  return SopArtifactShared.operationTitle(node);
}

function renderTransitionTitle(node) {
  return SopArtifactShared.transitionTitle(node);
}

function stepKindText(stepType, action) {
  if (stepType === "tab_transition") return "标签页切换";
  if (stepType === "navigation") return "页面跳转";
  if (action === "modal_open") return "弹窗出现";
  if (action === "modal_close") return "弹窗关闭";
  return action || "operation";
}

function getDefaultDurationSeconds(description, stepType) {
  if (stepType === "tab_transition" || stepType === "navigation") return 2;
  return Math.max(3, Math.ceil([...String(description || "")].length / 8));
}

function renderScreenshot(node) {
  const shot = node.screenshot;
  if (!shot?.dataUrl) return "";
  const box = getNodeFocusBox(node);
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
      ${renderMaskBoxes(node.privacyMaskBoxes || [], viewportWidth, viewportHeight)}
    </div>
  `;
}

function getNodeFocusBox(node) {
  if (node.focusBoxOverride) return node.focusBoxOverride;
  if (node.target?.visibility?.canHighlight === false) return null;
  return node.target?.boundingBox || null;
}

function canMergeFormFields(node, laterNodes) {
  const formSelector = node.target?.form?.selector;
  if (!formSelector || !["input", "select", "check", "upload"].includes(node.action)) return false;
  const nextActive = laterNodes.find((item) => item.status !== "discarded");
  return Boolean(
    nextActive &&
    ["input", "select", "check", "upload"].includes(nextActive.action) &&
    nextActive.tab?.tabId === node.tab?.tabId &&
    nextActive.target?.form?.selector === formSelector
  );
}

function getNodeMaskBox(node, fallbackBox) {
  if (node.privacyMaskBoxes?.[0]) return node.privacyMaskBoxes[0];
  return fallbackBox;
}

function renderMaskBoxes(boxes, viewportWidth, viewportHeight) {
  if (!viewportWidth || !viewportHeight) return "";
  return boxes.map((box) => {
    const mask = {
      left: `${Math.max(0, box.x / viewportWidth * 100)}%`,
      top: `${Math.max(0, box.y / viewportHeight * 100)}%`,
      width: `${Math.max(1, box.width) / viewportWidth * 100}%`,
      height: `${Math.max(1, box.height) / viewportHeight * 100}%`
    };
    return `<div class="mask-box" style="left:${mask.left};top:${mask.top};width:${mask.width};height:${mask.height}"></div>`;
  }).join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
