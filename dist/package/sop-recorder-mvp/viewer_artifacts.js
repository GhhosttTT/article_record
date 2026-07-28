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

async function renderArticleWordDocument(state, tabs, steps, options = {}) {
  const title = resolveArticleTitle(state, tabs, options);
  const safeSteps = steps || [];
  const images = await Promise.all(safeSteps.map(async (step, index) => ({
    stepId: step.id,
    filename: `image${index + 1}.png`,
    dataUrl: step.image ? await renderWordScreenshotDataUrl(step) : null,
    screenshot: step.screenshot || null
  })));
  return buildDocxBlob(title, tabs || [], safeSteps, images);
}
async function renderWordStep(step) {
  const transition = step.fromTabAlias || step.toTabAlias
    ? `<div class="switch">${escapeHtml(step.fromTabAlias || "当前标签页")} -> ${escapeHtml(step.toTabAlias || "目标标签页")}</div>`
    : "";
  const navigation = step.type === "navigation"
    ? `<div class="switch">${escapeHtml(step.fromUrl || "当前页面")} -> ${escapeHtml(step.toUrl || step.pageUrl || "目标页面")}</div>`
    : "";
  const warnings = step.privacyWarnings?.map((warning) => `<p class="warning">${escapeHtml(warning)}</p>`).join("") || "";
  const image = step.image
    ? await renderWordImage(step)
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

async function renderWordImage(step) {
  const rendered = await renderWordScreenshotDataUrl(step);
  return `<div class="shot"><img src="${rendered}" alt="Word screenshot"></div>`;
}

async function renderWordScreenshotDataUrl(step) {
  const box = step.focusBox;
  const masks = step.privacyMaskBoxes || [];
  if (!box && !masks.length) return step.image;
  try {
    const image = await loadImageElement(step.image);
    const shot = step.screenshot || {};
    const width = Math.max(1, Math.round(shot.viewportWidth || shot.width || image.naturalWidth || image.width));
    const height = Math.max(1, Math.round(shot.viewportHeight || shot.height || image.naturalHeight || image.height));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, width, height);
    if (box && Number.isFinite(box.x)) drawWordFocusOverlay(ctx, image, box, width, height);
    masks.forEach((mask) => drawWordMask(ctx, mask));
    return canvas.toDataURL("image/png");
  } catch {
    return step.image;
  }
}

function drawWordFocusOverlay(ctx, image, box, width, height) {
  const focus = expandBox(box, width, height, 12);
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.32)";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, focus.x, focus.y, focus.width, focus.height, focus.x, focus.y, focus.width, focus.height);
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  roundedRectPath(ctx, focus.x, focus.y, focus.width, focus.height, 8);
  ctx.strokeStyle = "#f18a2a";
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.restore();
}

function drawWordMask(ctx, box) {
  if (!box || !Number.isFinite(box.x)) return;
  ctx.save();
  ctx.fillStyle = "#111827";
  roundedRectPath(ctx, box.x, box.y, Math.max(1, box.width), Math.max(1, box.height), 6);
  ctx.fill();
  ctx.restore();
}

function expandBox(box, width, height, padding) {
  const x = Math.max(0, box.x - padding);
  const y = Math.max(0, box.y - padding);
  return {
    x,
    y,
    width: Math.min(width - x, Math.max(48, box.width + padding * 2)),
    height: Math.min(height - y, Math.max(32, box.height + padding * 2))
  };
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function buildDocxBlob(title, tabs, steps, images) {
  const mediaFiles = images
    .filter((item) => item.dataUrl)
    .map((item, index) => ({
      ...item,
      relId: `rIdImage${index + 1}`,
      path: `word/media/${item.filename}`,
      bytes: dataUrlToBytes(item.dataUrl)
    }));
  const imageByStep = new Map(mediaFiles.map((item) => [item.stepId, item]));
  const parts = [
    { path: "[Content_Types].xml", text: docxContentTypes(mediaFiles) },
    { path: "_rels/.rels", text: docxRootRels() },
    { path: "word/_rels/document.xml.rels", text: docxDocumentRels(mediaFiles) },
    { path: "word/document.xml", text: docxDocumentXml(title, tabs, steps, imageByStep) },
    ...mediaFiles.map((file) => ({ path: file.path, bytes: file.bytes }))
  ];
  return new Blob([zipStore(parts)], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });
}

function docxContentTypes(mediaFiles) {
  const pngOverride = mediaFiles.length ? '<Default Extension="png" ContentType="image/png"/>' : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${pngOverride}
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
}

function docxRootRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
}

function docxDocumentRels(mediaFiles) {
  const imageRels = mediaFiles.map((file) =>
    `<Relationship Id="${file.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${escapeXml(file.filename)}"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${imageRels}</Relationships>`;
}

function docxDocumentXml(title, tabs, steps, imageByStep) {
  const body = [
    docxParagraph(title, "Title"),
    docxParagraph(renderStepSummary(steps), "Meta"),
    ...(tabs || []).map((tab) => docxParagraph(`${tab.tabAlias}${tab.domain ? ` - ${tab.domain}` : ""}`, "Meta")),
    docxParagraph("操作步骤", "Heading1"),
    ...steps.flatMap((step) => docxStepBlocks(step, imageByStep.get(step.id)))
  ].join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body>
</w:document>`;
}

function docxStepBlocks(step, image) {
  const blocks = [
    docxParagraph(`${step.sequence}. ${step.title}`, "Heading2"),
    docxParagraph(stepTypeText(step.type), "Kind"),
    docxParagraph(step.description || "")
  ];
  if (step.fromTabAlias || step.toTabAlias) blocks.push(docxParagraph(`${step.fromTabAlias || "当前标签页"} -> ${step.toTabAlias || "目标标签页"}`, "Meta"));
  if (step.type === "navigation") blocks.push(docxParagraph(`${step.fromUrl || "当前页面"} -> ${step.toUrl || step.pageUrl || "目标页面"}`, "Meta"));
  (step.privacyWarnings || []).forEach((warning) => blocks.push(docxParagraph(warning, "Warning")));
  if (image) blocks.push(docxImageParagraph(image));
  if (!image && step.imageRedactedForPrivacy) blocks.push(docxParagraph("截图已因隐私保护从导出文件中移除，仅保留截图元数据。", "Meta"));
  if (step.key) blocks.push(docxParagraph(`按键：${step.key}`, "Meta"));
  if (step.privacyMaskBoxes?.length) blocks.push(docxParagraph("打码区域已渲染到截图中。", "Meta"));
  return blocks;
}

function docxParagraph(text, style = "") {
  const styleXml = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${styleXml}<w:r><w:t xml:space="preserve">${escapeXml(text || "")}</w:t></w:r></w:p>`;
}

function docxImageParagraph(image) {
  const dims = docxImageSize(image.screenshot);
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
    <wp:extent cx="${dims.width}" cy="${dims.height}"/><wp:docPr id="${image.relId.replace(/\D/g, "") || 1}" name="${escapeXml(image.filename)}"/>
    <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>
      <pic:nvPicPr><pic:cNvPr id="0" name="${escapeXml(image.filename)}"/><pic:cNvPicPr/></pic:nvPicPr>
      <pic:blipFill><a:blip r:embed="${image.relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
      <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${dims.width}" cy="${dims.height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
    </pic:pic></a:graphicData></a:graphic>
  </wp:inline></w:drawing></w:r></w:p>`;
}

function docxImageSize(screenshot = {}) {
  const sourceWidth = Math.max(1, Number(screenshot.viewportWidth || screenshot.width || 1280));
  const sourceHeight = Math.max(1, Number(screenshot.viewportHeight || screenshot.height || 720));
  const maxWidth = 6.4 * 914400;
  const height = Math.round(maxWidth * sourceHeight / sourceWidth);
  return { width: Math.round(maxWidth), height };
}

function dataUrlToBytes(dataUrl) {
  const base64 = String(dataUrl || "").split(",", 2)[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function zipStore(parts) {
  const encoder = new TextEncoder();
  const files = parts.map((part) => {
    const name = encoder.encode(part.path);
    const data = part.bytes || encoder.encode(part.text || "");
    return { ...part, name, data, crc: crc32(data) };
  });
  const chunks = [];
  const central = [];
  let offset = 0;
  files.forEach((file) => {
    const local = zipLocalHeader(file);
    chunks.push(local, file.name, file.data);
    central.push({ file, offset });
    offset += local.length + file.name.length + file.data.length;
  });
  const centralStart = offset;
  central.forEach((entry) => {
    const header = zipCentralHeader(entry.file, entry.offset);
    chunks.push(header, entry.file.name);
    offset += header.length + entry.file.name.length;
  });
  chunks.push(zipEndRecord(files.length, offset - centralStart, centralStart));
  return concatBytes(chunks);
}

function zipLocalHeader(file) {
  const header = new Uint8Array(30);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint32(14, file.crc, true);
  view.setUint32(18, file.data.length, true);
  view.setUint32(22, file.data.length, true);
  view.setUint16(26, file.name.length, true);
  return header;
}

function zipCentralHeader(file, offset) {
  const header = new Uint8Array(46);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint32(16, file.crc, true);
  view.setUint32(20, file.data.length, true);
  view.setUint32(24, file.data.length, true);
  view.setUint16(28, file.name.length, true);
  view.setUint32(42, offset, true);
  return header;
}

function zipEndRecord(fileCount, centralSize, centralOffset) {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, fileCount, true);
  view.setUint16(10, fileCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  return header;
}

function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.length;
  });
  return output;
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function escapeXml(value) {
  return escapeHtml(value);
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
