const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const framesOnly = process.argv.includes("--frames-only");
const resolution = resolveVideoResolution(process.argv);
const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const timelinePath = positionalArgs[0] || path.join(__dirname, "..", "dist", "video-timeline.json");
const outputDir = positionalArgs[1] || path.join(__dirname, "..", "dist", "video");

const timeline = JSON.parse(fs.readFileSync(timelinePath, "utf8"));
const frameDir = path.join(outputDir, "frames");
const pngFrameDir = path.join(outputDir, "png-frames");
const VIDEO_WIDTH = resolution.width;
const VIDEO_HEIGHT = resolution.height;
const VIDEO_VIEWBOX_WIDTH = 1280;
const VIDEO_VIEWBOX_HEIGHT = 720;
const FINAL_HOLD_SECONDS = 1;
fs.mkdirSync(frameDir, { recursive: true });
fs.mkdirSync(pngFrameDir, { recursive: true });
cleanGeneratedFrames(frameDir);
cleanGeneratedPngFrames(pngFrameDir);

const svgConcatLines = [];
for (const segment of timeline.segments || []) {
  const framePath = path.join(frameDir, `${segment.id}.svg`);
  fs.writeFileSync(framePath, renderFrame(segment), "utf8");
  svgConcatLines.push(`file '${toFfmpegPath(framePath)}'`);
  svgConcatLines.push(`duration ${segment.endTime - segment.startTime}`);
}

if (timeline.segments?.length) {
  const lastFrame = path.join(frameDir, `${timeline.segments.at(-1).id}.svg`);
  svgConcatLines.push(`file '${toFfmpegPath(lastFrame)}'`);
  svgConcatLines.push(`duration ${FINAL_HOLD_SECONDS}`);
}

const concatPath = path.join(outputDir, "concat.txt");
console.log(`Generated frames: ${frameDir}`);

if (!framesOnly) {
  const ffmpegPath = findFfmpegExecutable();
  if (!ffmpegPath) {
    console.warn("FFmpeg not found. Install ffmpeg or rerun with --frames-only to generate frames only.");
    process.exitCode = 2;
  } else {
    const chrome = findChromeExecutable();
    if (!chrome) {
      console.warn("Chrome not found. Install Chrome or rerun with --frames-only to generate SVG frames only.");
      process.exitCode = 2;
      process.exit();
    }
    renderPngFramesWithChrome(chrome, timeline.segments || [], frameDir, pngFrameDir);
    const pngConcatLines = [];
    for (const segment of timeline.segments || []) {
      const pngPath = path.join(pngFrameDir, `${segment.id}.png`);
      pngConcatLines.push(`file '${toFfmpegPath(pngPath)}'`);
      pngConcatLines.push(`duration ${segment.endTime - segment.startTime}`);
    }
    if (timeline.segments?.length) {
      const lastPng = path.join(pngFrameDir, `${timeline.segments.at(-1).id}.png`);
      pngConcatLines.push(`file '${toFfmpegPath(lastPng)}'`);
      pngConcatLines.push(`duration ${FINAL_HOLD_SECONDS}`);
      pngConcatLines.push(`file '${toFfmpegPath(lastPng)}'`);
    }
    fs.writeFileSync(concatPath, pngConcatLines.join("\n"), "utf8");
    console.log(`Generated PNG frames: ${pngFrameDir}`);
    console.log(`Generated concat list: ${concatPath}`);

    const outputPath = path.join(outputDir, "sop-video.mp4");
    const result = spawnSync(ffmpegPath, [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", concatPath,
      "-vf", "fps=30,format=yuv420p",
      "-c:v", "libx264",
      "-preset", "slow",
      "-crf", "16",
      "-movflags", "+faststart",
      outputPath
    ], { encoding: "utf8" });
    if (result.status !== 0) {
      console.error(result.stderr || result.stdout);
      process.exit(result.status || 1);
    }
    console.log(`Generated MP4: ${outputPath}`);
  }
} else {
  fs.writeFileSync(concatPath, svgConcatLines.join("\n"), "utf8");
  console.log(`Generated concat list: ${concatPath}`);
}

function resolveVideoResolution(argv) {
  const arg = argv.find((item) => item === "--4k" || item.startsWith("--resolution="));
  const value = arg === "--4k" ? "4k" : String(arg || "").split("=")[1] || "2k";
  if (/^(4k|uhd|2160p)$/i.test(value)) return { width: 3840, height: 2160, label: "4k" };
  if (/^(1080p|fhd)$/i.test(value)) return { width: 1920, height: 1080, label: "1080p" };
  return { width: 2560, height: 1440, label: "2k" };
}

function renderFrame(segment) {
  if (segment.type === "title_intro") return renderTitleIntroFrame(segment);
  const isTab = segment.type === "tab_transition";
  const isNavigation = segment.type === "navigation";
  const isChapter = segment.type === "chapter_intro";
  const title = isChapter ? "章节" : isTab ? "标签页切换" : isNavigation ? "页面跳转" : "操作步骤";
  const badgeColor = isChapter ? "#eef2ff" : isTab ? "#fff1e4" : isNavigation ? "#edf7ee" : "#e8f2fa";
  const badgeText = isChapter ? "#354a9f" : isTab ? "#a65016" : isNavigation ? "#226438" : "#145985";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${VIDEO_WIDTH}" height="${VIDEO_HEIGHT}" viewBox="0 0 ${VIDEO_VIEWBOX_WIDTH} ${VIDEO_VIEWBOX_HEIGHT}">
  <rect width="${VIDEO_VIEWBOX_WIDTH}" height="${VIDEO_VIEWBOX_HEIGHT}" fill="#111827"/>
  ${renderSegmentVisual(segment, isTab, isNavigation, isChapter)}
  ${renderTypeBadge(title, badgeColor, badgeText)}
  ${renderArticleTitle(segment.articleTitle)}
  ${segment.key ? renderKeyBadge(segment.key) : ""}
  ${renderSubtitle(segment)}
</svg>`;
}

function renderTitleIntroFrame(segment) {
  const title = trimMiddle(segment.caption || segment.articleTitle || "\u64cd\u4f5c\u6b65\u9aa4", 38);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${VIDEO_WIDTH}" height="${VIDEO_HEIGHT}" viewBox="0 0 ${VIDEO_VIEWBOX_WIDTH} ${VIDEO_VIEWBOX_HEIGHT}">
  <defs>
    <pattern id="title_grid" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M32 0H0V32" fill="none" stroke="#111827" stroke-width="1" opacity="0.045"/>
    </pattern>
  </defs>
  <rect width="${VIDEO_VIEWBOX_WIDTH}" height="${VIDEO_VIEWBOX_HEIGHT}" fill="#f7f7f4"/>
  <rect width="${VIDEO_VIEWBOX_WIDTH}" height="${VIDEO_VIEWBOX_HEIGHT}" fill="url(#title_grid)"/>
  <text x="640" y="350" text-anchor="middle" font-size="54" font-weight="900" fill="#111111" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(title)}</text>
  <rect x="442" y="390" width="396" height="4" fill="#f18a2a"/>
</svg>`;
}

function renderTypeBadge(title, badgeColor, badgeText) {
  const width = Math.max(128, [...title].length * 24 + 38);
  return `<rect x="34" y="28" width="${width}" height="42" rx="21" fill="${badgeColor}" opacity="0.96"/>
  <text x="${34 + width / 2}" y="56" text-anchor="middle" font-size="20" font-weight="800" fill="${badgeText}" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(title)}</text>`;
}

function renderKeyBadge(key) {
  const label = `按键：${key}`;
  return `<rect x="196" y="28" width="150" height="42" rx="21" fill="#f4f1ff" opacity="0.96"/>
  <text x="271" y="56" text-anchor="middle" font-size="20" font-weight="800" fill="#5b21b6" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(label)}</text>`;
}

function renderArticleTitle(title) {
  const text = trimMiddle(title || "", 42);
  if (!text) return "";
  const width = Math.min(700, Math.max(220, [...text].length * 18 + 42));
  const x = 1280 - width - 34;
  return `<rect x="${x}" y="28" width="${width}" height="42" rx="21" fill="#0f172a" opacity="0.86"/>
  <text x="${x + width / 2}" y="56" text-anchor="middle" font-size="19" font-weight="800" fill="#f8fafc" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(text)}</text>`;
}

function renderSubtitle(segment) {
  const captionLines = wrapText(segment.caption || "", 40, 2);
  const context = subtitleContext(segment);
  const firstY = captionLines.length > 1 ? 628 : 650;
  return `<rect x="0" y="586" width="1280" height="134" fill="#111827" opacity="0.88"/>
  ${captionLines.map((line, index) => `<text x="640" y="${firstY + index * 32}" text-anchor="middle" font-size="24" font-weight="800" fill="#ffffff" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(line)}</text>`).join("\n  ")}
  ${context ? `<text x="640" y="704" text-anchor="middle" font-size="16" fill="#cbd5e1" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(context)}</text>` : ""}`;
}

function subtitleContext(segment) {
  if (segment.fromTabAlias || segment.toTabAlias) return [segment.fromTabAlias, segment.toTabAlias].filter(Boolean).join(" -> ");
  if (segment.type === "navigation") return trimMiddle(segment.toUrl || segment.pageUrl || "", 60);
  if (segment.type === "chapter_intro") return segment.currentTabAlias || "";
  return "";
}

function renderSegmentVisual(segment, isTab, isNavigation, isChapter) {
  if (segment.visual) return renderScreenshotVisual(segment);
  if (isChapter) return renderChapterVisual(segment);
  if (isTab) return renderTabTransitionVisual(segment);
  if (isNavigation) return renderNavigationVisual(segment);
  return renderBlankStepVisual(segment);
}

function renderChapterVisual(segment) {
  const heading = segment.pageTitle || "流程章节";
  const context = segment.currentTabAlias || trimMiddle(segment.pageUrl || "", 58);
  return `
  <rect x="170" y="176" width="940" height="300" rx="22" fill="#f8fafc"/>
  <rect x="206" y="212" width="868" height="56" rx="14" fill="#e2e8f0"/>
  <rect x="206" y="296" width="610" height="34" rx="10" fill="#cbd5e1"/>
  <rect x="206" y="352" width="742" height="34" rx="10" fill="#dbeafe"/>
  <rect x="206" y="408" width="480" height="34" rx="10" fill="#bfdbfe"/>
  <text x="640" y="254" text-anchor="middle" font-size="34" font-weight="900" fill="#1e293b" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(heading)}</text>
  <text x="640" y="532" text-anchor="middle" font-size="24" font-weight="700" fill="#cbd5e1" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(context)}</text>`;
}

function renderTabTransitionVisual(segment) {
  return `
  <rect x="78" y="196" width="500" height="176" rx="18" fill="#f8fafc"/>
  <rect x="110" y="226" width="438" height="36" rx="18" fill="#dbeafe"/>
  <rect x="110" y="292" width="360" height="30" rx="8" fill="#cbd5e1"/>
  <text x="328" y="424" text-anchor="middle" font-size="26" font-weight="900" fill="#e2e8f0" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(segment.fromTabAlias || "当前标签页")}</text>
  <path d="M620 304 H740" stroke="#f97316" stroke-width="10" stroke-linecap="round"/>
  <path d="M740 304 l-30 -24 M740 304 l-30 24" stroke="#f97316" stroke-width="10" stroke-linecap="round"/>
  <rect x="792" y="176" width="410" height="216" rx="18" fill="#fff7ed" stroke="#fed7aa" stroke-width="4"/>
  <rect x="824" y="208" width="346" height="42" rx="21" fill="#fdba74"/>
  <rect x="824" y="284" width="286" height="30" rx="8" fill="#fed7aa"/>
  <text x="997" y="444" text-anchor="middle" font-size="28" font-weight="900" fill="#fed7aa" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(segment.toTabAlias || "目标标签页")}</text>`;
}

function renderNavigationVisual(segment) {
  const fromLabel = trimMiddle(segment.fromUrl || "当前页面", 42);
  const toLabel = trimMiddle(segment.toUrl || segment.pageUrl || "目标页面", 42);
  return `
  <rect x="70" y="172" width="500" height="234" rx="18" fill="#f8fafc"/>
  <rect x="106" y="214" width="428" height="42" rx="12" fill="#dbeafe"/>
  <rect x="106" y="286" width="336" height="30" rx="8" fill="#cbd5e1"/>
  <text x="320" y="458" text-anchor="middle" font-size="22" font-weight="800" fill="#cbd5e1" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(fromLabel)}</text>
  <path d="M620 296 H740" stroke="#22c55e" stroke-width="10" stroke-linecap="round"/>
  <path d="M740 296 l-30 -24 M740 296 l-30 24" stroke="#22c55e" stroke-width="10" stroke-linecap="round"/>
  <rect x="792" y="148" width="418" height="282" rx="18" fill="#f0fdf4" stroke="#86efac" stroke-width="4"/>
  <rect x="828" y="190" width="346" height="48" rx="14" fill="#bbf7d0"/>
  <rect x="828" y="274" width="310" height="30" rx="8" fill="#dcfce7"/>
  <text x="1001" y="464" text-anchor="middle" font-size="24" font-weight="900" fill="#bbf7d0" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(toLabel)}</text>`;
}

function renderScreenshotVisual(segment) {
  const imageSize = dataUrlImageSize(segment.visual);
  const frame = fitRect(
    segment.screenshot?.viewportWidth || segment.screenshot?.width || 1280,
    segment.screenshot?.viewportHeight || segment.screenshot?.height || 720,
    { x: 32, y: 24, width: 1216, height: 548 },
    imageSize ? { maxOutputWidth: imageSize.width, maxOutputHeight: imageSize.height } : {}
  );
  const highlight = renderVideoHighlight(segment.highlight, frame);
  const masks = (segment.privacyMaskBoxes || [])
    .map((box) => renderOverlayBox(box, frame, "#111827", "#111827", 0))
    .join("\n  ");
  const zoom = renderFocusZoom(segment, frame);
  const maskLabel = segment.privacyMaskBoxes?.length
    ? `<rect x="${frame.x + frame.width - 118}" y="${frame.y + 12}" width="104" height="34" rx="17" fill="#111827" opacity="0.9"/>
  <text x="${frame.x + frame.width - 66}" y="${frame.y + 35}" text-anchor="middle" font-size="17" font-weight="800" fill="#ffffff" font-family="Microsoft YaHei, Segoe UI, sans-serif">已打码</text>`
    : "";

  return `
  <rect x="${frame.x - 4}" y="${frame.y - 4}" width="${frame.width + 8}" height="${frame.height + 8}" rx="18" fill="#e2e8f0"/>
  <image href="${escapeXml(segment.visual)}" x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" preserveAspectRatio="none"/>
  ${masks}
  ${highlight}
  ${zoom}
  ${maskLabel}`;
}

function renderBlankStepVisual(segment) {
  const label = segment.pageTitle || segment.currentTabAlias || "此步骤没有可用截图";
  return `
  <rect x="32" y="24" width="1216" height="548" rx="18" fill="#f8fafc"/>
  <rect x="64" y="58" width="1152" height="72" rx="14" fill="#ffffff" stroke="#dce3ea"/>
  <text x="640" y="104" text-anchor="middle" font-size="24" font-weight="800" fill="#475569" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(label)}</text>
  <text x="640" y="310" text-anchor="middle" font-size="32" font-weight="900" fill="#18212b" font-family="Microsoft YaHei, Segoe UI, sans-serif">暂无截图</text>
  <text x="640" y="354" text-anchor="middle" font-size="22" fill="#66717d" font-family="Microsoft YaHei, Segoe UI, sans-serif">请根据底部字幕完成该步骤</text>`;
}

function renderFocusZoom(segment, frame) {
  const box = segment.highlight;
  if (!segment.visual || !box || !Number.isFinite(box.x)) return "";
  const zoomRect = focusZoomRect(box, frame);
  if (!shouldRenderFocusZoom(segment, box, zoomRect, frame)) return "";
  const zoomScale = frame.width / frame.sourceWidth * 2.8;
  const focusAnchor = focusZoomAnchor(box, zoomRect, zoomScale);
  const imageWidth = frame.sourceWidth * zoomScale;
  const imageHeight = frame.sourceHeight * zoomScale;
  const imageX = zoomRect.x + zoomRect.width / 2 - focusAnchor.x * zoomScale;
  const imageY = zoomRect.y + zoomRect.height / 2 - focusAnchor.y * zoomScale;
  const clipId = `clip_${String(segment.id || "focus").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const masks = (segment.privacyMaskBoxes || []).map((mask) => {
    const x = imageX + mask.x * zoomScale;
    const y = imageY + mask.y * zoomScale;
    return `<rect x="${round(x)}" y="${round(y)}" width="${round(Math.max(1, mask.width * zoomScale))}" height="${round(Math.max(1, mask.height * zoomScale))}" rx="8" fill="#111827" clip-path="url(#${clipId})"/>`;
  }).join("\n  ");
  return `
  <defs>
    <clipPath id="${clipId}">
      <rect x="${zoomRect.x}" y="${zoomRect.y}" width="${zoomRect.width}" height="${zoomRect.height}" rx="14"/>
    </clipPath>
  </defs>
  <rect x="${zoomRect.x - 3}" y="${zoomRect.y - 3}" width="${zoomRect.width + 6}" height="${zoomRect.height + 6}" rx="16" fill="#ffffff" stroke="#f18a2a" stroke-width="6"/>
  <image href="${escapeXml(segment.visual)}" x="${round(imageX)}" y="${round(imageY)}" width="${round(imageWidth)}" height="${round(imageHeight)}" preserveAspectRatio="none" clip-path="url(#${clipId})"/>
  ${masks}
  <rect x="${zoomRect.x}" y="${zoomRect.y}" width="${zoomRect.width}" height="${zoomRect.height}" rx="14" fill="none" stroke="#f18a2a" stroke-width="3"/>
  <rect x="${zoomRect.x + 12}" y="${zoomRect.y + 12}" width="106" height="28" rx="14" fill="#18212b" opacity="0.86"/>
  <text x="${zoomRect.x + 65}" y="${zoomRect.y + 32}" text-anchor="middle" font-size="15" font-weight="800" fill="#ffffff" font-family="Microsoft YaHei, Segoe UI, sans-serif">Focus zoom</text>`;
}

function focusZoomRect(box, frame) {
  const width = Math.min(560, Math.max(440, frame.width * 0.43));
  const height = Math.round(width * 0.62);
  const margin = 24;
  const boxFrameX = frame.x + box.x / frame.sourceWidth * frame.width;
  const boxFrameY = frame.y + box.y / frame.sourceHeight * frame.height;
  const boxFrameW = box.width / frame.sourceWidth * frame.width;
  const boxFrameH = box.height / frame.sourceHeight * frame.height;
  const frameRight = frame.x + frame.width;
  const frameBottom = frame.y + frame.height;
  const rightSpace = frameRight - (boxFrameX + boxFrameW);
  const leftCandidate = boxFrameX - width - margin;
  const rightCandidate = boxFrameX + boxFrameW + margin;
  const x = rightSpace >= width + margin ? rightCandidate : Math.max(frame.x + margin, leftCandidate);
  const y = Math.max(frame.y + margin, Math.min(frameBottom - height - margin, boxFrameY + boxFrameH / 2 - height / 2));
  return { x: round(x), y: round(y), width, height };
}

function shouldRenderFocusZoom(segment, box, zoomRect, frame) {
  const highlight = boxToFrameRect(box, frame);
  if (!highlight) return false;
  if (isCloseControlSegment(segment)) return false;
  if (highlight.width <= 92 && highlight.height <= 92) return false;
  const overlapWidth = Math.max(0, Math.min(highlight.x + highlight.width, zoomRect.x + zoomRect.width) - Math.max(highlight.x, zoomRect.x));
  const overlapHeight = Math.max(0, Math.min(highlight.y + highlight.height, zoomRect.y + zoomRect.height) - Math.max(highlight.y, zoomRect.y));
  if (overlapWidth > 0 && overlapHeight > 0) return false;
  const highlightArea = highlight.width * highlight.height;
  const frameArea = frame.width * frame.height;
  return highlightArea / frameArea < 0.12;
}

function isCloseControlSegment(segment = {}) {
  const text = String([segment.action, segment.caption, segment.voiceoverText].filter(Boolean).join(" ")).toLowerCase();
  return segment.action === "modal_close" || /(\u5173\u95ed\u5f39\u7a97|\u5173\u95ed|close|discard|cancel)/.test(text);
}

function boxToFrameRect(box, frame) {
  if (!box || !Number.isFinite(box.x)) return null;
  return {
    x: frame.x + box.x / frame.sourceWidth * frame.width,
    y: frame.y + box.y / frame.sourceHeight * frame.height,
    width: Math.max(1, box.width / frame.sourceWidth * frame.width),
    height: Math.max(1, box.height / frame.sourceHeight * frame.height)
  };
}

function focusZoomAnchor(box, zoomRect, zoomScale) {
  const visibleSourceWidth = zoomRect.width / zoomScale;
  const leftBias = Math.min(box.width * 0.2, Math.max(24, visibleSourceWidth * 0.28));
  return {
    x: box.x + Math.min(box.width / 2, leftBias),
    y: box.y + box.height / 2
  };
}

function cleanGeneratedFrames(frameDir) {
  for (const entry of fs.readdirSync(frameDir, { withFileTypes: true })) {
    if (entry.isFile() && /^(?:segment_.+|chapter_intro_.+|title_intro)\.svg$/.test(entry.name)) {
      fs.unlinkSync(path.join(frameDir, entry.name));
    }
  }
}

function cleanGeneratedPngFrames(frameDir) {
  for (const entry of fs.readdirSync(frameDir, { withFileTypes: true })) {
    if (entry.isFile() && /^(?:segment_.+|chapter_intro_.+|title_intro)\.png$/.test(entry.name)) {
      fs.unlinkSync(path.join(frameDir, entry.name));
    }
  }
}

function renderPngFramesWithChrome(chrome, segments, svgDir, pngDir) {
  for (const segment of segments) {
    const svgPath = path.join(svgDir, `${segment.id}.svg`);
    const pngPath = path.join(pngDir, `${segment.id}.png`);
    const result = spawnSync(chrome, [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      `--window-size=${VIDEO_WIDTH},${VIDEO_HEIGHT}`,
      `--screenshot=${pngPath}`,
      pathToFileUrl(svgPath)
    ], { encoding: "utf8" });
    if (result.status !== 0 || !fs.existsSync(pngPath)) {
      console.error(result.stderr || result.stdout || `Failed to render PNG frame: ${segment.id}`);
      process.exit(result.status || 1);
    }
  }
}

function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_SHIM,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe")
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function findFfmpegExecutable() {
  const system = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (system.status === 0) return "ffmpeg";

  const python = spawnSync("python", [
    "-c",
    "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"
  ], { encoding: "utf8" });
  const candidate = python.status === 0 ? python.stdout.trim().split(/\r?\n/).at(-1) : "";
  return candidate && fs.existsSync(candidate) ? candidate : null;
}

function pathToFileUrl(filePath) {
  return `file:///${path.resolve(filePath).replaceAll("\\", "/")}`;
}

function fitRect(sourceWidth, sourceHeight, target, options = {}) {
  const outputScale = VIDEO_WIDTH / VIDEO_VIEWBOX_WIDTH;
  const maxLogicalWidth = options.maxOutputWidth ? options.maxOutputWidth / outputScale : Infinity;
  const maxLogicalHeight = options.maxOutputHeight ? options.maxOutputHeight / outputScale : Infinity;
  const scale = Math.min(
    target.width / sourceWidth,
    target.height / sourceHeight,
    maxLogicalWidth / sourceWidth,
    maxLogicalHeight / sourceHeight
  );
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);
  return {
    x: Math.round(target.x + (target.width - width) / 2),
    y: Math.round(target.y + (target.height - height) / 2),
    width,
    height,
    sourceWidth,
    sourceHeight
  };
}

function dataUrlImageSize(dataUrl = "") {
  const match = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!match) return null;
  try {
    const buffer = Buffer.from(match[2], "base64");
    if (match[1].toLowerCase() === "png") return pngSize(buffer);
    return jpegSize(buffer);
  } catch {
    return null;
  }
}

function pngSize(buffer) {
  if (buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegSize(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function renderOverlayBox(box, frame, stroke, fill, strokeWidth) {
  if (!box || !Number.isFinite(box.x)) return "";
  const x = frame.x + box.x / frame.sourceWidth * frame.width;
  const y = frame.y + box.y / frame.sourceHeight * frame.height;
  const width = box.width / frame.sourceWidth * frame.width;
  const height = box.height / frame.sourceHeight * frame.height;
  return `<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
}

function renderVideoHighlight(box, frame) {
  const rect = paddedBoxToFrameRect(box, frame);
  if (!rect) return "";
  const framePath = `M${round(frame.x)} ${round(frame.y)}H${round(frame.x + frame.width)}V${round(frame.y + frame.height)}H${round(frame.x)}Z`;
  const holePath = `M${round(rect.x)} ${round(rect.y)}H${round(rect.x + rect.width)}V${round(rect.y + rect.height)}H${round(rect.x)}Z`;
  return `
  <path d="${framePath} ${holePath}" fill="#000000" opacity="0.30" fill-rule="evenodd"/>
  <rect x="${round(rect.x)}" y="${round(rect.y)}" width="${round(rect.width)}" height="${round(rect.height)}" rx="10" fill="none" stroke="#ffffff" stroke-width="8"/>
  <rect x="${round(rect.x)}" y="${round(rect.y)}" width="${round(rect.width)}" height="${round(rect.height)}" rx="10" fill="none" stroke="#f18a2a" stroke-width="5"/>`;
}

function paddedBoxToFrameRect(box, frame) {
  const rect = boxToFrameRect(box, frame);
  if (!rect) return null;
  const pad = 10;
  const minWidth = 44;
  const minHeight = 32;
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  let width = Math.max(minWidth, rect.width + pad * 2);
  let height = Math.max(minHeight, rect.height + pad * 2);
  width = Math.min(width, frame.width);
  height = Math.min(height, frame.height);
  const x = Math.max(frame.x, Math.min(frame.x + frame.width - width, centerX - width / 2));
  const y = Math.max(frame.y, Math.min(frame.y + frame.height - height, centerY - height / 2));
  return { x, y, width, height };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function wrapText(text, maxChars, maxLines) {
  const tokens = String(text ?? "").match(/[A-Za-z0-9_:/.-]+|\s+|./gu) || [];
  const lines = [];
  let current = "";
  for (const token of tokens) {
    const next = current + token;
    if (current.trim() && textLength(next) > maxChars) {
      lines.push(current);
      current = token.trimStart();
      if (lines.length === maxLines) break;
    } else {
      current = next;
    }
  }
  if (current.trim() && lines.length < maxLines) lines.push(current);
  return lines.map((line) => line.trim());
}

function textLength(text) {
  return [...String(text ?? "")].reduce((length, char) => length + (/[\x00-\x7F]/.test(char) ? 0.62 : 1), 0);
}

function trimMiddle(text, maxChars) {
  const chars = [...String(text ?? "")];
  if (chars.length <= maxChars) return chars.join("");
  const keep = Math.max(4, Math.floor((maxChars - 3) / 2));
  return `${chars.slice(0, keep).join("")}...${chars.slice(-keep).join("")}`;
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function toFfmpegPath(filePath) {
  return filePath.replaceAll("\\", "/").replaceAll("'", "'\\''");
}
