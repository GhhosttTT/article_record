const fs = require("node:fs");
const path = require("node:path");
const { buildArticleSteps, buildArticleChapters, buildPrivacySafeArticleSteps, buildVideoTimeline } = require("../extension/shared/artifacts");

const inputPath = process.argv[2] || path.join(__dirname, "..", "examples", "sample-recording.json");
const outputDir = process.argv[3] || path.join(__dirname, "..", "dist");

const recording = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const nodes = recording.nodes || [];
const tabs = Object.values(recording.tabContexts || {});
const steps = buildArticleSteps(nodes);
const exportSteps = buildPrivacySafeArticleSteps(steps);
const chapters = buildArticleChapters(exportSteps);
const timeline = buildVideoTimeline(exportSteps, { chapters, includeChapterIntros: true });

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "article.html"), renderArticle(recording, tabs, exportSteps), "utf8");
fs.writeFileSync(path.join(outputDir, "article.md"), renderArticleMarkdown(recording, tabs, exportSteps), "utf8");
fs.writeFileSync(path.join(outputDir, "article.doc"), renderArticleWordDocument(recording, tabs, exportSteps), "utf8");
fs.writeFileSync(path.join(outputDir, "video-timeline.json"), JSON.stringify(timeline, null, 2), "utf8");
fs.writeFileSync(path.join(outputDir, "video-storyboard.html"), renderVideoStoryboard(recording, timeline), "utf8");

console.log(`Generated ${path.join(outputDir, "article.html")}`);
console.log(`Generated ${path.join(outputDir, "article.md")}`);
console.log(`Generated ${path.join(outputDir, "article.doc")}`);
console.log(`Generated ${path.join(outputDir, "video-timeline.json")}`);
console.log(`Generated ${path.join(outputDir, "video-storyboard.html")}`);

function renderArticle(recording, tabs, steps) {
  const title = recording.session?.id || "SOP 操作手册";
  const chapters = buildArticleChapters(steps);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { --ink:#18212b; --muted:#66717d; --line:#dce3ea; --paper:#fff; --wash:#f3f6f8; --accent:#1769aa; --tab:#cc6b2c; }
    * { box-sizing:border-box; }
    body { margin:0; color:var(--ink); background:var(--wash); font-family:"Segoe UI","Microsoft YaHei",sans-serif; }
    main { width:min(1080px, calc(100vw - 36px)); margin:0 auto; padding:36px 0 64px; }
    header.hero { margin-bottom:22px; }
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
    .shot { position:relative; margin:18px; border:1px solid var(--line); border-radius:8px; overflow:hidden; background:#f7f9fb; }
    .shot img { display:block; width:100%; }
    .focus { position:absolute; border:3px solid #f18a2a; border-radius:8px; box-shadow:0 0 0 9999px rgb(0 0 0 / 32%); pointer-events:none; }
    .focus-zoom { position:absolute; width:min(280px, 36%); aspect-ratio:16/10; border:3px solid #f18a2a; border-radius:8px; overflow:hidden; background:#fff; box-shadow:0 12px 28px rgb(0 0 0 / 28%); pointer-events:none; }
    .focus-zoom img { position:absolute; display:block; max-width:none; width:auto; }
    .focus-zoom::before { content:"Focus zoom"; position:absolute; left:8px; top:8px; padding:3px 7px; border-radius:999px; background:rgb(24 33 43 / 82%); color:#fff; font-size:11px; font-weight:800; }
    .mask { position:absolute; border-radius:6px; background:#111827; box-shadow:inset 0 0 0 2px rgb(255 255 255 / 45%); pointer-events:none; }
    .warning { margin-top:10px; color:#9a3f00; font-weight:700; }
  </style>
</head>
<body>
  <main>
    <header class="hero">
      <h1>${escapeHtml(title)}</h1>
    <div class="meta">${renderStepSummary(steps, chapters)}</div>
      <div class="tabs">${tabs.map((tab) => `<span class="tab-pill">${escapeHtml(tab.tabAlias)} · ${escapeHtml(tab.domain || "")}</span>`).join("")}</div>
    </header>
    ${chapters.map(renderArticleChapter).join("\n")}
  </main>
</body>
</html>`;
}

function renderArticleMarkdown(recording, tabs, steps) {
  const title = recording.session?.id || "SOP 操作手册";
  const chapters = buildArticleChapters(steps);
  const lines = [
    `# ${escapeMarkdown(title)}`,
    "",
    renderStepSummary(steps, chapters),
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
  chapters.forEach((chapter) => {
    lines.push(`## 章节 ${chapter.sequence}：${escapeMarkdown(chapter.title)}`);
    const chapterContext = renderChapterContext(chapter);
    if (chapterContext) lines.push(escapeMarkdown(chapterContext));
    lines.push("");

    chapter.steps.forEach((step) => {
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
    if (step.focusBox) {
      lines.push("");
      lines.push(`高亮区域：x=${step.focusBox.x}, y=${step.focusBox.y}, width=${step.focusBox.width}, height=${step.focusBox.height}`);
    }
    if (step.clickPoint) {
      lines.push("");
      lines.push(`点击坐标：x=${step.clickPoint.x}, y=${step.clickPoint.y}`);
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
  });

  return `${lines.join("\n").trim()}\n`;
}

function renderArticleWordDocument(recording, tabs, steps) {
  const title = recording.session?.id || "SOP 操作手册";
  const chapters = buildArticleChapters(steps);
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
    .shot { position:relative; max-width:100%; border:1pt solid #dce3ea; overflow:hidden; }
    .shot img { display:block; max-width:100%; height:auto; }
    .focus { position:absolute; border:2pt solid #f18a2a; }
    .focus-zoom { display:none; }
    .mask { position:absolute; background:#111827; }
    .redacted { color:#66717d; font-weight:bold; border:1pt dashed #dce3ea; padding:10pt; }
    .coords { color:#66717d; font-size:9pt; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">${renderStepSummary(steps, chapters)}</p>
  <div class="tabs">${tabs.map((tab) => `<span class="tab">${escapeHtml(tab.tabAlias)}${tab.domain ? ` · ${escapeHtml(tab.domain)}` : ""}</span>`).join("")}</div>
  ${chapters.map(renderWordChapter).join("\n")}
</body>
</html>`;
}

function renderArticleChapter(chapter) {
  return `<section class="chapter">
  <header class="chapter-head">
    <h2>章节 ${chapter.sequence}：${escapeHtml(chapter.title)}</h2>
    <p>${escapeHtml(renderChapterContext(chapter))}</p>
  </header>
  ${chapter.steps.map(renderStep).join("\n")}
</section>`;
}

function renderWordChapter(chapter) {
  return `<section>
  <h2>章节 ${chapter.sequence}：${escapeHtml(chapter.title)}</h2>
  ${chapter.tabAlias || chapter.pageUrl ? `<p class="meta">${escapeHtml(renderChapterContext(chapter))}</p>` : ""}
  ${chapter.steps.map(renderWordStep).join("\n")}
</section>`;
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
    ? renderImage(step)
    : step.imageRedactedForPrivacy ? `<p class="redacted">截图已因隐私保护从导出文件中移除，仅保留截图元数据。</p>` : "";
  const focus = step.focusBox
    ? `<p class="coords">高亮区域：x=${escapeHtml(step.focusBox.x)}, y=${escapeHtml(step.focusBox.y)}, width=${escapeHtml(step.focusBox.width)}, height=${escapeHtml(step.focusBox.height)}</p>`
    : "";
  const click = step.clickPoint
    ? `<p class="coords">点击坐标：x=${escapeHtml(step.clickPoint.x)}, y=${escapeHtml(step.clickPoint.y)}</p>`
    : "";
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
  ${focus}
  ${click}
  ${key}
  ${masks}
</article>`;
}

function renderVideoStoryboard(recording, timeline) {
  const title = `${recording.session?.id || "SOP"} 视频分镜`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { --ink:#18212b; --muted:#66717d; --line:#dce3ea; --paper:#fff; --wash:#f3f6f8; --tab:#cc6b2c; --accent:#1769aa; }
    * { box-sizing:border-box; }
    body { margin:0; color:var(--ink); background:var(--wash); font-family:"Segoe UI","Microsoft YaHei",sans-serif; }
    main { width:min(1080px, calc(100vw - 36px)); margin:0 auto; padding:36px 0 64px; }
    h1 { margin:0 0 8px; font-size:34px; }
    .meta { color:var(--muted); margin-bottom:22px; }
    .segment { display:grid; grid-template-columns:160px 1fr; gap:18px; border:1px solid var(--line); border-radius:8px; background:var(--paper); margin-bottom:14px; overflow:hidden; }
    .time { padding:18px; border-right:1px solid var(--line); background:#edf4fa; font-weight:800; color:#145985; }
    .body { padding:18px; }
    .kind { display:inline-block; border-radius:999px; padding:6px 10px; margin-bottom:10px; background:#e8f2fa; color:#145985; font-size:12px; font-weight:800; }
    .kind.tab { background:#fff1e4; color:var(--tab); }
    h2 { margin:0 0 8px; font-size:20px; }
    p { margin:0 0 8px; color:var(--muted); line-height:1.55; }
    .tabswitch { border:1px dashed #dca977; border-radius:8px; padding:18px; background:#fff8f0; color:#854513; font-weight:800; }
    .shot { max-width:760px; border:1px solid var(--line); border-radius:8px; overflow:hidden; background:#f7f9fb; }
    .shot img { display:block; width:100%; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">总时长 ${timeline.segments.at(-1)?.endTime || 0}s，共 ${timeline.segments.length} 个片段。</div>
    ${timeline.segments.map(renderSegment).join("\n")}
  </main>
</body>
</html>`;
}

function renderSegment(segment) {
  const isTransition = segment.type === "tab_transition" || segment.type === "navigation" || segment.type === "chapter_intro";
  return `<article class="segment">
  <div class="time">${segment.startTime}s - ${segment.endTime}s</div>
  <div class="body">
    <span class="kind ${isTransition ? "tab" : ""}">${stepTypeText(segment.type)}片段</span>
    <h2>${escapeHtml(segment.caption)}</h2>
    ${segment.key ? `<p>按键：${escapeHtml(segment.key)}</p>` : ""}
    ${segment.currentTabAlias ? `<p>当前：${escapeHtml(segment.currentTabAlias)}</p>` : ""}
    ${segment.fromTabAlias || segment.toTabAlias ? `<div class="tabswitch">${escapeHtml(segment.fromTabAlias || "当前标签页")} -> ${escapeHtml(segment.toTabAlias || "目标标签页")}</div>` : ""}
    ${segment.type === "navigation" ? `<div class="tabswitch">${escapeHtml(segment.fromUrl || "当前页面")} -> ${escapeHtml(segment.toUrl || segment.pageUrl || "目标页面")}</div>` : ""}
    ${segment.visual ? `<div class="shot"><img src="${segment.visual}" alt="视频片段画面"></div>` : segment.screenshot?.redactedForPrivacy ? renderRedactedImageNotice() : ""}
  </div>
</article>`;
}

function renderStep(step) {
  const isTransition = step.type === "tab_transition" || step.type === "navigation";
  return `<article class="step">
  <div class="step-header">
    <div>
      <h2>${step.sequence}. ${escapeHtml(step.title)}</h2>
      <p>${escapeHtml(step.description)}</p>
      ${step.key ? `<p>按键：${escapeHtml(step.key)}</p>` : ""}
      ${step.privacyWarnings.map((warning) => `<div class="warning">${escapeHtml(warning)}</div>`).join("")}
    </div>
    <span class="kind ${isTransition ? "tab" : ""}">${stepTypeText(step.type)}</span>
  </div>
  ${step.type === "navigation" ? `<div class="tabswitch">${escapeHtml(step.fromUrl || "当前页面")} -> ${escapeHtml(step.toUrl || step.pageUrl || "目标页面")}</div>` : ""}
  ${step.image ? renderImage(step) : step.imageRedactedForPrivacy ? renderRedactedImageNotice() : ""}
</article>`;
}

function renderChapterContext(chapter) {
  const parts = [];
  if (chapter.tabAlias) parts.push(`当前标签页：${chapter.tabAlias}`);
  const path = pagePath(chapter.pageUrl);
  if (path) parts.push(`访问路径：${path}`);
  if (chapter.pageUrl) parts.push(`完整地址：${chapter.pageUrl}`);
  return parts.join(" · ");
}

function pagePath(url) {
  if (!url) return "";
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "";
  }
}

function renderStepSummary(steps, chapters = []) {
  const tabCount = steps.filter((step) => step.type === "tab_transition").length;
  const navigationCount = steps.filter((step) => step.type === "navigation").length;
  return `共 ${steps.length} 个步骤，分为 ${chapters.length} 个章节，其中 ${tabCount} 个标签页切换步骤、${navigationCount} 个页面跳转步骤。`;
}

function stepTypeText(type) {
  if (type === "chapter_intro") return "章节";
  if (type === "tab_transition") return "标签页切换";
  if (type === "navigation") return "页面跳转";
  return "操作步骤";
}

function renderImage(step) {
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
    return `<div class="mask" style="left:${left}px;top:${top}px;width:${Math.max(1, mask.width * scale)}px;height:${Math.max(1, mask.height * scale)}px"></div>`;
  }).join("");
  return `<div class="focus-zoom" style="left:${zoom.left};top:${zoom.top};width:${zoom.width}px;height:${zoom.height}px"><img src="${image}" alt="Focus zoom" style="left:${imageLeft}px;top:${imageTop}px;width:${imageWidth}px;height:${imageHeight}px">${masks}</div>`;
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeMarkdown(value) {
  return String(value ?? "").replace(/[\\`*{}[\]()#+\-.!|>]/g, "\\$&");
}

function escapeCssUrl(value) {
  return String(value ?? "").replace(/['\\]/g, "\\$&");
}
