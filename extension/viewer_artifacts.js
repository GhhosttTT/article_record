const { buildArticleSteps, buildArticleChapters, buildPrivacySafeArticleSteps, buildVideoTimeline } = SopArtifactShared;

function renderArticleHtml(state, tabs, steps, options = {}) {
  const title = resolveArticleTitle(state, tabs, options);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { --ink:#18212b; --muted:#66717d; --line:#dce3ea; --paper:#fff; --wash:#f3f6f8; --tab:#cc6b2c; }
    * { box-sizing:border-box; }
    body { margin:0; color:var(--ink); background:var(--wash); font-family:"Segoe UI","Microsoft YaHei",sans-serif; }
    main { width:min(1080px, calc(100vw - 36px)); margin:0 auto; padding:36px 0 64px; }
    h1 { margin:0 0 8px; font-size:36px; }
    .meta { color:var(--muted); }
    .tabs { display:flex; flex-wrap:wrap; gap:8px; margin:18px 0 24px; }
    .tab-pill { border:1px solid #e6c4aa; border-radius:999px; padding:7px 11px; background:#fff7ef; color:#854513; font-weight:700; font-size:13px; }
    .chapter { margin:28px 0 0; }
    .chapter-head { margin:0 0 14px; padding:0 0 12px; border-bottom:2px solid var(--line); }
    .chapter-head h2 { margin:0 0 6px; font-size:26px; }
    .chapter-head p { margin:0; color:var(--muted); }
    .step { border:1px solid var(--line); border-radius:8px; background:var(--paper); margin-bottom:18px; overflow:hidden; }
    .step-header { display:flex; justify-content:space-between; align-items:start; gap:20px; padding:18px; border-bottom:1px solid var(--line); }
    .step h2 { margin:0 0 8px; font-size:22px; }
    .step p { margin:0; color:var(--muted); line-height:1.55; }
    .kind { flex:0 0 auto; border-radius:999px; padding:6px 10px; background:#e8f2fa; color:#145985; font-size:12px; font-weight:800; }
    .kind.tab { background:#fff1e4; color:var(--tab); }
    .tabswitch { margin:0 18px 18px; border:1px dashed #dca977; border-radius:8px; padding:14px 16px; background:#fff8f0; color:#854513; font-weight:800; }
    .shot { position:relative; margin:18px; border:1px solid var(--line); border-radius:8px; overflow:visible; background:#f7f9fb; }
    .shot img { display:block; width:100%; }
    .focus { position:absolute; border:3px solid #f18a2a; border-radius:8px; box-shadow:0 0 0 9999px rgb(0 0 0 / 32%); pointer-events:none; }
    .focus-zoom { position:absolute; width:min(280px, 36%); aspect-ratio:16/10; border:3px solid #f18a2a; border-radius:8px; overflow:hidden; background:#fff; box-shadow:0 12px 28px rgb(0 0 0 / 28%); pointer-events:none; }
    .focus-zoom img { position:absolute; display:block; max-width:none; width:auto; }
    .focus-zoom::before { content:"Focus zoom"; position:absolute; left:8px; top:8px; padding:3px 7px; border-radius:999px; background:rgb(24 33 43 / 82%); color:#fff; font-size:11px; font-weight:800; }
    .mask { position:absolute; border-radius:6px; background:#111827; box-shadow:inset 0 0 0 2px rgb(255 255 255 / 45%); pointer-events:none; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">${renderStepSummary(steps)}</div>
    <div class="tabs">${tabs.map((tab) => `<span class="tab-pill">${escapeHtml(tab.tabAlias)} · ${escapeHtml(tab.domain || "")}</span>`).join("")}</div>
    <section class="chapter">
      <header class="chapter-head">
        <h2>操作步骤</h2>
      </header>
      ${steps.map(renderArticleStep).join("\n")}
    </section>
  </main>
</body>
</html>`;
}

function renderArticleMarkdown(state, tabs, steps, options = {}) {
  const title = resolveArticleTitle(state, tabs, options);
  const lines = [
    `# ${escapeMarkdown(title)}`,
    "",
    renderStepSummary(steps),
    "",
    "## 涉及标签页",
    ""
  ];

  if (tabs.length) {
    tabs.forEach((tab) => lines.push(`- ${escapeMarkdown(tab.tabAlias)}${tab.domain ? ` · ${escapeMarkdown(tab.domain)}` : ""}`));
  } else {
    lines.push("- 暂无标签页");
  }

  lines.push("");
  lines.push("## 操作步骤");
  lines.push("");
  steps.forEach((step) => {
    lines.push(`### ${step.sequence}. ${escapeMarkdown(step.title)}`);
    lines.push("");
    lines.push(`**类型**：${stepTypeText(step.type)}`);
    if (step.fromTabAlias || step.toTabAlias) lines.push(`**标签页变化**：${escapeMarkdown(step.fromTabAlias || "当前标签页")} -> ${escapeMarkdown(step.toTabAlias || "目标标签页")}`);
    if (step.type === "navigation") lines.push(`**页面变化**：${escapeMarkdown(step.fromUrl || "当前页面")} -> ${escapeMarkdown(step.toUrl || step.pageUrl || "目标页面")}`);
    lines.push("");
    lines.push(escapeMarkdown(step.description));
    if (step.privacyWarnings?.length) {
      lines.push("");
      step.privacyWarnings.forEach((warning) => lines.push(`> ${escapeMarkdown(warning)}`));
    }
    if (step.image) {
      lines.push("");
      lines.push(`![步骤截图](${step.image})`);
    } else if (step.imageRedactedForPrivacy) {
      lines.push("");
      lines.push("> 截图已因隐私保护从导出文件中移除，仅保留截图元数据。");
    }
    if (step.key) {
      lines.push("");
      lines.push(`按键：${escapeMarkdown(step.key)}`);
    }
    if (step.privacyMaskBoxes?.length) {
      lines.push("");
      lines.push(`打码区域：${step.privacyMaskBoxes.map((box) => `x=${box.x}, y=${box.y}, width=${box.width}, height=${box.height}`).join("; ")}`);
    }
    lines.push("");
  });

  return `${lines.join("\n").trim()}\n`;
}

function renderArticleWordDocument(state, tabs, steps, options = {}) {
  const title = resolveArticleTitle(state, tabs, options);
  return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    @page { margin: 2cm; }
    body { color:#18212b; font-family:"Microsoft YaHei","Segoe UI",sans-serif; line-height:1.55; }
    h1 { font-size:26pt; margin:0 0 8pt; }
    h2 { font-size:18pt; margin:22pt 0 8pt; border-bottom:1pt solid #dce3ea; padding-bottom:6pt; }
    h3 { font-size:14pt; margin:14pt 0 6pt; }
    p { margin:0 0 8pt; }
    .meta { color:#66717d; margin-bottom:14pt; }
    .tabs { margin:10pt 0 18pt; }
    .tab { display:inline-block; border:1pt solid #e6c4aa; padding:4pt 7pt; margin:0 5pt 5pt 0; color:#854513; background:#fff7ef; }
    .step { border:1pt solid #dce3ea; padding:12pt; margin:0 0 12pt; page-break-inside:avoid; }
    .kind { color:#145985; font-weight:bold; }
    .switch { color:#854513; background:#fff8f0; border:1pt dashed #dca977; padding:8pt; margin:8pt 0; }
    .warning { color:#9a3f00; font-weight:bold; }
    .shot { position:relative; max-width:100%; border:1pt solid #dce3ea; overflow:visible; }
    .shot img { display:block; max-width:100%; height:auto; }
    .focus { position:absolute; border:2pt solid #f18a2a; }
    .focus-zoom { position:absolute; border:2pt solid #f18a2a; overflow:hidden; background:#fff; }
    .focus-zoom img { position:absolute; display:block; max-width:none; height:auto; }
    .mask { position:absolute; background:#111827; }
    .redacted { color:#66717d; font-weight:bold; border:1pt dashed #dce3ea; padding:10pt; }
    .coords { color:#66717d; font-size:9pt; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">${renderStepSummary(steps)}</p>
  <div class="tabs">${tabs.map((tab) => `<span class="tab">${escapeHtml(tab.tabAlias)}${tab.domain ? ` · ${escapeHtml(tab.domain)}` : ""}</span>`).join("")}</div>
  <h2>操作步骤</h2>
  ${steps.map(renderWordStep).join("\n")}
</body>
</html>`;
}

function renderWordStep(step) {
  const transition = step.fromTabAlias || step.toTabAlias
    ? `<div class="switch">${escapeHtml(step.fromTabAlias || "当前标签页")} -> ${escapeHtml(step.toTabAlias || "目标标签页")}</div>`
    : "";
  const navigation = step.type === "navigation"
    ? `<div class="switch">${escapeHtml(step.fromUrl || "当前页面")} -> ${escapeHtml(step.toUrl || step.pageUrl || "目标页面")}</div>`
    : "";
  const warnings = step.privacyWarnings?.map((warning) => `<p class="warning">${escapeHtml(warning)}</p>`).join("") || "";
  const image = step.image
    ? renderArticleImage(step)
    : step.imageRedactedForPrivacy ? `<p class="redacted">截图已因隐私保护从导出文件中移除，仅保留截图元数据。</p>` : "";
  const key = step.key
    ? `<p class="coords">按键：${escapeHtml(step.key)}</p>`
    : "";
  const masks = step.privacyMaskBoxes?.length
    ? `<p class="coords">打码区域：${escapeHtml(step.privacyMaskBoxes.map((box) => `x=${box.x}, y=${box.y}, width=${box.width}, height=${box.height}`).join("; "))}</p>`
    : "";
  return `<article class="step">
  <h3>${step.sequence}. ${escapeHtml(step.title)}</h3>
  <p><span class="kind">${stepTypeText(step.type)}</span></p>
  ${transition}
  ${navigation}
  <p>${escapeHtml(step.description)}</p>
  ${warnings}
  ${image}
  ${key}
  ${masks}
</article>`;
}

function renderArticleStep(step) {
  const isTransition = step.type === "tab_transition" || step.type === "navigation";
  return `<article class="step">
  <div class="step-header">
    <div>
      <h2>${step.sequence}. ${escapeHtml(step.title)}</h2>
      <p>${escapeHtml(step.description)}</p>
      ${step.key ? `<p>按键：${escapeHtml(step.key)}</p>` : ""}
    </div>
    <span class="kind ${isTransition ? "tab" : ""}">${stepTypeText(step.type)}</span>
  </div>
  ${step.type === "navigation" ? `<div class="tabswitch">${escapeHtml(step.fromUrl || "当前页面")} -> ${escapeHtml(step.toUrl || step.pageUrl || "目标页面")}</div>` : ""}
  ${step.image ? renderArticleImage(step) : step.imageRedactedForPrivacy ? renderRedactedImageNotice() : ""}
</article>`;
}

function renderStepSummary(steps) {
  const tabCount = steps.filter((step) => step.type === "tab_transition").length;
  const navigationCount = steps.filter((step) => step.type === "navigation").length;
  const extras = [];
  if (tabCount) extras.push(`${tabCount} 个标签页切换`);
  if (navigationCount) extras.push(`${navigationCount} 个跨域页面变化`);
  return `共 ${steps.length} 个操作步骤${extras.length ? `，其中 ${extras.join("、")}` : ""}。`;
}

function resolveArticleTitle(state, tabs, options = {}) {
  const explicitTitle = normalizeTitle(options.title);
  if (explicitTitle) return explicitTitle;
  const sessionTitle = normalizeTitle(state?.session?.title || state?.session?.name);
  if (sessionTitle) return sessionTitle;
  const firstTab = (tabs || []).find((tab) => normalizeTitle(tab.title || tab.domain));
  if (firstTab) return `${normalizeTitle(firstTab.title || firstTab.domain)} 操作步骤`;
  return state?.session?.id || "SOP 操作手册";
}

function normalizeTitle(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stepTypeText(type) {
  if (type === "chapter_intro") return "章节";
  if (type === "tab_transition") return "标签页切换";
  if (type === "navigation") return "跨域页面变化";
  return "操作步骤";
}

function renderArticleImage(step) {
  const box = step.focusBox;
  const shot = step.screenshot || {};
  const viewportWidth = shot.viewportWidth || shot.width;
  const viewportHeight = shot.viewportHeight || shot.height;
  const focus = box && viewportWidth && viewportHeight ? renderFocusBox(box, viewportWidth, viewportHeight) : "";
  const zoom = box && viewportWidth && viewportHeight ? renderFocusZoom(step.image, box, viewportWidth, viewportHeight, step.privacyMaskBoxes || []) : "";
  const masks = viewportWidth && viewportHeight ? renderMaskBoxes(step.privacyMaskBoxes || [], viewportWidth, viewportHeight) : "";
  return `<div class="shot"><img src="${step.image}" alt="步骤截图">${focus}${masks}${zoom}</div>`;
}

function renderRedactedImageNotice() {
  return `<div class="shot" style="padding:22px;color:#66717d;font-weight:700">截图已因隐私保护从导出文件中移除，仅保留截图元数据。</div>`;
}

function renderFocusBox(box, viewportWidth, viewportHeight) {
  const focus = {
    left: `${Math.max(0, (box.x - 12) / viewportWidth * 100)}%`,
    top: `${Math.max(0, (box.y - 12) / viewportHeight * 100)}%`,
    width: `${Math.max(48, box.width + 24) / viewportWidth * 100}%`,
    height: `${Math.max(32, box.height + 24) / viewportHeight * 100}%`
  };
  return `<div class="focus" style="left:${focus.left};top:${focus.top};width:${focus.width};height:${focus.height}"></div>`;
}

function renderFocusZoom(image, box, viewportWidth, viewportHeight, maskBoxes = []) {
  const zoom = focusZoomLayout(box, viewportWidth, viewportHeight);
  const scale = Math.max(2.2, Math.min(5, Math.min(zoom.width / Math.max(1, box.width), zoom.height / Math.max(1, box.height)) * 1.9));
  const imageWidth = viewportWidth * scale;
  const imageHeight = viewportHeight * scale;
  const imageLeft = zoom.width / 2 - (box.x + box.width / 2) * scale;
  const imageTop = zoom.height / 2 - (box.y + box.height / 2) * scale;
  const masks = maskBoxes.map((mask) => {
    const left = imageLeft + mask.x * scale;
    const top = imageTop + mask.y * scale;
    return `<div class="mask" style="left:${left / zoom.width * 100}%;top:${top / zoom.height * 100}%;width:${Math.max(1, mask.width * scale) / zoom.width * 100}%;height:${Math.max(1, mask.height * scale) / zoom.height * 100}%"></div>`;
  }).join("");
  return `<div class="focus-zoom" style="left:${zoom.left};top:${zoom.top};width:${zoom.widthPercent};height:${zoom.heightPercent}"><img src="${image}" alt="Focus zoom" style="left:${imageLeft / zoom.width * 100}%;top:${imageTop / zoom.height * 100}%;width:${imageWidth / zoom.width * 100}%;height:${imageHeight / zoom.height * 100}%">${masks}</div>`;
}

function focusZoomLayout(box, viewportWidth, viewportHeight) {
  const zoomWidth = Math.min(280, Math.max(180, viewportWidth * 0.28));
  const zoomHeight = Math.round(zoomWidth * 0.625);
  const margin = 16;
  const rightSpace = viewportWidth - (box.x + box.width);
  const leftPx = rightSpace >= zoomWidth + margin * 2
    ? box.x + box.width + margin
    : Math.max(margin, box.x - zoomWidth - margin);
  const topPx = Math.max(margin, Math.min(viewportHeight - zoomHeight - margin, box.y + box.height / 2 - zoomHeight / 2));
  return {
    left: `${leftPx / viewportWidth * 100}%`,
    top: `${topPx / viewportHeight * 100}%`,
    widthPercent: `${zoomWidth / viewportWidth * 100}%`,
    heightPercent: `${zoomHeight / viewportHeight * 100}%`,
    width: Math.round(zoomWidth),
    height: Math.round(zoomHeight)
  };
}

function renderMaskBoxes(boxes, viewportWidth, viewportHeight) {
  return boxes.map((box) => {
    const mask = {
      left: `${Math.max(0, box.x / viewportWidth * 100)}%`,
      top: `${Math.max(0, box.y / viewportHeight * 100)}%`,
      width: `${Math.max(1, box.width) / viewportWidth * 100}%`,
      height: `${Math.max(1, box.height) / viewportHeight * 100}%`
    };
    return `<div class="mask" style="left:${mask.left};top:${mask.top};width:${mask.width};height:${mask.height}"></div>`;
  }).join("");
}

function downloadTextFile(filename, mimeType, content) {
  const url = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
  return chrome.downloads.download({ url, filename, saveAs: true });
}

function escapeMarkdown(value) {
  return String(value ?? "").replace(/[\\`*{}[\]()#+\-.!|>]/g, "\\$&");
}

function escapeCssUrl(value) {
  return String(value ?? "").replace(/['\\]/g, "\\$&");
}
