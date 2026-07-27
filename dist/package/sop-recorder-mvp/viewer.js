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
  timelineBtn: document.getElementById("timelineBtn"),
  videoBtn: document.getElementById("videoBtn"),
  articleTitleInput: document.getElementById("articleTitleInput"),
  privacyMaskToggle: document.getElementById("privacyMaskToggle")
};

let currentState = null;
let currentTabs = [];
let currentSteps = [];

els.privacyMaskToggle?.addEventListener("change", () => {
  if (currentState) applyState(currentState, { preserveTitle: true });
});

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
  const options = getExportOptions();
  const exportSteps = buildPrivacySafeArticleSteps(currentSteps, options);
  const html = renderArticleHtml(currentState, currentTabs, exportSteps, options);
  downloadTextFile(`sop-article-${currentState.session?.id || Date.now()}.html`, "text/html", html);
});

els.markdownBtn.addEventListener("click", () => {
  if (!currentState) return;
  if (!confirmPrivacyBeforeExport("SOP Markdown")) return;
  const options = getExportOptions();
  const exportSteps = buildPrivacySafeArticleSteps(currentSteps, options);
  const markdown = renderArticleMarkdown(currentState, currentTabs, exportSteps, options);
  downloadTextFile(`sop-article-${currentState.session?.id || Date.now()}.md`, "text/markdown", markdown);
});

els.wordBtn.addEventListener("click", () => {
  if (!currentState) return;
  if (!confirmPrivacyBeforeExport("SOP Word")) return;
  const options = getExportOptions();
  const exportSteps = buildPrivacySafeArticleSteps(currentSteps, options);
  const word = renderArticleWordDocument(currentState, currentTabs, exportSteps, options);
  downloadTextFile(`sop-article-${currentState.session?.id || Date.now()}.doc`, "application/msword", word);
});

els.timelineBtn.addEventListener("click", () => {
  if (!confirmPrivacyBeforeExport("视频时间轴")) return;
  const options = getExportOptions();
  const exportSteps = buildPrivacySafeArticleSteps(currentSteps, options);
  const timeline = buildVideoTimeline(exportSteps);
  downloadTextFile(`sop-video-timeline-${currentState?.session?.id || Date.now()}.json`, "application/json", JSON.stringify(timeline, null, 2));
});

els.videoBtn.addEventListener("click", async () => {
  if (!currentState) return;
  if (!confirmPrivacyBeforeExport("视频 WebM")) return;
  if (!window.MediaRecorder) {
    alert("当前浏览器不支持直接生成视频，请导出视频时间轴后使用离线工具生成 MP4。");
    return;
  }

  const originalText = els.videoBtn.textContent;
  els.videoBtn.disabled = true;
  els.videoBtn.textContent = "生成视频中...";
  try {
    const options = getExportOptions();
    const exportSteps = buildPrivacySafeArticleSteps(currentSteps, options);
    const timeline = buildVideoTimeline(exportSteps);
    const blob = await renderTimelineWebm(timeline);
    await downloadBlobFile(`sop-video-${currentState?.session?.id || Date.now()}.webm`, blob);
  } catch (error) {
    console.error(error);
    alert(`视频生成失败：${error?.message || error}`);
  } finally {
    els.videoBtn.disabled = false;
    els.videoBtn.textContent = originalText;
  }
});

load();

async function load() {
  const state = await chrome.runtime.sendMessage({ type: "recorder:get-full-state" });
  applyState(state);
}

function applyState(state, options = {}) {
  const nodes = state.nodes || [];
  const tabs = Object.values(state.tabContexts || {});
  const exportOptions = getExportOptions();
  const steps = buildArticleSteps(nodes, exportOptions);

  currentState = state;
  currentTabs = tabs;
  currentSteps = steps;

  if (!options.preserveTitle && els.articleTitleInput && !els.articleTitleInput.value) {
    els.articleTitleInput.value = defaultArticleTitle(state, tabs);
  }

  els.status.textContent = state.status || "idle";
  els.nodeCount.textContent = nodes.length;
  els.tabCount.textContent = tabs.length;

  renderMeta(state.session, tabs);
  renderPrivacyAudit(steps);
  renderChapterList(steps);
  renderSteps(nodes);
}

function getExportOptions() {
  return {
    title: els.articleTitleInput?.value || "",
    privacyMaskingEnabled: els.privacyMaskToggle?.checked !== false
  };
}

function defaultArticleTitle(state, tabs) {
  const explicit = state?.session?.title || state?.session?.name;
  if (explicit) return explicit;
  const firstTab = (tabs || []).find((tab) => tab.title || tab.domain);
  if (firstTab) return `${firstTab.title || firstTab.domain} 操作步骤`;
  return state?.session?.id || "SOP 操作手册";
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

function downloadBlobFile(filename, blob) {
  const url = URL.createObjectURL(blob);
  return Promise.resolve(chrome.downloads.download({ url, filename, saveAs: true }))
    .catch(() => {
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
    })
    .finally(() => {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
}

async function renderTimelineWebm(timeline) {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  const fps = 12;
  const mimeType = pickVideoMimeType();
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data?.size) chunks.push(event.data);
  });

  const stopped = new Promise((resolve, reject) => {
    recorder.addEventListener("stop", resolve, { once: true });
    recorder.addEventListener("error", () => reject(recorder.error), { once: true });
  });

  recorder.start(1000);
  for (const segment of timeline.segments || []) {
    await renderSegmentFrames(ctx, stream, segment, fps);
  }
  recorder.stop();
  await stopped;
  stream.getTracks().forEach((track) => track.stop());
  if (!chunks.length) throw new Error("浏览器没有生成视频数据，请改用导出视频时间轴后离线生成 MP4。");
  return new Blob(chunks, { type: mimeType || "video/webm" });
}

async function renderSegmentFrames(ctx, stream, segment, fps) {
  const durationMs = Math.max(500, ((segment.endTime || 0) - (segment.startTime || 0)) * 1000);
  const frameCount = Math.max(1, Math.ceil(durationMs / (1000 / fps)));
  for (let index = 0; index < frameCount; index += 1) {
    await drawVideoFrame(ctx, segment);
    stream.getVideoTracks?.()[0]?.requestFrame?.();
    await wait(1000 / fps);
  }
}

function pickVideoMimeType() {
  return [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm"
  ].find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function drawVideoFrame(ctx, segment) {
  ctx.fillStyle = "#111827";
  ctx.fillRect(0, 0, 1280, 720);
  if (segment.visual) {
    await drawScreenshotFrame(ctx, segment);
  } else if (segment.type === "tab_transition") {
    drawTabTransitionFrame(ctx, segment);
  } else if (segment.type === "navigation") {
    drawNavigationFrame(ctx, segment);
  } else {
    drawBlankStepFrame(ctx, segment);
  }
  drawTypeBadge(ctx, segment);
  if (segment.key) drawKeyBadge(ctx, segment.key);
  drawSubtitle(ctx, segment);
}

async function drawScreenshotFrame(ctx, segment) {
  const sourceWidth = segment.screenshot?.viewportWidth || segment.screenshot?.width || 1280;
  const sourceHeight = segment.screenshot?.viewportHeight || segment.screenshot?.height || 720;
  const frame = fitVideoRect(sourceWidth, sourceHeight, { x: 32, y: 24, width: 1216, height: 548 });
  const image = await loadCanvasImage(segment.visual);
  roundRect(ctx, frame.x - 4, frame.y - 4, frame.width + 8, frame.height + 8, 18, "#e2e8f0");
  ctx.drawImage(image, frame.x, frame.y, frame.width, frame.height);
  drawOverlayBox(ctx, segment.highlight, frame, "#f18a2a", null, 6);
  (segment.privacyMaskBoxes || []).forEach((box) => drawOverlayBox(ctx, box, frame, "#111827", "#111827", 0));
  drawFocusZoom(ctx, image, segment, frame);
  if (segment.privacyMaskBoxes?.length) {
    roundRect(ctx, frame.x + frame.width - 118, frame.y + 12, 104, 34, 17, "rgba(17,24,39,.9)");
    drawText(ctx, "已打码", frame.x + frame.width - 66, frame.y + 35, 17, "#fff", "800", "center");
  }
}

function drawBlankStepFrame(ctx, segment) {
  const label = segment.pageTitle || segment.currentTabAlias || "此步骤没有可用截图";
  roundRect(ctx, 32, 24, 1216, 548, 18, "#f8fafc");
  roundRect(ctx, 64, 58, 1152, 72, 14, "#fff", "#dce3ea", 1);
  drawText(ctx, label, 640, 104, 24, "#475569", "800", "center");
  drawText(ctx, "暂无截图", 640, 310, 32, "#18212b", "900", "center");
  drawText(ctx, "请根据底部字幕完成该步骤", 640, 354, 22, "#66717d", "400", "center");
}

function drawTabTransitionFrame(ctx, segment) {
  roundRect(ctx, 78, 196, 500, 176, 18, "#f8fafc");
  roundRect(ctx, 110, 226, 438, 36, 18, "#dbeafe");
  roundRect(ctx, 110, 292, 360, 30, 8, "#cbd5e1");
  drawText(ctx, segment.fromTabAlias || "当前标签页", 328, 424, 26, "#e2e8f0", "900", "center");
  drawArrow(ctx, 620, 304, 740, 304, "#f97316");
  roundRect(ctx, 792, 176, 410, 216, 18, "#fff7ed", "#fed7aa", 4);
  roundRect(ctx, 824, 208, 346, 42, 21, "#fdba74");
  roundRect(ctx, 824, 284, 286, 30, 8, "#fed7aa");
  drawText(ctx, segment.toTabAlias || "目标标签页", 997, 444, 28, "#fed7aa", "900", "center");
}

function drawNavigationFrame(ctx, segment) {
  roundRect(ctx, 70, 172, 500, 234, 18, "#f8fafc");
  roundRect(ctx, 106, 214, 428, 42, 12, "#dbeafe");
  roundRect(ctx, 106, 286, 336, 30, 8, "#cbd5e1");
  drawText(ctx, trimMiddle(segment.fromUrl || "当前页面", 42), 320, 458, 22, "#cbd5e1", "800", "center");
  drawArrow(ctx, 620, 296, 740, 296, "#22c55e");
  roundRect(ctx, 792, 148, 418, 282, 18, "#f0fdf4", "#86efac", 4);
  roundRect(ctx, 828, 190, 346, 48, 14, "#bbf7d0");
  roundRect(ctx, 828, 274, 310, 30, 8, "#dcfce7");
  drawText(ctx, trimMiddle(segment.toUrl || segment.pageUrl || "目标页面", 42), 1001, 464, 24, "#bbf7d0", "900", "center");
}

function drawTypeBadge(ctx, segment) {
  const isTab = segment.type === "tab_transition";
  const isNavigation = segment.type === "navigation";
  const isChapter = segment.type === "chapter_intro";
  const title = isChapter ? "章节" : isTab ? "标签页切换" : isNavigation ? "页面跳转" : "操作步骤";
  const badgeColor = isChapter ? "#eef2ff" : isTab ? "#fff1e4" : isNavigation ? "#edf7ee" : "#e8f2fa";
  const badgeText = isChapter ? "#354a9f" : isTab ? "#a65016" : isNavigation ? "#226438" : "#145985";
  const width = Math.max(128, [...title].length * 24 + 38);
  roundRect(ctx, 34, 28, width, 42, 21, badgeColor);
  drawText(ctx, title, 34 + width / 2, 56, 20, badgeText, "800", "center");
}

function drawKeyBadge(ctx, key) {
  roundRect(ctx, 196, 28, 150, 42, 21, "#f4f1ff");
  drawText(ctx, `按键：${key}`, 271, 56, 20, "#5b21b6", "800", "center");
}

function drawSubtitle(ctx, segment) {
  ctx.fillStyle = "rgba(17,24,39,.88)";
  ctx.fillRect(0, 586, 1280, 134);
  const lines = wrapCanvasText(segment.caption || "", 30, 2);
  const firstY = lines.length > 1 ? 626 : 648;
  lines.forEach((line, index) => drawText(ctx, line, 640, firstY + index * 38, 32, "#fff", "800", "center"));
  const context = videoSubtitleContext(segment);
  if (context) drawText(ctx, context, 640, 704, 20, "#cbd5e1", "400", "center");
}

function videoSubtitleContext(segment) {
  if (segment.fromTabAlias || segment.toTabAlias) return [segment.fromTabAlias, segment.toTabAlias].filter(Boolean).join(" -> ");
  if (segment.type === "navigation") return trimMiddle(segment.toUrl || segment.pageUrl || "", 60);
  if (segment.type === "chapter_intro") return segment.currentTabAlias || "";
  return "";
}

function drawFocusZoom(ctx, image, segment, frame) {
  const box = segment.highlight;
  if (!box || !Number.isFinite(box.x)) return;
  const zoom = focusZoomFrameRect(box, frame);
  const scale = frame.width / frame.sourceWidth * 2.35;
  const imageWidth = frame.sourceWidth * scale;
  const imageHeight = frame.sourceHeight * scale;
  const imageX = zoom.x + zoom.width / 2 - (box.x + box.width / 2) * scale;
  const imageY = zoom.y + zoom.height / 2 - (box.y + box.height / 2) * scale;
  roundRect(ctx, zoom.x - 3, zoom.y - 3, zoom.width + 6, zoom.height + 6, 16, "#fff", "#f18a2a", 6);
  ctx.save();
  roundedClip(ctx, zoom.x, zoom.y, zoom.width, zoom.height, 14);
  ctx.drawImage(image, imageX, imageY, imageWidth, imageHeight);
  (segment.privacyMaskBoxes || []).forEach((mask) => {
    roundRect(ctx, imageX + mask.x * scale, imageY + mask.y * scale, Math.max(1, mask.width * scale), Math.max(1, mask.height * scale), 8, "#111827");
  });
  ctx.restore();
  roundRect(ctx, zoom.x + 12, zoom.y + 12, 106, 28, 14, "rgba(24,33,43,.86)");
  drawText(ctx, "Focus zoom", zoom.x + 65, zoom.y + 32, 15, "#fff", "800", "center");
}

function drawOverlayBox(ctx, box, frame, stroke, fill, lineWidth) {
  if (!box || !Number.isFinite(box.x)) return;
  const x = frame.x + box.x / frame.sourceWidth * frame.width;
  const y = frame.y + box.y / frame.sourceHeight * frame.height;
  const width = Math.max(1, box.width / frame.sourceWidth * frame.width);
  const height = Math.max(1, box.height / frame.sourceHeight * frame.height);
  if (fill) roundRect(ctx, x, y, width, height, 8, fill);
  if (stroke && lineWidth) roundRect(ctx, x, y, width, height, 8, null, stroke, lineWidth);
}

function fitVideoRect(sourceWidth, sourceHeight, bounds) {
  const scale = Math.min(bounds.width / sourceWidth, bounds.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: bounds.x + (bounds.width - width) / 2,
    y: bounds.y + (bounds.height - height) / 2,
    width,
    height,
    sourceWidth,
    sourceHeight
  };
}

function focusZoomFrameRect(box, frame) {
  const width = 330;
  const height = 210;
  const margin = 20;
  const boxX = frame.x + box.x / frame.sourceWidth * frame.width;
  const boxY = frame.y + box.y / frame.sourceHeight * frame.height;
  const boxW = box.width / frame.sourceWidth * frame.width;
  const boxH = box.height / frame.sourceHeight * frame.height;
  const rightSpace = frame.x + frame.width - (boxX + boxW);
  const x = rightSpace >= width + margin ? boxX + boxW + margin : Math.max(frame.x + margin, boxX - width - margin);
  const y = Math.max(frame.y + margin, Math.min(frame.y + frame.height - height - margin, boxY + boxH / 2 - height / 2));
  return { x, y, width, height };
}

function loadCanvasImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("截图加载失败，无法生成视频帧"));
    image.src = src;
  });
}

function roundRect(ctx, x, y, width, height, radius, fill, stroke, lineWidth = 1) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function roundedClip(ctx, x, y, width, height, radius) {
  roundRect(ctx, x, y, width, height, radius);
  ctx.clip();
}

function drawArrow(ctx, fromX, fromY, toX, toY, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - 30, toY - 24);
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - 30, toY + 24);
  ctx.stroke();
}

function drawText(ctx, text, x, y, size, color, weight = "400", align = "left") {
  ctx.font = `${weight} ${size}px "Microsoft YaHei", "Segoe UI", sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(String(text || ""), x, y);
}

function wrapCanvasText(text, maxChars, maxLines) {
  const chars = [...String(text || "")];
  const lines = [];
  let current = "";
  for (const char of chars) {
    current += char;
    if ([...current].length >= maxChars) {
      lines.push(current);
      current = "";
      if (lines.length === maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (chars.length > maxChars * maxLines && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, -1)}…`;
  return lines.length ? lines : [""];
}

function trimMiddle(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  const keep = Math.floor((maxLength - 1) / 2);
  return `${text.slice(0, keep)}…${text.slice(-keep)}`;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
