const fs = require("node:fs");
const path = require("node:path");
const { buildArticleSteps, buildArticleChapters, buildVideoTimeline } = require("../extension/shared/artifacts");

const root = path.join(__dirname, "..");
const inputPath = process.argv[2] || path.join(root, "examples", "sample-recording.json");
const recording = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const errors = [];

validateRecording(recording);
validateSession(recording.session);
validateRecordingRoot(recording);

const steps = buildArticleSteps(recording.nodes || []);
validateArticleSteps(steps);

const chapters = buildArticleChapters(steps);
validateArticleChapters(chapters, steps);

const timeline = buildVideoTimeline(steps);
validateTimeline(timeline);

if (errors.length) {
  for (const error of errors) console.error(`SCHEMA ${error}`);
  process.exit(1);
}

console.log(`Schema OK: ${path.relative(root, inputPath)}`);
console.log(`ArticleSteps: ${steps.length}`);
console.log(`ArticleChapters: ${chapters.length}`);
console.log(`VideoSegments: ${timeline.segments.length}`);

function validateRecording(data) {
  assert(data.session?.id, "session.id 必填");
  assert(data.session?.browser, "session.browser 必填");
  assert(Array.isArray(data.nodes), "nodes 必须是数组");
  assert(data.tabContexts && typeof data.tabContexts === "object", "tabContexts 必须是对象");

  for (const tab of Object.values(data.tabContexts)) {
    assert(Number.isFinite(tab.tabId), `tabContext ${tab.tabAlias || ""} 缺少 tabId`);
    assert(tab.tabAlias, `tabContext ${tab.tabId || ""} 缺少 tabAlias`);
    validateRecordedUrl(tab.firstUrl, `tabContext ${tab.tabAlias || tab.tabId}.firstUrl`);
    validateRecordedUrl(tab.currentUrl, `tabContext ${tab.tabAlias || tab.tabId}.currentUrl`);
  }

  data.nodes.forEach((node, index) => validateNode(node, index));
}

function validateSession(session) {
  assert(session?.startedAt, "session.startedAt 必填");
  assert(["recording", "paused", "completed", "idle"].includes(session?.status), "session.status 非法");
  if (session?.endedAt !== undefined && session?.endedAt !== null) {
    assert(typeof session.endedAt === "string" && session.endedAt.trim(), "session.endedAt 必须是非空字符串");
  }
}

function validateRecordingRoot(data) {
  const allowed = new Set(["session", "tabContexts", "nodes"]);
  for (const key of Object.keys(data || {})) {
    assert(allowed.has(key), `root.${key} 不是录制 JSON 契约字段`);
  }
}

function validateNode(node, index) {
  const label = node.id || `nodes[${index}]`;
  assert(node.id, `${label} 缺少 id`);
  assert(node.action, `${label} 缺少 action`);
  assert(node.generatedInstruction, `${label} 缺少 generatedInstruction`);
  if (node.sequence !== undefined) assert(Number.isFinite(node.sequence), `${label}.sequence 必须是数字`);
  if (node.waitDurationMs !== undefined) assert(Number.isFinite(node.waitDurationMs) && node.waitDurationMs >= 0, `${label}.waitDurationMs 必须是非负数字`);
  if (node.durationOverrideSeconds !== undefined) assert(Number.isFinite(node.durationOverrideSeconds) && node.durationOverrideSeconds >= 1 && node.durationOverrideSeconds <= 120, `${label}.durationOverrideSeconds 必须是 1 到 120 之间的数字`);
  if (node.mergedEventCount !== undefined) assert(Number.isFinite(node.mergedEventCount) && node.mergedEventCount >= 1, `${label}.mergedEventCount 必须是大于等于 1 的数字`);
  if (node.mergedClickCount !== undefined) assert(Number.isFinite(node.mergedClickCount) && node.mergedClickCount >= 1, `${label}.mergedClickCount 必须是大于等于 1 的数字`);
  if (node.status !== undefined) {
    assert(["auto_generated", "reviewed", "discarded"].includes(node.status), `${label}.status 非法`);
  }
  if (node.titleOverride !== undefined) assert(typeof node.titleOverride === "string" && node.titleOverride.trim(), `${label}.titleOverride 必须是非空字符串`);
  if (node.descriptionOverride !== undefined) assert(typeof node.descriptionOverride === "string" && node.descriptionOverride.trim(), `${label}.descriptionOverride 必须是非空字符串`);
  if (node.voiceoverText !== undefined) assert(typeof node.voiceoverText === "string" && node.voiceoverText.trim(), `${label}.voiceoverText 必须是非空字符串`);
  if (node.voiceoverTextOverridden !== undefined) assert(typeof node.voiceoverTextOverridden === "boolean", `${label}.voiceoverTextOverridden 必须是布尔值`);
  if (node.rawValue !== undefined) assert(false, `${label}.rawValue 不允许持久化`);
  if (node.maskedValue !== undefined && node.maskedValue !== null) assert(typeof node.maskedValue === "string", `${label}.maskedValue 必须是字符串`);
  if (node.value !== undefined && node.value !== null) assert(typeof node.value === "string", `${label}.value 必须是字符串`);
  if (node.checked !== undefined && node.checked !== null) assert(typeof node.checked === "boolean", `${label}.checked must be boolean`);
  if (node.maskedValue !== undefined && node.value !== undefined) assert(node.maskedValue === node.value, `${label}.value 必须与 maskedValue 保持兼容一致`);
  if (node.key !== undefined) assert(["Enter", "Escape"].includes(node.key), `${label}.key 只允许 Enter 或 Escape`);
  validateViewport(node.viewport, `${label}.viewport`);
  validatePoint(node.clickPoint, `${label}.clickPoint`);
  if (node.focusBoxOverride) validateBox(node.focusBoxOverride, `${label}.focusBoxOverride`);
  validateFormMerge(node.formMerge, `${label}.formMerge`);
  validateScreenshot(node.screenshot, `${label}.screenshot`);
  validatePrivacyMaskBoxes(node.privacyMaskBoxes, `${label}.privacyMaskBoxes`);
  validatePrivacy(node.privacy, `${label}.privacy`);
  if (node.mergedNodeIds !== undefined) {
    assert(Array.isArray(node.mergedNodeIds), `${label}.mergedNodeIds 必须是数组`);
    node.mergedNodeIds.forEach((id, idIndex) => assert(typeof id === "string" && id, `${label}.mergedNodeIds[${idIndex}] 必须是非空字符串`));
  }
  if (node.discardReason !== undefined) assert(typeof node.discardReason === "string" && node.discardReason, `${label}.discardReason 必须是非空字符串`);
  if (node.triggeredByNodeId !== undefined) assert(typeof node.triggeredByNodeId === "string" && node.triggeredByNodeId, `${label}.triggeredByNodeId 必须是非空字符串`);
  if (node.triggeredNavigationNodeId !== undefined) assert(typeof node.triggeredNavigationNodeId === "string" && node.triggeredNavigationNodeId, `${label}.triggeredNavigationNodeId 必须是非空字符串`);
  validateRecordedUrl(node.beforeUrl, `${label}.beforeUrl`);
  validateRecordedUrl(node.afterUrl, `${label}.afterUrl`);
  validateRecordedUrl(node.pageUrl, `${label}.pageUrl`);
  if (node.navigationTargetUrl !== undefined && node.navigationTargetUrl !== null) {
    assert(typeof node.navigationTargetUrl === "string" && node.navigationTargetUrl, `${label}.navigationTargetUrl 必须是非空字符串`);
    validateRecordedUrl(node.navigationTargetUrl, `${label}.navigationTargetUrl`);
  }
  if (node.triggeredTabNodeId !== undefined) assert(typeof node.triggeredTabNodeId === "string" && node.triggeredTabNodeId, `${label}.triggeredTabNodeId 必须是非空字符串`);
  if (node.tabTargetUrl !== undefined && node.tabTargetUrl !== null) {
    assert(typeof node.tabTargetUrl === "string" && node.tabTargetUrl, `${label}.tabTargetUrl 必须是非空字符串`);
    validateRecordedUrl(node.tabTargetUrl, `${label}.tabTargetUrl`);
  }

  if (node.action?.startsWith("tab_") || node.action === "navigation") {
    assert(node.fromTab || node.toTab, `${label} 标签页节点必须包含 fromTab 或 toTab`);
    if (node.fromTab) {
      assert(node.fromTab.tabAlias, `${label}.fromTab 缺少 tabAlias`);
      validateRecordedUrl(node.fromTab.url, `${label}.fromTab.url`);
    }
    if (node.toTab) {
      assert(node.toTab.tabAlias, `${label}.toTab 缺少 tabAlias`);
      validateRecordedUrl(node.toTab.url, `${label}.toTab.url`);
    }
  } else {
    assert(node.tab?.tabAlias, `${label} 普通操作节点缺少 tab.tabAlias`);
    validateRecordedUrl(node.tab?.url, `${label}.tab.url`);
    validateTarget(node.target, `${label}.target`);
    if (node.target?.boundingBox) validateBox(node.target.boundingBox, `${label}.target.boundingBox`);
  }
}

function validateTarget(target, label) {
  if (!target) return;
  ["text", "ariaLabel", "placeholder", "title", "labelText", "nearbyText", "name", "id", "selector"].forEach((key) => {
    if (target[key] !== undefined && target[key] !== null) {
      assert(typeof target[key] === "string", `${label}.${key} 必须是字符串`);
    }
  });
  if (target.attributes) validateTargetAttributes(target.attributes, `${label}.attributes`);
  if (target.visibility) validateVisibility(target.visibility, `${label}.visibility`);
  if (target.form) validateFormTarget(target.form, `${label}.form`);
}

function validateTargetAttributes(attributes, label) {
  assert(attributes && typeof attributes === "object" && !Array.isArray(attributes), `${label} 必须是对象`);
  ["tagName", "role", "href", "target", "inputType"].forEach((key) => {
    if (attributes[key] !== undefined && attributes[key] !== null) {
      assert(typeof attributes[key] === "string", `${label}.${key} 必须是字符串`);
    }
  });
  if (attributes.href !== undefined && attributes.href !== null) validateSafeHref(attributes.href, `${label}.href`);
  ["required", "disabled", "checked", "multiple"].forEach((key) => {
    if (attributes[key] !== undefined && attributes[key] !== null) {
      assert(typeof attributes[key] === "boolean", `${label}.${key} 必须是布尔值`);
    }
  });
}

function validateSafeHref(href, label) {
  if (!href) return;
  validateUrlShape(href, label);
}

function validateRecordedUrl(url, label) {
  if (url === undefined || url === null || url === "") return;
  assert(typeof url === "string", `${label} 必须是字符串`);
  validateUrlShape(url, label);
}

function validateUrlShape(url, label) {
  assert(!/[?#]/.test(url), `${label} 不得包含 query 或 hash`);
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    assert(/^https?:\/\//i.test(url), `${label} 只允许 http/https`);
  } else {
    assert(url.startsWith("/"), `${label} 相对路径必须以 / 开头`);
  }
}

function validateFormTarget(form, label) {
  ["id", "name", "selector", "text"].forEach((key) => {
    if (form[key] !== undefined && form[key] !== null) {
      assert(typeof form[key] === "string", `${label}.${key} 必须是字符串`);
    }
  });
  assert(typeof form.selector === "string" && form.selector, `${label}.selector 必须是非空字符串`);
}

function validateFormMerge(formMerge, label) {
  if (!formMerge) return;
  assert(typeof formMerge.formSelector === "string" && formMerge.formSelector, `${label}.formSelector 必须是非空字符串`);
  assert(Number.isFinite(formMerge.mergedFieldCount) && formMerge.mergedFieldCount >= 2, `${label}.mergedFieldCount 必须是大于等于 2 的数字`);
  assert(typeof formMerge.mergedAt === "string" && formMerge.mergedAt, `${label}.mergedAt 必须是非空字符串`);
}

function validateVisibility(visibility, label) {
  ["visible", "inViewport", "hasBox", "canHighlight"].forEach((key) => {
    if (visibility[key] !== undefined) assert(typeof visibility[key] === "boolean", `${label}.${key} 必须是布尔值`);
  });
  if (visibility.reason !== undefined) assert(typeof visibility.reason === "string", `${label}.reason 必须是字符串`);
}

function validateArticleSteps(steps) {
  assert(steps.length > 0, "ArticleStep 不能为空");
  steps.forEach((step) => {
    assert(step.id, "ArticleStep 缺少 id");
    assert(step.nodeId, `${step.id} 缺少 nodeId`);
    assert(["operation", "tab_transition", "navigation"].includes(step.type), `${step.id} type 非法`);
    assert(step.title, `${step.id} 缺少 title`);
    assert(step.description, `${step.id} 缺少 description`);
    validateKey(step.key, `${step.id}.key`);
    if (step.voiceoverText !== undefined) assert(typeof step.voiceoverText === "string" && step.voiceoverText.trim(), `${step.id}.voiceoverText 必须是非空字符串`);
    if (step.voiceoverTextOverridden !== undefined) assert(typeof step.voiceoverTextOverridden === "boolean", `${step.id}.voiceoverTextOverridden 必须是布尔值`);
    if (step.imageRedactedForPrivacy !== undefined) assert(typeof step.imageRedactedForPrivacy === "boolean", `${step.id}.imageRedactedForPrivacy 必须是布尔值`);
    if (step.durationOverrideSeconds !== undefined && step.durationOverrideSeconds !== null) assert(Number.isFinite(step.durationOverrideSeconds), `${step.id}.durationOverrideSeconds 必须是数字`);
    validatePrivacyMaskBoxes(step.privacyMaskBoxes, `${step.id}.privacyMaskBoxes`);
    if (step.focusBox) validateBox(step.focusBox, `${step.id}.focusBox`);
    assert(Array.isArray(step.privacyWarnings), `${step.id}.privacyWarnings 必须是数组`);
    if (step.type === "tab_transition") {
      assert(step.fromTabAlias || step.toTabAlias, `${step.id} 标签页步骤缺少 from/to alias`);
    }
    if (step.type === "navigation") {
      assert(step.fromUrl || step.toUrl || step.pageUrl, `${step.id} 页面跳转步骤缺少页面 URL`);
    }
  });
}

function validateArticleChapters(chapters, steps) {
  assert(Array.isArray(chapters), "ArticleChapter 必须是数组");
  assert(chapters.length > 0, "ArticleChapter 不能为空");
  const chapterSteps = chapters.flatMap((chapter) => chapter.steps || []);
  assert(chapterSteps.length === steps.length, "ArticleChapter 必须覆盖全部 ArticleStep");
  chapters.forEach((chapter, index) => {
    assert(chapter.id === `chapter_${String(index + 1).padStart(3, "0")}`, `${chapter.id || "chapter"} id 必须连续`);
    assert(chapter.sequence === index + 1, `${chapter.id} sequence 必须连续`);
    assert(chapter.title, `${chapter.id} 缺少 title`);
    assert(Array.isArray(chapter.steps) && chapter.steps.length > 0, `${chapter.id} steps 不能为空`);
  });
}

function validateTimeline(timeline) {
  assert(timeline.version, "timeline.version 必填");
  assert(Array.isArray(timeline.segments), "timeline.segments 必须是数组");
  assert(timeline.segments.length > 0, "timeline.segments 不能为空");
  assert(timeline.duration === timeline.segments.at(-1).endTime, "timeline.duration 必须等于最后片段 endTime");

  let cursor = 0;
  for (const segment of timeline.segments) {
    assert(segment.startTime === cursor, `${segment.id} startTime 不连续`);
    assert(segment.endTime > segment.startTime, `${segment.id} endTime 必须大于 startTime`);
    assert(segment.caption, `${segment.id} 缺少 caption`);
    validateKey(segment.key, `${segment.id}.key`);
    if (segment.voiceoverText !== undefined) assert(typeof segment.voiceoverText === "string" && segment.voiceoverText.trim(), `${segment.id}.voiceoverText 必须是非空字符串`);
    if (segment.voiceoverTextOverridden !== undefined) assert(typeof segment.voiceoverTextOverridden === "boolean", `${segment.id}.voiceoverTextOverridden 必须是布尔值`);
    if (segment.highlight) validateBox(segment.highlight, `${segment.id}.highlight`);
    validatePrivacyMaskBoxes(segment.privacyMaskBoxes, `${segment.id}.privacyMaskBoxes`);
    validateScreenshot(segment.screenshot, `${segment.id}.screenshot`);
    if (segment.type === "tab_transition") {
      assert(segment.storyboardVisualType === "tab_transition", `${segment.id} storyboardVisualType 必须为 tab_transition`);
      assert(segment.fromTabAlias || segment.toTabAlias, `${segment.id} 缺少 from/to alias`);
    }
    if (segment.type === "navigation") {
      assert(segment.storyboardVisualType === "navigation", `${segment.id} storyboardVisualType 必须为 navigation`);
      assert(segment.fromUrl || segment.toUrl || segment.pageUrl, `${segment.id} 缺少页面跳转 URL`);
    }
    if (segment.type === "chapter_intro") {
      assert(segment.storyboardVisualType === "chapter_intro", `${segment.id} storyboardVisualType 必须为 chapter_intro`);
      assert(segment.chapterId, `${segment.id} 缺少 chapterId`);
    }
    cursor = segment.endTime;
  }
}

function validateKey(key, label) {
  if (key === undefined || key === null) return;
  assert(["Enter", "Escape"].includes(key), `${label} 只允许 Enter 或 Escape`);
}

function validateBox(box, label) {
  ["x", "y", "width", "height"].forEach((key) => {
    assert(Number.isFinite(box[key]), `${label}.${key} 必须是数字`);
  });
  assert(box.width >= 0, `${label}.width 不能为负`);
  assert(box.height >= 0, `${label}.height 不能为负`);
}

function validatePrivacyMaskBoxes(boxes, label) {
  if (boxes === undefined) return;
  assert(Array.isArray(boxes), `${label} 必须是数组`);
  boxes.forEach((box, index) => validateBox(box, `${label}[${index}]`));
}

function validatePrivacy(privacy, label) {
  if (!privacy) return;
  if (privacy.containsSensitiveData !== undefined) assert(typeof privacy.containsSensitiveData === "boolean", `${label}.containsSensitiveData 必须是布尔值`);
  if (privacy.autoMaskApplied !== undefined) assert(typeof privacy.autoMaskApplied === "boolean", `${label}.autoMaskApplied 必须是布尔值`);
  if (privacy.manualMaskApplied !== undefined) assert(typeof privacy.manualMaskApplied === "boolean", `${label}.manualMaskApplied 必须是布尔值`);
  if (privacy.maskedFields !== undefined) assert(Array.isArray(privacy.maskedFields), `${label}.maskedFields 必须是数组`);
  if (privacy.reasons !== undefined) assert(Array.isArray(privacy.reasons), `${label}.reasons 必须是数组`);
}

function validateScreenshot(screenshot, label) {
  if (!screenshot) return;
  ["width", "height", "viewportWidth", "viewportHeight", "devicePixelRatio", "scrollX", "scrollY"].forEach((key) => {
    if (screenshot[key] !== undefined && screenshot[key] !== null) {
      assert(Number.isFinite(screenshot[key]), `${label}.${key} 必须是数字`);
    }
  });
  if (screenshot.pruned !== undefined) assert(typeof screenshot.pruned === "boolean", `${label}.pruned 必须是布尔值`);
  if (screenshot.pruneReason !== undefined) assert(typeof screenshot.pruneReason === "string" && screenshot.pruneReason, `${label}.pruneReason 必须是非空字符串`);
  if (screenshot.prunedAt !== undefined) assert(typeof screenshot.prunedAt === "string" && screenshot.prunedAt, `${label}.prunedAt 必须是非空字符串`);
  if (screenshot.redactedForPrivacy !== undefined) assert(typeof screenshot.redactedForPrivacy === "boolean", `${label}.redactedForPrivacy 必须是布尔值`);
  if (screenshot.redactionReason !== undefined) assert(typeof screenshot.redactionReason === "string" && screenshot.redactionReason, `${label}.redactionReason 必须是非空字符串`);
  if (screenshot.redactedAt !== undefined) assert(typeof screenshot.redactedAt === "string" && screenshot.redactedAt, `${label}.redactedAt 必须是非空字符串`);
  if (screenshot.captureTiming !== undefined) {
    assert(["before_action_preferred", "after_action", "after_navigation", "after_wait"].includes(screenshot.captureTiming), `${label}.captureTiming 非法`);
  }
}

function validateViewport(viewport, label) {
  if (!viewport) return;
  ["width", "height", "devicePixelRatio", "scrollX", "scrollY"].forEach((key) => {
    if (viewport[key] !== undefined && viewport[key] !== null) {
      assert(Number.isFinite(viewport[key]), `${label}.${key} 必须是数字`);
    }
  });
}

function validatePoint(point, label) {
  if (!point) return;
  ["x", "y"].forEach((key) => {
    assert(Number.isFinite(point[key]), `${label}.${key} 必须是数字`);
  });
  if (point.coordinateSpace !== undefined) {
    assert(point.coordinateSpace === "viewport-css-pixel", `${label}.coordinateSpace 必须是 viewport-css-pixel`);
  }
}

function assert(condition, message) {
  if (!condition) errors.push(message);
}
