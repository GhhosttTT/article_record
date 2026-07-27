const STORAGE_KEY = "sopRecorderState";
const MAX_SCREENSHOT_RECORDS = 120;

importScripts("db.js");

const initialState = {
  status: "idle",
  session: null,
  activeTabId: null,
  tabContexts: {},
  pendingNavigations: {},
  pendingTabOpens: {},
  nodes: []
};

let runtimeState = structuredClone(initialState);

chrome.runtime.onInstalled.addListener(async () => {
  await persistState();
});

chrome.runtime.onStartup.addListener(async () => {
  await hydrateState();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  await hydrateState();
  if (runtimeState.status !== "recording") return;

  const tab = await safeGetTab(tabId);
  if (isIgnoredTab(tab)) {
    return;
  }

  const fromTabId = runtimeState.activeTabId;
  runtimeState.activeTabId = tabId;

  const toContext = await ensureTabContext(tab, windowId);
  const fromContext = fromTabId ? runtimeState.tabContexts[fromTabId] : null;

  if (fromContext && fromContext.tabId !== toContext.tabId && !shouldSkipTabSwitch(fromContext, toContext)) {
    await addTabNode("tab_switch", {
      fromTab: pickTabForNode(fromContext),
      toTab: pickTabForNode(toContext),
      reason: "user_switch",
      pageUrl: toContext.currentUrl,
      pageTitle: toContext.title,
      generatedInstruction: `切换到${toContext.tabAlias}，继续后续操作。`
    });
  }

  await persistState();
});

chrome.tabs.onCreated.addListener(async (tab) => {
  await hydrateState();
  if (runtimeState.status !== "recording") return;
  if (isIgnoredTab(tab)) {
    if (isInitialBlankTab(tab)) rememberPendingTabOpen(tab);
    await persistState();
    return;
  }

  const context = await ensureTabContext(tab, tab.windowId);
  const openerContext = tab.openerTabId ? runtimeState.tabContexts[tab.openerTabId] : null;
  const triggerNode = tab.openerTabId ? findRecentTabOpenTriggerNode(tab.openerTabId) : null;
  const tabOpenNode = await addTabNode("tab_open", {
    fromTab: openerContext ? pickTabForNode(openerContext) : undefined,
    toTab: pickTabForNode(context),
    triggeredByNodeId: triggerNode?.id,
    reason: tab.openerTabId ? "link_opened" : "system_detected",
    pageUrl: context.currentUrl,
    pageTitle: context.title,
    generatedInstruction: `打开${context.tabAlias}。`
  });
  linkTabOpenTrigger(triggerNode?.id, tabOpenNode?.id, context.currentUrl);
  await persistState();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await hydrateState();
  if (runtimeState.status !== "recording") return;
  const context = runtimeState.tabContexts[tabId];
  if (!context) {
    delete runtimeState.pendingTabOpens?.[tabId];
    await persistState();
    return;
  }

  await addTabNode("tab_close", {
    fromTab: pickTabForNode(context),
    reason: "user_switch",
    pageUrl: context.currentUrl,
    pageTitle: context.title,
    generatedInstruction: `关闭${context.tabAlias}。`
  });
  delete runtimeState.tabContexts[tabId];
  delete runtimeState.pendingTabOpens?.[tabId];
  await persistState();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && !changeInfo.title && changeInfo.status !== "complete") return;
  await hydrateState();
  if (runtimeState.status === "idle") return;

  if (isIgnoredTab(tab)) {
    delete runtimeState.pendingNavigations[tabId];
    if (!isInitialBlankTab(tab)) delete runtimeState.pendingTabOpens?.[tabId];
    delete runtimeState.tabContexts[tabId];
    if (runtimeState.activeTabId === tabId) runtimeState.activeTabId = null;
    await persistState();
    return;
  }

  const existing = runtimeState.tabContexts[tabId];
  const context = await ensureTabContext(tab, tab.windowId);
  if (!existing && runtimeState.status === "recording" && runtimeState.pendingTabOpens?.[tabId]) {
    await createTabOpenNodeForTab(tab, tab.windowId, context);
  }
  if (changeInfo.url && existing && runtimeState.status === "recording") {
    const triggerNode = findRecentNavigationTriggerNode(tabId);
    runtimeState.pendingNavigations[tabId] = {
      fromTab: pickTabForNode(existing),
      toTab: pickTabForNode(context),
      triggeredByNodeId: triggerNode?.id,
      reason: "system_detected",
      pageUrl: context.currentUrl,
      pageTitle: context.title,
      capturedAt: new Date().toISOString()
    };
  }

  if (changeInfo.status === "complete" && runtimeState.status === "recording") {
    await flushPendingNavigation(tabId, context, tab);
  }
  await persistState();
});

async function handleMessage(message, sender) {
  await hydrateState();
  switch (message?.type) {
    case "recorder:start":
      return startRecording();
    case "recorder:pause":
      return pauseRecording();
    case "recorder:resume":
      return resumeRecording();
    case "recorder:stop":
      return stopRecording();
    case "recorder:get-state":
      return publicState();
    case "recorder:get-privacy-audit":
      return privacyAuditState();
    case "recorder:get-full-state":
      return fullStateWithScreenshots();
    case "recorder:reset":
      await cleanupCurrentSessionScreenshots();
      runtimeState = structuredClone(initialState);
      await persistState();
      return publicState();
    case "recorder:open-viewer":
      await chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
      return { ok: true };
    case "recorder:export-json":
      return exportJson();
    case "recorder:set-node-status":
      return setNodeStatus(message.payload);
    case "recorder:move-node":
      return moveNode(message.payload);
    case "recorder:merge-node-next":
      return mergeNodeWithNext(message.payload);
    case "recorder:merge-form-fields":
      return mergeFormFields(message.payload);
    case "recorder:split-merged-node":
      return splitMergedNode(message.payload);
    case "recorder:update-node-text":
      return updateNodeText(message.payload);
    case "recorder:update-node-focus":
      return updateNodeFocus(message.payload);
    case "recorder:update-node-duration":
      return updateNodeDuration(message.payload);
    case "recorder:update-node-voiceover":
      return updateNodeVoiceover(message.payload);
    case "recorder:update-node-mask":
      return updateNodeMask(message.payload);
    case "recorder:event":
      return captureOperationNode(message.payload, sender, message.eventId);
    default:
      return { ok: false, error: "Unknown message type" };
  }
}

async function setNodeStatus(payload = {}) {
  const allowedStatuses = new Set(["auto_generated", "reviewed", "discarded"]);
  const nodeId = payload.nodeId;
  const status = payload.status;

  if (!nodeId) return { ok: false, error: "Missing nodeId" };
  if (!allowedStatuses.has(status)) return { ok: false, error: "Unsupported node status" };

  const node = runtimeState.nodes.find((item) => item.id === nodeId);
  if (!node) return { ok: false, error: "Node not found" };

  if (node.discardReason?.startsWith("merged_into:") && status !== "discarded") {
    const parentId = node.discardReason.slice("merged_into:".length);
    return splitMergedNode({ nodeId: parentId });
  }

  node.status = status;
  if (status === "discarded") delete node.discardReason;
  node.reviewedAt = new Date().toISOString();
  await persistState();
  return fullStateWithScreenshots();
}

async function moveNode(payload = {}) {
  const nodeId = payload.nodeId;
  const direction = payload.direction;
  if (!nodeId) return { ok: false, error: "Missing nodeId" };
  if (!["up", "down"].includes(direction)) return { ok: false, error: "Unsupported move direction" };

  const currentIndex = runtimeState.nodes.findIndex((item) => item.id === nodeId);
  if (currentIndex < 0) return { ok: false, error: "Node not found" };

  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= runtimeState.nodes.length) {
    return fullStateWithScreenshots();
  }

  const [node] = runtimeState.nodes.splice(currentIndex, 1);
  runtimeState.nodes.splice(targetIndex, 0, node);
  resequenceNodes();
  await persistState();
  return fullStateWithScreenshots();
}

async function mergeNodeWithNext(payload = {}) {
  const nodeId = payload.nodeId;
  if (!nodeId) return { ok: false, error: "Missing nodeId" };

  const currentIndex = runtimeState.nodes.findIndex((item) => item.id === nodeId);
  if (currentIndex < 0) return { ok: false, error: "Node not found" };

  const current = runtimeState.nodes[currentIndex];
  if (current.status === "discarded") return { ok: false, error: "Cannot merge discarded node" };

  const next = runtimeState.nodes.slice(currentIndex + 1).find((item) => item.status !== "discarded");
  if (!next) return { ok: false, error: "No next active node" };

  const currentTitle = getNodeTitle(current);
  const currentDescription = getNodeDescription(current);
  const nextTitle = getNodeTitle(next);
  const nextDescription = getNodeDescription(next);

  current.titleOverride = currentTitle;
  current.descriptionOverride = normalizeText(`${currentDescription} ${nextDescription}`);
  current.mergedNodeIds = Array.from(new Set([...(current.mergedNodeIds || []), next.id, ...(next.mergedNodeIds || [])]));
  current.privacy = mergePrivacyFromNodes([current, next]);
  current.privacyMaskBoxes = mergePrivacyMaskBoxesFromNodes([current, next]);
  current.status = "reviewed";
  current.reviewedAt = new Date().toISOString();
  current.updatedAt = new Date().toISOString();

  next.status = "discarded";
  next.discardReason = `merged_into:${current.id}`;
  next.reviewedAt = new Date().toISOString();
  next.updatedAt = new Date().toISOString();
  next.titleOverride = next.titleOverride || nextTitle;
  next.descriptionOverride = next.descriptionOverride || nextDescription;

  await persistState();
  return fullStateWithScreenshots();
}

async function mergeFormFields(payload = {}) {
  const nodeId = payload.nodeId;
  if (!nodeId) return { ok: false, error: "Missing nodeId" };

  const currentIndex = runtimeState.nodes.findIndex((item) => item.id === nodeId);
  if (currentIndex < 0) return { ok: false, error: "Node not found" };

  const current = runtimeState.nodes[currentIndex];
  if (current.status === "discarded") return { ok: false, error: "Cannot merge discarded node" };
  if (!isFormFieldNode(current)) return { ok: false, error: "Node is not a form field" };

  const formSelector = current.target?.form?.selector;
  const mergeTargets = [];
  for (const item of runtimeState.nodes.slice(currentIndex + 1)) {
    if (item.status === "discarded") continue;
    if (!isFormFieldNode(item)) break;
    if (item.tab?.tabId !== current.tab?.tabId) break;
    if (item.target?.form?.selector !== formSelector) break;
    mergeTargets.push(item);
  }

  if (!mergeTargets.length) return { ok: false, error: "No later form fields to merge" };

  const formName = current.target?.form?.text || current.target?.form?.name || current.target?.form?.id || current.tab?.title || "当前表单";
  const mergedNodes = [current, ...mergeTargets];
  current.titleOverride = `填写 ${formName}`;
  current.descriptionOverride = normalizeText(mergedNodes.map(getNodeDescription).join(" "));
  current.mergedNodeIds = Array.from(new Set([
    ...(current.mergedNodeIds || []),
    ...mergeTargets.flatMap((item) => [item.id, ...(item.mergedNodeIds || [])])
  ]));
  current.privacy = mergePrivacyFromNodes(mergedNodes);
  current.privacyMaskBoxes = mergePrivacyMaskBoxesFromNodes(mergedNodes);
  current.formMerge = {
    formSelector,
    mergedFieldCount: mergedNodes.length,
    mergedAt: new Date().toISOString()
  };
  current.status = "reviewed";
  current.reviewedAt = new Date().toISOString();
  current.updatedAt = new Date().toISOString();

  mergeTargets.forEach((item) => {
    item.status = "discarded";
    item.discardReason = `merged_into:${current.id}`;
    item.reviewedAt = new Date().toISOString();
    item.updatedAt = new Date().toISOString();
    item.titleOverride = item.titleOverride || getNodeTitle(item);
    item.descriptionOverride = item.descriptionOverride || getNodeDescription(item);
  });

  resequenceNodes();
  await persistState();
  return fullStateWithScreenshots();
}

async function splitMergedNode(payload = {}) {
  const nodeId = payload.nodeId;
  if (!nodeId) return { ok: false, error: "Missing nodeId" };

  const node = runtimeState.nodes.find((item) => item.id === nodeId);
  if (!node) return { ok: false, error: "Node not found" };
  if (!node.mergedNodeIds?.length) return { ok: false, error: "Node has no merged steps" };

  const mergedIds = new Set(node.mergedNodeIds);
  let restoredCount = 0;
  runtimeState.nodes.forEach((item) => {
    if (!mergedIds.has(item.id) || item.discardReason !== `merged_into:${node.id}`) return;
    item.status = "auto_generated";
    delete item.discardReason;
    item.updatedAt = new Date().toISOString();
    restoredCount += 1;
  });

  delete node.mergedNodeIds;
  delete node.formMerge;
  node.descriptionOverride = node.generatedInstruction || getNodeTitle(node);
  node.status = "reviewed";
  node.reviewedAt = new Date().toISOString();
  node.updatedAt = new Date().toISOString();

  if (!restoredCount) return { ok: false, error: "No merged steps restored" };

  resequenceNodes();
  await persistState();
  return fullStateWithScreenshots();
}

function isFormFieldNode(node) {
  return ["input", "select", "check", "upload"].includes(node.action) && Boolean(node.target?.form?.selector);
}

function mergePrivacyFromNodes(nodes) {
  const reasons = uniqueStrings(nodes.flatMap((node) => node.privacy?.reasons || []));
  const maskedFields = uniqueStrings(nodes.flatMap((node) => node.privacy?.maskedFields || []));
  const privacyMaskBoxes = mergePrivacyMaskBoxesFromNodes(nodes);
  return {
    containsSensitiveData: nodes.some((node) => node.privacy?.containsSensitiveData) || privacyMaskBoxes.length > 0,
    reasons,
    maskedFields,
    autoMaskApplied: nodes.some((node) => node.privacy?.autoMaskApplied),
    manualMaskApplied: nodes.some((node) => node.privacy?.manualMaskApplied)
  };
}

function mergePrivacyMaskBoxesFromNodes(nodes) {
  return nodes.flatMap((node) => Array.isArray(node.privacyMaskBoxes) ? node.privacyMaskBoxes : []);
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value)));
}

async function updateNodeText(payload = {}) {
  const nodeId = payload.nodeId;
  if (!nodeId) return { ok: false, error: "Missing nodeId" };

  const node = runtimeState.nodes.find((item) => item.id === nodeId);
  if (!node) return { ok: false, error: "Node not found" };

  if (payload.clear) {
    delete node.titleOverride;
    delete node.descriptionOverride;
    node.status = "reviewed";
    node.reviewedAt = new Date().toISOString();
    node.updatedAt = new Date().toISOString();
    await persistState();
    return fullStateWithScreenshots();
  }

  const title = normalizeText(payload.title || "");
  const description = normalizeText(payload.description || "");
  if (!title) return { ok: false, error: "Missing title" };
  if (!description) return { ok: false, error: "Missing description" };

  node.titleOverride = title;
  node.descriptionOverride = description;
  node.status = "reviewed";
  node.reviewedAt = new Date().toISOString();
  node.updatedAt = new Date().toISOString();
  await persistState();
  return fullStateWithScreenshots();
}

async function updateNodeFocus(payload = {}) {
  const nodeId = payload.nodeId;
  if (!nodeId) return { ok: false, error: "Missing nodeId" };

  const node = runtimeState.nodes.find((item) => item.id === nodeId);
  if (!node) return { ok: false, error: "Node not found" };

  if (payload.clear) {
    delete node.focusBoxOverride;
    node.status = "reviewed";
    node.reviewedAt = new Date().toISOString();
    node.updatedAt = new Date().toISOString();
    await persistState();
    return fullStateWithScreenshots();
  }

  const focusBox = normalizeFocusBox(payload.focusBox);
  if (!focusBox) return { ok: false, error: "Invalid focus box" };

  node.focusBoxOverride = focusBox;
  node.status = "reviewed";
  node.reviewedAt = new Date().toISOString();
  node.updatedAt = new Date().toISOString();
  await persistState();
  return fullStateWithScreenshots();
}

async function updateNodeDuration(payload = {}) {
  const nodeId = payload.nodeId;
  if (!nodeId) return { ok: false, error: "Missing nodeId" };

  const node = runtimeState.nodes.find((item) => item.id === nodeId);
  if (!node) return { ok: false, error: "Node not found" };

  if (payload.clear) {
    delete node.durationOverrideSeconds;
    node.status = "reviewed";
    node.reviewedAt = new Date().toISOString();
    node.updatedAt = new Date().toISOString();
    await persistState();
    return fullStateWithScreenshots();
  }

  const duration = Number(payload.durationSeconds);
  if (!Number.isFinite(duration) || duration < 1 || duration > 120) {
    return { ok: false, error: "Duration must be between 1 and 120 seconds" };
  }

  node.durationOverrideSeconds = Math.round(duration * 10) / 10;
  node.status = "reviewed";
  node.reviewedAt = new Date().toISOString();
  node.updatedAt = new Date().toISOString();
  await persistState();
  return fullStateWithScreenshots();
}

async function updateNodeVoiceover(payload = {}) {
  const nodeId = payload.nodeId;
  if (!nodeId) return { ok: false, error: "Missing nodeId" };

  const node = runtimeState.nodes.find((item) => item.id === nodeId);
  if (!node) return { ok: false, error: "Node not found" };

  if (payload.clear) {
    delete node.voiceoverText;
    delete node.voiceoverTextOverridden;
    node.status = "reviewed";
    node.reviewedAt = new Date().toISOString();
    node.updatedAt = new Date().toISOString();
    await persistState();
    return fullStateWithScreenshots();
  }

  const voiceoverText = normalizeText(payload.voiceoverText || "");
  if (!voiceoverText) return { ok: false, error: "Missing voiceover text" };
  if (voiceoverText.length > 500) return { ok: false, error: "Voiceover text is too long" };

  node.voiceoverText = voiceoverText;
  node.voiceoverTextOverridden = true;
  node.status = "reviewed";
  node.reviewedAt = new Date().toISOString();
  node.updatedAt = new Date().toISOString();
  await persistState();
  return fullStateWithScreenshots();
}

async function updateNodeMask(payload = {}) {
  const nodeId = payload.nodeId;
  if (!nodeId) return { ok: false, error: "Missing nodeId" };

  const node = runtimeState.nodes.find((item) => item.id === nodeId);
  if (!node) return { ok: false, error: "Node not found" };

  if (payload.clear) {
    node.privacyMaskBoxes = [];
  } else {
    const maskBox = normalizeFocusBox(payload.maskBox);
    if (!maskBox) return { ok: false, error: "Invalid mask box" };
    node.privacyMaskBoxes = [maskBox];
  }

  node.privacy = {
    ...(node.privacy || {}),
    containsSensitiveData: Boolean(node.privacy?.containsSensitiveData || node.privacyMaskBoxes.length),
    autoMaskApplied: Boolean(node.privacy?.autoMaskApplied && node.privacyMaskBoxes.length),
    manualMaskApplied: Boolean(node.privacyMaskBoxes.length)
  };
  node.status = "reviewed";
  node.reviewedAt = new Date().toISOString();
  node.updatedAt = new Date().toISOString();
  await persistState();
  return fullStateWithScreenshots();
}

async function startRecording() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTabIsRecordable = Boolean(activeTab?.id && !isIgnoredTab(activeTab));
  const now = new Date().toISOString();
  await cleanupCurrentSessionScreenshots();
  runtimeState = {
    status: "recording",
    session: {
      id: `rec_${Date.now()}`,
      browser: "Chrome",
      viewport: null,
      startedAt: now,
      endedAt: null,
      status: "recording"
    },
    activeTabId: activeTabIsRecordable ? activeTab.id : null,
    tabContexts: {},
    pendingNavigations: {},
    pendingTabOpens: {},
    nodes: []
  };
  if (activeTabIsRecordable) {
    await ensureTabContext(activeTab, activeTab.windowId);
    await injectRecorderContentScript(activeTab.id);
  }
  await persistState();
  return publicState();
}

async function injectRecorderContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content.js"]
    });
  } catch {
    // The manifest-declared content script will still run after the page is refreshed.
  }
}

async function cleanupCurrentSessionScreenshots() {
  await deleteScreenshotRecords(runtimeState.nodes.map((node) => node.screenshot?.id));
}

async function pauseRecording() {
  if (runtimeState.status !== "recording") return publicState();
  runtimeState.status = "paused";
  runtimeState.pendingNavigations = {};
  runtimeState.pendingTabOpens = {};
  if (runtimeState.session) runtimeState.session.status = "paused";
  await persistState();
  return publicState();
}

async function resumeRecording() {
  if (runtimeState.status !== "paused") return publicState();
  runtimeState.status = "recording";
  if (runtimeState.session) runtimeState.session.status = "recording";
  await persistState();
  return publicState();
}

async function stopRecording() {
  if (!["recording", "paused"].includes(runtimeState.status)) return publicState();
  runtimeState.status = "idle";
  runtimeState.pendingNavigations = {};
  runtimeState.pendingTabOpens = {};
  if (runtimeState.session) {
    runtimeState.session.status = "completed";
    runtimeState.session.endedAt = new Date().toISOString();
  }
  await persistState();
  return publicState();
}

async function captureOperationNode(payload, sender, eventId = null) {
  if (runtimeState.status !== "recording") return { ok: true, skipped: "not_recording" };
  if (!sender.tab?.id || isIgnoredUrl(sender.tab.url)) return { ok: true, skipped: "ignored_page" };
  if (eventId && hasRecordedEvent(eventId)) return { ok: true, duplicateEvent: true, state: publicState() };

  const context = await ensureTabContext(sender.tab, sender.tab.windowId);
  runtimeState.activeTabId = sender.tab.id;

  if (!isMeaningfulEvent(payload)) return { ok: true, skipped: "not_meaningful" };
  if (payload.action === "submit" && shouldSkipSubmitAfterEnterKey(payload, context)) {
    return { ok: true, skipped: "redundant_submit_after_key", state: publicState() };
  }
  if (payload.action === "wait" && shouldSkipWaitNode(payload, context)) {
    return { ok: true, skipped: "redundant_wait", state: publicState() };
  }

  if (payload.action === "select") await delay(250);
  const screenshot = await captureVisibleScreenshot(sender.tab.windowId, payload.viewport, getScreenshotCaptureTiming(payload.action));
  const privacy = payload.privacy || { containsSensitiveData: false, maskedFields: [] };
  const maskedValue = payload.maskedValue ?? payload.value ?? null;
  const privacyMaskBoxes = buildAutoMaskBoxes(payload);
  const hasAutoMask = Boolean(privacyMaskBoxes.length);
  const duplicateClickTarget = findMergeableClickNode(payload, context);
  if (duplicateClickTarget) {
    await mergeOperationNode(duplicateClickTarget, payload, context, screenshot, privacy, privacyMaskBoxes, hasAutoMask, "mergedClickCount", eventId);
    return { ok: true, nodeId: duplicateClickTarget.id, merged: true, duplicate: true, state: publicState() };
  }
  const mergeTarget = findMergeableInputNode(payload, context);
  if (mergeTarget) {
    await mergeOperationNode(mergeTarget, payload, context, screenshot, privacy, privacyMaskBoxes, hasAutoMask, "mergedEventCount", eventId);
    return { ok: true, nodeId: mergeTarget.id, merged: true, state: publicState() };
  }
  const node = {
    id: `node_${Date.now()}_${runtimeState.nodes.length + 1}`,
    sessionId: runtimeState.session.id,
    sequence: runtimeState.nodes.length + 1,
    action: payload.action,
    timestamp: secondsSinceSessionStart(),
    tab: {
      tabId: context.tabId,
      tabAlias: context.tabAlias,
      windowId: context.windowId,
      url: context.currentUrl,
      title: context.title,
      domain: context.domain
    },
    target: payload.target,
    key: payload.key,
    clickPoint: payload.clickPoint,
    viewport: payload.viewport,
    screenshot,
    beforeUrl: sanitizeRecordingUrl(payload.beforeUrl || context.currentUrl),
    afterUrl: sanitizeRecordingUrl(payload.afterUrl || context.currentUrl),
    waitDurationMs: payload.waitDurationMs,
    privacy: {
      ...privacy,
      autoMaskApplied: hasAutoMask,
      manualMaskApplied: false
    },
    privacyMaskBoxes,
    maskedValue,
    value: maskedValue,
    generatedInstruction: generateInstruction(payload, context),
    eventId,
    eventIds: eventId ? [eventId] : [],
    status: "auto_generated",
    capturedAt: new Date().toISOString()
  };

  runtimeState.nodes.push(node);
  await pruneScreenshotCapacity();
  await persistState();
  return { ok: true, nodeId: node.id, state: publicState() };
}

async function mergeOperationNode(node, payload, context, screenshot, privacy, privacyMaskBoxes, hasAutoMask, counterKey, eventId = null) {
  const previousScreenshotId = node.screenshot?.id;
  node.target = payload.target;
  node.key = payload.key;
  node.clickPoint = payload.clickPoint;
  node.viewport = payload.viewport;
  node.screenshot = screenshot;
  node.afterUrl = payload.afterUrl || context.currentUrl;
  node.privacy = {
    ...privacy,
    autoMaskApplied: hasAutoMask,
    manualMaskApplied: Boolean(node.privacy?.manualMaskApplied)
  };
  node.privacyMaskBoxes = node.privacy?.manualMaskApplied && node.privacyMaskBoxes?.length
    ? node.privacyMaskBoxes
    : privacyMaskBoxes;
  node.maskedValue = payload.maskedValue ?? payload.value ?? null;
  node.value = node.maskedValue;
  node.beforeUrl = sanitizeRecordingUrl(node.beforeUrl || payload.beforeUrl || context.currentUrl);
  node.afterUrl = sanitizeRecordingUrl(payload.afterUrl || context.currentUrl);
  node.generatedInstruction = generateInstruction(payload, context);
  if (eventId) node.eventIds = Array.from(new Set([...(node.eventIds || []), eventId]));
  node.updatedAt = new Date().toISOString();
  node[counterKey] = (node[counterKey] || 1) + 1;
  if (previousScreenshotId && previousScreenshotId !== screenshot.id) {
    await deleteScreenshotRecords([previousScreenshotId]);
  }
  await pruneScreenshotCapacity();
  await persistState();
}

function hasRecordedEvent(eventId) {
  return runtimeState.nodes.some((node) => node.eventId === eventId || node.eventIds?.includes(eventId));
}

function findMergeableInputNode(payload, context) {
  if (payload.action !== "input") return null;
  const selector = payload.target?.selector;
  if (!selector) return null;
  const last = runtimeState.nodes[runtimeState.nodes.length - 1];
  if (!last || last.status === "discarded") return null;
  if (last.action !== "input") return null;
  if (last.tab?.tabId !== context.tabId) return null;
  if (last.target?.selector !== selector) return null;
  if (Date.now() - new Date(last.updatedAt || last.capturedAt).getTime() > 5000) return null;
  return last;
}

function findMergeableClickNode(payload, context) {
  if (payload.action !== "click") return null;
  const selector = payload.target?.selector;
  if (!selector) return null;
  const last = runtimeState.nodes[runtimeState.nodes.length - 1];
  if (!last || last.status === "discarded") return null;
  if (last.action !== "click") return null;
  if (last.tab?.tabId !== context.tabId) return null;
  if (last.target?.selector !== selector) return null;
  if (Date.now() - new Date(last.updatedAt || last.capturedAt).getTime() > 1000) return null;
  return last;
}

function buildAutoMaskBoxes(payload = {}) {
  if (!payload.privacy?.containsSensitiveData) return [];
  const box = normalizeFocusBox(payload.target?.boundingBox);
  return box ? [box] : [];
}

async function addTabNode(action, details) {
  if (!runtimeState.session) return;
  const node = {
    id: `node_${Date.now()}_${runtimeState.nodes.length + 1}`,
    sessionId: runtimeState.session.id,
    sequence: runtimeState.nodes.length + 1,
    action,
    timestamp: secondsSinceSessionStart(),
    fromTab: details.fromTab,
    toTab: details.toTab,
    triggeredByNodeId: details.triggeredByNodeId,
    reason: details.reason,
    pageUrl: sanitizeRecordingUrl(details.pageUrl),
    pageTitle: details.pageTitle,
    screenshot: details.screenshot,
    generatedInstruction: details.generatedInstruction,
    status: "auto_generated",
    capturedAt: new Date().toISOString()
  };
  runtimeState.nodes.push(node);
  await pruneScreenshotCapacity();
  return node;
}

async function pruneScreenshotCapacity() {
  const nodesWithScreenshots = runtimeState.nodes.filter((node) => node.screenshot?.id && !node.screenshot?.error && !node.screenshot?.pruned);
  if (nodesWithScreenshots.length <= MAX_SCREENSHOT_RECORDS) return;

  const nodesToPrune = nodesWithScreenshots.slice(0, nodesWithScreenshots.length - MAX_SCREENSHOT_RECORDS);
  const prunedAt = new Date().toISOString();
  await deleteScreenshotRecords(nodesToPrune.map((node) => node.screenshot.id));
  nodesToPrune.forEach((node) => {
    node.screenshot = {
      ...node.screenshot,
      pruned: true,
      pruneReason: "capacity_limit",
      prunedAt
    };
  });
}

async function flushPendingNavigation(tabId, context, tab) {
  const pending = runtimeState.pendingNavigations?.[tabId];
  if (!pending) return;
  if (isIgnoredUrl(context.currentUrl)) {
    delete runtimeState.pendingNavigations[tabId];
    return;
  }

  const screenshot = await captureVisibleScreenshot(context.windowId || tab.windowId, viewportFromTab(tab), "after_navigation");
  const navigationNode = await addTabNode("navigation", {
    fromTab: pending.fromTab,
    toTab: pickTabForNode(context),
    triggeredByNodeId: pending.triggeredByNodeId,
    reason: pending.reason,
    pageUrl: context.currentUrl,
    pageTitle: context.title,
    screenshot,
    generatedInstruction: `页面跳转到：${context.title || context.currentUrl}`
  });
  linkNavigationTrigger(pending.triggeredByNodeId, navigationNode?.id, context.currentUrl, context.title);
  delete runtimeState.pendingNavigations[tabId];
}

function findRecentNavigationTriggerNode(tabId) {
  const last = runtimeState.nodes[runtimeState.nodes.length - 1];
  if (!last || last.status === "discarded") return null;
  if (!["click", "submit", "key"].includes(last.action)) return null;
  if (last.tab?.tabId !== tabId) return null;
  if (Date.now() - new Date(last.updatedAt || last.capturedAt).getTime() > 5000) return null;
  return last;
}

function findRecentTabOpenTriggerNode(openerTabId) {
  const last = runtimeState.nodes[runtimeState.nodes.length - 1];
  if (!last || last.status === "discarded") return null;
  if (last.action !== "click") return null;
  if (last.tab?.tabId !== openerTabId) return null;
  if (Date.now() - new Date(last.updatedAt || last.capturedAt).getTime() > 5000) return null;
  return last;
}

function findTabOpenTriggerNode(openerTabId, triggerNodeId) {
  if (triggerNodeId) {
    const triggerNode = runtimeState.nodes.find((node) => node.id === triggerNodeId);
    if (triggerNode && triggerNode.status !== "discarded") return triggerNode;
  }
  return openerTabId ? findRecentTabOpenTriggerNode(openerTabId) : null;
}

function rememberPendingTabOpen(tab = {}) {
  if (!tab.id) return;
  runtimeState.pendingTabOpens = runtimeState.pendingTabOpens || {};
  const openerTabId = tab.openerTabId || null;
  const triggerNode = openerTabId ? findRecentTabOpenTriggerNode(openerTabId) : null;
  runtimeState.pendingTabOpens[tab.id] = {
    openerTabId,
    triggerNodeId: triggerNode?.id || null,
    windowId: tab.windowId || 0,
    capturedAt: new Date().toISOString()
  };
}

async function createTabOpenNodeForTab(tab, fallbackWindowId, existingContext = null) {
  const pending = runtimeState.pendingTabOpens?.[tab.id] || null;
  const openerTabId = tab.openerTabId || pending?.openerTabId || null;
  const context = existingContext || await ensureTabContext(tab, fallbackWindowId);
  const openerContext = openerTabId ? runtimeState.tabContexts[openerTabId] : null;
  const triggerNode = findTabOpenTriggerNode(openerTabId, pending?.triggerNodeId);
  const tabOpenNode = await addTabNode("tab_open", {
    fromTab: openerContext ? pickTabForNode(openerContext) : undefined,
    toTab: pickTabForNode(context),
    triggeredByNodeId: triggerNode?.id,
    reason: openerTabId ? "link_opened" : "system_detected",
    pageUrl: context.currentUrl,
    pageTitle: context.title,
    generatedInstruction: `打开${context.tabAlias}。`
  });
  linkTabOpenTrigger(triggerNode?.id, tabOpenNode?.id, context.currentUrl);
  if (runtimeState.pendingTabOpens) delete runtimeState.pendingTabOpens[tab.id];
  return tabOpenNode;
}

function linkNavigationTrigger(triggerNodeId, navigationNodeId, targetUrl, targetTitle = "") {
  if (!triggerNodeId || !navigationNodeId) return;
  const triggerNode = runtimeState.nodes.find((node) => node.id === triggerNodeId);
  if (!triggerNode || triggerNode.status === "discarded") return;
  triggerNode.triggeredNavigationNodeId = navigationNodeId;
  triggerNode.navigationTargetUrl = sanitizeRecordingUrl(targetUrl) || null;
  triggerNode.navigationTargetTitle = targetTitle || null;
  triggerNode.updatedAt = new Date().toISOString();
}

function linkTabOpenTrigger(triggerNodeId, tabOpenNodeId, targetUrl) {
  if (!triggerNodeId || !tabOpenNodeId) return;
  const triggerNode = runtimeState.nodes.find((node) => node.id === triggerNodeId);
  if (!triggerNode || triggerNode.status === "discarded") return;
  triggerNode.triggeredTabNodeId = tabOpenNodeId;
  triggerNode.tabTargetUrl = sanitizeRecordingUrl(targetUrl) || null;
  triggerNode.updatedAt = new Date().toISOString();
}

function resequenceNodes() {
  runtimeState.nodes.forEach((node, index) => {
    node.sequence = index + 1;
  });
}

function getNodeTitle(node) {
  const isTabTransition = node.action?.startsWith("tab_");
  if (node.titleOverride) return node.titleOverride;
  return isTabTransition ? getTabNodeTitle(node) : getOperationNodeTitle(node);
}

function getNodeDescription(node) {
  return node.descriptionOverride || node.generatedInstruction || getNodeTitle(node);
}

function getOperationNodeTitle(node) {
  const target = node.target || {};
  const name = target.text || target.ariaLabel || target.labelText || target.placeholder || target.title || target.nearbyText || target.name || target.id || target.type || "目标元素";
  if (node.action === "input") return `填写 ${name}`;
  if (node.action === "select") return `选择 ${name}`;
  if (node.action === "check") return `勾选 ${name}`;
  if (node.action === "upload") return `上传 ${name}`;
  if (node.action === "submit") return "提交表单";
  if (node.action === "key") return `按下 ${node.key || "快捷键"}：${name}`;
  if (node.action === "modal_open") return `弹窗出现：${name}`;
  if (node.action === "modal_close") return `关闭弹窗：${name}`;
  return `点击 ${name}`;
}

function getTabNodeTitle(node) {
  if (node.action === "tab_open") return `打开${node.toTab?.tabAlias || "新标签页"}`;
  if (node.action === "tab_close") return `关闭${node.fromTab?.tabAlias || "标签页"}`;
  return `切换到${node.toTab?.tabAlias || "目标标签页"}`;
}

function shouldSkipTabSwitch(fromContext, toContext) {
  const last = runtimeState.nodes[runtimeState.nodes.length - 1];
  if (!last || last.action !== "tab_open") return false;
  const sameTarget = last.toTab?.tabId === toContext.tabId;
  const sameSource = !last.fromTab || last.fromTab?.tabId === fromContext.tabId;
  const closeTime = Date.now() - new Date(last.capturedAt).getTime() < 2000;
  return sameTarget && sameSource && closeTime;
}

async function ensureTabContext(tab, fallbackWindowId) {
  const tabId = tab?.id;
  if (!tabId) throw new Error("Missing tab id");
  const existing = runtimeState.tabContexts[tabId];
  const url = sanitizeRecordingUrl(tab.url || existing?.currentUrl || "");
  const title = tab.title || existing?.title || "";
  const domain = extractDomain(url);
  const now = new Date().toISOString();
  const tabAlias = existing?.tabAlias || makeTabAlias(Object.keys(runtimeState.tabContexts).length, title, domain);

  const context = {
    tabId,
    tabAlias,
    windowId: tab.windowId || fallbackWindowId || existing?.windowId || 0,
    openerTabId: tab.openerTabId || existing?.openerTabId,
    firstUrl: existing?.firstUrl || url,
    currentUrl: url,
    title,
    createdAt: existing?.createdAt || now,
    lastActiveAt: now,
    domain
  };
  runtimeState.tabContexts[tabId] = context;
  return context;
}

function makeTabAlias(index, title, domain) {
  const letter = String.fromCharCode("A".charCodeAt(0) + Math.min(index, 25));
  const name = normalizeText(title || domain || "未命名页面").slice(0, 32);
  return `标签页 ${letter}：${name}`;
}

function generateInstruction(payload, context) {
  const targetName = payload.target?.text || payload.target?.ariaLabel || payload.target?.labelText || payload.target?.placeholder || payload.target?.title || payload.target?.nearbyText || payload.target?.name || payload.target?.id || "目标元素";
  if (payload.action === "wait") return `等待${formatDuration(payload.waitDurationMs)}，直到${context.title || targetName || "当前页面"}加载完成。`;
  if (payload.action === "input") return `在${targetName}中输入内容。`;
  if (payload.action === "select") return `在${targetName}中选择选项。`;
  if (payload.action === "check") return `勾选${targetName}。`;
  if (payload.action === "upload") return `在${targetName}中上传文件。`;
  if (payload.action === "submit") return `提交${context.title || "当前页面"}中的表单。`;
  if (payload.action === "key") return `按下 ${payload.key || "快捷键"}，操作${targetName}。`;
  if (payload.action === "modal_open") return `页面出现弹窗：${targetName}。`;
  if (payload.action === "modal_close") return `关闭弹窗：${targetName}。`;
  return `点击${targetName}。`;
}

function shouldSkipWaitNode(payload, context) {
  const last = runtimeState.nodes[runtimeState.nodes.length - 1];
  if (!last) return false;
  if (last.tab?.tabId !== context.tabId && last.toTab?.tabId !== context.tabId) return false;
  if (last.action === "navigation") return true;
  if (last.action !== "wait") return false;
  if ((last.afterUrl || last.pageUrl) !== (payload.afterUrl || context.currentUrl)) return false;
  return Date.now() - new Date(last.updatedAt || last.capturedAt).getTime() < 15000;
}

function shouldSkipSubmitAfterEnterKey(payload, context) {
  const last = runtimeState.nodes[runtimeState.nodes.length - 1];
  if (!last || last.status === "discarded") return false;
  if (last.action !== "key" || last.key !== "Enter") return false;
  if (last.tab?.tabId !== context.tabId) return false;
  const sameForm = payload.target?.form?.selector && last.target?.form?.selector && payload.target.form.selector === last.target.form.selector;
  const sameTarget = payload.target?.selector && last.target?.selector && payload.target.selector === last.target.selector;
  if (!sameForm && !sameTarget) return false;
  return Date.now() - new Date(last.updatedAt || last.capturedAt).getTime() < 1200;
}

function formatDuration(milliseconds) {
  const seconds = Math.max(1, Math.round(Number(milliseconds || 0) / 100) / 10);
  return `${seconds} 秒`;
}

async function captureVisibleScreenshot(windowId, viewport, captureTiming = "after_action") {
  const id = `img_${Date.now()}`;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    await putScreenshotRecord({
      id,
      dataUrl,
      width: viewport?.width || null,
      height: viewport?.height || null,
      viewportWidth: viewport?.width || null,
      viewportHeight: viewport?.height || null,
      devicePixelRatio: viewport?.devicePixelRatio || null,
      scrollX: viewport?.scrollX || 0,
      scrollY: viewport?.scrollY || 0,
      captureTiming,
      capturedAt: new Date().toISOString()
    });
    return screenshotMeta(id, viewport, captureTiming);
  } catch (error) {
    return {
      id,
      error: String(error?.message || error),
      captureTiming,
      capturedAt: new Date().toISOString()
    };
  }
}

async function exportJson() {
  const fullState = await fullStateWithScreenshots();
  const payload = buildRecordingExportPayload(fullState);
  const json = JSON.stringify(payload, null, 2);
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  await chrome.downloads.download({
    url,
    filename: `sop-recording-${runtimeState.session?.id || Date.now()}.json`,
    saveAs: true
  });
  return { ok: true };
}

function buildRecordingExportPayload(fullState) {
  return {
    session: fullState.session,
    tabContexts: fullState.tabContexts,
    nodes: fullState.nodes.map(sanitizeNodeForJsonExport)
  };
}

function sanitizeNodeForJsonExport(node) {
  if (!node?.screenshot?.dataUrl) return node;
  const containsSensitiveData = Boolean(node.privacy?.containsSensitiveData);
  const hasMaskBoxes = Boolean(node.privacyMaskBoxes?.length);
  if (!containsSensitiveData && !hasMaskBoxes) return node;

  const { dataUrl, ...screenshot } = node.screenshot;
  return {
    ...node,
    screenshot: {
      ...screenshot,
      redactedForPrivacy: true,
      redactionReason: containsSensitiveData ? "contains_sensitive_data" : "has_privacy_mask",
      redactedAt: new Date().toISOString()
    }
  };
}

function sanitizeTabContextsForOutput(tabContexts = {}) {
  return Object.fromEntries(Object.entries(tabContexts || {}).map(([tabId, context]) => [tabId, sanitizeTabContextForOutput(context)]));
}

function sanitizeTabContextForOutput(context = {}) {
  const sanitized = { ...context };
  sanitizeUrlProperty(sanitized, "firstUrl");
  sanitizeUrlProperty(sanitized, "currentUrl");
  return sanitized;
}

function sanitizeNodeUrlsForOutput(node = {}) {
  const sanitized = {
    ...node,
    tab: sanitizeTabReferenceForOutput(node.tab),
    fromTab: sanitizeTabReferenceForOutput(node.fromTab),
    toTab: sanitizeTabReferenceForOutput(node.toTab)
  };
  ["beforeUrl", "afterUrl", "pageUrl", "navigationTargetUrl", "tabTargetUrl"].forEach((key) => sanitizeUrlProperty(sanitized, key));
  return sanitized;
}

function sanitizeTabReferenceForOutput(tab) {
  if (!tab) return tab;
  const sanitized = { ...tab };
  sanitizeUrlProperty(sanitized, "url");
  return sanitized;
}

function sanitizeUrlProperty(target, key) {
  if (!Object.prototype.hasOwnProperty.call(target, key)) return;
  if (target[key] === null) return;
  target[key] = sanitizeRecordingUrl(target[key]);
}

function privacyAuditState() {
  const activeNodes = runtimeState.nodes.filter((node) => node.status !== "discarded");
  const sensitiveNodes = activeNodes.filter((node) => node.privacy?.containsSensitiveData);
  const unmaskedNodes = sensitiveNodes.filter((node) => !(node.privacyMaskBoxes || []).length);
  return {
    ok: true,
    sensitiveCount: sensitiveNodes.length,
    unmaskedCount: unmaskedNodes.length
  };
}

async function fullStateWithScreenshots() {
  const screenshotMap = await getScreenshotRecords(runtimeState.nodes.map((node) => node.screenshot?.id));
  return {
    ok: true,
    status: runtimeState.status,
    session: runtimeState.session,
    tabContexts: sanitizeTabContextsForOutput(runtimeState.tabContexts),
    nodes: runtimeState.nodes.map((node) => {
      const screenshotRecord = screenshotMap[node.screenshot?.id];
      const hydratedNode = screenshotRecord ? { ...node, screenshot: { ...node.screenshot, dataUrl: screenshotRecord.dataUrl } } : node;
      return sanitizeNodeUrlsForOutput(hydratedNode);
    })
  };
}

function screenshotMeta(id, viewport, captureTiming = "after_action") {
  return {
    id,
    width: viewport?.width || null,
    height: viewport?.height || null,
    viewportWidth: viewport?.width || null,
    viewportHeight: viewport?.height || null,
    devicePixelRatio: viewport?.devicePixelRatio || null,
    scrollX: viewport?.scrollX || 0,
    scrollY: viewport?.scrollY || 0,
    captureTiming,
    capturedAt: new Date().toISOString()
  };
}

function getScreenshotCaptureTiming(action) {
  if (action === "click") return "before_action_preferred";
  if (action === "navigation") return "after_navigation";
  if (action === "wait") return "after_wait";
  if (action === "modal_open" || action === "modal_close") return "after_action";
  if (["input", "select", "check", "upload", "submit"].includes(action)) return "after_action";
  return "after_action";
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isMeaningfulEvent(payload) {
  if (!payload?.action) return false;
  if (!isVisibleTarget(payload)) return false;
  if (["input", "select", "check", "submit", "key", "modal_open", "modal_close"].includes(payload.action)) return true;
  if (payload.action === "wait") return Number(payload.waitDurationMs) >= 1200;
  if (payload.action === "click") {
    const target = payload.target || {};
    return Boolean(target.text || target.ariaLabel || target.placeholder || target.title || target.labelText || target.nearbyText || target.name || target.id || target.type !== "unknown");
  }
  return true;
}

function isVisibleTarget(payload) {
  if (!payload.target) return true;
  if (payload.target.visibility) return Boolean(payload.target.visibility.visible);
  const box = payload.target.boundingBox;
  if (!box) return true;
  return Number(box.width) > 0 && Number(box.height) > 0;
}

function pickTabForNode(context) {
  return {
    tabId: context.tabId,
    tabAlias: context.tabAlias,
    url: sanitizeRecordingUrl(context.currentUrl),
    title: context.title,
    domain: context.domain
  };
}

function secondsSinceSessionStart() {
  if (!runtimeState.session?.startedAt) return 0;
  return Math.round((Date.now() - new Date(runtimeState.session.startedAt).getTime()) / 100) / 10;
}

async function safeGetTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return { id: tabId, url: "", title: "" };
  }
}

function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function sanitizeRecordingUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return `${parsed.origin}${parsed.pathname}`.slice(0, 500);
  } catch {
    return raw.split(/[?#]/, 1)[0].slice(0, 500);
  }
}

function isIgnoredTab(tab = {}) {
  return isIgnoredUrl(tab.url || tab.pendingUrl || "");
}

function isInitialBlankTab(tab = {}) {
  const raw = String(tab.url || tab.pendingUrl || "").trim().toLowerCase();
  return !raw || raw === "about:blank";
}

function isIgnoredUrl(url = "") {
  const raw = String(url || "").trim().toLowerCase();
  return !raw ||
    raw.startsWith("chrome://") ||
    raw.startsWith("chrome-extension://") ||
    raw.startsWith("chrome-untrusted://") ||
    raw.startsWith("edge://") ||
    raw.startsWith("about:") ||
    raw.startsWith("devtools://");
}

function normalizeText(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function viewportFromTab(tab = {}) {
  return {
    width: tab.width || null,
    height: tab.height || null,
    devicePixelRatio: null
  };
}

function normalizeFocusBox(box = {}) {
  const x = Number(box.x);
  const y = Number(box.y);
  const width = Number(box.width);
  const height = Number(box.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width <= 0 || height <= 0) return null;
  return {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    width: Math.round(width),
    height: Math.round(height),
    coordinateSpace: "viewport-css-pixel"
  };
}

async function hydrateState() {
  const saved = await chrome.storage.local.get(STORAGE_KEY);
  if (saved[STORAGE_KEY]) runtimeState = saved[STORAGE_KEY];
  if (!runtimeState.pendingNavigations) runtimeState.pendingNavigations = {};
  if (!runtimeState.pendingTabOpens) runtimeState.pendingTabOpens = {};
}

async function persistState() {
  await chrome.storage.local.set({ [STORAGE_KEY]: runtimeState });
  const text = runtimeState.status === "recording" ? String(runtimeState.nodes.length) : "";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: "#1b6aa8" });
}

function publicState() {
  return {
    ok: true,
    status: runtimeState.status,
    session: runtimeState.session,
    nodeCount: runtimeState.nodes.length,
    tabCount: Object.keys(runtimeState.tabContexts).length
  };
}
