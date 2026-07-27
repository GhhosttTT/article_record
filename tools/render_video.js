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
  const ffmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (ffmpeg.status !== 0) {
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
    const result = spawnSync("ffmpeg", [
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
  const borderColor = isChapter ? "#b8c2f0" : isTab ? "#dca977" : isNavigation ? "#a9d1b4" : "#9ec4df";
  const captionLines = wrapText(segment.caption || "", 23, 3);
  const currentTab = segment.currentTabAlias || "";
  const tabLine = [segment.fromTabAlias, segment.toTabAlias].filter(Boolean).join("  ->  ");
  const timeText = `${segment.startTime}s - ${segment.endTime}s`;
  const keyBadge = segment.key ? renderKeyBadge(segment.key) : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#f3f6f8"/>
  <rect x="72" y="64" width="1136" height="592" rx="18" fill="#ffffff" stroke="#dce3ea"/>
  <rect x="104" y="96" width="190" height="42" rx="21" fill="${badgeColor}" stroke="${borderColor}"/>
  <text x="199" y="123" text-anchor="middle" font-size="20" font-weight="700" fill="${badgeText}" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(title)}</text>
  ${keyBadge}
  <text x="1094" y="123" text-anchor="end" font-size="20" font-weight="700" fill="#66717d" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(timeText)}</text>
  <text x="104" y="205" font-size="42" font-weight="800" fill="#18212b" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(captionLines[0] || "")}</text>
  ${captionLines.slice(1).map((line, index) => `<text x="104" y="${260 + index * 52}" font-size="38" font-weight="700" fill="#18212b" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(line)}</text>`).join("\n  ")}
  ${renderSegmentVisual(segment, isTab, isNavigation, isChapter)}
  <text x="104" y="594" font-size="24" fill="#66717d" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(currentTab)}</text>
  ${tabLine ? `<text x="104" y="630" font-size="22" fill="#a65016" font-weight="700" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(tabLine)}</text>` : ""}
</svg>`;
}

function renderKeyBadge(key) {
  const label = `按键：${key}`;
  return `<rect x="320" y="96" width="170" height="42" rx="21" fill="#f4f1ff" stroke="#c4b5fd"/>
  <text x="405" y="123" text-anchor="middle" font-size="20" font-weight="800" fill="#5b21b6" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(label)}</text>`;
}

function renderSegmentVisual(segment, isTab, isNavigation, isChapter) {
  if (isChapter) {
    return `
  <rect x="104" y="342" width="720" height="142" rx="16" fill="#eef2ff" stroke="#b8c2f0"/>
  <text x="464" y="392" text-anchor="middle" font-size="28" font-weight="800" fill="#354a9f" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(segment.pageTitle || "流程章节")}</text>
  <text x="464" y="436" text-anchor="middle" font-size="22" fill="#66717d" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(segment.currentTabAlias || segment.pageUrl || "")}</text>`;
  }

  if (isTab) {
    return `
  <rect x="104" y="350" width="470" height="96" rx="14" fill="#edf4fa" stroke="#b7cad9"/>
  <text x="339" y="408" text-anchor="middle" font-size="26" font-weight="800" fill="#145985" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(segment.fromTabAlias || "当前标签页")}</text>
  <path d="M610 398 H720" stroke="#cc6b2c" stroke-width="8" stroke-linecap="round"/>
  <path d="M720 398 l-26 -20 M720 398 l-26 20" stroke="#cc6b2c" stroke-width="8" stroke-linecap="round"/>
  <rect x="756" y="350" width="420" height="96" rx="14" fill="#fff1e4" stroke="#dca977"/>
  <text x="966" y="408" text-anchor="middle" font-size="26" font-weight="800" fill="#a65016" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(segment.toTabAlias || "目标标签页")}</text>`;
  }

  if (isNavigation) {
    const fromLabel = trimMiddle(segment.fromUrl || "当前页面", 36);
    const toLabel = trimMiddle(segment.toUrl || segment.pageUrl || "目标页面", 36);
    return `
  <rect x="104" y="342" width="470" height="104" rx="14" fill="#edf4fa" stroke="#b7cad9"/>
  <text x="339" y="384" text-anchor="middle" font-size="24" font-weight="800" fill="#145985" font-family="Microsoft YaHei, Segoe UI, sans-serif">原页面</text>
  <text x="339" y="420" text-anchor="middle" font-size="19" fill="#66717d" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(fromLabel)}</text>
  <path d="M610 394 H720" stroke="#2f855a" stroke-width="8" stroke-linecap="round"/>
  <path d="M720 394 l-26 -20 M720 394 l-26 20" stroke="#2f855a" stroke-width="8" stroke-linecap="round"/>
  <rect x="756" y="342" width="420" height="104" rx="14" fill="#edf7ee" stroke="#a9d1b4"/>
  <text x="966" y="384" text-anchor="middle" font-size="24" font-weight="800" fill="#226438" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(segment.pageTitle || "目标页面")}</text>
  <text x="966" y="420" text-anchor="middle" font-size="19" fill="#4d6b57" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(toLabel)}</text>`;
  }

  if (segment.visual) return renderScreenshotVisual(segment);

  const highlight = segment.highlight;
  const showHighlight = highlight && Number.isFinite(highlight.x);
  return `
  <rect x="104" y="338" width="720" height="178" rx="14" fill="#edf4fa" stroke="#b7cad9"/>
  <rect x="138" y="376" width="652" height="36" rx="8" fill="#ffffff" stroke="#cbd8e2"/>
  <rect x="138" y="434" width="390" height="36" rx="8" fill="#ffffff" stroke="#cbd8e2"/>
  <rect x="138" y="486" width="230" height="36" rx="8" fill="#1769aa"/>
  <text x="253" y="510" text-anchor="middle" font-size="20" font-weight="800" fill="#ffffff" font-family="Microsoft YaHei, Segoe UI, sans-serif">目标操作区域</text>
  ${showHighlight ? `<rect x="124" y="470" width="268" height="70" rx="12" fill="none" stroke="#f18a2a" stroke-width="8"/>` : ""}`;
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

function pathToFileUrl(filePath) {
  return `file:///${path.resolve(filePath).replaceAll("\\", "/")}`;
}

function renderScreenshotVisual(segment) {
  const frame = fitRect(
    segment.screenshot?.viewportWidth || segment.screenshot?.width || 1280,
    segment.screenshot?.viewportHeight || segment.screenshot?.height || 720,
    { x: 104, y: 318, width: 720, height: 230 }
  );
  const highlight = renderOverlayBox(segment.highlight, frame, "#f18a2a", "none", 6);
  const zoom = renderFocusZoom(segment, frame);
  const masks = (segment.privacyMaskBoxes || [])
    .map((box) => renderOverlayBox(box, frame, "#111827", "#111827", 0))
    .join("\n  ");
  const maskLabel = segment.privacyMaskBoxes?.length
    ? `<text x="${frame.x + frame.width - 14}" y="${frame.y + 28}" text-anchor="end" font-size="18" font-weight="800" fill="#ffffff" font-family="Microsoft YaHei, Segoe UI, sans-serif">已打码</text>`
    : "";

  return `
  <rect x="${frame.x - 2}" y="${frame.y - 2}" width="${frame.width + 4}" height="${frame.height + 4}" rx="14" fill="#edf4fa" stroke="#b7cad9"/>
  <image href="${escapeXml(segment.visual)}" x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" preserveAspectRatio="none"/>
  ${highlight}
  ${masks}
  ${zoom}
  ${maskLabel}`;
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

function renderFocusZoom(segment, frame) {
  const box = segment.highlight;
  if (!segment.visual || !box || !Number.isFinite(box.x)) return "";
  const zoomRect = { x: 858, y: 318, width: 300, height: 190 };
  const zoomScale = frame.width / frame.sourceWidth * 2.35;
  const boxCenterX = box.x + box.width / 2;
  const boxCenterY = box.y + box.height / 2;
  const imageWidth = frame.sourceWidth * zoomScale;
  const imageHeight = frame.sourceHeight * zoomScale;
  const imageX = zoomRect.x + zoomRect.width / 2 - boxCenterX * zoomScale;
  const imageY = zoomRect.y + zoomRect.height / 2 - boxCenterY * zoomScale;
  const clipId = `clip_${String(segment.id || "focus").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  return `
  <defs>
    <clipPath id="${clipId}">
      <rect x="${zoomRect.x}" y="${zoomRect.y}" width="${zoomRect.width}" height="${zoomRect.height}" rx="14"/>
    </clipPath>
  </defs>
  <rect x="${zoomRect.x - 3}" y="${zoomRect.y - 3}" width="${zoomRect.width + 6}" height="${zoomRect.height + 6}" rx="16" fill="#ffffff" stroke="#f18a2a" stroke-width="6"/>
  <image href="${escapeXml(segment.visual)}" x="${round(imageX)}" y="${round(imageY)}" width="${round(imageWidth)}" height="${round(imageHeight)}" preserveAspectRatio="none" clip-path="url(#${clipId})"/>
  <rect x="${zoomRect.x}" y="${zoomRect.y}" width="${zoomRect.width}" height="${zoomRect.height}" rx="14" fill="none" stroke="#f18a2a" stroke-width="3"/>
  <rect x="${zoomRect.x + 12}" y="${zoomRect.y + 12}" width="106" height="28" rx="14" fill="#18212b" opacity="0.86"/>
  <text x="${zoomRect.x + 65}" y="${zoomRect.y + 32}" text-anchor="middle" font-size="15" font-weight="800" fill="#ffffff" font-family="Microsoft YaHei, Segoe UI, sans-serif">Focus zoom</text>`;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function wrapText(text, maxChars, maxLines) {
  const chars = [...text];
  const lines = [];
  let current = "";
  for (const char of chars) {
    if ([...current].length >= maxChars) {
      lines.push(current);
      current = "";
      if (lines.length === maxLines) break;
    }
    current += char;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
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
