(() => {
var INPUT_DEBOUNCE_MS = 800;
var PAGE_LOAD_WAIT_THRESHOLD_MS = 1200;
var MODAL_SCAN_DEBOUNCE_MS = 150;
var ACTION_TARGET_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "label",
  "select",
  "textarea",
  "summary",
  "[onclick]",
  "[tabindex]",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='checkbox']",
  "[role='radio']",
  "td",
  "th",
  "[role='cell']",
  "[role='gridcell']",
  "[role='row']"
].join(",");
var inputTimers = new WeakMap();
var pendingInputTargets = new Set();
var activeModalTargets = new Map();
var recentCheckClickPoints = new WeakMap();
var pendingCheckClickTimers = new WeakMap();
var recentCheckSentAt = new WeakMap();
var recentPreActionClicks = new WeakMap();
var modalScanTimer = null;
var EVENT_QUEUE_KEY = "sopRecorderPendingEvents";
var MAX_QUEUED_EVENTS = 80;
var MAX_EVENT_DELIVERY_ATTEMPTS = 8;
var MAX_EVENT_QUEUE_AGE_MS = 2 * 60 * 1000;

var CONTENT_INSTANCE_ID = `content_${Date.now()}_${Math.random().toString(36).slice(2)}`;
window.__sopRecorderContentInstanceId = CONTENT_INSTANCE_ID;
window.__sopRecorderContentLoadedAt = Date.now();

window.addEventListener("error", suppressInvalidatedRuntimeError, true);
window.addEventListener("unhandledrejection", suppressInvalidatedRuntimeError, true);

drainQueuedRecorderEvents();

if (document.readyState === "complete") {
  window.setTimeout(reportPageLoadWait, 0);
} else {
  window.addEventListener("load", reportPageLoadWait, { once: true });
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", startModalObserver, { once: true });
} else {
  window.setTimeout(startModalObserver, 0);
}

document.addEventListener("pointerdown", (event) => {
  if (!isActiveContentInstance()) return;
  const clickPoint = getClickPoint(event);
  const target = resolveActionTarget(event.target, clickPoint);
  if (!target || isCheckableTarget(target) || !shouldCaptureBeforeClick(target)) return;
  flushPendingInputs();
  recentPreActionClicks.set(target, Date.now());
  sendClickEvent(target, clickPoint, { preAction: true });
}, true);

document.addEventListener("click", (event) => {
  if (!isActiveContentInstance()) return;
  const clickPoint = getClickPoint(event);
  const target = resolveActionTarget(event.target, clickPoint);
  if (!target) return;
  if (shouldSkipAfterPreActionClick(target)) return;
  flushPendingInputs();
  if (isCheckableTarget(target)) {
    const checkTarget = getCheckableInput(target) || target;
    recentCheckClickPoints.set(checkTarget, clickPoint);
    scheduleCheckClickEvent(checkTarget, clickPoint);
    return;
  }
  sendClickEvent(target, clickPoint);
}, true);

document.addEventListener("input", (event) => {
  if (!isActiveContentInstance()) return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
  scheduleInputEvent(target);
}, true);

document.addEventListener("change", (event) => {
  if (!isActiveContentInstance()) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target instanceof HTMLSelectElement) {
    sendInputLikeEvent(target, "select");
    return;
  }
  if (target instanceof HTMLInputElement && target.type === "file") {
    sendInputLikeEvent(target, "upload");
    return;
  }
  if (target instanceof HTMLInputElement && ["checkbox", "radio"].includes(target.type)) {
    if (shouldSkipCheckChange(target)) return;
    sendInputLikeEvent(target, "check", recentCheckClickPoints.get(target) || null);
  }
}, true);

document.addEventListener("submit", (event) => {
  if (!isActiveContentInstance()) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  flushPendingInputs();
  sendRecorderEvent({
    action: "submit",
    target: extractTarget(target),
    viewport: getViewport(),
    beforeUrl: location.href,
    privacy: detectPrivacy(target)
  });
}, true);

document.addEventListener("keydown", (event) => {
  if (!isActiveContentInstance()) return;
  if (event.repeat || !["Enter", "Escape"].includes(event.key)) return;
  const baseTarget = event.target instanceof Element ? event.target : document.activeElement;
  if (!(baseTarget instanceof Element)) return;
  const target = resolveActionTarget(baseTarget) || baseTarget;
  flushPendingInputs();
  sendRecorderEvent({
    action: "key",
    key: event.key,
    target: extractTarget(target),
    viewport: getViewport(),
    beforeUrl: location.href,
    privacy: detectPrivacy(target)
  });
}, true);

window.addEventListener("pagehide", () => {
  if (isActiveContentInstance()) flushPendingInputs();
}, { capture: true });
window.addEventListener("beforeunload", () => {
  if (isActiveContentInstance()) flushPendingInputs();
}, { capture: true });
document.addEventListener("visibilitychange", () => {
  if (!isActiveContentInstance()) return;
  if (document.visibilityState === "hidden") flushPendingInputs();
}, true);

function scheduleInputEvent(target) {
  pendingInputTargets.add(target);
  window.clearTimeout(inputTimers.get(target));
  inputTimers.set(target, window.setTimeout(() => {
    if (!isActiveContentInstance()) return;
    flushPendingInput(target);
  }, INPUT_DEBOUNCE_MS));
}

function flushPendingInputs() {
  if (!isActiveContentInstance()) return;
  Array.from(pendingInputTargets).forEach((target) => flushPendingInput(target));
}

function flushPendingInput(target) {
  if (!pendingInputTargets.has(target)) return;
  window.clearTimeout(inputTimers.get(target));
  inputTimers.delete(target);
  pendingInputTargets.delete(target);
  sendInputLikeEvent(target, "input");
}

function scheduleCheckClickEvent(target, clickPoint) {
  window.clearTimeout(pendingCheckClickTimers.get(target));
  pendingCheckClickTimers.set(target, window.setTimeout(() => {
    pendingCheckClickTimers.delete(target);
    if (!isActiveContentInstance()) return;
    recentCheckSentAt.set(target, Date.now());
    sendInputLikeEvent(target, "check", clickPoint);
  }, 160));
}

function shouldSkipCheckChange(target) {
  if (pendingCheckClickTimers.has(target)) return true;
  const sentAt = recentCheckSentAt.get(target);
  return Boolean(sentAt && Date.now() - sentAt < 500);
}

function sendInputLikeEvent(target, action, clickPoint = null) {
  const privacy = detectPrivacy(target);
  const maskedValue = getMaskedValue(target, privacy.containsSensitiveData);
  const checkedState = action === "check" ? getCheckedState(target) : null;
  sendRecorderEvent({
    action,
    target: extractTarget(target),
    maskedValue,
    value: action === "check" && checkedState ? checkedState.label : maskedValue,
    checked: checkedState?.checked ?? null,
    clickPoint,
    viewport: getViewport(),
    beforeUrl: location.href,
    privacy
  });
}

function getClickPoint(event) {
  return {
    x: event.clientX,
    y: event.clientY,
    coordinateSpace: "viewport-css-pixel"
  };
}

function sendClickEvent(target, clickPoint, options = {}) {
  sendRecorderEvent({
    action: "click",
    target: extractTarget(target),
    clickPoint,
    viewport: getViewport(),
    beforeUrl: location.href,
    privacy: detectPrivacy(target),
    preAction: Boolean(options.preAction)
  });
}

function shouldSkipAfterPreActionClick(target) {
  const timestamp = recentPreActionClicks.get(target);
  if (!timestamp) return false;
  if (Date.now() - timestamp > 1200) return false;
  recentPreActionClicks.delete(target);
  return true;
}

function shouldCaptureBeforeClick(target) {
  if (!(target instanceof Element)) return false;
  const type = inferTargetType(target);
  if (["button", "link", "menuitem", "table_cell", "table_row"].includes(type)) return true;
  if (target.hasAttribute("onclick")) return true;
  if (window.getComputedStyle(target).cursor === "pointer" && !["input", "select", "checkbox", "radio", "upload"].includes(type)) return true;
  const text = normalizeText([
    target.innerText,
    target.textContent,
    target.getAttribute("aria-label"),
    target.getAttribute("title"),
    target.getAttribute("name"),
    target.id
  ].filter(Boolean).join(" ")).toLowerCase();
  return /save|confirm|submit|delete|discard|close|ok|yes|保存|确认|提交|删除|关闭|取消|确定/.test(text);
}

function isCheckableTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLInputElement && ["checkbox", "radio"].includes(target.type)) return true;
  if (target instanceof HTMLLabelElement && target.control instanceof HTMLInputElement && ["checkbox", "radio"].includes(target.control.type)) return true;
  const role = target.getAttribute("role");
  return ["checkbox", "radio", "switch"].includes(role || "") || target.hasAttribute("aria-checked") || isCheckboxLikeElement(target);
}

function getCheckedState(target) {
  const input = getCheckableInput(target);
  if (input) {
    const checked = Boolean(input.checked);
    return {
      checked,
      label: `${checked ? "已勾选" : "已取消勾选"} ${getElementDisplayName(input)}`
    };
  }
  const ariaChecked = target instanceof Element ? target.getAttribute("aria-checked") : null;
  if (ariaChecked) {
    const checked = ariaChecked === "true";
    return {
      checked,
      label: `${checked ? "已勾选" : "已取消勾选"} ${getElementDisplayName(target)}`
    };
  }
  if (target instanceof Element && isCheckboxLikeElement(target)) {
    const checked = isCheckboxLikeChecked(target);
    return {
      checked,
      label: `${checked ? "已勾选" : "已取消勾选"} ${getElementDisplayName(target)}`
    };
  }
  return null;
}

function getCheckableInput(target) {
  if (target instanceof HTMLInputElement && ["checkbox", "radio"].includes(target.type)) return target;
  if (target instanceof HTMLLabelElement && target.control instanceof HTMLInputElement && ["checkbox", "radio"].includes(target.control.type)) return target.control;
  const input = target instanceof Element ? target.closest("label")?.querySelector("input[type='checkbox'], input[type='radio']") : null;
  if (input instanceof HTMLInputElement) return input;
  const compactOwner = findCompactCheckableOwner(target);
  if (compactOwner) {
    const ownedInput = compactOwner.querySelector("input[type='checkbox'], input[type='radio']");
    if (ownedInput instanceof HTMLInputElement) return ownedInput;
  }
  return null;
}

function findCompactCheckableOwner(target) {
  if (!(target instanceof Element)) return null;
  let current = target;
  let depth = 0;
  while (current && current !== document.body && depth < 4) {
    if (isExplicitCheckable(current) || isCheckboxLikeElement(current) || isCompactCheckableBox(current)) return current;
    current = current.parentElement;
    depth += 1;
  }
  return null;
}

function getElementDisplayName(element) {
  return normalizeText(
    findLabelText(element) ||
    element.getAttribute("aria-label") ||
    element.getAttribute("title") ||
    element.getAttribute("name") ||
    element.id ||
    element.innerText ||
    element.textContent ||
    element.type ||
    (isCheckboxLikeElement(element) ? "多选框" : "") ||
    "目标元素"
  ).slice(0, 120);
}

function reportPageLoadWait() {
  if (!isActiveContentInstance()) return;
  const duration = getPageLoadDuration();
  if (duration < PAGE_LOAD_WAIT_THRESHOLD_MS) return;
  sendRecorderEvent({
    action: "wait",
    target: getPageTarget(),
    waitDurationMs: duration,
    viewport: getViewport(),
    beforeUrl: location.href,
    afterUrl: location.href,
    privacy: { containsSensitiveData: false, reasons: [], maskedFields: [] }
  });
}

function startModalObserver() {
  if (!isActiveContentInstance()) return;
  scanModals({ initial: true });
  const observer = new MutationObserver(() => {
    if (!isActiveContentInstance()) return;
    window.clearTimeout(modalScanTimer);
    modalScanTimer = window.setTimeout(scanModals, MODAL_SCAN_DEBOUNCE_MS);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["open", "hidden", "style", "class", "aria-hidden"]
  });
}

function scanModals(options = {}) {
  if (!isActiveContentInstance()) return;
  const currentTargets = new Map();
  getVisibleModalElements().forEach((element) => {
    const target = {
      ...extractTarget(element),
      type: "dialog"
    };
    const key = target.selector || `${target.type}:${target.text || target.ariaLabel || target.id || target.name}`;
    currentTargets.set(key, target);
    if (!options.initial && !activeModalTargets.has(key)) {
      sendModalEvent("modal_open", target);
    }
  });

  if (!options.initial) {
    activeModalTargets.forEach((target, key) => {
      if (!currentTargets.has(key)) sendModalEvent("modal_close", target);
    });
  }

  activeModalTargets.clear();
  currentTargets.forEach((target, key) => activeModalTargets.set(key, target));
}

function getVisibleModalElements() {
  return Array.from(document.querySelectorAll("dialog[open], [role='dialog'], [aria-modal='true'], .modal, .dialog, .popup"))
    .filter((element) => element instanceof Element)
    .filter((element) => {
      const box = element.getBoundingClientRect();
      const visibility = getTargetVisibility(element, box);
      if (!visibility.visible) return false;
      if (element.getAttribute("aria-hidden") === "true") return false;
      return Boolean(
        element.matches("dialog[open], [aria-modal='true']") ||
        element.getAttribute("role") === "dialog" ||
        normalizeText(element.innerText || element.textContent || element.getAttribute("aria-label") || "")
      );
    });
}

function sendModalEvent(action, target) {
  sendRecorderEvent({
    action,
    target,
    viewport: getViewport(),
    beforeUrl: location.href,
    afterUrl: location.href,
    privacy: { containsSensitiveData: false, reasons: [], maskedFields: [] }
  });
}

function getPageLoadDuration() {
  const navigation = performance.getEntriesByType?.("navigation")?.[0];
  if (navigation?.duration) return Math.round(navigation.duration);
  const timing = performance.timing;
  if (!timing?.loadEventEnd || !timing.navigationStart) return 0;
  return Math.max(0, Math.round(timing.loadEventEnd - timing.navigationStart));
}

function getPageTarget() {
  return {
    type: "page",
    text: document.title || location.hostname || "当前页面",
    selector: "document",
    boundingBox: {
      x: 0,
      y: 0,
      width: window.innerWidth,
      height: window.innerHeight,
      coordinateSpace: "viewport-css-pixel"
    },
    visibility: {
      visible: true,
      inViewport: true,
      hasBox: true,
      canHighlight: false,
      reason: "page_load"
    }
  };
}

function sendRecorderEvent(payload) {
  const event = {
    id: `event_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    payload: {
      ...payload,
      pagePrivacyMaskBoxes: collectPagePrivacyMaskBoxes()
    },
    queuedAt: Date.now()
  };
  queueRecorderEvent(event);
  deliverRecorderEvent(event, 0);
}

function drainQueuedRecorderEvents() {
  pruneQueuedRecorderEvents();
  readQueuedRecorderEvents().forEach((event) => deliverRecorderEvent(event, event.attempts || 0));
}

function deliverRecorderEvent(event, attempt) {
  if (!isActiveContentInstance()) return;
  if (!hasRuntimeContext()) {
    retryRecorderEvent(event, attempt, "extension_context_invalidated");
    return;
  }

  let delivery;
  try {
    delivery = chrome.runtime.sendMessage({ type: "recorder:event", eventId: event.id, payload: event.payload });
  } catch (error) {
    retryRecorderEvent(event, attempt, error?.message || "send_failed");
    return;
  }

  delivery
    .then((response) => {
      if (response?.ok || response?.duplicateEvent) {
        removeQueuedRecorderEvent(event.id);
        return;
      }
      retryRecorderEvent(event, attempt, response?.error || response?.skipped || "not_acknowledged");
    })
    .catch((error) => retryRecorderEvent(event, attempt, error?.message || "send_failed"));
}

function retryRecorderEvent(event, attempt, lastError) {
  if (!isActiveContentInstance()) return;
  if (isExtensionContextInvalidatedError(lastError)) {
    removeQueuedRecorderEvent(event.id);
    return;
  }
  const nextAttempt = attempt + 1;
  const queuedAt = Number(event.queuedAt || Date.now());
  if (nextAttempt >= MAX_EVENT_DELIVERY_ATTEMPTS || Date.now() - queuedAt > MAX_EVENT_QUEUE_AGE_MS) {
    removeQueuedRecorderEvent(event.id);
    return;
  }
  updateQueuedRecorderEvent({
    ...event,
    attempts: nextAttempt,
    lastError,
    lastAttemptAt: Date.now()
  });
  const delay = Math.min(5000, 250 * 2 ** Math.min(nextAttempt, 5));
  window.setTimeout(() => deliverRecorderEvent(event, nextAttempt), delay);
}

function isActiveContentInstance() {
  return window.__sopRecorderContentInstanceId === CONTENT_INSTANCE_ID;
}

function hasRuntimeContext() {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

function suppressInvalidatedRuntimeError(event) {
  const message = event?.message || event?.reason?.message || event?.error?.message || String(event?.reason || "");
  if (!isExtensionContextInvalidatedError(message)) return;
  event.preventDefault?.();
  event.stopImmediatePropagation?.();
}

function isExtensionContextInvalidatedError(error) {
  const message = String(error || "");
  return message.includes("Extension context invalidated") || message.includes("extension_context_invalidated");
}

function queueRecorderEvent(event) {
  const events = readQueuedRecorderEvents().filter((item) => item.id !== event.id);
  events.push(event);
  writeQueuedRecorderEvents(events.slice(-MAX_QUEUED_EVENTS));
}

function removeQueuedRecorderEvent(eventId) {
  writeQueuedRecorderEvents(readQueuedRecorderEvents().filter((event) => event.id !== eventId));
}

function updateQueuedRecorderEvent(event) {
  const events = readQueuedRecorderEvents().map((item) => item.id === event.id ? event : item);
  writeQueuedRecorderEvents(events);
}

function pruneQueuedRecorderEvents() {
  const now = Date.now();
  writeQueuedRecorderEvents(readQueuedRecorderEvents().filter((event) => now - Number(event.queuedAt || now) <= MAX_EVENT_QUEUE_AGE_MS));
}

function readQueuedRecorderEvents() {
  try {
    return JSON.parse(sessionStorage.getItem(EVENT_QUEUE_KEY) || "[]").filter((event) => event?.id && event?.payload);
  } catch {
    return [];
  }
}

function writeQueuedRecorderEvents(events) {
  try {
    sessionStorage.setItem(EVENT_QUEUE_KEY, JSON.stringify(events));
  } catch {
    sessionStorage.removeItem(EVENT_QUEUE_KEY);
  }
}

function resolveActionTarget(target, clickPoint = null) {
  if (!(target instanceof Element)) return null;
  const pointCheckable = findCheckableAtPoint(clickPoint);
  if (pointCheckable) return pointCheckable;
  const checkableAncestor = getCheckableInput(target);
  if (checkableAncestor) return checkableAncestor;
  const preferredTarget = findPreferredActionTarget(target);
  if (preferredTarget) return preferredTarget;
  return findPointerCursorTarget(target);
}

function findPreferredActionTarget(target) {
  if (!(target instanceof Element)) return null;
  const prioritySelectors = [
    "button",
    "[role='button']",
    "a[href]",
    "[role='link']",
    "[role='menuitem']",
    "input",
    "label",
    "select",
    "textarea",
    "summary",
    "[onclick]",
    "td",
    "th",
    "[role='cell']",
    "[role='gridcell']",
    "[role='row']",
    "[tabindex]"
  ];
  for (const selector of prioritySelectors) {
    const candidate = target.closest(selector);
    if (candidate instanceof Element && candidate.closest(ACTION_TARGET_SELECTOR)) return expandActionContainer(candidate);
  }
  return null;
}

function expandActionContainer(element) {
  if (!(element instanceof Element)) return element;
  const type = inferTargetType(element);
  if (!["button", "link", "menuitem"].includes(type)) return element;
  const box = element.getBoundingClientRect();
  let current = element.parentElement;
  let depth = 0;
  while (current && current !== document.body && current !== document.documentElement && depth < 3) {
    const currentBox = current.getBoundingClientRect();
    if (!isLikelyActionWrapper(current, currentBox, box)) break;
    element = current;
    current = current.parentElement;
    depth += 1;
  }
  return element;
}

function isLikelyActionWrapper(element, wrapperBox, innerBox) {
  if (!(element instanceof Element)) return false;
  if (wrapperBox.width <= innerBox.width || wrapperBox.height < innerBox.height) return false;
  if (wrapperBox.width > innerBox.width + 90 || wrapperBox.height > innerBox.height + 36) return false;
  const style = window.getComputedStyle(element);
  const signature = [
    element.className,
    element.getAttribute("role"),
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    style.cursor
  ].map((value) => String(value || "")).join(" ").toLowerCase();
  const text = normalizeText(element.innerText || element.textContent || "");
  const looksLikeTightTextButton = text.length > 0 && text.length <= 40 && wrapperBox.width <= 180 && wrapperBox.height <= 56;
  return /button|btn|toolbar-button|action|pointer/.test(signature) || looksLikeTightTextButton;
}

function findCheckableAtPoint(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const elements = document.elementsFromPoint?.(point.x, point.y) || [];
  for (const element of elements) {
    if (!(element instanceof Element)) continue;
    const input = getCheckableInput(element);
    if (input) return input;
    const customCheckable = findCustomCheckableTarget(element, point);
    if (customCheckable) return customCheckable;
  }
  const nearbyInputs = Array.from(document.querySelectorAll("input[type='checkbox'], input[type='radio']"));
  return nearbyInputs.find((input) => {
    const box = input.getBoundingClientRect();
    return point.x >= box.left - 8 && point.x <= box.right + 8 && point.y >= box.top - 8 && point.y <= box.bottom + 8;
  }) || null;
}

function findPointerCursorTarget(element) {
  let current = element;
  let depth = 0;
  while (current && current !== document.documentElement && current !== document.body && depth < 4) {
    if (window.getComputedStyle(current).cursor === "pointer") return current;
    current = current.parentElement;
    depth += 1;
  }
  return null;
}

function extractTarget(element) {
  const box = element.getBoundingClientRect();
  const labelText = findLabelText(element);
  const dialogTitle = inferTargetType(element) === "dialog" ? findDialogTitle(element) : null;
  const visibleText = normalizeText(element.innerText || element.textContent || "");
  const title = element.getAttribute("title");
  const visibility = getTargetVisibility(element, box);
  return {
    type: inferTargetType(element),
    text: dialogTitle || (isCheckableTarget(element) ? "" : visibleText.slice(0, 120)),
    ariaLabel: element.getAttribute("aria-label"),
    placeholder: element.getAttribute("placeholder"),
    title,
    labelText,
    nearbyText: findNearbyText(element),
    name: element.getAttribute("name"),
    id: element.id || null,
    attributes: getElementAttributes(element),
    form: getFormMetadata(element),
    selector: buildSelector(element),
    boundingBox: {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
      coordinateSpace: "viewport-css-pixel"
    },
    visibility
  };
}

function getElementAttributes(element) {
  const attributes = {
    tagName: element.tagName.toLowerCase()
  };
  const role = element.getAttribute("role");
  if (role) attributes.role = role;
  if (element instanceof HTMLAnchorElement) {
    attributes.href = sanitizeUrlAttribute(element.getAttribute("href") || "");
    attributes.target = element.getAttribute("target") || "";
  }
  if (element instanceof HTMLInputElement) {
    attributes.inputType = element.getAttribute("type") || "text";
    attributes.required = element.required;
    attributes.disabled = element.disabled;
    attributes.checked = element.checked;
  } else if (element instanceof HTMLSelectElement) {
    attributes.multiple = element.multiple;
    attributes.required = element.required;
    attributes.disabled = element.disabled;
  } else if (element instanceof HTMLTextAreaElement || element instanceof HTMLButtonElement) {
    attributes.required = Boolean(element.required);
    attributes.disabled = element.disabled;
  }
  return attributes;
}

function sanitizeUrlAttribute(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed, location.href);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      return `${parsed.origin}${parsed.pathname}`.slice(0, 300);
    }
    if (trimmed.startsWith("//")) {
      return `${parsed.origin}${parsed.pathname}`.slice(0, 300);
    }
    return `${parsed.pathname}`.slice(0, 300);
  } catch (error) {
    return trimmed.split(/[?#]/, 1)[0].slice(0, 300);
  }
}

function getFormMetadata(element) {
  const form = element.closest("form");
  if (!form) return null;
  return {
    id: form.id || null,
    name: form.getAttribute("name"),
    selector: buildSelector(form),
    text: normalizeText(form.getAttribute("aria-label") || form.getAttribute("title") || findLabelText(form) || "").slice(0, 120)
  };
}

function getTargetVisibility(element, box) {
  const style = window.getComputedStyle(element);
  const hasBox = box.width > 0 && box.height > 0;
  const inViewport = box.bottom > 0 && box.right > 0 && box.top < window.innerHeight && box.left < window.innerWidth;
  const visible = hasBox && inViewport && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || 1) > 0;
  return {
    visible,
    inViewport,
    hasBox,
    canHighlight: visible,
    reason: visible ? "visible" : !hasBox ? "empty_box" : !inViewport ? "outside_viewport" : "hidden_style"
  };
}

function inferTargetType(element) {
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute("role");
  if (tag === "button" || role === "button") return "button";
  if (tag === "a" || role === "link") return "link";
  if (tag === "select") return "select";
  if (tag === "textarea") return "input";
  if (tag === "form") return "form";
  if (tag === "td" || tag === "th" || role === "cell" || role === "gridcell") return "table_cell";
  if (tag === "tr" || role === "row") return "table_row";
  if (role === "menuitem") return "menuitem";
  if (role === "checkbox" || role === "switch" || isCheckboxLikeElement(element)) return "checkbox";
  if (role === "radio") return "radio";
  if (tag === "input") {
    const type = element.getAttribute("type") || "text";
    if (type === "password") return "password";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "file") return "upload";
    return "input";
  }
  if (element.closest("button")) return "button";
  if (element.closest("a")) return "link";
  return "unknown";
}

function findLabelText(element) {
  if (element.id) {
    const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    if (label) return normalizeText(label.innerText || label.textContent || "").slice(0, 120);
  }
  const wrappingLabel = element.closest("label");
  if (wrappingLabel) return normalizeText(wrappingLabel.innerText || wrappingLabel.textContent || "").slice(0, 120);
  const ariaLabelledBy = element.getAttribute("aria-labelledby");
  if (ariaLabelledBy) {
    return ariaLabelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map((node) => normalizeText(node.innerText || node.textContent || ""))
      .join(" ")
      .slice(0, 120);
  }
  return null;
}

function findNearbyText(element) {
  const candidates = [
    element.previousElementSibling,
    element.nextElementSibling,
    element.parentElement?.previousElementSibling,
    element.parentElement?.nextElementSibling
  ];
  for (const candidate of candidates) {
    const text = normalizeText(candidate?.innerText || candidate?.textContent || "");
    if (text) return text.slice(0, 120);
  }
  return null;
}

function buildSelector(element) {
  if (element.id) return `#${CSS.escape(element.id)}`;
  const testId = element.getAttribute("data-testid") || element.getAttribute("data-test");
  if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
  const parts = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 4) {
    let part = current.tagName.toLowerCase();
    const name = current.getAttribute("name");
    if (name) part += `[name="${CSS.escape(name)}"]`;
    parts.unshift(part);
    current = current.parentElement;
  }
  return parts.join(" > ");
}

function detectPrivacy(element) {
  const value = getElementValue(element);
  const sensitiveByField = isPasswordElement(element);
  const sensitiveByValue = isEmailValue(value);
  const sensitive = sensitiveByField || sensitiveByValue;
  return {
    containsSensitiveData: sensitive,
    reasons: [
      sensitiveByField ? "password" : null,
      sensitiveByValue ? "email" : null
    ].filter(Boolean),
    maskedFields: sensitive ? [buildSelector(element)] : []
  };
}

function collectPagePrivacyMaskBoxes() {
  const boxes = [];
  Array.from(document.querySelectorAll("input, textarea, [contenteditable='true']"))
    .filter((element) => element instanceof Element)
    .forEach((element) => {
      if (!isEmailOrPasswordElement(element)) return;
      const box = getMaskableBox(element);
      if (box) boxes.push(box);
    });

  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = normalizeText(node.nodeValue || "");
      if (!containsEmailText(text)) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  while (walker.nextNode()) {
    const range = document.createRange();
    range.selectNodeContents(walker.currentNode);
    Array.from(range.getClientRects()).forEach((rect) => {
      const box = normalizeRectToMaskBox(rect);
      if (box) boxes.push(box);
    });
    range.detach();
  }

  return mergeMaskBoxes(boxes).slice(0, 30);
}

function isEmailOrPasswordElement(element) {
  const value = getElementValue(element);
  return isPasswordElement(element) ||
    (element instanceof HTMLInputElement && element.type === "email") ||
    isEmailValue(value);
}

function isPasswordElement(element) {
  const text = [
    element.getAttribute("type"),
    element.getAttribute("name"),
    element.getAttribute("id"),
    element.getAttribute("placeholder"),
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    findLabelText(element)
  ].filter(Boolean).join(" ").toLowerCase();
  return /password|passwd/.test(text) || (element instanceof HTMLInputElement && element.type === "password");
}

function getMaskableBox(element) {
  const box = element.getBoundingClientRect();
  const visibility = getTargetVisibility(element, box);
  if (!visibility.visible) return null;
  return normalizeRectToMaskBox(box);
}

function normalizeRectToMaskBox(rect) {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(viewportWidth, rect.right);
  const bottom = Math.min(viewportHeight, rect.bottom);
  const width = right - left;
  const height = bottom - top;
  if (width <= 2 || height <= 2) return null;
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
    coordinateSpace: "viewport-css-pixel",
    source: "email_password_scan"
  };
}

function mergeMaskBoxes(boxes) {
  const seen = new Set();
  const result = [];
  boxes.forEach((box) => {
    const key = [box.x, box.y, box.width, box.height].join(":");
    if (seen.has(key)) return;
    seen.add(key);
    result.push(box);
  });
  return result;
}
function getMaskedValue(element, sensitive) {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return null;
  if (element instanceof HTMLSelectElement) return normalizeText(element.selectedOptions[0]?.text || element.value);
  if (element instanceof HTMLInputElement && element.type === "file") return getFileUploadSummary(element);
  const value = getElementValue(element);
  if (isEmailValue(value)) return maskEmail(value);
  if (sensitive) return "***";
  return value ? "已输入内容" : "";
}

function getFileUploadSummary(element) {
  const files = Array.from(element.files || []);
  if (!files.length) return "未选择文件";
  if (files.length === 1) return `已选择文件：${maskFileName(files[0].name)}`;
  return `已选择 ${files.length} 个文件：${files.slice(0, 3).map((file) => maskFileName(file.name)).join("、")}${files.length > 3 ? " 等" : ""}`;
}

function maskFileName(name = "") {
  const text = normalizeText(name);
  if (!text) return "未命名文件";
  const dotIndex = text.lastIndexOf(".");
  const base = dotIndex > 0 ? text.slice(0, dotIndex) : text;
  const ext = dotIndex > 0 ? text.slice(dotIndex) : "";
  if ([...base].length <= 2) return `*${ext}`;
  return `${[...base].slice(0, 1).join("")}***${ext}`;
}

function getElementValue(element) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return element.value || "";
  }
  return "";
}

function isEmailValue(value = "") {
  return /^\S+@\S+\.\S+$/.test(value);
}

function containsEmailText(value = "") {
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value);
}

function isPhoneValue(value = "") {
  return /^\+?\d[\d\s-]{6,}$/.test(value);
}

function isIdCardValue(value = "") {
  return /^\d{6}\d{8}\d{3}[\dXx]$/.test(value.replace(/\s|-/g, ""));
}

function isBankCardValue(value = "") {
  const digits = value.replace(/\s|-/g, "");
  return /^\d{13,19}$/.test(digits) && !isPhoneValue(value) && !isIdCardValue(value);
}

function maskEmail(value) {
  const [name, domain] = value.split("@");
  return `${name.slice(0, 1)}***@${domain}`;
}

function maskIdCard(value) {
  const normalized = value.replace(/\s|-/g, "");
  return `${normalized.slice(0, 2)}**************${normalized.slice(-2)}`;
}

function maskBankCard(value) {
  const normalized = value.replace(/\s|-/g, "");
  return `**** **** **** ${normalized.slice(-4)}`;
}

function getViewport() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    scrollX: Math.round(window.scrollX || window.pageXOffset || 0),
    scrollY: Math.round(window.scrollY || window.pageYOffset || 0)
  };
}

function normalizeText(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function findDialogTitle(element) {
  const aria = normalizeText(element.getAttribute("aria-label") || "");
  if (aria) return aria.slice(0, 80);
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const label = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map((node) => normalizeText(node.innerText || node.textContent || ""))
      .find(Boolean);
    if (label) return label.slice(0, 80);
  }
  const titleElement = element.querySelector([
    "[role='heading']",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    ".modal-title",
    ".ant-modal-title",
    ".el-dialog__title",
    ".MuiDialogTitle-root"
  ].join(","));
  const title = normalizeText(titleElement?.innerText || titleElement?.textContent || "");
  if (title) return title.slice(0, 80);
  return "\u5f39\u7a97";
}

function findCustomCheckableTarget(target, point = null) {
  if (!(target instanceof Element)) return null;
  let current = target;
  let depth = 0;
  const candidates = [];
  while (current && current !== document.body && depth < 5) {
    if (isCustomCheckableTarget(current) || isCheckboxLikeElement(current) || isSmallCheckableVisual(current)) {
      const box = current.getBoundingClientRect();
      if (!point || pointInsideExpandedBox(point, box, 6)) {
        candidates.push({ element: current, area: Math.max(1, box.width * box.height) });
      }
    }
    current = current.parentElement;
    depth += 1;
  }
  const valid = candidates.filter((candidate) => isExplicitCheckable(candidate.element) || isCompactCheckableBox(candidate.element) || isSwitchLikeElement(candidate.element));
  return valid.find((candidate) => isExplicitCheckable(candidate.element))?.element ||
    valid.filter((candidate) => isSwitchLikeElement(candidate.element)).sort((a, b) => b.area - a.area)[0]?.element ||
    valid.sort((a, b) => a.area - b.area)[0]?.element || null;
}

function isCustomCheckableTarget(target) {
  if (!(target instanceof Element)) return false;
  const role = target.getAttribute("role");
  return ["checkbox", "radio", "switch"].includes(role || "") || target.hasAttribute("aria-checked");
}

function isCheckboxLikeElement(target) {
  if (!(target instanceof Element)) return false;
  if (!isCompactCheckableBox(target) && !isExplicitCheckable(target) && !isSwitchLikeElement(target)) return false;
  const signature = [
    target.className,
    target.id,
    target.getAttribute("data-testid"),
    target.getAttribute("data-test"),
    target.getAttribute("aria-label"),
    target.getAttribute("title")
  ].map((value) => String(value || "")).join(" ").toLowerCase();
  return /\b(checkbox|check-box|checkable|selection|select-row|row-select|switch|toggle|slider|ant-checkbox|el-checkbox|mat-checkbox|mui-checkbox|p-checkbox|v-input--selection-controls)\b/.test(signature);
}

function isExplicitCheckable(target) {
  if (!(target instanceof Element)) return false;
  const role = target.getAttribute("role");
  return ["checkbox", "radio", "switch"].includes(role || "") || target.hasAttribute("aria-checked");
}

function isCompactCheckableBox(target) {
  if (!(target instanceof Element)) return false;
  const box = target.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return false;
  return box.width <= 36 && box.height <= 36;
}

function isSwitchLikeElement(target) {
  if (!(target instanceof Element)) return false;
  const box = target.getBoundingClientRect();
  if (box.width < 24 || box.width > 72 || box.height < 12 || box.height > 40) return false;
  const style = window.getComputedStyle(target);
  const signature = [
    target.className,
    target.id,
    target.getAttribute("data-testid"),
    target.getAttribute("data-test"),
    target.getAttribute("aria-label"),
    target.getAttribute("title"),
    style.borderRadius,
    style.backgroundColor,
    style.cursor
  ].map((value) => String(value || "")).join(" ").toLowerCase();
  const radius = Number.parseFloat(style.borderRadius || "0") || 0;
  const ratio = box.width / Math.max(1, box.height);
  const looksLikeTrack = style.cursor === "pointer" && radius >= 6 && ratio >= 1.4 && ratio <= 4.5;
  return /switch|toggle|slider|active|inactive|checked|unchecked/.test(signature) || looksLikeTrack;
}

function isSmallCheckableVisual(target) {
  if (!(target instanceof Element) || !isCompactCheckableBox(target)) return false;
  const style = window.getComputedStyle(target);
  const signature = [
    target.className,
    style.border,
    style.backgroundImage,
    style.cursor
  ].map((value) => String(value || "")).join(" ").toLowerCase();
  return /checkbox|check|square|border|pointer|rgb|rgba|url/.test(signature);
}

function pointInsideExpandedBox(point, box, padding = 0) {
  return point.x >= box.left - padding &&
    point.x <= box.right + padding &&
    point.y >= box.top - padding &&
    point.y <= box.bottom + padding;
}

function isCheckboxLikeChecked(target) {
  if (!(target instanceof Element)) return false;
  const input = target.querySelector("input[type='checkbox'], input[type='radio']");
  if (input instanceof HTMLInputElement) return input.checked;
  const ariaChecked = target.getAttribute("aria-checked") || target.querySelector("[aria-checked]")?.getAttribute("aria-checked");
  if (ariaChecked) return ariaChecked === "true";
  const selectedAncestor = target.closest(".selected, .checked, .is-checked, .ant-checkbox-checked, .el-checkbox__input.is-checked, tr[aria-selected='true'], [aria-selected='true']");
  if (selectedAncestor) return true;
  const signature = String(target.className || "").toLowerCase();
  return /\b(checked|selected|active|is-checked|ant-checkbox-checked|el-checkbox__input is-checked)\b/.test(signature);
}
})();
