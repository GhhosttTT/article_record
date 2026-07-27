const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const framesOnly = process.argv.includes("--frames-only");
const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const timelinePath = positionalArgs[0] || path.join(__dirname, "..", "dist", "video-timeline.json");
const outputDir = positionalArgs[1] || path.join(__dirname, "..", "dist", "video");

const timeline = JSON.parse(fs.readFileSync(timelinePath, "utf8"));
const frameDir = path.join(outputDir, "frames");
const pngFrameDir = path.join(outputDir, "png-frames");
validateTimelineVisuals(timeline);
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

function renderFrame(segment) {
  const isTab = segment.type === "tab_transition";
  const isNavigation = segment.type === "navigation";
  const isChapter = segment.type === "chapter_intro";
  const title = isChapter ? "章节" : isTab ? "标签页切换" : isNavigation ? "页面跳转" : "操作步骤";
  const badgeColor = isChapter ? "#eef2ff" : isTab ? "#fff1e4" : isNavigation ? "#edf7ee" : "#e8f2fa";
  const badgeText = isChapter ? "#354a9f" : isTab ? "#a65016" : isNavigation ? "#226438" : "#145985";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#111827"/>
  ${renderSegmentVisual(segment, isTab, isNavigation, isChapter)}
  ${renderTypeBadge(title, badgeColor, badgeText)}
  ${segment.key ? renderKeyBadge(segment.key) : ""}
  ${renderSubtitle(segment)}
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

function renderSubtitle(segment) {
  const captionLines = wrapText(segment.caption || "", 30, 2);
  const context = subtitleContext(segment);
  const firstY = captionLines.length > 1 ? 626 : 648;
  return `<rect x="0" y="586" width="1280" height="134" fill="#111827" opacity="0.88"/>
  ${captionLines.map((line, index) => `<text x="640" y="${firstY + index * 38}" text-anchor="middle" font-size="32" font-weight="800" fill="#ffffff" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(line)}</text>`).join("\n  ")}
  ${context ? `<text x="640" y="704" text-anchor="middle" font-size="20" fill="#cbd5e1" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(context)}</text>` : ""}`;
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
  throw new Error(`Operation segment ${segment.id || "(unknown)"} is missing visual screenshot data.`);
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
  const frame = fitRect(
    segment.screenshot?.viewportWidth || segment.screenshot?.width || 1280,
    segment.screenshot?.viewportHeight || segment.screenshot?.height || 720,
    { x: 32, y: 24, width: 1216, height: 548 }
  );
  const highlight = renderOverlayBox(segment.highlight, frame, "#f18a2a", "none", 6);
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
  ${highlight}
  ${masks}
  ${zoom}
  ${maskLabel}`;
}

function validateTimelineVisuals(timeline) {
  const missing = (timeline.segments || []).filter((segment) => {
    const needsScreenshot = !["tab_transition", "navigation", "chapter_intro"].includes(segment.type);
    return needsScreenshot && !segment.visual;
  });
  if (!missing.length) return;
  const ids = missing.map((segment) => segment.id || segment.stepId || "(unknown)").join(", ");
  console.error(`Cannot render teaching video: operation segments are missing screenshot visuals: ${ids}`);
  console.error("Export the video timeline from the preview page before exporting a privacy-stripped recording JSON. The video timeline must carry the same screenshots used by the article.");
  process.exit(3);
}

function renderFocusZoom(segment, frame) {
  const box = segment.highlight;
  if (!segment.visual || !box || !Number.isFinite(box.x)) return "";
  const zoomRect = focusZoomRect(box, frame);
  const zoomScale = frame.width / frame.sourceWidth * 2.35;
  const boxCenterX = box.x + box.width / 2;
  const boxCenterY = box.y + box.height / 2;
  const imageWidth = frame.sourceWidth * zoomScale;
  const imageHeight = frame.sourceHeight * zoomScale;
  const imageX = zoomRect.x + zoomRect.width / 2 - boxCenterX * zoomScale;
  const imageY = zoomRect.y + zoomRect.height / 2 - boxCenterY * zoomScale;
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
  const width = 330;
  const height = 210;
  const margin = 20;
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

function cleanGeneratedFrames(frameDir) {
  for (const entry of fs.readdirSync(frameDir, { withFileTypes: true })) {
    if (entry.isFile() && /^(segment_|chapter_intro_).+\.svg$/.test(entry.name)) {
      fs.unlinkSync(path.join(frameDir, entry.name));
    }
  }
}

function cleanGeneratedPngFrames(frameDir) {
  for (const entry of fs.readdirSync(frameDir, { withFileTypes: true })) {
    if (entry.isFile() && /^(segment_|chapter_intro_).+\.png$/.test(entry.name)) {
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
      "--window-size=1280,720",
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

function fitRect(sourceWidth, sourceHeight, target) {
  const scale = Math.min(target.width / sourceWidth, target.height / sourceHeight);
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

function renderOverlayBox(box, frame, stroke, fill, strokeWidth) {
  if (!box || !Number.isFinite(box.x)) return "";
  const x = frame.x + box.x / frame.sourceWidth * frame.width;
  const y = frame.y + box.y / frame.sourceHeight * frame.height;
  const width = box.width / frame.sourceWidth * frame.width;
  const height = box.height / frame.sourceHeight * frame.height;
  return `<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
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
