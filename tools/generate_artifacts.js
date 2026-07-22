const fs = require("node:fs");
const path = require("node:path");
const { buildArticleSteps, buildVideoTimeline } = require("../extension/shared/artifacts");

const inputPath = process.argv[2] || path.join(__dirname, "..", "examples", "sample-recording.json");
const outputDir = process.argv[3] || path.join(__dirname, "..", "dist");

const recording = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const nodes = recording.nodes || [];
const tabs = Object.values(recording.tabContexts || {});
const steps = buildArticleSteps(nodes);
const timeline = buildVideoTimeline(steps);

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "article.html"), renderArticle(recording, tabs, steps), "utf8");
fs.writeFileSync(path.join(outputDir, "video-timeline.json"), JSON.stringify(timeline, null, 2), "utf8");
fs.writeFileSync(path.join(outputDir, "video-storyboard.html"), renderVideoStoryboard(recording, timeline), "utf8");

console.log(`Generated ${path.join(outputDir, "article.html")}`);
console.log(`Generated ${path.join(outputDir, "video-timeline.json")}`);
console.log(`Generated ${path.join(outputDir, "video-storyboard.html")}`);

function renderArticle(recording, tabs, steps) {
  const title = recording.session?.id || "SOP 操作手册";
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
    .step { border:1px solid var(--line); border-radius:8px; background:var(--paper); margin-bottom:18px; overflow:hidden; }
    .step-header { display:flex; justify-content:space-between; align-items:start; gap:20px; padding:18px; border-bottom:1px solid var(--line); }
    .step h2 { margin:0 0 8px; font-size:22px; }
    .step p { margin:0; color:var(--muted); line-height:1.55; }
    .kind { flex:0 0 auto; border-radius:999px; padding:6px 10px; background:#e8f2fa; color:#145985; font-size:12px; font-weight:800; }
    .kind.tab { background:#fff1e4; color:var(--tab); }
    .shot { position:relative; margin:18px; border:1px solid var(--line); border-radius:8px; overflow:hidden; background:#f7f9fb; }
    .shot img { display:block; width:100%; }
    .focus { position:absolute; border:3px solid #f18a2a; border-radius:8px; box-shadow:0 0 0 9999px rgb(0 0 0 / 32%); pointer-events:none; }
    .warning { margin-top:10px; color:#9a3f00; font-weight:700; }
  </style>
</head>
<body>
  <main>
    <header class="hero">
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">共 ${steps.length} 个步骤，其中 ${steps.filter((step) => step.type === "tab_transition").length} 个标签页切换步骤。</div>
      <div class="tabs">${tabs.map((tab) => `<span class="tab-pill">${escapeHtml(tab.tabAlias)} · ${escapeHtml(tab.domain || "")}</span>`).join("")}</div>
    </header>
    ${steps.map(renderStep).join("\n")}
  </main>
</body>
</html>`;
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
  const isTab = segment.type === "tab_transition";
  return `<article class="segment">
  <div class="time">${segment.startTime}s - ${segment.endTime}s</div>
  <div class="body">
    <span class="kind ${isTab ? "tab" : ""}">${isTab ? "标签页切换片段" : "操作片段"}</span>
    <h2>${escapeHtml(segment.caption)}</h2>
    ${segment.currentTabAlias ? `<p>当前：${escapeHtml(segment.currentTabAlias)}</p>` : ""}
    ${segment.fromTabAlias || segment.toTabAlias ? `<div class="tabswitch">${escapeHtml(segment.fromTabAlias || "当前标签页")} -> ${escapeHtml(segment.toTabAlias || "目标标签页")}</div>` : ""}
    ${segment.visual ? `<div class="shot"><img src="${segment.visual}" alt="视频片段画面"></div>` : ""}
  </div>
</article>`;
}

function renderStep(step) {
  const isTab = step.type === "tab_transition";
  return `<article class="step">
  <div class="step-header">
    <div>
      <h2>${step.sequence}. ${escapeHtml(step.title)}</h2>
      <p>${escapeHtml(step.description)}</p>
      ${step.tabAlias ? `<p>${escapeHtml(step.tabAlias)}</p>` : ""}
      ${step.privacyWarnings.map((warning) => `<div class="warning">${escapeHtml(warning)}</div>`).join("")}
    </div>
    <span class="kind ${isTab ? "tab" : ""}">${isTab ? "标签页切换" : "操作步骤"}</span>
  </div>
  ${step.image ? renderImage(step) : ""}
</article>`;
}

function renderImage(step) {
  const box = step.focusBox;
  const focus = box
    ? `<div class="focus" style="left:${Math.max(0, box.x - 12)}px;top:${Math.max(0, box.y - 12)}px;width:${Math.max(48, box.width + 24)}px;height:${Math.max(32, box.height + 24)}px"></div>`
    : "";
  return `<div class="shot"><img src="${step.image}" alt="步骤截图">${focus}</div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
