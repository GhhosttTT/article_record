const INPUT_DEBOUNCE_MS = 800;
const inputTimers = new WeakMap();

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
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
  window.clearTimeout(inputTimers.get(target));
  inputTimers.set(target, window.setTimeout(() => {
    sendInputLikeEvent(target, "input");
  }, INPUT_DEBOUNCE_MS));
}, true);

document.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target instanceof HTMLSelectElement) {
    sendInputLikeEvent(target, "select");
    return;
  }
  if (target instanceof HTMLInputElement && ["checkbox", "radio"].includes(target.type)) {
    sendInputLikeEvent(target, "check");
  }
}, true);

document.addEventListener("submit", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  sendRecorderEvent({
    action: "submit",
    target: extractTarget(target),
    viewport: getViewport(),
    beforeUrl: location.href,
    privacy: detectPrivacy(target)
  });
}, true);

function sendInputLikeEvent(target, action) {
  const privacy = detectPrivacy(target);
  sendRecorderEvent({
    action,
    target: extractTarget(target),
    value: getMaskedValue(target, privacy.containsSensitiveData),
    viewport: getViewport(),
    beforeUrl: location.href,
    privacy
  });
}

function sendRecorderEvent(payload) {
  chrome.runtime.sendMessage({ type: "recorder:event", payload }).catch(() => {});
}

function extractTarget(element) {
  const box = element.getBoundingClientRect();
  const labelText = findLabelText(element);
  const visibleText = normalizeText(element.innerText || element.textContent || "");
  return {
    type: inferTargetType(element),
    text: visibleText.slice(0, 120),
    ariaLabel: element.getAttribute("aria-label"),
    placeholder: element.getAttribute("placeholder"),
    labelText,
    name: element.getAttribute("name"),
    id: element.id || null,
    selector: buildSelector(element),
    boundingBox: {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
      coordinateSpace: "viewport-css-pixel"
    }
  };
}

function inferTargetType(element) {
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute("role");
  if (tag === "button" || role === "button") return "button";
  if (tag === "a") return "link";
  if (tag === "select") return "select";
  if (tag === "textarea") return "input";
  if (tag === "form") return "form";
  if (tag === "td" || tag === "th") return "table_cell";
  if (role === "menuitem") return "menuitem";
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
    findLabelText(element)
  ].filter(Boolean).join(" ").toLowerCase();
  const sensitive = /password|passwd|token|secret|otp|验证码|code|captcha/.test(text);
  return {
    containsSensitiveData: sensitive,
    maskedFields: sensitive ? [buildSelector(element)] : []
  };
}

function getMaskedValue(element, sensitive) {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return null;
  if (sensitive) return "***";
  if (element instanceof HTMLSelectElement) return normalizeText(element.selectedOptions[0]?.text || element.value);
  const value = element.value || "";
  if (/^\S+@\S+\.\S+$/.test(value)) return maskEmail(value);
  if (/^\+?\d[\d\s-]{6,}$/.test(value)) return value.replace(/\d(?=\d{4})/g, "*");
  return value ? "已输入内容" : "";
}

function maskEmail(value) {
  const [name, domain] = value.split("@");
  return `${name.slice(0, 1)}***@${domain}`;
}

function getViewport() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1
  };
}

function normalizeText(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}
