const STORAGE_KEY = "sopRecorderState";

importScripts("db.js");

const initialState = {
  status: "idle",
  session: null,
  activeTabId: null,
  tabContexts: {},
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

  const fromTabId = runtimeState.activeTabId;
  runtimeState.activeTabId = tabId;

  const tab = await safeGetTab(tabId);
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

  const context = await ensureTabContext(tab, tab.windowId);
  const openerContext = tab.openerTabId ? runtimeState.tabContexts[tab.openerTabId] : null;
  await addTabNode("tab_open", {
    fromTab: openerContext ? pickTabForNode(openerContext) : undefined,
    toTab: pickTabForNode(context),
    reason: tab.openerTabId ? "link_opened" : "system_detected",
    pageUrl: context.currentUrl,
    pageTitle: context.title,
    generatedInstruction: `打开${context.tabAlias}。`
  });
  await persistState();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await hydrateState();
  if (runtimeState.status !== "recording") return;
  const context = runtimeState.tabContexts[tabId];
  if (!context) return;

  await addTabNode("tab_close", {
    fromTab: pickTabForNode(context),
    reason: "user_switch",
    pageUrl: context.currentUrl,
    pageTitle: context.title,
    generatedInstruction: `关闭${context.tabAlias}。`
  });
  delete runtimeState.tabContexts[tabId];
  await persistState();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && !changeInfo.title) return;
  await hydrateState();
  if (runtimeState.status === "idle") return;

  const existing = runtimeState.tabContexts[tabId];
  const context = await ensureTabContext(tab, tab.windowId);
  if (changeInfo.url && existing && runtimeState.status === "recording") {
    await addTabNode("navigation", {
      fromTab: pickTabForNode(existing),
      toTab: pickTabForNode(context),
      reason: "system_detected",
      pageUrl: context.currentUrl,
      pageTitle: context.title,
      generatedInstruction: `页面跳转到：${context.title || context.currentUrl}`
    });
  }
  await persistState();
});

async function handleMessage(message, sender) {
  await hydrateState();
  switch (message?.type) {
    case "recorder:start":
      return startRecording();
    case "recorder:pause":
      runtimeState.status = "paused";
      await persistState();
      return publicState();
    case "recorder:resume":
      runtimeState.status = "recording";
      await persistState();
      return publicState();
    case "recorder:stop":
      runtimeState.status = "idle";
      if (runtimeState.session) runtimeState.session.endedAt = new Date().toISOString();
      await persistState();
      return publicState();
    case "recorder:get-state":
      return publicState();
    case "recorder:get-full-state":
      return fullStateWithScreenshots();
    case "recorder:reset":
      await deleteScreenshotRecords(runtimeState.nodes.map((node) => node.screenshot?.id));
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
    case "recorder:event":
      return captureOperationNode(message.payload, sender);
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

  node.status = status;
  node.reviewedAt = new Date().toISOString();
  await persistState();
  return fullStateWithScreenshots();
}

async function startRecording() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const now = new Date().toISOString();
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
    activeTabId: activeTab?.id || null,
    tabContexts: {},
    nodes: []
  };
  if (activeTab?.id) await ensureTabContext(activeTab, activeTab.windowId);
  await persistState();
  return publicState();
}

async function captureOperationNode(payload, sender) {
  if (runtimeState.status !== "recording") return { ok: true, skipped: "not_recording" };
  if (!sender.tab?.id || isIgnoredUrl(sender.tab.url)) return { ok: true, skipped: "ignored_page" };

  const context = await ensureTabContext(sender.tab, sender.tab.windowId);
  runtimeState.activeTabId = sender.tab.id;

  if (!isMeaningfulEvent(payload)) return { ok: true, skipped: "not_meaningful" };
  if (isDuplicate(payload, context)) return { ok: true, skipped: "duplicate" };

  const screenshot = await captureVisibleScreenshot(sender.tab.windowId, payload.viewport);
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
    clickPoint: payload.clickPoint,
    screenshot,
    beforeUrl: payload.beforeUrl || context.currentUrl,
    afterUrl: payload.afterUrl || context.currentUrl,
    privacy: payload.privacy || { containsSensitiveData: false, maskedFields: [] },
    value: payload.value,
    generatedInstruction: generateInstruction(payload, context),
    status: "auto_generated",
    capturedAt: new Date().toISOString()
  };

  runtimeState.nodes.push(node);
  await persistState();
  return { ok: true, nodeId: node.id, state: publicState() };
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
    reason: details.reason,
    pageUrl: details.pageUrl,
    pageTitle: details.pageTitle,
    generatedInstruction: details.generatedInstruction,
    status: "auto_generated",
    capturedAt: new Date().toISOString()
  };
  runtimeState.nodes.push(node);
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
  const url = tab.url || existing?.currentUrl || "";
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
  const targetName = payload.target?.text || payload.target?.labelText || payload.target?.placeholder || payload.target?.ariaLabel || "目标元素";
  if (payload.action === "input") return `在${targetName}中输入内容。`;
  if (payload.action === "select") return `在${targetName}中选择选项。`;
  if (payload.action === "check") return `勾选${targetName}。`;
  if (payload.action === "submit") return `提交${context.title || "当前页面"}中的表单。`;
  return `点击${targetName}。`;
}

async function captureVisibleScreenshot(windowId, viewport) {
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
      capturedAt: new Date().toISOString()
    });
    return screenshotMeta(id, viewport);
  } catch (error) {
    return {
      id,
      error: String(error?.message || error),
      capturedAt: new Date().toISOString()
    };
  }
}

async function exportJson() {
  const fullState = await fullStateWithScreenshots();
  const payload = {
    session: fullState.session,
    tabContexts: fullState.tabContexts,
    nodes: fullState.nodes
  };
  const json = JSON.stringify(payload, null, 2);
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  await chrome.downloads.download({
    url,
    filename: `sop-recording-${runtimeState.session?.id || Date.now()}.json`,
    saveAs: true
  });
  return { ok: true };
}

async function fullStateWithScreenshots() {
  const screenshotMap = await getScreenshotRecords(runtimeState.nodes.map((node) => node.screenshot?.id));
  return {
    ok: true,
    status: runtimeState.status,
    session: runtimeState.session,
    tabContexts: runtimeState.tabContexts,
    nodes: runtimeState.nodes.map((node) => {
      const screenshotRecord = screenshotMap[node.screenshot?.id];
      return screenshotRecord ? { ...node, screenshot: { ...node.screenshot, dataUrl: screenshotRecord.dataUrl } } : node;
    })
  };
}

function screenshotMeta(id, viewport) {
  return {
    id,
    width: viewport?.width || null,
    height: viewport?.height || null,
    viewportWidth: viewport?.width || null,
    viewportHeight: viewport?.height || null,
    devicePixelRatio: viewport?.devicePixelRatio || null,
    capturedAt: new Date().toISOString()
  };
}

function isMeaningfulEvent(payload) {
  if (!payload?.action) return false;
  if (["input", "select", "check", "submit"].includes(payload.action)) return true;
  if (payload.action === "click") {
    const target = payload.target || {};
    return Boolean(target.text || target.ariaLabel || target.placeholder || target.labelText || target.type !== "unknown");
  }
  return true;
}

function isDuplicate(payload, context) {
  const last = runtimeState.nodes[runtimeState.nodes.length - 1];
  if (!last || !last.target || !payload.target) return false;
  const sameTarget = last.target.selector && last.target.selector === payload.target.selector;
  const closeTime = Date.now() - new Date(last.capturedAt).getTime() < 700;
  return last.action === payload.action && sameTarget && last.tab?.tabId === context.tabId && closeTime;
}

function pickTabForNode(context) {
  return {
    tabId: context.tabId,
    tabAlias: context.tabAlias,
    url: context.currentUrl,
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

function isIgnoredUrl(url = "") {
  return !url || url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("edge://") || url.startsWith("about:");
}

function normalizeText(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

async function hydrateState() {
  const saved = await chrome.storage.local.get(STORAGE_KEY);
  if (saved[STORAGE_KEY]) runtimeState = saved[STORAGE_KEY];
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
