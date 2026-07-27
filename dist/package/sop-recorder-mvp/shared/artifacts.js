(function initArtifactShared(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.SopArtifactShared = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createArtifactShared() {
  function buildArticleSteps(nodes) {
    const activeNodes = filterMeaningfulTransitionNodes((nodes || []).filter((node) => node.status !== "discarded"));
    return activeNodes.map((node, index) => {
      const type = articleStepType(node);
      const isTransition = type === "tab_transition" || type === "navigation";
      const title = node.titleOverride || (isTransition ? transitionTitle(node) : operationTitle(node));
      const description = node.descriptionOverride || node.generatedInstruction || title;
      const voiceoverText = normalizeText(node.voiceoverText || "");
      const focusBox = normalizeBox(node.focusBoxOverride || (node.target?.visibility?.canHighlight === false ? null : node.target?.boundingBox));
      const privacyMaskBoxes = Array.isArray(node.privacyMaskBoxes) ? node.privacyMaskBoxes : [];
      return {
        id: `article_step_${String(index + 1).padStart(3, "0")}`,
        nodeId: node.id,
        sequence: index + 1,
        type,
        title,
        description,
        tabAlias: node.tab?.tabAlias || node.toTab?.tabAlias || node.fromTab?.tabAlias || null,
        fromTabAlias: type === "tab_transition" ? node.fromTab?.tabAlias || null : null,
        toTabAlias: type === "tab_transition" ? node.toTab?.tabAlias || null : null,
        fromUrl: node.fromTab?.url || node.beforeUrl || null,
        toUrl: node.toTab?.url || node.afterUrl || node.pageUrl || null,
        pageTitle: node.pageTitle || node.toTab?.title || node.tab?.title || null,
        pageUrl: node.pageUrl || node.toTab?.url || node.afterUrl || null,
        image: node.screenshot?.dataUrl || null,
        screenshot: node.screenshot || null,
        key: normalizeKey(node.key),
        clickPoint: normalizePoint(node.clickPoint),
        focusBox,
        focusMode: focusBox ? "highlight" : "none",
        privacyMaskBoxes,
        privacyWarnings: node.privacy?.containsSensitiveData ? ["此步骤包含敏感字段，已脱敏。"] : [],
        durationOverrideSeconds: normalizeDuration(node.durationOverrideSeconds),
        voiceoverText: voiceoverText || description,
        voiceoverTextOverridden: Boolean(node.voiceoverTextOverridden && voiceoverText),
        editStatus: node.status === "reviewed" ? "reviewed" : "auto"
      };
    });
  }

  function buildArticleChapters(steps) {
    const chapters = [];
    const pageContexts = {};
    let current = null;
    for (const step of steps || []) {
      const chapterStep = stepWithChapterContext(step, pageContexts);
      rememberPageContext(chapterStep, pageContexts);
      const key = chapterKey(chapterStep);
      if (!current || current.key !== key) {
        current = {
          id: `chapter_${String(chapters.length + 1).padStart(3, "0")}`,
          sequence: chapters.length + 1,
          key,
          title: chapterTitle(chapterStep),
          tabAlias: chapterStep.tabAlias || chapterStep.toTabAlias || null,
          pageTitle: chapterStep.pageTitle || null,
          pageUrl: chapterStep.pageUrl || chapterStep.toUrl || null,
          steps: []
        };
        chapters.push(current);
      }
      current.steps.push(step);
    }
    return chapters.map(({ key, ...chapter }) => chapter);
  }

  function stepWithChapterContext(step, pageContexts) {
    const tabAlias = step.tabAlias || step.toTabAlias || step.fromTabAlias || "";
    const known = tabAlias ? pageContexts[tabAlias] : null;
    if (!known || step.pageTitle || step.pageUrl || step.toUrl) return step;
    return {
      ...step,
      pageTitle: known.pageTitle,
      pageUrl: known.pageUrl
    };
  }

  function rememberPageContext(step, pageContexts) {
    const tabAlias = step.tabAlias || step.toTabAlias || "";
    const pageUrl = step.pageUrl || step.toUrl || "";
    if (!tabAlias || !pageUrl) return;
    pageContexts[tabAlias] = {
      pageTitle: step.pageTitle || tabAlias,
      pageUrl
    };
  }

  function chapterKey(step = {}) {
    if (step.type === "tab_transition") return `tab:${step.toTabAlias || step.fromTabAlias || "unknown"}`;
    return [
      step.tabAlias || step.toTabAlias || step.fromTabAlias || "unknown_tab",
      step.pageTitle || "",
      normalizeUrlForChapter(step.pageUrl || step.toUrl || step.fromUrl || "")
    ].join("|");
  }

  function chapterTitle(step = {}) {
    if (step.type === "tab_transition") return step.toTabAlias ? `切换到${step.toTabAlias}` : "标签页切换";
    if (step.pageTitle) return step.pageTitle;
    if (step.tabAlias) return step.tabAlias;
    const domain = normalizeUrlForChapter(step.pageUrl || step.toUrl || step.fromUrl || "");
    return domain || "未命名章节";
  }

  function normalizeUrlForChapter(url = "") {
    try {
      const parsed = new URL(url);
      return `${parsed.hostname}${parsed.pathname}`.replace(/\/$/, "");
    } catch {
      return "";
    }
  }

  function filterMeaningfulTransitionNodes(nodes) {
    const filtered = [];
    let currentMeaningfulTabId = null;

    (nodes || []).forEach((node, index) => {
      if (!node.action?.startsWith("tab_")) {
        filtered.push(node);
        currentMeaningfulTabId = operationTabId(node) || currentMeaningfulTabId;
        return;
      }

      if (!isMeaningfulTabTransition(nodes, index, currentMeaningfulTabId)) return;
      filtered.push(node);
      currentMeaningfulTabId = transitionTargetTabId(node) || currentMeaningfulTabId;
    });

    return filtered;
  }

  function isMeaningfulTabTransition(nodes, index, currentMeaningfulTabId) {
    const node = nodes[index];
    const targetTabId = transitionTargetTabId(node);
    const nextOperation = findNextOperation(nodes, index);
    if (!nextOperation) return false;

    const nextOperationTabId = operationTabId(nextOperation);
    if (targetTabId && nextOperationTabId && targetTabId !== nextOperationTabId) return false;
    if (targetTabId && currentMeaningfulTabId && targetTabId === currentMeaningfulTabId) return false;
    if (node.action === "tab_close") return true;
    return Boolean(targetTabId && hasLaterOperationInTab(nodes, index, targetTabId));
  }

  function transitionTargetTabId(node) {
    if (node.action === "tab_close") return node.toTab?.tabId || null;
    return node.toTab?.tabId || null;
  }

  function findNextOperation(nodes, startIndex) {
    return nodes.slice(startIndex + 1).find((node) => !node.action?.startsWith("tab_")) || null;
  }

  function operationTabId(node) {
    return node.tab?.tabId || node.toTab?.tabId || node.fromTab?.tabId || null;
  }

  function hasLaterOperationInTab(nodes, startIndex, tabId) {
    return nodes.slice(startIndex + 1).some((node) => {
      if (node.action?.startsWith("tab_")) return false;
      return operationTabId(node) === tabId;
    });
  }

  function buildVideoTimeline(steps, options = {}) {
    if (options.includeChapterIntros) {
      return buildVideoTimelineWithChapters(steps, options.chapters || buildArticleChapters(steps));
    }
    let cursor = 0;
    const segments = (steps || []).map((step) => {
      const segment = buildVideoSegment(step, cursor);
      cursor = segment.endTime;
      return segment;
    });
    return {
      version: "0.1.0",
      duration: cursor,
      segments
    };
  }

  function buildPrivacySafeArticleSteps(steps) {
    return (steps || []).map((step) => {
      const containsSensitiveData = Boolean(step.privacyWarnings?.length);
      const hasMaskBoxes = Boolean(step.privacyMaskBoxes?.length);
      if (!step.image || (!containsSensitiveData && !hasMaskBoxes)) return step;
      const { dataUrl, ...screenshot } = step.screenshot || {};
      return {
        ...step,
        image: null,
        screenshot: {
          ...screenshot,
          redactedForPrivacy: true,
          redactionReason: containsSensitiveData ? "contains_sensitive_data" : "has_privacy_mask"
        },
        imageRedactedForPrivacy: true
      };
    });
  }

  function buildVideoTimelineWithChapters(steps, chapters) {
    let cursor = 0;
    const segments = [];
    const stepSet = new Set(steps || []);
    for (const chapter of chapters || []) {
      const introDuration = 2;
      segments.push({
        id: `chapter_intro_${String(chapter.sequence).padStart(3, "0")}`,
        chapterId: chapter.id,
        type: "chapter_intro",
        startTime: cursor,
        endTime: cursor + introDuration,
        caption: `章节 ${chapter.sequence}：${chapter.title}`,
        currentTabAlias: chapter.tabAlias || null,
        pageTitle: chapter.pageTitle || null,
        pageUrl: chapter.pageUrl || null,
        visual: null,
        screenshot: null,
        storyboardVisualType: "chapter_intro",
        highlight: null,
        privacyMaskBoxes: []
      });
      cursor += introDuration;

      for (const step of chapter.steps || []) {
        if (!stepSet.has(step)) continue;
        const segment = buildVideoSegment(step, cursor);
        segments.push(segment);
        cursor = segment.endTime;
      }
    }
    return {
      version: "0.1.0",
      duration: cursor,
      segments
    };
  }

  function buildVideoSegment(step, cursor) {
    const duration = step.durationOverrideSeconds || (step.type === "tab_transition" || step.type === "navigation"
      ? 2
      : Math.max(3, Math.ceil([...step.description].length / 8)));
    return {
      id: `segment_${String(step.sequence).padStart(3, "0")}`,
      stepId: step.id,
      type: step.type,
      startTime: cursor,
      endTime: cursor + duration,
      caption: step.voiceoverText || step.description,
      voiceoverText: step.voiceoverText || step.description,
      voiceoverTextOverridden: Boolean(step.voiceoverTextOverridden),
      currentTabAlias: step.tabAlias,
      fromTabAlias: step.fromTabAlias,
      toTabAlias: step.toTabAlias,
      fromUrl: step.fromUrl,
      toUrl: step.toUrl,
      pageTitle: step.pageTitle,
      pageUrl: step.pageUrl,
      key: step.key || null,
      visual: step.image || null,
      screenshot: step.screenshot || null,
      storyboardVisualType: step.type === "tab_transition" ? "tab_transition" : step.type === "navigation" ? "navigation" : "screenshot",
      highlight: step.focusBox,
      privacyMaskBoxes: step.privacyMaskBoxes || []
    };
  }

  function normalizeDuration(value) {
    const duration = Number(value);
    if (!Number.isFinite(duration) || duration < 1 || duration > 120) return null;
    return Math.round(duration * 10) / 10;
  }

  function normalizeText(text = "") {
    return String(text).replace(/\s+/g, " ").trim();
  }

  function normalizeKey(value) {
    return ["Enter", "Escape"].includes(value) ? value : null;
  }

  function articleStepType(node) {
    if (node.action === "navigation") return "navigation";
    if (node.action?.startsWith("tab_")) return "tab_transition";
    return "operation";
  }

  function normalizeBox(box) {
    if (!box) return null;
    const x = Number(box.x);
    const y = Number(box.y);
    const width = Number(box.width);
    const height = Number(box.height);
    if (![x, y, width, height].every(Number.isFinite)) return null;
    if (width <= 0 || height <= 0) return null;
    return {
      ...box,
      x,
      y,
      width,
      height,
      coordinateSpace: box.coordinateSpace || "viewport-css-pixel"
    };
  }

  function normalizePoint(point) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    return {
      x: Math.round(point.x),
      y: Math.round(point.y),
      coordinateSpace: point.coordinateSpace || "viewport-css-pixel"
    };
  }

  function operationTitle(node) {
    const target = node.target || {};
    const name = target.text || target.ariaLabel || target.labelText || target.placeholder || target.title || target.nearbyText || target.name || target.id || target.type || "目标元素";
    if (node.action === "input") return `填写 ${name}`;
    if (node.action === "select") return `选择 ${name}`;
    if (node.action === "check") return `勾选 ${name}`;
    if (node.action === "upload") return `上传 ${name}`;
    if (node.action === "submit") return "提交表单";
    if (node.action === "key") return `按下 ${node.key || "快捷键"}：${name}`;
    if (node.action === "wait") return `等待 ${name} 加载`;
    if (node.action === "modal_open") return `弹窗出现：${name}`;
    if (node.action === "modal_close") return `关闭弹窗：${name}`;
    return `点击 ${name}`;
  }

  function transitionTitle(node) {
    if (node.action === "navigation") return `跳转到${node.pageTitle || node.toTab?.title || node.pageUrl || node.toTab?.url || "新页面"}`;
    if (node.action === "tab_open") return `打开${node.toTab?.tabAlias || "新标签页"}`;
    if (node.action === "tab_close") return `关闭${node.fromTab?.tabAlias || "标签页"}`;
    return `切换到${node.toTab?.tabAlias || "目标标签页"}`;
  }

  return {
    buildArticleSteps,
    buildArticleChapters,
    buildPrivacySafeArticleSteps,
    buildVideoTimeline,
    articleStepType,
    filterMeaningfulTransitionNodes,
    normalizeBox,
    operationTitle,
    transitionTitle
  };
});
