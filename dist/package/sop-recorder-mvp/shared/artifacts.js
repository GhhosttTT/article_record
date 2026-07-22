(function initArtifactShared(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.SopArtifactShared = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createArtifactShared() {
  function buildArticleSteps(nodes) {
    return (nodes || []).filter((node) => node.status !== "discarded").map((node, index) => {
      const isTabTransition = node.action?.startsWith("tab_");
      const title = isTabTransition ? tabTitle(node) : operationTitle(node);
      return {
        id: `article_step_${String(index + 1).padStart(3, "0")}`,
        nodeId: node.id,
        sequence: index + 1,
        type: isTabTransition ? "tab_transition" : "operation",
        title,
        description: node.generatedInstruction || title,
        tabAlias: node.tab?.tabAlias || node.toTab?.tabAlias || node.fromTab?.tabAlias || null,
        fromTabAlias: node.fromTab?.tabAlias || null,
        toTabAlias: node.toTab?.tabAlias || null,
        image: node.screenshot?.dataUrl || null,
        screenshot: node.screenshot || null,
        focusBox: node.target?.boundingBox || null,
        focusMode: node.target?.boundingBox ? "highlight" : "none",
        privacyWarnings: node.privacy?.containsSensitiveData ? ["此步骤包含敏感字段，已脱敏。"] : [],
        editStatus: node.status === "reviewed" ? "reviewed" : "auto"
      };
    });
  }

  function buildVideoTimeline(steps) {
    let cursor = 0;
    const segments = (steps || []).map((step) => {
      const duration = step.type === "tab_transition"
        ? 2
        : Math.max(3, Math.ceil([...step.description].length / 8));
      const segment = {
        id: `segment_${String(step.sequence).padStart(3, "0")}`,
        stepId: step.id,
        type: step.type,
        startTime: cursor,
        endTime: cursor + duration,
        caption: step.description,
        currentTabAlias: step.tabAlias,
        fromTabAlias: step.fromTabAlias,
        toTabAlias: step.toTabAlias,
        visual: step.image || null,
        storyboardVisualType: step.type === "tab_transition" ? "tab_transition" : "screenshot",
        highlight: step.focusBox
      };
      cursor += duration;
      return segment;
    });
    return {
      version: "0.1.0",
      duration: cursor,
      segments
    };
  }

  function operationTitle(node) {
    const target = node.target || {};
    const name = target.text || target.labelText || target.placeholder || target.ariaLabel || target.name || target.type || "目标元素";
    if (node.action === "input") return `填写 ${name}`;
    if (node.action === "select") return `选择 ${name}`;
    if (node.action === "check") return `勾选 ${name}`;
    if (node.action === "submit") return "提交表单";
    return `点击 ${name}`;
  }

  function tabTitle(node) {
    if (node.action === "tab_open") return `打开${node.toTab?.tabAlias || "新标签页"}`;
    if (node.action === "tab_close") return `关闭${node.fromTab?.tabAlias || "标签页"}`;
    return `切换到${node.toTab?.tabAlias || "目标标签页"}`;
  }

  return {
    buildArticleSteps,
    buildVideoTimeline,
    operationTitle,
    tabTitle
  };
});
