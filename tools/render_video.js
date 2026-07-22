const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const framesOnly = process.argv.includes("--frames-only");
const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const timelinePath = positionalArgs[0] || path.join(__dirname, "..", "dist", "video-timeline.json");
const outputDir = positionalArgs[1] || path.join(__dirname, "..", "dist", "video");

const timeline = JSON.parse(fs.readFileSync(timelinePath, "utf8"));
const frameDir = path.join(outputDir, "frames");
fs.mkdirSync(frameDir, { recursive: true });

const concatLines = [];
for (const segment of timeline.segments || []) {
  const framePath = path.join(frameDir, `${segment.id}.svg`);
  fs.writeFileSync(framePath, renderFrame(segment), "utf8");
  concatLines.push(`file '${toFfmpegPath(framePath)}'`);
  concatLines.push(`duration ${segment.endTime - segment.startTime}`);
}

if (timeline.segments?.length) {
  const lastFrame = path.join(frameDir, `${timeline.segments.at(-1).id}.svg`);
  concatLines.push(`file '${toFfmpegPath(lastFrame)}'`);
}

const concatPath = path.join(outputDir, "concat.txt");
fs.writeFileSync(concatPath, concatLines.join("\n"), "utf8");
console.log(`Generated frames: ${frameDir}`);
console.log(`Generated concat list: ${concatPath}`);

if (!framesOnly) {
  const ffmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (ffmpeg.status !== 0) {
    console.warn("FFmpeg not found. Install ffmpeg or rerun with --frames-only to generate frames only.");
    process.exitCode = 2;
  } else {
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
}

function renderFrame(segment) {
  const isTab = segment.type === "tab_transition";
  const title = isTab ? "标签页切换" : "操作步骤";
  const badgeColor = isTab ? "#fff1e4" : "#e8f2fa";
  const badgeText = isTab ? "#a65016" : "#145985";
  const borderColor = isTab ? "#dca977" : "#9ec4df";
  const captionLines = wrapText(segment.caption || "", 23, 3);
  const currentTab = segment.currentTabAlias || "";
  const tabLine = [segment.fromTabAlias, segment.toTabAlias].filter(Boolean).join("  ->  ");
  const timeText = `${segment.startTime}s - ${segment.endTime}s`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#f3f6f8"/>
  <rect x="72" y="64" width="1136" height="592" rx="18" fill="#ffffff" stroke="#dce3ea"/>
  <rect x="104" y="96" width="190" height="42" rx="21" fill="${badgeColor}" stroke="${borderColor}"/>
  <text x="199" y="123" text-anchor="middle" font-size="20" font-weight="700" fill="${badgeText}" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(title)}</text>
  <text x="1094" y="123" text-anchor="end" font-size="20" font-weight="700" fill="#66717d" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(timeText)}</text>
  <text x="104" y="205" font-size="42" font-weight="800" fill="#18212b" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(captionLines[0] || "")}</text>
  ${captionLines.slice(1).map((line, index) => `<text x="104" y="${260 + index * 52}" font-size="38" font-weight="700" fill="#18212b" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(line)}</text>`).join("\n  ")}
  ${renderSegmentVisual(segment, isTab)}
  <text x="104" y="594" font-size="24" fill="#66717d" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(currentTab)}</text>
  ${tabLine ? `<text x="104" y="630" font-size="22" fill="#a65016" font-weight="700" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(tabLine)}</text>` : ""}
</svg>`;
}

function renderSegmentVisual(segment, isTab) {
  if (isTab) {
    return `
  <rect x="104" y="350" width="470" height="96" rx="14" fill="#edf4fa" stroke="#b7cad9"/>
  <text x="339" y="408" text-anchor="middle" font-size="26" font-weight="800" fill="#145985" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(segment.fromTabAlias || "当前标签页")}</text>
  <path d="M610 398 H720" stroke="#cc6b2c" stroke-width="8" stroke-linecap="round"/>
  <path d="M720 398 l-26 -20 M720 398 l-26 20" stroke="#cc6b2c" stroke-width="8" stroke-linecap="round"/>
  <rect x="756" y="350" width="420" height="96" rx="14" fill="#fff1e4" stroke="#dca977"/>
  <text x="966" y="408" text-anchor="middle" font-size="26" font-weight="800" fill="#a65016" font-family="Microsoft YaHei, Segoe UI, sans-serif">${escapeXml(segment.toTabAlias || "目标标签页")}</text>`;
  }

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
