const INPUT_DEBOUNCE_MS = 800;
const PAGE_LOAD_WAIT_THRESHOLD_MS = 1200;
const MODAL_SCAN_DEBOUNCE_MS = 150;
const ACTION_TARGET_SELECTOR = [
  "button",
  "a[href]",
  "input",
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
const inputTimers = new WeakMap();
const pendingInputTargets = new Set();
const activeModalTargets = new Map();
let modalScanTimer = null;

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

document.addEventListener("click", (event) => {
  const target = resolveActionTarget(event.target);
  if (!target) return;
  flushPendingInputs();
  const targetMeta = extractTarget(target);
  sendRecorderEvent({
    action: "click",
    target: targetMeta,
    clickPoint: {
      x: event.clientX,
      y: event.clientY,
      coordinateSpace: "viewport-css-pixel"
    },
    viewport: getViewport(),
    beforeUrl: location.href,
    privacy: detectPrivacy(target)
  });
}, true);

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
  scheduleInputEvent(target);
}, true);

document.addEventListener("change", (event) => {
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
    sendInputLikeEvent(target, "check");
  }
}, true);

document.addEventListener("submit", (event) => {
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

window.addEventListener("pagehide", flushPendingInputs, { capture: true });
window.addEventListener("beforeunload", flushPendingInputs, { capture: true });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPendingInputs();
}, true);

function scheduleInputEvent(target) {
  pendingInputTargets.add(target);
  window.clearTimeout(inputTimers.get(target));
  inputTimers.set(target, window.setTimeout(() => {
    flushPendingInput(target);
  }, INPUT_DEBOUNCE_MS));
}

function flushPendingInputs() {
  Array.from(pendingInputTargets).forEach((target) => flushPendingInput(target));
}

function flushPendingInput(target) {
  if (!pendingInputTargets.has(target)) return;
  window.clearTimeout(inputTimers.get(target));
  inputTimers.delete(target);
  pendingInputTargets.delete(target);
  sendInputLikeEvent(target, "input");
}

function sendInputLikeEvent(target, action) {
  const privacy = detectPrivacy(target);
  const maskedValue = getMaskedValue(target, privacy.containsSensitiveData);
  sendRecorderEvent({
    action,
    target: extractTarget(target),
    maskedValue,
    value: maskedValue,
    viewport: getViewport(),
    beforeUrl: location.href,
    privacy
  });
}

function reportPageLoadWait() {
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
  scanModals({ initial: true });
  const observer = new MutationObserver(() => {
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
  chrome.runtime.sendMessage({ type: "recorder:event", payload }).catch(() => {});
}

function resolveActionTarget(target) {
  if (!(target instanceof Element)) return null;
  const explicitTarget = target.closest(ACTION_TARGET_SELECTOR);
  if (explicitTarget) return explicitTarget;
  return findPointerCursorTarget(target);
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
  const visibleText = normalizeText(element.innerText || element.textContent || "");
  const title = element.getAttribute("title");
  const visibility = getTargetVisibility(element, box);
  return {
    type: inferTargetType(element),
    text: visibleText.slice(0, 120),
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
  if (role === "checkbox") return "checkbox";
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
  const text = [
    element.getAttribute("type"),
    element.getAttribute("name"),
    element.getAttribute("id"),
    element.getAttribute("placeholder"),
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    findLabelText(element)
  ].filter(Boolean).join(" ").toLowerCase();
  const value = getElementValue(element);
  const sensitiveByField = /password|passwd|token|secret|otp|验证码|code|captcha/.test(text);
  const sensitiveByValue = isEmailValue(value) || isPhoneValue(value) || isIdCardValue(value) || isBankCardValue(value);
  const sensitive = sensitiveByField || sensitiveByValue;
  return {
    containsSensitiveData: sensitive,
    reasons: [
      sensitiveByField ? "sensitive_field" : null,
      isEmailValue(value) ? "email" : null,
      isPhoneValue(value) ? "phone" : null,
      isIdCardValue(value) ? "id_card" : null,
      isBankCardValue(value) ? "bank_card" : null
    ].filter(Boolean),
    maskedFields: sensitive ? [buildSelector(element)] : []
  };
}

function getMaskedValue(element, sensitive) {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return null;
  if (element instanceof HTMLSelectElement) return normalizeText(element.selectedOptions[0]?.text || element.value);
  if (element instanceof HTMLInputElement && element.type === "file") return getFileUploadSummary(element);
  const value = getElementValue(element);
  if (isEmailValue(value)) return maskEmail(value);
  if (isPhoneValue(value)) return value.replace(/\d(?=\d{4})/g, "*");
  if (isIdCardValue(value)) return maskIdCard(value);
  if (isBankCardValue(value)) return maskBankCard(value);
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
