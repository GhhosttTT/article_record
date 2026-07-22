const { buildArticleSteps, buildVideoTimeline } = SopArtifactShared;

function renderArticleHtml(state, tabs, steps) {
  const title = state.session?.id || "SOP 操作手册";
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
    .step { border:1px solid var(--line); border-radius:8px; background:var(--paper); margin-bottom:18px; overflow:hidden; }
    .step-header { display:flex; justify-content:space-between; align-items:start; gap:20px; padding:18px; border-bottom:1px solid var(--line); }
    .step h2 { margin:0 0 8px; font-size:22px; }
    .step p { margin:0; color:var(--muted); line-height:1.55; }
    .kind { flex:0 0 auto; border-radius:999px; padding:6px 10px; background:#e8f2fa; color:#145985; font-size:12px; font-weight:800; }
    .kind.tab { background:#fff1e4; color:var(--tab); }
    .shot { position:relative; margin:18px; border:1px solid var(--line); border-radius:8px; overflow:hidden; background:#f7f9fb; }
    .shot img { display:block; width:100%; }
    .focus { position:absolute; border:3px solid #f18a2a; border-radius:8px; box-shadow:0 0 0 9999px rgb(0 0 0 / 32%); pointer-events:none; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">共 ${steps.length} 个步骤，其中 ${steps.filter((step) => step.type === "tab_transition").length} 个标签页切换步骤。</div>
    <div class="tabs">${tabs.map((tab) => `<span class="tab-pill">${escapeHtml(tab.tabAlias)} · ${escapeHtml(tab.domain || "")}</span>`).join("")}</div>
    ${steps.map(renderArticleStep).join("\n")}
  </main>
</body>
</html>`;
}

function renderArticleStep(step) {
  const isTab = step.type === "tab_transition";
  return `<article class="step">
  <div class="step-header">
    <div>
      <h2>${step.sequence}. ${escapeHtml(step.title)}</h2>
      <p>${escapeHtml(step.description)}</p>
      ${step.tabAlias ? `<p>${escapeHtml(step.tabAlias)}</p>` : ""}
    </div>
    <span class="kind ${isTab ? "tab" : ""}">${isTab ? "标签页切换" : "操作步骤"}</span>
  </div>
  ${step.image ? renderArticleImage(step) : ""}
</article>`;
}

function renderArticleImage(step) {
  const box = step.focusBox;
  const focus = box
    ? `<div class="focus" style="left:${Math.max(0, box.x - 12)}px;top:${Math.max(0, box.y - 12)}px;width:${Math.max(48, box.width + 24)}px;height:${Math.max(32, box.height + 24)}px"></div>`
    : "";
  return `<div class="shot"><img src="${step.image}" alt="步骤截图">${focus}</div>`;
}

function downloadTextFile(filename, mimeType, content) {
  const url = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
  return chrome.downloads.download({ url, filename, saveAs: true });
}
