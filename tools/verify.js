const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const checks = [];

runCheck("manifest.json 可解析且为 MV3", () => {
  const manifest = readJson("extension/manifest.json");
  assert(manifest.manifest_version === 3, "manifest_version 必须为 3");
  assert(manifest.background?.service_worker === "background.js", "缺少 background service_worker");
  assert(manifest.permissions.includes("tabs"), "需要 tabs 权限记录多标签页");
  assert(manifest.permissions.includes("scripting"), "需要 scripting 权限在开始录制时注入 content.js");
  assert(!manifest.content_scripts, "content.js must be injected by background only");
});

[
  "extension/background.js",
  "extension/content.js",
  "extension/db.js",
  "extension/popup.js",
  "extension/shared/artifacts.js",
  "extension/viewer_artifacts.js",
  "extension/viewer.js",
  "tools/generate_artifacts.js",
  "tools/generate_pdf.js",
  "tools/package_extension.js",
  "tools/render_video.js",
  "tools/validate_schema.js",
  "tools/verify.js"
].forEach((file) => {
  runCheck(`${file} 语法检查`, () => {
    const result = spawnSync("node", ["--check", file], { cwd: root, encoding: "utf8" });
    assert(result.status === 0, result.stderr || result.stdout || `${file} 语法检查失败`);
  });
});

runCheck("离线生成器可生成文章、时间轴和视频分镜", () => {
  const result = spawnSync("node", ["tools/generate_artifacts.js"], { cwd: root, encoding: "utf8" });
  assert(result.status === 0, result.stderr || result.stdout || "generate_artifacts 执行失败");
  assertExists("dist/article.html");
  assertExists("dist/article.md");
  assertExists("dist/article.doc");
  assertExists("dist/video-timeline.json");
  assertExists("dist/video-storyboard.html");
});

runCheck("离线 PDF 导出可复用 SOP HTML", () => {
  const packageJson = readJson("package.json");
  const pdfTool = readText("tools/generate_pdf.js");
  assert(packageJson.scripts["generate:pdf"] === "node tools/generate_pdf.js", "package.json 必须提供 generate:pdf 脚本");
  assert(pdfTool.includes("dist\", \"article.html"), "PDF 导出必须默认读取 dist/article.html");
  assert(pdfTool.includes("--print-to-pdf"), "PDF 导出必须通过 Chrome 打印生成 PDF");
  assert(pdfTool.includes("findChromeExecutable"), "PDF 导出必须查找 Chrome 可执行文件");
  assert(pdfTool.includes("pathToFileUrl"), "PDF 导出必须用 file URL 打开 SOP HTML");

  const chrome = findChromeExecutable();
  if (!chrome) return;

  const result = spawnSync("node", ["tools/generate_pdf.js"], { cwd: root, encoding: "utf8" });
  assert(result.status === 0, result.stderr || result.stdout || "generate_pdf 执行失败");
  assertExists("dist/article.pdf");
  const stat = fs.statSync(path.join(root, "dist/article.pdf"));
  assert(stat.size > 1024, "article.pdf 必须是非空 PDF 文件");
});

runCheck("扩展可打包为 zip", () => {
  const result = spawnSync("node", ["tools/package_extension.js"], { cwd: root, encoding: "utf8" });
  assert(result.status === 0, result.stderr || result.stdout || "package_extension 执行失败");
  assertExists("dist/package/sop-recorder-mvp/manifest.json");
  assertExists("dist/package/sop-recorder-mvp.zip");
});

runCheck("示例录制数据满足 schema 契约", () => {
  const result = spawnSync("node", ["tools/validate_schema.js"], { cwd: root, encoding: "utf8" });
  assert(result.status === 0, result.stderr || result.stdout || "validate_schema 执行失败");
});

runCheck("schema 会拒绝不安全 URL 和普通字符键", () => {
  assertSchemaRejectsHref("https://mail.example.com/activate?token=abc", "不得包含 query 或 hash");
  assertSchemaRejectsHref("https://mail.example.com/activate#step", "不得包含 query 或 hash");
  assertSchemaRejectsHref("javascript:alert(1)", "只允许 http/https");
  assertSchemaRejectsRecordingUrl((fixture) => {
    fixture.nodes[0].beforeUrl = "https://biotimecloud.info/onboard/sign-in?session=abc";
  }, "不得包含 query 或 hash");
  assertSchemaRejectsRecordingUrl((fixture) => {
    fixture.nodes[0].navigationTargetUrl = "https://biotimecloud.info/onboard/register#done";
  }, "不得包含 query 或 hash");
  assertSchemaRejectsRecordingUrl((fixture) => {
    fixture.tabContexts["101"].currentUrl = "javascript:alert(1)";
  }, "只允许 http/https");
  assertSchemaRejectsRecordingUrl((fixture) => {
    fixture.nodes[0].action = "key";
    fixture.nodes[0].key = "a";
  }, "只允许 Enter 或 Escape");
  assertSchemaRejectsRecordingUrl((fixture) => {
    delete fixture.session.startedAt;
  }, "session.startedAt");
  assertSchemaRejectsRecordingUrl((fixture) => {
    fixture.session.status = "done";
  }, "session.status");
  assertSchemaRejectsRecordingUrl((fixture) => {
    fixture.pendingTabOpens = {};
  }, "root.pendingTabOpens");
  assertSchemaRejectsRecordingUrl((fixture) => {
    fixture.status = "idle";
  }, "root.status");
});

runCheck("schema 校验覆盖编辑和隐私扩展字段", () => {
  const validator = readText("tools/validate_schema.js");
  const background = readText("extension/background.js");
  const sample = readJson("examples/sample-recording.json");
  assert(validator.includes("function validateSession"), "validate_schema 必须校验录制会话字段");
  assert(validator.includes("function validateRecordingRoot"), "validate_schema 必须校验录制 JSON 根结构");
  assert(validator.includes("new Set([\"session\", \"tabContexts\", \"nodes\"])"), "validate_schema 根结构只能允许 session/tabContexts/nodes");
  assert(background.includes("function buildRecordingExportPayload"), "background 必须集中构建录制 JSON 导出 payload");
  assert(background.includes("buildRecordingExportPayload(fullState)"), "exportJson 必须通过录制导出 payload 函数输出契约字段");
  assert(!background.includes("pendingTabOpens: fullState.pendingTabOpens"), "录制 JSON 导出不得包含 pendingTabOpens");
  assert(!background.includes("pendingNavigations: fullState.pendingNavigations"), "录制 JSON 导出不得包含 pendingNavigations");
  assert(!background.includes("activeTabId: fullState.activeTabId"), "录制 JSON 导出不得包含 activeTabId");
  assert(validator.includes("session.startedAt"), "validate_schema 必须要求 session.startedAt");
  assert(validator.includes("[\"recording\", \"paused\", \"completed\", \"idle\"].includes(session?.status)"), "validate_schema 必须限制 session.status 白名单");
  assert(sample.session.status === "completed", "示例录制会话必须是 completed 状态");
  assert(validator.includes("titleOverride"), "validate_schema 必须校验人工标题字段");
  assert(validator.includes("descriptionOverride"), "validate_schema 必须校验人工说明字段");
  assert(validator.includes("focusBoxOverride"), "validate_schema 必须校验人工高亮字段");
  assert(validator.includes("durationOverrideSeconds"), "validate_schema 必须校验人工视频时长字段");
  assert(validator.includes("voiceoverText"), "validate_schema 必须校验人工视频旁白字段");
  assert(validator.includes("voiceoverTextOverridden"), "validate_schema 必须校验人工视频旁白覆盖标记");
  assert(validator.includes("[\"Enter\", \"Escape\"].includes(node.key)"), "validate_schema 必须限制 key 节点键名白名单");
  assert(validator.includes("validateKey(step.key"), "validate_schema 必须校验 ArticleStep key 字段");
  assert(validator.includes("validateKey(segment.key"), "validate_schema 必须校验 VideoTimeline key 字段");
  assert(validator.includes("maskedValue"), "validate_schema 必须校验 maskedValue 字段");
  assert(validator.includes("rawValue 不允许持久化"), "validate_schema 必须禁止 rawValue 持久化");
  assert(validator.includes("privacyMaskBoxes"), "validate_schema 必须校验打码区域");
  assert(validator.includes("validateScreenshot"), "validate_schema 必须校验视频时间轴截图元数据");
  assert(validator.includes("redactedForPrivacy"), "validate_schema 必须校验 JSON 导出截图隐私裁剪字段");
  assert(validator.includes("validateArticleChapters"), "validate_schema 必须校验文章章节");
  assert(validator.includes("mergedNodeIds"), "validate_schema 必须校验合并节点字段");
  assert(validator.includes("validateFormTarget"), "validate_schema 必须校验表单目标元数据");
  assert(validator.includes("validateFormMerge"), "validate_schema 必须校验同表单字段合并元数据");
  assert(validator.includes("mergedEventCount"), "validate_schema 必须校验连续输入合并计数字段");
  assert(validator.includes("mergedClickCount"), "validate_schema 必须校验重复点击合并计数字段");
  assert(validator.includes("autoMaskApplied"), "validate_schema 必须校验自动打码标记");
  const firstClickNode = sample.nodes.find((node) => node.id === "node_001");
  assert(firstClickNode?.mergedClickCount === 2, "示例录制数据必须覆盖重复点击合并计数字段");
  const emailNode = sample.nodes.find((node) => node.id === "node_003");
  assert(emailNode?.titleOverride, "示例录制数据必须覆盖人工标题字段");
  assert(emailNode?.privacy?.reasons?.includes("email"), "示例录制数据必须覆盖 PII 原因字段");
  assert(emailNode?.privacyMaskBoxes?.length === 1, "示例录制数据必须覆盖打码区域字段");
  assert(emailNode?.mergedEventCount === 2, "示例录制数据必须覆盖连续输入合并计数字段");
  assert(emailNode?.voiceoverTextOverridden === true, "示例录制数据必须覆盖人工视频旁白字段");
  assert(sample.nodes.some((node) => node.action === "navigation"), "示例录制数据必须覆盖页面跳转节点");
  const uploadNode = sample.nodes.find((node) => node.action === "upload");
  assert(uploadNode?.target?.type === "upload", "示例录制数据必须覆盖 upload 节点");
  assert(uploadNode.maskedValue?.includes("***"), "upload 节点必须只保存脱敏文件名摘要");
  assert(uploadNode.value === uploadNode.maskedValue, "upload 节点 value 必须与 maskedValue 兼容一致");
  assert(!/fakepath|[A-Z]:\\\\|\/home\//i.test(uploadNode.maskedValue || ""), "upload 节点不能保存本地完整路径");
  const nearbyNode = sample.nodes.find((node) => node.target?.nearbyText === "Support Contact");
  assert(nearbyNode?.action === "input", "示例录制数据必须覆盖邻近文本目标识别");
  const visibleNode = sample.nodes.find((node) => node.target?.visibility?.canHighlight);
  assert(visibleNode, "示例录制数据必须覆盖目标可见性字段");
  const idCardNode = sample.nodes.find((node) => node.privacy?.reasons?.includes("id_card"));
  const bankCardNode = sample.nodes.find((node) => node.privacy?.reasons?.includes("bank_card"));
  assert(idCardNode?.maskedValue === "31**************10", "示例录制数据必须覆盖身份证号脱敏");
  assert(idCardNode?.value === idCardNode?.maskedValue, "身份证号节点 value 必须与 maskedValue 兼容一致");
  assert(idCardNode?.privacyMaskBoxes?.length === 1, "身份证号节点必须覆盖自动打码区域");
  assert(bankCardNode?.maskedValue === "**** **** **** 3456", "示例录制数据必须覆盖银行卡号脱敏");
  assert(bankCardNode?.value === bankCardNode?.maskedValue, "银行卡号节点 value 必须与 maskedValue 兼容一致");
  assert(bankCardNode?.privacyMaskBoxes?.length === 1, "银行卡号节点必须覆盖自动打码区域");
  assert(!JSON.stringify(sample.nodes).includes("rawValue"), "示例录制数据不得包含 rawValue");
  assert(idCardNode?.target?.form?.selector, "身份证号节点必须覆盖所属表单元数据");
  assert(bankCardNode?.target?.form?.selector, "银行卡号节点必须覆盖所属表单元数据");
});

runCheck("视频时间轴包含正确 duration 和 tab_transition", () => {
  const timeline = readJson("dist/video-timeline.json");
  assert(Array.isArray(timeline.segments), "segments 必须是数组");
  assert(timeline.segments.length >= 5, "示例时间轴至少应有 5 个片段");
  const lastEnd = timeline.segments.at(-1).endTime;
  assert(timeline.duration === lastEnd, `duration 应等于最后片段 endTime，当前 ${timeline.duration} != ${lastEnd}`);
  const tabSegments = timeline.segments.filter((segment) => segment.type === "tab_transition");
  assert(tabSegments.length >= 2, "必须包含至少 2 个标签页切换片段");
  assert(tabSegments.some((segment) => segment.fromTabAlias && segment.toTabAlias), "标签页切换片段必须包含 from/to 标签页");
  const chapterSegments = timeline.segments.filter((segment) => segment.type === "chapter_intro");
  assert(chapterSegments.length === 0, "默认视频时间轴不应插入章节开场片段");
  assert(!timeline.segments.some((segment) => segment.caption?.includes("跳转到")), "默认时间轴不应输出“跳转到”式页面日志");
});

runCheck("文章和视频分镜都标注标签页切换", () => {
  const article = readText("dist/article.html");
  const storyboard = readText("dist/video-storyboard.html");
  assert(article.includes("标签页切换"), "article.html 缺少标签页切换标注");
  assert(storyboard.includes("标签页切换片段"), "video-storyboard.html 缺少标签页切换片段");
  assert(!storyboard.includes("章节片段"), "video-storyboard.html 不应输出章节片段");
  assert(storyboard.includes("标签页 A：ZKBio TimeCloud 注册页 -> 标签页 B：邮箱收件箱"), "storyboard 缺少 A -> B 切换");
  assert(article.includes("操作步骤"), "article.html 必须按操作步骤组织");
});

runCheck("视频帧生成器可输出 tab_transition SVG 帧", () => {
  const result = spawnSync("node", ["tools/render_video.js", "--frames-only"], { cwd: root, encoding: "utf8" });
  assert(result.status === 0, result.stderr || result.stdout || "render_video 执行失败");
  const timeline = readJson("dist/video-timeline.json");
  const tabSegment = timeline.segments.find((segment) => segment.type === "tab_transition");
  assert(tabSegment, "示例时间轴缺少 tab_transition 片段");
  const framePath = `dist/video/frames/${tabSegment.id}.svg`;
  assertExists(framePath);
  const frame = readText(framePath);
  assert(frame.includes("标签页切换"), `${tabSegment.id}.svg 缺少标签页切换标题`);
  assert(frame.includes("标签页 A：ZKBio TimeCloud 注册页"), `${tabSegment.id}.svg 缺少来源标签页`);
  assert(frame.includes("标签页 B：邮箱收件箱"), `${tabSegment.id}.svg 缺少目标标签页`);
});

runCheck("视频帧生成器可输出 navigation 页面跳转 SVG 帧", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sop-render-nav-"));
  const timelinePath = path.join(tmpDir, "timeline.json");
  fs.writeFileSync(timelinePath, JSON.stringify({
    version: "0.1.0",
    duration: 2,
    segments: [
      {
        id: "segment_navigation",
        type: "navigation",
        startTime: 0,
        endTime: 2,
        caption: "进入支付页。",
        fromUrl: "https://example.com/register",
        toUrl: "https://pay.example.net/checkout",
        pageUrl: "https://pay.example.net/checkout",
        storyboardVisualType: "navigation"
      }
    ]
  }), "utf8");
  const result = spawnSync("node", ["tools/render_video.js", "--frames-only", timelinePath, tmpDir], { cwd: root, encoding: "utf8" });
  assert(result.status === 0, result.stderr || result.stdout || "navigation 视频帧生成失败");
  const frame = fs.readFileSync(path.join(tmpDir, "frames", "segment_navigation.svg"), "utf8");
  assert(frame.includes("页面跳转"), "navigation SVG 缺少页面跳转标题");
  assert(frame.includes("y=\"586\" width=\"1280\" height=\"134\""), "navigation SVG 必须使用底部字幕条");
  assert(!/\d+(?:\.\d+)?s\s*-\s*\d+(?:\.\d+)?s/.test(frame), "navigation SVG 不应显示时间范围");
  assert(frame.includes("pay.example.net"), "navigation SVG 必须展示目标地址上下文");
});

runCheck("默认视频帧不输出 chapter_intro 章节 SVG 帧", () => {
  const timeline = readJson("dist/video-timeline.json");
  assert(!timeline.segments.some((segment) => segment.type === "chapter_intro"), "默认时间轴不应包含 chapter_intro");
  const frameDir = path.join(root, "dist/video/frames");
  const chapterFrames = fs.readdirSync(frameDir).filter((name) => /^chapter_intro_.+\.svg$/.test(name));
  assert(chapterFrames.length === 0, "默认视频帧目录不应包含 chapter_intro 帧");
});

runCheck("视频帧生成器会清理旧 segment SVG 帧", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sop-render-clean-"));
  const frameDir = path.join(tmpDir, "frames");
  fs.mkdirSync(frameDir, { recursive: true });
  fs.writeFileSync(path.join(frameDir, "segment_stale.svg"), "<svg></svg>", "utf8");
  fs.writeFileSync(path.join(frameDir, "chapter_intro_stale.svg"), "<svg></svg>", "utf8");
  const timelinePath = path.join(tmpDir, "timeline.json");
  fs.writeFileSync(timelinePath, JSON.stringify({
    version: "0.1.0",
    duration: 2,
    segments: [
      {
        id: "segment_current",
        stepId: "article_step_001",
        type: "operation",
        startTime: 0,
        endTime: 2,
        caption: "当前片段",
        key: "Enter",
        visual: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='200'%3E%3Crect width='400' height='200' fill='white'/%3E%3C/svg%3E",
        screenshot: { viewportWidth: 400, viewportHeight: 200, width: 400, height: 200 }
      }
    ]
  }), "utf8");
  const result = spawnSync("node", ["tools/render_video.js", "--frames-only", timelinePath, tmpDir], { cwd: root, encoding: "utf8" });
  assert(result.status === 0, result.stderr || result.stdout || "render_video 清理旧帧验证失败");
  assert(!fs.existsSync(path.join(frameDir, "segment_stale.svg")), "render_video 必须清理旧 segment SVG 帧");
  assert(!fs.existsSync(path.join(frameDir, "chapter_intro_stale.svg")), "render_video 必须清理旧 chapter_intro SVG 帧");
  assert(fs.existsSync(path.join(frameDir, "segment_current.svg")), "render_video 必须生成当前 segment SVG 帧");
  const frame = fs.readFileSync(path.join(frameDir, "segment_current.svg"), "utf8");
  assert(frame.includes("按键：Enter"), "render_video 生成的 SVG 帧必须显示 key 片段按键");
  assert(frame.includes("当前片段"), "render_video 生成的 SVG 帧必须把说明作为字幕展示");
  assert(!/\d+(?:\.\d+)?s\s*-\s*\d+(?:\.\d+)?s/.test(frame), "render_video 生成的 SVG 帧不应显示时间范围");
});

runCheck("视频帧生成器可渲染真实截图、高亮和打码", () => {
  const renderVideo = readText("tools/render_video.js");
  assert(renderVideo.includes("renderScreenshotVisual"), "render_video.js 必须支持真实截图渲染");
  assert(renderVideo.includes("<image href="), "render_video.js 必须把截图嵌入 SVG");
  assert(renderVideo.includes("renderBlankStepVisual"), "render_video.js 必须在操作截图缺失时生成空白步骤画面");
  assert(!renderVideo.includes("目标操作区域"), "render_video.js 不应为普通操作片段伪造系统页面");
  assert(renderVideo.includes("privacyMaskBoxes"), "render_video.js 必须渲染打码区域");
  assert(renderVideo.includes("renderFocusZoom"), "render_video.js 必须基于高亮区域渲染局部放大预览");
  assert(renderVideo.includes("resolveVideoResolution") && renderVideo.includes("3840, height: 2160") && renderVideo.includes("2560, height: 1440"), "render_video.js must support 2K and 4K MP4 frames");
  assert(renderVideo.includes("\"-crf\", \"16\"") && renderVideo.includes("\"-preset\", \"slow\"") && renderVideo.includes("\"-movflags\", \"+faststart\""), "render_video.js must use high-quality H.264 MP4 settings");
  assert(renderVideo.includes("viewBox=\"0 0 ${VIDEO_VIEWBOX_WIDTH} ${VIDEO_VIEWBOX_HEIGHT}\""), "render_video.js must scale legacy coordinates through SVG viewBox");
  assert(renderVideo.includes("--window-size=${VIDEO_WIDTH},${VIDEO_HEIGHT}"), "render_video.js must render PNG frames at 2K resolution");
  assert(renderVideo.includes("* 2.8"), "render_video.js focus zoom must avoid over-enlarging low-resolution screenshot areas");
  assert(renderVideo.includes("function focusZoomAnchor") && renderVideo.includes("box.width * 0.2"), "render_video.js focus zoom must bias the crop toward the left text area");
  assert(renderVideo.includes("function shouldRenderFocusZoom"), "render_video.js must decide when focus zoom is useful");
  assert(renderVideo.includes("overlapWidth > 0 && overlapHeight > 0"), "render_video.js must hide focus zoom when it overlaps the original highlight");
  assert(renderVideo.includes("highlightArea / frameArea < 0.12"), "render_video.js must hide focus zoom for already-large highlights");
  assert(renderVideo.includes("renderSubtitle"), "render_video.js 必须把说明渲染为字幕");
  assert(renderVideo.includes("{ x: 32, y: 24, width: 1216, height: 548 }"), "render_video.js 必须使用大面积截图主画面");
  assert(renderVideo.includes("已打码"), "render_video.js 必须在有打码区域时显示提示");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sop-render-video-"));
  const timelinePath = path.join(tmpDir, "timeline.json");
  const outputDir = path.join(tmpDir, "video");
  const timeline = {
    version: "0.1.0",
    duration: 3,
    segments: [
      {
        id: "segment_realshot",
        stepId: "article_step_001",
        type: "operation",
        startTime: 0,
        endTime: 3,
        caption: "真实截图片段",
        visual: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='200'%3E%3Crect width='400' height='200' fill='white'/%3E%3C/svg%3E",
        screenshot: { viewportWidth: 400, viewportHeight: 200, width: 400, height: 200 },
        highlight: { x: 40, y: 50, width: 120, height: 40 },
        privacyMaskBoxes: [{ x: 200, y: 60, width: 90, height: 30 }]
      }
    ]
  };
  fs.writeFileSync(timelinePath, JSON.stringify(timeline), "utf8");
  const result = spawnSync("node", ["tools/render_video.js", "--frames-only", timelinePath, outputDir], { cwd: root, encoding: "utf8" });
  assert(result.status === 0, result.stderr || result.stdout || "真实截图视频帧生成失败");
  const frame = fs.readFileSync(path.join(outputDir, "frames", "segment_realshot.svg"), "utf8");
  assert(frame.includes("<image href=\"data:image/svg+xml"), "真实截图帧必须包含 image");
  assert(frame.includes("width=\"1096\" height=\"548\""), "真实截图帧必须把截图作为主画面放大展示");
  assert(frame.includes("y=\"586\" width=\"1280\" height=\"134\""), "真实截图帧必须使用底部字幕条");
  assert(frame.includes("真实截图片段"), "真实截图帧必须把说明作为字幕展示");
  assert(!/\d+(?:\.\d+)?s\s*-\s*\d+(?:\.\d+)?s/.test(frame), "真实截图帧不应显示时间范围");
  assert(frame.includes("已打码"), "真实截图帧必须标注已打码");
  assert(frame.includes("stroke=\"#f18a2a\""), "真实截图帧必须渲染高亮框");
  assert(frame.includes("Focus zoom"), "真实截图帧必须渲染局部放大预览");
  assert(frame.includes("clipPath"), "局部放大预览必须裁剪截图区域");
  assert(frame.includes("fill=\"#111827\""), "真实截图帧必须渲染打码遮罩");
});

runCheck("视频生成器缺少操作截图时输出空白步骤帧", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sop-render-missing-shot-"));
  const timelinePath = path.join(tmpDir, "timeline.json");
  fs.writeFileSync(timelinePath, JSON.stringify({
    version: "0.1.0",
    duration: 2,
    segments: [
      {
        id: "segment_missing_visual",
        type: "operation",
        startTime: 0,
        endTime: 2,
        caption: "缺少截图的操作片段",
        screenshot: { viewportWidth: 400, viewportHeight: 200 }
      }
    ]
  }), "utf8");
  const result = spawnSync("node", ["tools/render_video.js", "--frames-only", timelinePath, tmpDir], { cwd: root, encoding: "utf8" });
  assert(result.status === 0, result.stderr || result.stdout || "缺少操作截图时也应生成空白步骤帧");
  const frame = fs.readFileSync(path.join(tmpDir, "frames", "segment_missing_visual.svg"), "utf8");
  assert(frame.includes("暂无截图"), "缺少截图时必须输出空白步骤画面提示");
  assert(frame.includes("缺少截图的操作片段"), "缺少截图时必须保留步骤字幕");
  assert(!frame.includes("目标操作区域"), "缺少截图时不能生成伪系统页面");
});

runCheck("视频生成器可通过 PNG 中间帧合成 MP4", () => {
  const renderVideo = readText("tools/render_video.js");
  assert(renderVideo.includes("renderPngFramesWithChrome"), "render_video.js 必须先用 Chrome 渲染 PNG 中间帧");
  assert(renderVideo.includes("png-frames"), "render_video.js 必须输出 PNG 中间帧目录");
  assert(renderVideo.includes("findChromeExecutable"), "render_video.js 必须查找 Chrome 可执行文件");
  assert(renderVideo.includes("pathToFileUrl"), "render_video.js 必须用 file URL 打开 SVG 帧");
  assert(renderVideo.includes("cleanGeneratedPngFrames"), "render_video.js 必须清理旧 PNG 中间帧");

  const ffmpeg = spawnSync("ffmpeg", ["-version"], { cwd: root, encoding: "utf8" });
  const chrome = findChromeExecutable();
  if (ffmpeg.status !== 0 || !chrome) return;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sop-render-mp4-"));
  const timelinePath = path.join(tmpDir, "timeline.json");
  const outputDir = path.join(tmpDir, "video");
  fs.writeFileSync(timelinePath, JSON.stringify({
    version: "0.1.0",
    duration: 2,
    segments: [
      {
        id: "segment_mp4",
        stepId: "article_step_001",
        type: "operation",
        startTime: 0,
        endTime: 2,
        caption: "生成 MP4 验证片段",
        currentTabAlias: "标签页 A：验证页"
      }
    ]
  }), "utf8");
  const result = spawnSync("node", ["tools/render_video.js", timelinePath, outputDir], { cwd: root, encoding: "utf8" });
  assert(result.status === 0, result.stderr || result.stdout || "render_video MP4 生成失败");
  const pngPath = path.join(outputDir, "png-frames", "segment_mp4.png");
  const mp4Path = path.join(outputDir, "sop-video.mp4");
  assert(fs.existsSync(pngPath), "render_video 必须生成 PNG 中间帧");
  assert(fs.existsSync(mp4Path), "render_video 必须生成 MP4 文件");
  assert(fs.statSync(mp4Path).size > 1024, "生成的 MP4 文件不应为空");
});

runCheck("测试页覆盖注册、邮箱、新建公司关键操作", () => {
  const index = readText("test-pages/index.html");
  const mail = readText("test-pages/mail.html");
  const company = readText("test-pages/company.html");
  assert(index.includes("SIGN UP"), "注册页缺少 SIGN UP");
  assert(index.includes("target=\"_blank\""), "注册页应新开邮箱标签页");
  assert(mail.includes("Activate Account"), "邮箱页缺少 Activate Account");
  assert(company.includes("Confirm"), "公司页缺少 Confirm");
  assert(company.includes("type=\"file\""), "公司页缺少文件上传控件");
  assert(company.includes("Business License"), "公司页缺少上传字段标签");
  assert(company.includes("Support Contact"), "公司页缺少邻近文本测试控件");
  assert(company.includes("Legal Representative ID"), "公司页缺少身份证号测试控件");
  assert(company.includes("Billing Bank Card"), "公司页缺少银行卡号测试控件");
});

runCheck("内容脚本覆盖基础表单事件采集", () => {
  const content = readText("extension/content.js");
  const background = readText("extension/background.js");
  const shared = readText("extension/shared/artifacts.js");
  const index = readText("test-pages/index.html");
  const company = readText("test-pages/company.html");

  assert(content.startsWith("(() => {"), "content.js 必须包在函数作用域内，避免重复注入时顶层 const 重复声明");
  assert(content.includes("var INPUT_DEBOUNCE_MS") && !content.includes("const INPUT_DEBOUNCE_MS"), "content top-level recorder variables must not redeclare const");
  assert(content.includes("document.addEventListener(\"click\""), "content.js 必须监听点击事件");
  assert(content.includes("document.addEventListener(\"input\""), "content.js 必须监听输入事件");
  assert(content.includes("document.addEventListener(\"change\""), "content.js 必须监听 change 事件");
  assert(content.includes("document.addEventListener(\"submit\""), "content.js 必须监听表单提交事件");
  assert(content.includes("document.addEventListener(\"keydown\""), "content.js 必须监听键盘关键动作");
  assert(content.includes("[\"Enter\", \"Escape\"].includes(event.key)"), "键盘采集只能记录 Enter/Escape");
  assert(content.includes("event.repeat"), "键盘采集必须忽略长按重复键");
  assert(content.includes("sendInputLikeEvent(target, \"select\")"), "content.js 必须发送 select 事件");
  assert(content.includes("sendInputLikeEvent(target, \"check\","), "content.js 必须发送 check 事件");
  assert(content.includes("function scheduleCheckClickEvent"), "checkbox/switch 点击必须主动延迟记录，不能只依赖 change 事件");
  assert(content.includes("function shouldSkipCheckChange"), "checkbox/switch click 和 change 必须去重");
  assert(content.includes("isCheckableTarget(target)"), "click 事件必须识别原生和自定义 checkbox/radio/switch");
  assert(content.includes("window.setTimeout(() =>") && content.includes("sendInputLikeEvent(liveTarget, \"check\", clickPoint)"), "自定义 checkbox 点击必须等选中状态更新后再记录");
  assert(content.includes("sendCheckEventFromSnapshot"), "checkbox/switch click must fall back to the click-time target snapshot after rerender");
  assert(content.includes("getCheckableCaptureTarget"), "checkbox/switch must highlight the visible control container");
  assert(content.includes("sendInputLikeEvent(checkTarget, \"check\", clickPoint, {") && content.includes("preAction: true"), "checkbox/switch 必须在 pointerdown 阶段发送 preAction check，确保截图发生在状态切换前");
  assert(content.includes("function getNextCheckedState"), "checkbox/switch preAction 节点必须推算点击后的 checked 状态");
  assert(content.includes("input.PrivateSwitchBase-input"), "checkbox/switch must detect MUI PrivateSwitchBase inputs");
  assert(!content.includes("target.querySelector?.(\"input[type='checkbox']"), "checkbox detection must not scan child rows/cells");
  assert(content.includes("recentCheckClickPoints"), "checkbox/radio change 事件必须继承最近点击坐标");
  assert(content.includes("sendInputLikeEvent(target, \"check\", recentCheckClickPoints.get(target) || null)"), "checkbox/radio 必须在 change 后记录选中状态和点击坐标");
  assert(content.includes("action: \"submit\""), "content.js 必须发送 submit 事件");
  assert(content.includes("response?.ok || response?.duplicateEvent"), "content.js 只有收到 background 确认后才能删除事件队列");
  assert(content.includes("chrome.runtime?.id"), "content.js 必须在扩展上下文失效时避免直接调用 sendMessage");
  assert(content.includes("extension_context_invalidated"), "content.js 必须标记扩展上下文失效的投递失败原因");
  assert(content.includes("retryRecorderEvent(event, attempt"), "content.js 发送失败或未确认时必须重试事件");
  assert(content.includes("MAX_EVENT_DELIVERY_ATTEMPTS"), "content.js 必须限制事件重试次数");
  assert(content.includes("lastError"), "content.js 必须记录事件投递失败原因以便排查");
  assert(content.includes("CONTENT_INSTANCE_ID"), "content.js 必须用实例标识避免重复注入后重复监听");
  assert(content.includes("isActiveContentInstance()"), "content.js 旧实例监听器必须能自动失效");
  assert(background.includes("payload.action === \"submit\""), "background 必须生成 submit 默认说明");
  assert(background.includes("payload.action === \"key\""), "background 必须生成 key 默认说明");
  assert(background.includes("[\"click\", \"submit\", \"key\"].includes(last.action)"), "键盘关键动作必须能关联后续页面跳转");
  assert(background.includes("function shouldSkipSubmitAfterEnterKey"), "background 必须去重 Enter 后立即触发的重复 submit");
  assert(background.includes("redundant_submit_after_key"), "重复 submit 跳过响应必须标记原因");
  assert(background.includes("last.action !== \"key\" || last.key !== \"Enter\""), "submit 去重必须只针对 Enter key");
  assert(background.includes("payload.target.form.selector === last.target.form.selector"), "submit 去重必须支持同表单判断");
  assert(background.includes("payload.action === \"select\""), "background 必须生成 select 默认说明");
  assert(background.includes("if (payload.action === \"select\") await delay(250)"), "select 节点截图必须等待选中状态稳定后再捕获");
  assert(background.includes("function delay(milliseconds)"), "background 必须提供截图延迟工具函数");
  assert(background.includes("payload.action === \"check\""), "background 必须生成 check 默认说明");
  assert(shared.includes("node.action === \"submit\""), "共享 artifact 必须生成 submit 默认标题");
  assert(shared.includes("node.action === \"key\""), "共享 artifact 必须生成 key 默认标题");
  assert(shared.includes("key: normalizeKey(node.key)"), "共享 artifact 必须把节点 key 带入 ArticleStep");
  assert(shared.includes("key: step.key || null"), "共享 artifact 必须把 ArticleStep key 带入 VideoTimeline");
  assert(shared.includes("node.action === \"select\""), "共享 artifact 必须生成 select 默认标题");
  assert(shared.includes("node.action === \"check\""), "共享 artifact 必须生成 check 默认标题");
  const { buildArticleSteps } = require(path.join(root, "extension/shared/artifacts.js"));
  const keySteps = buildArticleSteps([{
    id: "node_key_enter",
    sequence: 1,
    action: "key",
    key: "Enter",
    tab: { tabId: 1, tabAlias: "标签页 A：查询页", domain: "example.com" },
    target: { type: "input", labelText: "Search" },
    generatedInstruction: "按下 Enter，操作 Search。",
    status: "auto_generated"
  }]);
  const { buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const keyTimeline = buildVideoTimeline(keySteps);
  assert(keySteps[0].title.includes("Enter"), "key 节点文章标题必须包含键名");
  assert(keySteps[0].key === "Enter", "key 节点 ArticleStep 必须保留结构化键名");
  assert(keyTimeline.segments[0].key === "Enter", "key 节点 VideoTimeline 必须保留结构化键名");
  assert(index.includes("type=\"submit\""), "注册测试页必须覆盖表单提交控件");
  assert(company.includes("<select"), "公司测试页必须覆盖下拉选择控件");
  assert(company.includes("type=\"checkbox\""), "公司测试页必须覆盖勾选控件");
});

runCheck("项目文档覆盖当前编辑、隐私和视频能力", () => {
  const readme = readText("README.md");
  const dataModel = readText("DATA_MODEL.md");
  const testing = readText("TESTING.md");
  ["合并/拆分", "同一表单", "手动调整高亮", "恢复自动高亮", "Popup 和预览页导出前", "Markdown", "Word", "页面变化", "弹窗", "上传文件", "视频时间轴", "清理已知旧截图", "等待节点", "步骤分组", "视频旁白", "恢复自动文案", "scrollX/scrollY", "clickPoint", "target.attributes", "防抖", "局部放大"].forEach((text) => {
    assert(readme.includes(text), `README.md 缺少 ${text}`);
  });
  ["titleOverride", "focusBoxOverride", "durationOverrideSeconds", "voiceoverText", "voiceoverTextOverridden", "privacyMaskBoxes", "maskedValue", "rawValue", "mergedNodeIds", "formMerge", "target.form", "target.attributes", "navigation", "modal_open", "modal_close", "upload", "waitDurationMs", "ArticleChapter", "nearbyText", "visibility", "screenshot", "screenshot.pruned", "screenshot.captureTiming", "redactedForPrivacy", "imageRedactedForPrivacy", "viewport.scrollX", "screenshot.scrollX", "clickPoint"].forEach((text) => {
    assert(dataModel.includes(text), `DATA_MODEL.md 缺少 ${text}`);
  });
  assert(dataModel.includes("局部放大预览"), "DATA_MODEL.md 缺少局部放大预览说明");
  ["真实截图", "删除/恢复", "隐私确认", "Markdown", "Word", "页面变化", "modal_open", "文件上传", "maskedValue", "rawValue", "privacyMaskBoxes", "captureTiming", "同一表单", "旧步骤截图", "wait", "操作步骤", "视频时长", "视频旁白", "恢复自动文案", "恢复自动高亮", "redactedForPrivacy", "原始截图 `dataUrl`", "scrollX/scrollY", "clickPoint", "target.attributes", "防抖", "局部放大预览", "步骤分组"].forEach((text) => {
    assert(testing.includes(text), `TESTING.md 缺少 ${text}`);
  });
});

runCheck("扩展预览页支持导出文章和视频时间轴", () => {
  const viewerHtml = readText("extension/viewer.html");
  const viewerJs = readText("extension/viewer.js");
  const artifactsJs = readText("extension/viewer_artifacts.js");
  assert(viewerHtml.includes("articleBtn"), "viewer.html 缺少 SOP 文章导出按钮");
  assert(viewerHtml.includes("markdownBtn"), "viewer.html 缺少 SOP Markdown 导出按钮");
  assert(viewerHtml.includes("wordBtn"), "viewer.html 缺少 SOP Word 导出按钮");
  assert(viewerHtml.includes("timelineBtn"), "viewer.html 缺少视频时间轴导出按钮");
  assert(viewerHtml.includes("videoBtn"), "viewer.html 缺少视频 WebM 直接导出按钮");
  assert(viewerHtml.includes("articleTitleInput"), "viewer.html 必须支持选择/填写文章标题");
  assert(viewerHtml.includes("privacyMaskToggle"), "viewer.html 必须提供邮箱和密码打码开关");
  assert(viewerJs.includes("renderTimelineWebm"), "viewer.js 必须支持在预览页直接生成 WebM 视频");
  assert(viewerJs.includes("canvas.captureStream"), "预览页视频导出必须使用 Canvas captureStream");
  assert(viewerJs.includes("new MediaRecorder"), "预览页视频导出必须使用 MediaRecorder");
  assert(viewerJs.includes("renderSegmentFrames"), "预览页视频导出必须逐帧刷新 Canvas");
  assert(viewerJs.includes("requestFrame"), "预览页视频导出必须主动请求视频帧");
  assert(viewerJs.includes("canvas.captureStream(0)"), "预览页视频导出必须使用手动帧捕获，避免自动捕获清屏过程导致频闪");
  assert(viewerJs.includes("const VIDEO_WIDTH = 2560") && viewerJs.includes("const VIDEO_HEIGHT = 1440"), "video export must use 2K canvas");
  assert(viewerJs.includes("ctx.setTransform(VIDEO_SCALE"), "video export must scale virtual coordinates on high-res canvas");
  assert(viewerJs.includes("WEBM_VIDEO_BITS_PER_SECOND = 48_000_000"), "video export must use a high bitrate for clear 2K WebM output");
  assert(viewerJs.includes("ctx.imageSmoothingEnabled = true") && viewerJs.includes("ctx.imageSmoothingQuality = \"high\""), "video export must use high-quality smoothing when scaling screenshots");
  assert(viewerJs.includes("* 2.8"), "focus zoom must avoid over-enlarging low-resolution screenshot areas");
  assert(viewerJs.includes("frame.width * 0.43"), "focus zoom window must be larger");
  assert(viewerJs.includes("function focusZoomAnchor") && viewerJs.includes("box.width * 0.2"), "focus zoom must bias the crop toward the left text area");
  assert(viewerJs.includes("function shouldRenderFocusZoom"), "preview video export must decide when focus zoom is useful");
  assert(viewerJs.includes("overlapWidth > 0 && overlapHeight > 0"), "preview video export must hide focus zoom when it overlaps the original highlight");
  assert(viewerJs.includes("highlightArea / frameArea < 0.12"), "preview video export must hide focus zoom for already-large highlights");
  assert(viewerJs.indexOf("await drawVideoFrame(ctx, segment);") < viewerJs.indexOf("for (let index = 0; index < frameCount; index += 1)"), "preview video export must draw the segment once before timed frame requests");
  assert(viewerJs.includes("drawArticleTitle"), "预览页视频导出必须展示文章标题");
  assert(viewerJs.includes("segment.articleTitle || timelineTitle"), "preview video export must use timeline title as a global fallback");
  assert(viewerJs.includes("canvasImageCache"), "预览页视频导出必须缓存截图，避免逐帧重复加载导致抖动");
  assert(viewerJs.includes("drawText(ctx, line, 640, firstY + index * 32, 24"), "video subtitle font must be smaller");
  assert(viewerJs.includes("!chunks.length"), "预览页视频导出必须检测空视频数据");
  assert(viewerJs.includes(".webm"), "预览页视频导出文件必须使用 WebM 扩展名");
  assert(viewerJs.includes("downloadBlobFile"), "预览页视频导出必须下载 Blob 视频文件");
  assert(viewerJs.includes("drawScreenshotFrame"), "预览页视频导出必须用步骤截图渲染视频主画面");
  assert(viewerJs.includes("drawBlankStepFrame"), "预览页视频导出必须在缺少截图时输出空白步骤帧");
  assert(viewerHtml.indexOf("shared/artifacts.js") < viewerHtml.indexOf("viewer_artifacts.js"), "shared/artifacts.js 必须先于 viewer_artifacts.js 加载");
  assert(viewerHtml.indexOf("viewer_artifacts.js") < viewerHtml.indexOf("viewer.js"), "viewer_artifacts.js 必须先于 viewer.js 加载");
  assert(artifactsJs.includes("SopArtifactShared"), "viewer_artifacts.js 必须使用共享 artifact 库");
  assert(artifactsJs.includes("操作步骤"), "viewer_artifacts.js 必须按步骤教学渲染文章");
  assert(artifactsJs.includes("renderArticleMarkdown"), "viewer_artifacts.js 必须支持 Markdown 渲染");
  assert(artifactsJs.includes("renderArticleWordDocument"), "viewer_artifacts.js 必须支持 Word 兼容文档渲染");
  assert(artifactsJs.includes("resolveArticleTitle"), "viewer_artifacts.js 必须按用户选择生成文章标题");
  assert(artifactsJs.includes("stepTypeText"), "viewer_artifacts.js 必须按步骤类型渲染导出标签");
});

runCheck("文章导出不在每个步骤重复访问路径", () => {
  const viewerArtifacts = readText("extension/viewer_artifacts.js");
  const generator = readText("tools/generate_artifacts.js");
  const article = readText("dist/article.html");
  const markdown = readText("dist/article.md");
  const word = readText("dist/article.doc");
  assert(!article.includes("访问路径："), "article.html 不应重复输出访问路径");
  assert(!article.includes("完整地址："), "article.html 不应重复输出完整地址");
  assert(!markdown.includes("访问路径："), "article.md 不应重复输出访问路径");
  assert(!word.includes("完整地址："), "article.doc 不应重复输出完整地址");
  assert(!viewerArtifacts.includes("step.tabAlias ? `<p>${escapeHtml(step.tabAlias)}</p>`"), "HTML 步骤不应重复显示标签页");
  assert(!generator.includes("step.tabAlias ? `<p>${escapeHtml(step.tabAlias)}</p>`"), "离线 HTML 步骤不应重复显示标签页");
  assert(!viewerArtifacts.includes("**当前标签页**"), "Markdown 步骤不应重复显示当前标签页");
  assert(!generator.includes("**当前标签页**"), "离线 Markdown 步骤不应重复显示当前标签页");
});

runCheck("文章导出按操作步骤组织，内部仍可构建分组", () => {
  const { buildArticleSteps, buildArticleChapters } = require(path.join(root, "extension/shared/artifacts.js"));
  const shared = readText("extension/shared/artifacts.js");
  const article = readText("dist/article.html");
  const markdown = readText("dist/article.md");
  const word = readText("dist/article.doc");
  assert(shared.includes("function buildArticleChapters"), "共享 artifact 必须提供 ArticleChapter 构建");
  assert(shared.includes("chapterKey"), "ArticleChapter 必须有稳定分组 key");
  assert(article.includes("操作步骤"), "article.html 必须包含操作步骤标题");
  assert(markdown.includes("## 操作步骤"), "article.md 必须包含操作步骤标题");
  assert(word.includes("操作步骤"), "article.doc 必须包含操作步骤标题");
  assert(!article.includes("章节 1"), "article.html 不应按章节教学导出");
  assert(!markdown.includes("## 章节 1"), "article.md 不应按章节教学导出");

  const steps = buildArticleSteps([
    {
      id: "node_a",
      sequence: 1,
      action: "click",
      tab: { tabId: 1, tabAlias: "标签页 A：登录页", domain: "example.com" },
      target: { type: "button", text: "登录" },
      generatedInstruction: "点击登录。",
      status: "auto_generated"
    },
    {
      id: "node_b",
      sequence: 2,
      action: "input",
      tab: { tabId: 1, tabAlias: "标签页 A：登录页", domain: "example.com" },
      target: { type: "input", text: "邮箱" },
      generatedInstruction: "填写邮箱。",
      status: "auto_generated"
    },
    {
      id: "node_c",
      sequence: 3,
      action: "navigation",
      fromTab: { tabId: 1, tabAlias: "标签页 A：登录页", url: "https://example.com/login" },
      toTab: { tabId: 1, tabAlias: "标签页 A：首页", url: "https://example.com/home", title: "首页" },
      triggeredByNodeId: "node_a",
      pageTitle: "首页",
      pageUrl: "https://example.com/home",
      generatedInstruction: "跳转到首页。",
      status: "auto_generated"
    }
  ]);
  const chapters = buildArticleChapters(steps);
  assert(steps.length === 2, "同域同标签页 navigation 应折叠进触发操作，不应成为独立步骤");
  assert(steps[0].title.includes("进入首页页面"), "触发操作标题应说明进入目标页面");
  assert(chapters.length >= 1, "内部仍可为侧栏构建步骤分组");
  assert(chapters.flatMap((chapter) => chapter.steps).length === steps.length, "章节必须覆盖全部 ArticleStep");
});

runCheck("扩展预览页侧栏显示章节列表", () => {
  const viewerHtml = readText("extension/viewer.html");
  const viewerJs = readText("extension/viewer.js");
  const viewerCss = readText("extension/viewer.css");
  assert(viewerHtml.includes("chapterList"), "viewer.html 必须提供章节列表容器");
  assert(viewerHtml.includes("aria-label=\"章节列表\""), "章节列表必须提供可访问标签");
  assert(viewerJs.includes("renderChapterList(steps)"), "viewer.js 必须在应用状态时渲染章节列表");
  assert(viewerJs.includes("buildArticleChapters(steps)"), "章节列表必须复用共享 ArticleChapter 构建");
  assert(viewerJs.includes("chapter.steps.map"), "章节列表必须渲染章节内步骤");
  assert(viewerJs.includes("href=\"#${escapeHtml(step.nodeId)}\""), "章节内步骤必须链接到对应节点卡片");
  assert(viewerJs.includes("id=\"${escapeHtml(node.id)}\""), "步骤卡片必须提供稳定锚点");
  assert(viewerCss.includes(".chapter-nav"), "viewer.css 必须提供章节导航样式");
  assert(viewerCss.includes("max-height: 32vh"), "章节列表必须限制高度避免挤压导出按钮");
  assert(viewerCss.includes(".actions"), "viewer.css 必须提供流程预览底部操作区样式");
  assert(viewerCss.includes("position: sticky"), "流程预览底部操作按钮必须固定在侧栏底部");
  assert(viewerCss.includes("bottom: 0"), "流程预览底部操作按钮必须贴近侧栏底部");
  assert(viewerCss.includes("margin-top: auto"), "流程预览底部操作按钮必须在侧栏内容不足时靠底显示");
});

runCheck("录制控制状态会保持 runtime 和 session 一致", () => {
  const background = readText("extension/background.js");
  const normalizedBackground = background.replace(/\r\n/g, "\n");
  const popupJs = readText("extension/popup.js");
  const popupCss = readText("extension/popup.css");
  assert(background.includes("cleanupCurrentSessionScreenshots"), "background 必须集中清理当前录制截图");
  assert(normalizedBackground.includes("await cleanupCurrentSessionScreenshotsIfUnarchived();\n  runtimeState = {"), "重新开始录制前必须清理未归档的上一段录制截图");
  assert(normalizedBackground.includes("await cleanupCurrentSessionScreenshotsIfUnarchived();\n      runtimeState = structuredClone(initialState);"), "清空录制前必须清理未归档的当前截图");
  assert(background.includes("const activeTabIsRecordable = Boolean(activeTab?.id && !isIgnoredTab(activeTab))"), "开始录制时必须先判断当前 tab 是否可记录");
  assert(background.includes("activeTabId: activeTabIsRecordable ? activeTab.id : null"), "从内部页开始录制时 activeTabId 必须保持为空");
  assert(background.includes("if (activeTabIsRecordable)") && background.includes("await ensureTabContext(activeTab, activeTab.windowId)"), "开始录制时只能为可记录 tab 建立上下文");
  assert(background.includes("injectRecorderContentScript(activeTab.id)"), "开始录制时必须主动向当前页面注入 content.js");
  assert(background.includes("await injectRecorderContentScript(tabId)") && background.indexOf("chrome.tabs.onActivated") < background.indexOf("await injectRecorderContentScript(tabId)"), "tab activation must inject content.js so operations after tab switch are recorded");
  assert(background.includes("chrome.scripting.executeScript"), "background 必须通过 scripting API 注入 content.js");
  assert(background.includes("deleteScreenshotRecords(runtimeState.nodes.map((node) => node.screenshot?.id))"), "截图清理必须删除当前节点引用的截图记录");
  assert(background.includes("MAX_SCREENSHOT_RECORDS = 120"), "background 必须限制单次录制截图数量");
  assert(background.includes("function pruneScreenshotCapacity"), "background 必须集中执行截图容量裁剪");
  assert(background.includes("nodesWithScreenshots.slice(0, nodesWithScreenshots.length - MAX_SCREENSHOT_RECORDS)"), "截图容量裁剪必须优先淘汰最早截图");
  assert(background.includes("pruneReason: \"capacity_limit\""), "被淘汰截图必须标记容量裁剪原因");
  assert(background.includes("await pruneScreenshotCapacity();"), "新增或替换截图后必须执行容量裁剪");
  assert(background.includes("!node.screenshot?.pruned"), "容量裁剪不能重复处理已淘汰截图");
  assert(background.includes("function pauseRecording"), "background 必须集中处理暂停录制");
  assert(background.includes("runtimeState.session.status = \"paused\""), "暂停时 session.status 必须同步为 paused");
  assert(background.includes("function resumeRecording"), "background 必须集中处理继续录制");
  assert(background.includes("runtimeState.session.status = \"recording\""), "继续时 session.status 必须同步为 recording");
  assert(background.includes("function stopRecording"), "background 必须集中处理停止录制");
  assert(background.includes("runtimeState.session.status = \"completed\""), "停止时 session.status 必须同步为 completed");
  assert(background.includes("[\"recording\", \"paused\"].includes(runtimeState.status)"), "停止录制必须允许 recording 和 paused 两种状态");
  assert(popupJs.includes("els.pauseBtn.disabled = !isRecording"), "popup 必须在非 recording 时禁用暂停");
  assert(popupJs.includes("els.resumeBtn.disabled = !isPaused"), "popup 必须在非 paused 时禁用继续");
  assert(popupJs.includes("els.stopBtn.disabled = !(isRecording || isPaused)"), "popup 必须只在录制或暂停时允许停止");
  assert(popupCss.includes(".badge.paused"), "popup 必须提供暂停状态样式");
  assert(popupCss.includes("button:disabled"), "popup 必须提供禁用按钮样式");
});

runCheck("页面跳转会等页面完成后再生成节点并截图", () => {
  const background = readText("extension/background.js");
  const validator = readText("tools/validate_schema.js");
  const sample = readJson("examples/sample-recording.json");
  const navigationNode = sample.nodes.find((node) => node.action === "navigation");
  const triggerNode = sample.nodes.find((node) => node.triggeredNavigationNodeId === navigationNode?.id);
  assert(background.includes("pendingNavigations"), "background 必须暂存 URL 变化中的页面跳转");
  assert(background.includes("findRecentNavigationTriggerNode"), "background 必须识别最近触发跳转的操作节点");
  assert(background.includes("function sanitizeRecordingUrl"), "background 必须统一脱敏持久化 URL");
  assert(background.includes("beforeUrl: sanitizeRecordingUrl(payload.beforeUrl || context.currentUrl)"), "操作节点 beforeUrl 必须脱敏后持久化");
  assert(background.includes("pageUrl: sanitizeRecordingUrl(details.pageUrl)"), "tab/navigation 节点 pageUrl 必须脱敏后持久化");
  assert(background.includes("function sanitizeUrlProperty"), "background 输出脱敏必须保留可选 URL 字段形状");
  assert(background.includes("Object.prototype.hasOwnProperty.call(target, key)"), "输出脱敏不得凭空补充缺失 URL 字段");
  assert(background.includes("sanitizeTabContextsForOutput(runtimeState.tabContexts)"), "完整状态返回前必须脱敏 tabContexts URL");
  assert(background.includes("sanitizeNodeUrlsForOutput(hydratedNode)"), "完整状态返回前必须脱敏节点 URL");
  assert(background.includes("triggeredByNodeId: triggerNode?.id"), "pending navigation 必须记录触发操作节点 ID");
  assert(background.includes("linkNavigationTrigger"), "background 必须把 navigation 节点回填到触发操作节点");
  assert(background.includes("changeInfo.status === \"complete\""), "background 必须等待页面加载完成");
  assert(background.includes("flushPendingNavigation"), "background 必须在页面完成后落 navigation 节点");
  assert(background.includes("captureVisibleScreenshot(context.windowId || tab.windowId"), "navigation 节点必须在完成后截图");
  assert(background.includes("runtimeState.pendingNavigations = {}"), "暂停或停止时必须清理未完成的页面跳转");
  assert(validator.includes("triggeredByNodeId"), "schema 必须校验 navigation 触发来源字段");
  assert(validator.includes("function validateRecordedUrl"), "schema 必须校验持久化 URL 安全格式");
  assert(validator.includes("triggeredNavigationNodeId"), "schema 必须校验操作触发的 navigation 字段");
  assert(validator.includes("navigationTargetUrl"), "schema 必须校验操作触发的目标 URL 字段");
  assert(validator.includes("validateScreenshot(node.screenshot"), "schema 必须校验节点截图元数据");
  assert(navigationNode?.screenshot?.viewportWidth === 1440, "示例 navigation 节点必须覆盖截图元数据");
  assert(navigationNode?.triggeredByNodeId === "node_001", "示例 navigation 节点必须覆盖触发来源节点");
  assert(triggerNode?.navigationTargetUrl?.includes("/onboard/register"), "示例触发节点必须覆盖跳转目标 URL");
});

runCheck("点击打开新标签页会关联触发操作节点", () => {
  const background = readText("extension/background.js");
  const validator = readText("tools/validate_schema.js");
  const dataModel = readText("DATA_MODEL.md");
  const testing = readText("TESTING.md");
  const readme = readText("README.md");
  assert(background.includes("findRecentTabOpenTriggerNode"), "background 必须识别最近触发新标签页的点击节点");
  assert(background.includes("triggeredByNodeId: triggerNode?.id"), "tab_open 节点必须记录触发操作节点 ID");
  assert(background.includes("linkTabOpenTrigger"), "background 必须把 tab_open 节点回填到触发操作节点");
  assert(background.includes("triggerNode.triggeredTabNodeId = tabOpenNodeId"), "触发点击节点必须记录 triggeredTabNodeId");
  assert(background.includes("triggerNode.tabTargetUrl = sanitizeRecordingUrl(targetUrl) || null"), "触发点击节点必须脱敏后记录 tabTargetUrl");
  assert(validator.includes("triggeredTabNodeId"), "schema 必须校验 triggeredTabNodeId");
  assert(validator.includes("tabTargetUrl"), "schema 必须校验 tabTargetUrl");
  assert(dataModel.includes("triggeredTabNodeId") && dataModel.includes("tabTargetUrl"), "DATA_MODEL.md 必须说明新标签页触发关联字段");
  assert(testing.includes("triggeredTabNodeId"), "TESTING.md 必须覆盖新标签页触发关联");
  assert(readme.includes("tab_open"), "README.md 必须说明 tab_open 关联能力");

  const { buildArticleSteps, buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([
    {
      id: "node_open_mail",
      sequence: 1,
      action: "click",
      tab: { tabId: 1, tabAlias: "标签页 A：注册页", domain: "example.com" },
      target: { type: "button", text: "打开邮箱" },
      triggeredTabNodeId: "node_tab_open",
      tabTargetUrl: "https://mail.example.com",
      generatedInstruction: "点击打开邮箱。",
      status: "auto_generated"
    },
    {
      id: "node_tab_open",
      sequence: 2,
      action: "tab_open",
      fromTab: { tabId: 1, tabAlias: "标签页 A：注册页", url: "https://example.com/register" },
      toTab: { tabId: 2, tabAlias: "标签页 B：邮箱收件箱", url: "https://mail.example.com" },
      triggeredByNodeId: "node_open_mail",
      generatedInstruction: "打开标签页 B：邮箱收件箱。",
      status: "auto_generated"
    },
    {
      id: "node_mail_click",
      sequence: 3,
      action: "click",
      tab: { tabId: 2, tabAlias: "标签页 B：邮箱收件箱", domain: "mail.example.com" },
      target: { type: "link", text: "Activate Account" },
      generatedInstruction: "点击激活链接。",
      status: "auto_generated"
    }
  ]);
  const timeline = buildVideoTimeline(steps);
  assert(steps.some((step) => step.nodeId === "node_tab_open" && step.type === "tab_transition"), "tab_open 关联后仍必须生成标签页切换步骤");
  assert(timeline.segments.some((segment) => segment.type === "tab_transition" && segment.fromTabAlias && segment.toTabAlias), "VideoTimeline 必须保留 tab_open 过渡片段");
});

runCheck("schema 支持截图容量裁剪元数据", () => {
  const validator = readText("tools/validate_schema.js");
  assert(validator.includes("screenshot.pruned"), "validate_schema 必须校验截图裁剪标记");
  assert(validator.includes("screenshot.pruneReason"), "validate_schema 必须校验截图裁剪原因");
  assert(validator.includes("screenshot.prunedAt"), "validate_schema 必须校验截图裁剪时间");
});

runCheck("耗时页面加载会生成去重后的 wait 节点", () => {
  const content = readText("extension/content.js");
  const background = readText("extension/background.js");
  const shared = readText("extension/shared/artifacts.js");
  const viewerJs = readText("extension/viewer.js");
  const validator = readText("tools/validate_schema.js");
  assert(content.includes("PAGE_LOAD_WAIT_THRESHOLD_MS"), "content.js 必须定义页面加载等待阈值");
  assert(content.includes("reportPageLoadWait"), "content.js 必须上报页面加载等待事件");
  assert(content.includes("getPageLoadDuration"), "content.js 必须读取页面加载耗时");
  assert(content.includes("action: \"wait\""), "content.js 必须发送 wait 节点事件");
  assert(content.includes("waitDurationMs"), "content.js 必须传递等待耗时");
  assert(background.includes("shouldSkipWaitNode"), "background 必须对 wait 节点去重");
  assert(background.includes("redundant_wait"), "重复等待节点必须被跳过");
  assert(background.includes("[\"navigation\", \"click\", \"submit\", \"key\", \"input\", \"select\", \"check\"].includes(last.action)"), "紧跟 navigation 的 wait 节点必须跳过");
  assert(!background.includes("formatDuration(payload.waitDurationMs)"), "wait 节点说明不应包含等待时长");
  assert(background.includes("Number(payload.waitDurationMs) >= 1200"), "wait 节点必须有最小时长门槛");
  assert(shared.includes("node.action === \"wait\""), "共享 artifact 必须支持 wait 默认标题");
  assert(validator.includes("waitDurationMs"), "validate_schema 必须校验 waitDurationMs");

  const { buildArticleSteps, buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([
    {
      id: "node_wait",
      sequence: 1,
      action: "wait",
      tab: { tabId: 1, tabAlias: "标签页 A：报表页", domain: "example.com" },
      target: { type: "page", text: "报表页" },
      waitDurationMs: 2600,
      generatedInstruction: "等待2.6 秒，直到报表页加载完成。",
      status: "auto_generated"
    }
  ]);
  const timeline = buildVideoTimeline(steps);
  assert(steps[0].type === "operation", "wait 节点应作为普通操作步骤导出");
  assert(steps[0].title === "进入 报表页 页面", "wait 节点必须生成可读标题");
  assert(steps[0].description === "报表页 页面加载完成。", "wait 节点说明不应包含具体等待秒数");
  assert(timeline.segments[0].caption === "报表页 页面加载完成。", "wait 视频字幕不应包含具体等待秒数");
});

runCheck("离线和预览 Markdown/Word 导出复用 ArticleStep 数据", () => {
  const viewerJs = readText("extension/viewer.js");
  const viewerArtifacts = readText("extension/viewer_artifacts.js");
  const generator = readText("tools/generate_artifacts.js");
  const markdown = readText("dist/article.md");
  const word = readText("dist/article.doc");
  assert(viewerJs.includes("const exportSteps = buildPrivacySafeArticleSteps(currentSteps, options)"), "viewer.js 必须从当前 ArticleStep 和隐私开关生成 Markdown 步骤");
  assert(viewerJs.includes("renderArticleMarkdown(currentState, currentTabs, exportSteps, options)"), "viewer.js 必须用隐私安全 ArticleStep 导出 Markdown");
  assert(viewerJs.includes("await renderArticleWordDocument(currentState, currentTabs, exportSteps, options)"), "viewer.js 必须等待隐私安全 ArticleStep 合成后再导出 Word");
  assert(viewerJs.includes(".docx"), "viewer.js 必须导出真正的 .docx 文件");
  assert(viewerJs.includes("downloadBlobFile(`${exportBaseName()}.docx`"), "viewer.js 必须以 Blob 下载 DOCX");
  assert(viewerArtifacts.includes("async function renderArticleWordDocument"), "预览页 Word 导出必须支持异步截图合成");
  assert(viewerArtifacts.includes("async function renderWordImage"), "预览页 Word 导出必须把截图和高亮合成为单张图片");
  assert(viewerArtifacts.includes("function buildDocxBlob"), "预览页 Word 导出必须生成 OpenXML DOCX 包");
  assert(viewerArtifacts.includes("[Content_Types].xml") && viewerArtifacts.includes("word/document.xml"), "预览页 Word 导出必须包含 DOCX 核心部件");
  assert(viewerArtifacts.includes("word/styles.xml") && viewerArtifacts.includes("word/settings.xml"), "预览页 Word 导出必须包含标准 styles/settings 部件，提升复制粘贴兼容性");
  assert(viewerArtifacts.includes("docProps/core.xml") && viewerArtifacts.includes("docProps/app.xml"), "预览页 Word 导出必须包含标准 docProps 部件");
  assert(viewerArtifacts.includes("drawingId") && viewerArtifacts.includes("<wp:cNvGraphicFramePr>"), "Word 图片 drawing 必须使用唯一 ID 和标准 graphic frame 属性");
  assert(!viewerArtifacts.includes("if (!box && !masks.length) return step.image"), "Word 导出必须把所有截图统一渲染为 PNG，避免复制后图片资源破损");
  assert(viewerArtifacts.includes("drawWordFocusOverlay"), "预览页 Word 导出必须把高亮和阴影画进图片");
  assert(viewerArtifacts.includes("canvas.toDataURL(\"image/png\")"), "预览页 Word 导出必须导出已渲染 PNG，避免 Word 丢失 CSS 叠层");
  assert(viewerArtifacts.includes("privacyMaskBoxes"), "预览 Markdown/Word 必须包含打码区域信息");
  assert(!viewerArtifacts.includes("点击坐标：x="), "预览 Markdown/Word 不应输出点击坐标元数据");
  assert(!viewerArtifacts.includes("高亮区域：x="), "预览 Markdown/Word 不应输出高亮区域元数据");
  assert(!generator.includes("点击坐标：x="), "离线 Markdown/Word 不应输出点击坐标元数据");
  assert(!generator.includes("高亮区域：x="), "离线 Markdown/Word 不应输出高亮区域元数据");
  assert(viewerArtifacts.includes("step.key") && viewerArtifacts.includes("按键"), "预览 HTML/Markdown/Word 必须包含键盘按键信息");
  assert(generator.includes("article.md"), "离线生成器必须输出 article.md");
  assert(generator.includes("article.doc"), "离线生成器必须输出 article.doc");
  assert(generator.includes("renderArticleMarkdown(recording, tabs, exportSteps)"), "离线 Markdown 必须复用隐私安全 ArticleStep");
  assert(generator.includes("renderArticleWordDocument(recording, tabs, exportSteps)"), "离线 Word 必须复用隐私安全 ArticleStep");
  assert(generator.includes("step.key") && generator.includes("segment.key") && generator.includes("按键"), "离线 HTML/Markdown/Word 和视频分镜必须包含键盘按键信息");
  assert(readText("tools/render_video.js").includes("renderKeyBadge"), "SVG 视频帧必须支持显示键盘按键信息");
  assert(markdown.includes("# rec_sample_zkbiotime"), "article.md 必须包含流程标题");
  assert(markdown.includes("## 涉及标签页"), "article.md 必须包含标签页摘要");
  assert(!markdown.includes("点击坐标：x="), "article.md 不应包含点击坐标元数据");
  assert(!markdown.includes("高亮区域：x="), "article.md 不应包含高亮区域元数据");
  assert(markdown.includes("打码区域"), "article.md 必须包含打码区域说明");
  assert(markdown.includes("操作步骤"), "article.md 必须按操作步骤导出");
  assert(markdown.includes("上传 Business License"), "article.md 必须包含文件上传步骤");
  assert(markdown.includes("填写 Support Contact"), "article.md 必须包含邻近文本识别出的步骤标题");
  assert(markdown.includes("填写 Legal Representative ID"), "article.md 必须包含身份证号步骤");
  assert(markdown.includes("填写 Billing Bank Card"), "article.md 必须包含银行卡号步骤");
  assert(word.includes("rec_sample_zkbiotime"), "article.doc 必须包含流程标题");
  assert(word.includes("操作步骤"), "article.doc 必须包含操作步骤标题");
  assert(!word.includes("点击坐标：x="), "article.doc 不应包含点击坐标元数据");
  assert(!word.includes("高亮区域：x="), "article.doc 不应包含高亮区域元数据");
  assert(word.includes("打码区域"), "article.doc 必须包含打码区域说明");
  assert(!word.includes("完整地址："), "article.doc 不应重复输出完整地址");
  assert(word.includes("上传 Business License"), "article.doc 必须包含文件上传步骤");
  assert(word.includes("填写 Support Contact"), "article.doc 必须包含邻近文本识别出的步骤标题");
  assert(word.includes("填写 Legal Representative ID"), "article.doc 必须包含身份证号步骤");
  assert(viewerArtifacts.includes("renderMaskBoxes"), "article.doc 有已打码截图时必须能渲染遮挡层");
});

runCheck("目标元素名称识别覆盖 title、id 和邻近文本", () => {
  const content = readText("extension/content.js");
  const background = readText("extension/background.js");
  const shared = readText("extension/shared/artifacts.js");
  const viewerJs = readText("extension/viewer.js");
  const validator = readText("tools/validate_schema.js");
  assert(content.includes("const title = element.getAttribute(\"title\")") && content.includes("title,"), "content.js 必须采集 title 属性");
  assert(content.includes("nearbyText: findNearbyText(element)"), "content.js 必须采集邻近文本");
  assert(content.includes("previousElementSibling"), "findNearbyText 必须检查前序邻近元素");
  assert(content.includes("nextElementSibling"), "findNearbyText 必须检查后序邻近元素");
  assert(content.includes("element.parentElement?.previousElementSibling"), "findNearbyText 必须检查父级邻近元素");
  assert(background.includes("payload.target?.title"), "background 默认说明必须使用 title");
  assert(background.includes("payload.target?.nearbyText"), "background 默认说明必须使用 nearbyText");
  assert(shared.includes("target.title"), "共享 ArticleStep 标题必须使用 title");
  assert(shared.includes("target.id"), "共享 ArticleStep 标题必须使用 id");
  assert(shared.includes("target.nearbyText"), "共享 ArticleStep 标题必须使用 nearbyText");
  assert(validator.includes("validateTarget"), "schema 必须校验 target 元数据");
  assert(validator.includes("\"nearbyText\""), "schema 必须覆盖 nearbyText 字段");
});

runCheck("目标元素会保存安全 DOM 属性摘要", () => {
  const content = readText("extension/content.js");
  const validator = readText("tools/validate_schema.js");
  const sample = readJson("examples/sample-recording.json");
  const clickNode = sample.nodes.find((node) => node.id === "node_001");
  const emailNode = sample.nodes.find((node) => node.id === "node_003");
  const linkNode = sample.nodes.find((node) => node.id === "node_005");
  const uploadNode = sample.nodes.find((node) => node.action === "upload");

  assert(content.includes("attributes: getElementAttributes(element)"), "content.js 必须采集 target.attributes");
  assert(content.includes("function getElementAttributes"), "content.js 必须实现安全属性摘要");
  assert(content.includes("function sanitizeUrlAttribute"), "content.js 必须实现 href 属性脱敏");
  assert(content.includes("sanitizeUrlAttribute(element.getAttribute(\"href\") || \"\")"), "target.attributes.href 必须写入脱敏后的 URL");
  assert(!content.includes("attributes.href = element.getAttribute(\"href\") || \"\""), "target.attributes.href 不得保留原始 href");
  assert(content.includes("inputType") && content.includes("required") && content.includes("disabled"), "target.attributes 必须覆盖输入类型和基础状态");
  assert(!content.includes("attributes.value"), "target.attributes 不得采集输入 value");
  assert(validator.includes("function validateTargetAttributes"), "validate_schema 必须校验 target.attributes");
  assert(validator.includes("function validateSafeHref"), "validate_schema 必须校验 target.attributes.href 安全格式");
  assert(validator.includes("不得包含 query 或 hash"), "validate_schema 必须拒绝 href query/hash");
  assert(validator.includes("只允许 http/https"), "validate_schema 必须拒绝非 http/https href 协议");
  assert(validator.includes("\"tagName\", \"role\", \"href\", \"target\", \"inputType\""), "validate_schema 必须限制字符串属性白名单");
  assert(validator.includes("\"required\", \"disabled\", \"checked\", \"multiple\""), "validate_schema 必须限制布尔属性白名单");
  assert(clickNode?.target?.attributes?.tagName === "button", "示例点击节点必须覆盖按钮 tagName");
  assert(linkNode?.target?.attributes?.href === "https://mail.example.com/activate", "示例链接 href 必须去掉 query/hash");
  assert(emailNode?.target?.attributes?.inputType === "email", "示例邮箱节点必须覆盖 inputType");
  assert(emailNode?.target?.attributes?.required === true, "示例邮箱节点必须覆盖 required 状态");
  assert(uploadNode?.target?.attributes?.inputType === "file", "示例上传节点必须覆盖 file inputType");
  assert(!JSON.stringify(sample.nodes).includes("\"attributes\":{\"value\""), "示例 target.attributes 不得包含 value");
});

runCheck("输入防抖会在提交和离页前刷新", () => {
  const content = readText("extension/content.js");
  assert(content.includes("var pendingInputTargets = new Set()"), "content.js must keep pending input targets");
  assert(content.includes("function scheduleInputEvent"), "content.js 必须封装输入防抖调度");
  assert(content.includes("function flushPendingInputs"), "content.js 必须提供批量刷新待发送输入");
  assert(content.includes("function flushPendingInput"), "content.js 必须提供单个输入刷新逻辑");
  const clickFlushIndex = content.indexOf("flushPendingInputs();");
  const clickActionIndex = content.indexOf("action: \"click\"");
  const submitActionIndex = content.indexOf("action: \"submit\"");
  const submitFlushIndex = content.indexOf("flushPendingInputs();", clickFlushIndex + 1);
  assert(clickFlushIndex !== -1 && clickActionIndex !== -1 && clickFlushIndex < clickActionIndex, "click 前必须刷新待发送输入");
  assert(submitFlushIndex !== -1 && submitActionIndex !== -1 && submitFlushIndex < submitActionIndex, "submit 前必须刷新待发送输入");
  assert(content.includes("pagehide") && content.includes("beforeunload"), "离页前必须刷新待发送输入");
  assert(content.includes("document.visibilityState === \"hidden\""), "页面隐藏前必须刷新待发送输入");
  assert(content.includes("inputTimers.delete(target)"), "刷新后必须清理输入防抖计时器");
});

runCheck("点击目标会归一到可操作元素并覆盖单选和表格单元格", () => {
  const content = readText("extension/content.js");
  const shared = readText("extension/shared/artifacts.js");
  const dataModel = readText("DATA_MODEL.md");
  const testing = readText("TESTING.md");
  const readme = readText("README.md");
  const company = readText("test-pages/company.html");
  assert(content.includes("function resolveActionTarget"), "content.js 必须实现点击目标归一");
  assert(content.includes("resolveActionTarget(event.target, clickPoint)"), "click 事件必须按点击坐标先归一目标元素");
  assert(content.includes("function findPreferredActionTarget"), "click target normalization must prioritize the real actionable element");
  assert(content.includes("\"button\",") && content.includes("\"[tabindex]\""), "click target normalization must prefer buttons before generic tabindex wrappers");
  assert(content.includes("function expandActionContainer"), "button clicks on inner icons/text must expand to the visible action wrapper");
  assert(content.includes("function findButtonLikeAncestor"), "button clicks on inner p/span/svg/path must resolve to the outer button root");
  assert(content.includes("function isButtonRootCandidate"), "button root detection must cover UI-library button classes");
  assert(content.includes("element.matches(\"button, [role='button'], [datatype='action'], .MuiButton-root, .MuiButtonBase-root, .MuiIconButton-root"), "button root detection must cover MUI and business action buttons");
  assert(content.includes("function findIconActionAncestor"), "icon clicks must resolve to the outer clickable parent");
  assert(content.includes("[\"svg\", \"path\", \"use\", \"i\"].includes(tag)"), "icon click normalization must explicitly cover svg/path/i targets");
  assert(content.includes("box.width > Math.max(180, iconBox.width + 140)"), "icon parent expansion must stay tightly scoped");
  assert(content.includes("const actionTarget = resolveActionTarget(target, clickPoint) || target"), "sendClickEvent must normalize again before extracting the target box");
  assert(content.includes("element = findButtonLikeAncestor(element) || element"), "extractTarget must not persist inner text/icon boxes for button clicks");
  assert(content.includes("wrapperBox.width > innerBox.width + 90"), "button wrapper expansion must stay tightly scoped");
  assert(content.includes("looksLikeTightTextButton"), "icon clicks inside text buttons must expand to the full button label");
  assert(content.includes("findCheckableAtPoint"), "checkbox/radio 点击必须优先按点击坐标定位真实控件");
  assert(content.includes("isCheckboxLikeElement"), "checkbox/radio 点击必须覆盖常见 UI 库的 checkbox-like 元素");
  assert(content.includes("function isSwitchLikeElement"), "switch/toggle tracks must be recognized as checkable controls");
  assert(content.includes("box.width > 72") && content.includes("role === \"switch\""), "switch detection must allow wider toggle tracks and role=switch");
  assert(content.includes("function findCompactCheckableOwner"), "checkbox/radio detection must look for inputs inside compact checkbox wrappers");
  assert(content.includes("ownedInput = compactOwner.querySelector"), "checkbox/radio detection must capture hidden native inputs inside compact wrappers");
  assert(content.includes("ant-checkbox") && content.includes("el-checkbox") && content.includes("mat-checkbox"), "checkbox-like 识别必须覆盖常见组件库类名");
  assert(content.includes("isCompactCheckableBox") && content.includes("box.width <= 48 && box.height <= 48"), "checkbox-like 识别必须限制为小尺寸控件，避免框整列");
  assert(content.includes(".sort((a, b) => a.area - b.area)"), "checkbox-like 点击坐标命中时必须优先返回最小候选控件");
  assert(content.includes("isCheckableTarget(element) ? \"\" : visibleText.slice(0, 120)"), "checkbox/radio 目标不应把整行文本作为标题来源");
  assert(content.includes("ACTION_TARGET_SELECTOR"), "content.js 必须集中维护可操作点击目标选择器");
  assert(content.includes("[onclick]"), "点击目标归一必须覆盖 onclick 自定义控件");
  assert(content.includes("[tabindex]"), "点击目标归一必须覆盖 tabindex 自定义控件");
  assert(content.includes("[role='menuitem']"), "点击目标归一必须覆盖菜单项");
  assert(content.includes("td") && content.includes("th"), "点击目标归一必须覆盖表格单元格");
  assert(content.includes("findPointerCursorTarget"), "点击目标归一必须覆盖 pointer 光标自定义控件");
  assert(content.includes("return null;") && !content.includes(")) || target;"), "点击目标归一不能把空白区域 fallback 成普通容器");
  assert(content.includes("role === \"cell\"") && content.includes("role === \"gridcell\""), "inferTargetType 必须识别 ARIA 表格单元格");
  assert(content.includes("role === \"row\""), "inferTargetType 必须识别表格行");
  assert(content.includes("if (type === \"radio\") return \"radio\""), "inferTargetType 必须识别单选按钮");
  assert(shared.includes("target.type"), "共享标题生成必须能回退到 target.type");
  assert(dataModel.includes("table_cell") && dataModel.includes("table_row") && dataModel.includes("radio"), "DATA_MODEL.md 必须说明表格和单选 target.type");
  assert(dataModel.includes("可操作祖先元素"), "DATA_MODEL.md 必须说明点击目标归一");
  assert(dataModel.includes("无业务意义点击不应生成节点"), "DATA_MODEL.md 必须说明空白区域点击过滤");
  assert(testing.includes("target.type` 应为 `radio`"), "TESTING.md 必须覆盖单选按钮采集");
  assert(testing.includes("target.type` 应为 `table_cell`"), "TESTING.md 必须覆盖表格单元格采集");
  assert(testing.includes("空白区域点击是否被过滤"), "TESTING.md 必须覆盖空白区域点击过滤");
  assert(readme.includes("表格单元格"), "README.md 必须说明表格单元格录制能力");
  assert(readme.includes("空白区域"), "README.md 必须说明空白区域点击过滤");
  assert(company.includes("type=\"radio\""), "公司测试页必须覆盖单选按钮");
  assert(company.includes("<td id=\"recentCompanyCell\""), "公司测试页必须覆盖可点击表格单元格");
  assert(company.includes("id=\"customAction\"") && company.includes("tabindex=\"0\""), "公司测试页必须覆盖自定义可点击控件");

  const { buildArticleSteps, buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([
    {
      id: "node_table_cell",
      sequence: 1,
      action: "click",
      tab: { tabId: 1, tabAlias: "标签页 A：公司页", domain: "example.com" },
      target: {
        type: "table_cell",
        text: "Acme Singapore",
        selector: "#recentCompanyCell",
        boundingBox: { x: 80, y: 540, width: 220, height: 42, coordinateSpace: "viewport-css-pixel" }
      },
      generatedInstruction: "点击Acme Singapore。",
      status: "auto_generated"
    },
    {
      id: "node_radio",
      sequence: 2,
      action: "check",
      tab: { tabId: 1, tabAlias: "标签页 A：公司页", domain: "example.com" },
      target: {
        type: "radio",
        labelText: "Branch Office",
        selector: "input[name=companyType]",
        boundingBox: { x: 80, y: 300, width: 18, height: 18, coordinateSpace: "viewport-css-pixel" }
      },
      generatedInstruction: "勾选Branch Office。",
      status: "auto_generated"
    }
  ]);
  const timeline = buildVideoTimeline(steps);
  assert(steps[0].title === "点击 Acme Singapore", "ArticleStep 必须为表格单元格生成可读标题");
  assert(steps[0].focusBox.width === 220, "表格单元格高亮必须使用单元格 bounding box");
  assert(steps[1].title === "勾选 Branch Office", "ArticleStep 必须为单选按钮生成可读标题");
  assert(timeline.segments[0].highlight.width === 220, "VideoTimeline 必须保留表格单元格高亮区域");
  assert(timeline.segments[1].caption === "勾选Branch Office。", "VideoTimeline 必须复用单选按钮说明");

  const checkboxSteps = buildArticleSteps([{
    id: "node_checkbox",
    sequence: 3,
    action: "check",
    checked: true,
    tab: { tabId: 1, tabAlias: "标签页 A：订单", domain: "example.com" },
    target: {
      type: "checkbox",
      text: "",
      selector: "input[type=checkbox]",
      boundingBox: { x: 214, y: 185, width: 16, height: 16, coordinateSpace: "viewport-css-pixel" }
    },
    generatedInstruction: "勾选多选框。",
    status: "auto_generated"
  }]);
  assert(checkboxSteps[0].title === "勾选 多选框", "无 label 多选框标题必须保持简洁");
  assert(!checkboxSteps[0].title.includes("订单号码"), "多选框标题不得包含整行表格内容");
  assert(content.includes("isSmallCheckableVisual"), "checkbox-like 识别必须覆盖无明确 role/class 的小方框视觉元素");
});

runCheck("自动高亮会使用用户选择的目标元素 boundingBox", () => {
  const shared = readText("extension/shared/artifacts.js");
  const viewerJs = readText("extension/viewer.js");
  assert(shared.includes("return normalizeBox(node.target?.boundingBox)"), "共享 artifact 自动高亮必须使用目标元素 boundingBox");
  assert(viewerJs.includes("return node.target?.boundingBox || null"), "预览页自动高亮必须使用目标元素 boundingBox");
  assert(!shared.includes("function focusBoxFromClickPoint"), "共享 artifact 不应再按点击坐标裁切高亮框");
  assert(!viewerJs.includes("function focusBoxFromClickPoint"), "预览页不应再按点击坐标裁切高亮框");

  const { buildArticleSteps, buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([{
    id: "node_search",
    sequence: 1,
    action: "click",
    tab: { tabId: 1, tabAlias: "标签页 A：订单", domain: "example.com" },
    target: {
      type: "input",
      placeholder: "搜索方式",
      boundingBox: { x: 120, y: 64, width: 720, height: 36, coordinateSpace: "viewport-css-pixel" }
    },
    clickPoint: { x: 620, y: 82, coordinateSpace: "viewport-css-pixel" },
    viewport: { width: 1280, height: 720 },
    generatedInstruction: "点击搜索方式。",
    status: "auto_generated"
  }]);
  const timeline = buildVideoTimeline(steps);
  assert(steps[0].focusBox.x === 120 && steps[0].focusBox.width === 720, "长输入框 focusBox 必须完整使用目标元素 boundingBox");
  assert(steps[0].focusBox.y === 64 && steps[0].focusBox.height === 36, "长输入框 focusBox 位置必须来自目标元素 boundingBox");
  assert(timeline.segments[0].highlight.width === 720, "VideoTimeline 必须复用目标元素 boundingBox");

  const smallControlSteps = buildArticleSteps([{
    id: "node_checkbox_focus",
    sequence: 2,
    action: "check",
    tab: { tabId: 1, tabAlias: "标签页 A：订单", domain: "example.com" },
    target: {
      type: "checkbox",
      boundingBox: { x: 214, y: 185, width: 16, height: 16, coordinateSpace: "viewport-css-pixel" }
    },
    clickPoint: { x: 222, y: 193, coordinateSpace: "viewport-css-pixel" },
    viewport: { width: 1280, height: 720 },
    generatedInstruction: "勾选多选框。",
    status: "auto_generated"
  }]);
  assert(smallControlSteps[0].focusBox.width === 16 && smallControlSteps[0].focusBox.height === 16, "小控件 focusBox 必须只框点击元素本身");
});

runCheck("不可见目标不会生成坏步骤或坏高亮", () => {
  const content = readText("extension/content.js");
  const background = readText("extension/background.js");
  const shared = readText("extension/shared/artifacts.js");
  const viewerJs = readText("extension/viewer.js");
  const validator = readText("tools/validate_schema.js");
  assert(content.includes("getTargetVisibility"), "content.js 必须采集目标可见性");
  assert(content.includes("canHighlight: visible"), "content.js 必须标记可高亮目标");
  assert(content.includes("outside_viewport"), "content.js 必须标记视口外目标");
  assert(background.includes("isVisibleTarget(payload)"), "background 必须过滤不可见目标");
  assert(background.includes("payload.target.visibility.visible"), "background 必须使用 visibility.visible 判断");
  assert(shared.includes("node.target?.visibility?.canHighlight === false"), "共享构建必须避免不可高亮目标生成 focusBox");
  assert(viewerJs.includes("node.target?.visibility?.canHighlight === false"), "预览页必须避免不可高亮目标生成 focusBox");
  assert(shared.includes("function normalizeBox"), "共享构建必须规范化 focusBox");
  assert(validator.includes("validateVisibility"), "schema 必须校验 target.visibility");

  const { buildArticleSteps } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([
    {
      id: "node_hidden",
      sequence: 1,
      action: "click",
      tab: { tabId: 1, tabAlias: "标签页 A：测试页", domain: "example.com" },
      target: {
        type: "button",
        text: "隐藏按钮",
        boundingBox: { x: 0, y: 0, width: 0, height: 0 },
        visibility: { visible: false, inViewport: true, hasBox: false, canHighlight: false, reason: "empty_box" }
      },
      generatedInstruction: "点击隐藏按钮。",
      status: "auto_generated"
    }
  ]);
  assert(steps[0].focusBox === null, "不可高亮目标不应进入 ArticleStep focusBox");
  assert(steps[0].focusMode === "none", "不可高亮目标 focusMode 必须为 none");
});

runCheck("操作节点会保存视口、滚动偏移和设备像素比", () => {
  const content = readText("extension/content.js");
  const background = readText("extension/background.js");
  const validator = readText("tools/validate_schema.js");
  const sample = readJson("examples/sample-recording.json");
  const clickNode = sample.nodes.find((node) => node.id === "node_001");
  const navigationNode = sample.nodes.find((node) => node.action === "navigation");

  assert(content.includes("scrollX: Math.round(window.scrollX"), "content.js 必须采集水平滚动偏移");
  assert(content.includes("scrollY: Math.round(window.scrollY"), "content.js 必须采集垂直滚动偏移");
  assert(content.includes("devicePixelRatio: window.devicePixelRatio || 1"), "content.js 必须采集 devicePixelRatio");
  assert(content.includes("function getClickPoint") && content.includes("clickPoint,"), "content.js 必须采集点击坐标 clickPoint");
  assert(background.includes("viewport: payload.viewport"), "background 必须把事件 viewport 保存到操作节点");
  assert(background.includes("clickPoint: payload.clickPoint"), "background 必须把 clickPoint 保存到操作节点");
  assert(background.includes("scrollX: viewport?.scrollX || 0"), "background 必须把 scrollX 写入截图元数据");
  assert(background.includes("scrollY: viewport?.scrollY || 0"), "background 必须把 scrollY 写入截图元数据");
  assert(validator.includes("function validateViewport"), "validate_schema 必须校验 viewport");
  assert(validator.includes("function validatePoint"), "validate_schema 必须校验 clickPoint");
  assert(validator.includes("\"devicePixelRatio\", \"scrollX\", \"scrollY\""), "validate_schema 必须校验滚动和设备像素比字段");
  assert(clickNode?.viewport?.scrollY === 240, "示例点击节点必须覆盖非零 scrollY");
  assert(clickNode?.viewport?.devicePixelRatio === 1, "示例点击节点必须覆盖 devicePixelRatio");
  assert(clickNode?.clickPoint?.x === 940 && clickNode?.clickPoint?.y === 542, "示例点击节点必须覆盖点击坐标");
  assert(clickNode?.clickPoint?.coordinateSpace === "viewport-css-pixel", "示例点击坐标必须使用 viewport-css-pixel");
  assert(navigationNode?.screenshot?.scrollX === 0, "示例 navigation 截图必须覆盖 scrollX");
  assert(navigationNode?.screenshot?.scrollY === 0, "示例 navigation 截图必须覆盖 scrollY");
});

runCheck("截图元数据会标记捕获时机", () => {
  const content = readText("extension/content.js");
  const background = readText("extension/background.js");
  const validator = readText("tools/validate_schema.js");
  const dataModel = readText("DATA_MODEL.md");
  const readme = readText("README.md");
  const testing = readText("TESTING.md");
  const sample = readJson("examples/sample-recording.json");
  const clickNode = sample.nodes.find((node) => node.action === "click" && node.screenshot);
  const inputNode = sample.nodes.find((node) => node.action === "input" && node.screenshot);
  const navigationNode = sample.nodes.find((node) => node.action === "navigation" && node.screenshot);
  assert(background.includes("getScreenshotCaptureTiming(payload.action)"), "background 必须按动作决定截图捕获时机");
  assert(background.includes("captureTiming,"), "background 必须把 captureTiming 写入截图记录和节点元数据");
  assert(background.includes("before_action_preferred"), "background 必须支持点击前优先截图标记");
  assert(content.includes("sendClickEvent(target, clickPoint, { preAction: true })"), "content.js 必须在 pointerdown 阶段发送点击前截图事件");
  assert(content.includes("[\"button\", \"link\", \"menuitem\", \"table_cell\", \"table_row\"].includes(type)"), "点击前截图必须覆盖按钮、链接、菜单和表格点击");
  assert(background.includes("if ([\"check\", \"submit\"].includes(action)) return \"before_action_preferred\""), "check/submit 必须优先保留动作前截图");
  assert(background.includes("shouldSkipSubmitAfterPreActionClick"), "preAction 点击后必须跳过冗余 submit 步骤");
  assert(background.includes("after_navigation"), "background 必须支持跳转后截图标记");
  assert(validator.includes("screenshot.captureTiming"), "validate_schema 必须校验 screenshot.captureTiming");
  assert(validator.includes("before_action_preferred") && validator.includes("after_wait"), "validate_schema 必须校验 captureTiming 枚举");
  assert(dataModel.includes("screenshot.captureTiming"), "DATA_MODEL.md 必须说明截图捕获时机");
  assert(readme.includes("captureTiming"), "README.md 必须说明截图捕获时机");
  assert(testing.includes("captureTiming"), "TESTING.md 必须覆盖截图捕获时机");
  assert(clickNode?.screenshot?.captureTiming === "before_action_preferred", "示例点击截图必须标记 before_action_preferred");
  assert(inputNode?.screenshot?.captureTiming === "after_action", "示例输入截图必须标记 after_action");
  assert(navigationNode?.screenshot?.captureTiming === "after_navigation", "示例跳转截图必须标记 after_navigation");
  assert(validator.includes("node.preAction"), "validate_schema 必须校验 preAction 字段");
});

runCheck("同域页面变化会合并进触发操作，跨域变化才保留独立步骤", () => {
  const { buildArticleSteps, buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([
    {
      id: "node_click_same_origin",
      sequence: 1,
      action: "click",
      tab: { tabId: 1, tabAlias: "标签页 A：登录页", url: "https://example.com/login" },
      target: { type: "button", text: "注册" },
      generatedInstruction: "点击注册。",
      status: "auto_generated"
    },
    {
      id: "node_navigation_same_origin",
      sequence: 2,
      action: "navigation",
      fromTab: { tabId: 1, tabAlias: "标签页 A：登录页", url: "https://example.com/login" },
      toTab: { tabId: 1, tabAlias: "标签页 A：注册页", url: "https://example.com/register", title: "注册页" },
      triggeredByNodeId: "node_click_same_origin",
      pageUrl: "https://example.com/register",
      pageTitle: "注册页",
      generatedInstruction: "页面跳转到注册页。",
      status: "auto_generated"
    },
    {
      id: "node_navigation_cross_origin",
      sequence: 3,
      action: "navigation",
      fromTab: { tabId: 1, tabAlias: "标签页 A：注册页", url: "https://example.com/register" },
      toTab: { tabId: 1, tabAlias: "标签页 A：支付页", url: "https://pay.example.net/checkout", title: "支付页" },
      triggeredByNodeId: "node_click_same_origin",
      pageUrl: "https://pay.example.net/checkout",
      pageTitle: "支付页",
      generatedInstruction: "页面跳转到支付页。",
      status: "auto_generated"
    }
  ]);
  const timeline = buildVideoTimeline(steps);
  assert(steps.length === 2, "同域 navigation 不应成为独立 ArticleStep，跨域 navigation 应保留");
  assert(steps[0].type === "operation", "触发点击应保留为操作步骤");
  assert(steps[0].title.includes("进入注册页页面"), "触发点击标题必须说明进入目标页面");
  assert(steps[1].type === "navigation", "跨域 navigation 必须保留为独立步骤");
  assert(steps[1].title === "进入支付页", "navigation 默认标题必须使用进入目标页面文案");
  assert(timeline.segments.some((segment) => segment.type === "navigation"), "VideoTimeline 必须保留跨域 navigation 类型");
});

runCheck("缺少触发 ID 的同域导航会向前折叠到点击步骤", () => {
  const { buildArticleSteps } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([
    {
      id: "node_click_gps",
      sequence: 1,
      action: "click",
      capturedAt: "2026-07-27T10:08:07.436Z",
      tab: { tabId: 1, tabAlias: "标签页 A：ZKBio TimeCloud", domain: "biotimecloud.info", title: "ZKBio TimeCloud", url: "https://biotimecloud.info/company/area" },
      target: { type: "link", text: "GPS", boundingBox: { x: 10, y: 10, width: 60, height: 30 } },
      generatedInstruction: "点击GPS。",
      status: "auto_generated"
    },
    {
      id: "node_navigation_without_trigger",
      sequence: 2,
      action: "navigation",
      capturedAt: "2026-07-27T10:08:07.440Z",
      fromTab: { tabId: 1, url: "https://biotimecloud.info/gps", domain: "biotimecloud.info", title: "ZKBio TimeCloud" },
      pageTitle: "ZKBio TimeCloud",
      pageUrl: "https://biotimecloud.info/gps/accounts",
      generatedInstruction: "页面跳转到：ZKBio TimeCloud",
      status: "auto_generated"
    }
  ]);
  assert(steps.length === 1, "缺少 triggeredByNodeId 的同域 navigation 不应成为独立步骤");
  assert(steps[0].title.includes("GPS"), "同域 navigation 应合并回前一个点击目标");
});

runCheck("文件上传控件会生成 upload 节点并脱敏文件名", () => {
  const content = readText("extension/content.js");
  const background = readText("extension/background.js");
  const shared = readText("extension/shared/artifacts.js");
  assert(content.includes("target.type === \"file\""), "content.js 必须监听 file input change");
  assert(content.includes("sendInputLikeEvent(target, \"upload\")"), "content.js 必须发送 upload 事件");
  assert(content.includes("getFileUploadSummary"), "content.js 必须生成上传文件摘要");
  assert(content.includes("maskFileName"), "content.js 必须脱敏文件名");
  assert(background.includes("payload.action === \"upload\""), "background 必须生成 upload 默认说明");
  assert(shared.includes("node.action === \"upload\""), "共享 artifact 必须生成 upload 默认标题");

  const { buildArticleSteps, buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([
    {
      id: "node_upload",
      sequence: 1,
      action: "upload",
      tab: { tabId: 1, tabAlias: "标签页 A：公司页", domain: "example.com" },
      target: { type: "upload", labelText: "Business License", boundingBox: { x: 10, y: 20, width: 180, height: 36 } },
      value: "已选择文件：b***.pdf",
      generatedInstruction: "在 Business License 中上传文件。",
      status: "auto_generated"
    }
  ]);
  const timeline = buildVideoTimeline(steps);
  assert(steps[0].title === "上传 Business License", "ArticleStep 必须生成 upload 标题");
  assert(timeline.segments[0].caption === "在 Business License 中上传文件。", "VideoTimeline 必须复用 upload 说明");
});

runCheck("页面弹窗出现和关闭会生成可导出的操作节点", () => {
  const content = readText("extension/content.js");
  const background = readText("extension/background.js");
  const shared = readText("extension/shared/artifacts.js");
  const viewerJs = readText("extension/viewer.js");
  const company = readText("test-pages/company.html");
  assert(content.includes("new MutationObserver"), "content.js 必须监听 DOM 变化识别弹窗");
  assert(content.includes("getVisibleModalElements"), "content.js 必须筛选可见弹窗元素");
  assert(content.includes("sendModalEvent(\"modal_open\""), "content.js 必须发送 modal_open 事件");
  assert(content.includes("sendModalEvent(\"modal_close\""), "content.js 必须发送 modal_close 事件");
  assert(content.includes("dialog[open]"), "content.js 必须支持原生 dialog");
  assert(background.includes("\"modal_open\""), "background 必须放行 modal_open 事件");
  assert(background.includes("\"modal_close\""), "background 必须放行 modal_close 事件");
  assert(content.includes("return \"\\u5f39\\u7a97\";"), "content.js 弹窗缺少标题时不应回退整段弹窗内容");
  assert(background.includes("return \"\\u5f39\\u7a97\";"), "background 弹窗标题缺失时不应回退整段弹窗内容");
  assert(shared.includes("return \"\\u5f39\\u7a97\";"), "共享导出弹窗标题缺失时不应回退整段弹窗内容");
  assert(background.includes("页面出现弹窗"), "background 必须生成弹窗出现说明");
  assert(background.includes("关闭弹窗"), "background 必须生成弹窗关闭说明");
  assert(shared.includes("node.action === \"modal_open\""), "共享 artifact 必须生成弹窗出现标题");
  assert(shared.includes("node.action === \"modal_close\""), "共享 artifact 必须保留弹窗关闭标题兼容");
  assert(shared.includes("if (node.action === \"modal_close\") return;"), "modal_close 不应进入最终文章和视频片段");
  assert(shared.includes("if (node.action === \"modal_close\") return null;"), "modal_close 不应生成弹窗原位置高亮");
  assert(viewerJs.includes("if (node.action === \"modal_close\") return null;"), "预览页 modal_close 不应框出弹窗原位置");
  assert(viewerJs.includes("弹窗出现") || viewerJs.includes("\\u5f39\\u7a97\\u51fa\\u73b0"), "viewer.js 必须显示可读弹窗步骤类型");
  assert(company.includes("<dialog"), "公司测试页必须覆盖原生弹窗");
  assert(company.includes("showModal()"), "公司测试页必须能打开弹窗");
  assert(company.includes(".close()"), "公司测试页必须能关闭弹窗");

  const { buildArticleSteps, buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([
    {
      id: "node_modal_open",
      sequence: 1,
      action: "modal_open",
      tab: { tabId: 1, tabAlias: "标签页 A：公司页", domain: "example.com" },
      target: {
        type: "dialog",
        ariaLabel: "Company Review",
        text: "Company Review Confirm the company profile before submitting.",
        selector: "#reviewDialog",
        boundingBox: { x: 420, y: 180, width: 420, height: 220, coordinateSpace: "viewport-css-pixel" }
      },
      generatedInstruction: "页面出现弹窗：Company Review。",
      status: "auto_generated"
    },
    {
      id: "node_modal_close",
      sequence: 2,
      action: "modal_close",
      tab: { tabId: 1, tabAlias: "标签页 A：公司页", domain: "example.com" },
      target: {
        type: "dialog",
        ariaLabel: "Company Review",
        text: "Company Review Confirm the company profile before submitting.",
        selector: "#reviewDialog",
        boundingBox: { x: 420, y: 180, width: 420, height: 220, coordinateSpace: "viewport-css-pixel" }
      },
      generatedInstruction: "关闭弹窗：Company Review。",
      status: "auto_generated"
    }
  ]);
  const timeline = buildVideoTimeline(steps);
  assert(steps[0].title === "弹窗出现：Company Review", "ArticleStep 弹窗标题必须只保留弹窗标题");
  assert(steps[0].focusMode === "highlight", "弹窗出现步骤应可高亮弹窗区域");
  assert(steps.length === 1, "ArticleStep 不应导出 modal_close 空截图步骤");
  assert(timeline.segments.length === 1, "VideoTimeline 不应包含 modal_close 空截图片段");
  assert(timeline.segments[0].caption === "页面出现弹窗：Company Review。", "VideoTimeline 必须复用弹窗标题说明");
});

runCheck("同一输入框连续输入会合并为一个节点", () => {
  const background = readText("extension/background.js");
  const dataModel = readText("DATA_MODEL.md");
  const testing = readText("TESTING.md");
  assert(background.includes("findMergeableInputNode"), "background 必须查找可合并的连续输入节点");
  assert(background.includes("payload.action !== \"input\""), "连续输入合并只能作用于 input");
  assert(background.includes("last.target?.selector !== selector"), "连续输入合并必须要求同一 selector");
  assert(background.includes("last.tab?.tabId !== context.tabId"), "连续输入合并必须要求同一标签页");
  assert(background.includes("> 5000"), "连续输入合并必须有时间窗口");
  assert(background.includes("mergedEventCount"), "连续输入合并必须记录合并次数");
  assert(background.includes("await deleteScreenshotRecords([previousScreenshotId])"), "连续输入合并必须清理旧截图");
  assert(background.includes("return { ok: true, nodeId: mergeTarget.id, merged: true"), "连续输入合并响应必须标记 merged");
  assert(dataModel.includes("mergedEventCount"), "DATA_MODEL.md 必须说明连续输入合并计数");
  assert(testing.includes("连续输入"), "TESTING.md 必须覆盖连续输入合并");
});

runCheck("同一目标快速重复点击会合并为最后一次点击节点", () => {
  const background = readText("extension/background.js");
  const dataModel = readText("DATA_MODEL.md");
  const testing = readText("TESTING.md");
  assert(background.includes("findMergeableClickNode"), "background 必须查找可合并的重复点击节点");
  assert(background.includes("payload.action !== \"click\""), "重复点击合并只能作用于 click");
  assert(background.includes("last.target?.selector !== selector"), "重复点击合并必须要求同一 selector");
  assert(background.includes("last.tab?.tabId !== context.tabId"), "重复点击合并必须要求同一标签页");
  assert(background.includes("> 1000"), "重复点击合并必须有短时间窗口");
  assert(background.includes("mergeOperationNode(duplicateClickTarget"), "重复点击必须复用节点合并更新逻辑");
  assert(background.includes("mergedClickCount"), "重复点击合并必须记录合并次数");
  assert(background.includes("deleteScreenshotRecords([previousScreenshotId])"), "重复点击合并必须清理旧截图");
  assert(background.includes("duplicate: true"), "重复点击合并响应必须标记 duplicate");
  assert(!background.includes("function isDuplicate"), "background 不应保留只跳过后续点击的旧 duplicate 逻辑");
  assert(dataModel.includes("mergedClickCount"), "DATA_MODEL.md 必须说明重复点击合并计数");
  assert(testing.includes("快速重复点击"), "TESTING.md 必须覆盖重复点击合并");
});

runCheck("扩展预览页支持删除和恢复步骤状态", () => {
  const viewerJs = readText("extension/viewer.js");
  const viewerCss = readText("extension/viewer.css");
  assert(viewerJs.includes("recorder:set-node-status"), "viewer.js 必须调用节点状态更新接口");
  assert(viewerJs.includes("isDiscarded ? \"auto_generated\" : \"discarded\""), "viewer.js 必须提供删除和恢复步骤入口");
  assert(viewerCss.includes(".step.discarded"), "viewer.css 必须提供已删除步骤样式");
});

runCheck("扩展预览页支持编辑步骤标题和说明", () => {
  const background = readText("extension/background.js");
  const viewerJs = readText("extension/viewer.js");
  const viewerCss = readText("extension/viewer.css");
  assert(background.includes("recorder:update-node-text"), "background 必须提供节点文案更新接口");
  assert(background.includes("titleOverride"), "background 必须持久化人工标题");
  assert(background.includes("descriptionOverride"), "background 必须持久化人工说明");
  assert(background.includes("delete node.titleOverride"), "background 必须支持恢复自动标题");
  assert(background.includes("delete node.descriptionOverride"), "background 必须支持恢复自动说明");
  assert(viewerJs.includes("data-node-title"), "viewer.js 必须渲染标题编辑控件");
  assert(viewerJs.includes("data-node-description"), "viewer.js 必须渲染说明编辑控件");
  assert(viewerJs.includes("data-node-action=\"save-text\""), "viewer.js 必须提供保存文案入口");
  assert(viewerJs.includes("data-node-action=\"clear-text\""), "viewer.js 必须提供恢复自动文案入口");
  assert(viewerJs.includes("!node.titleOverride && !node.descriptionOverride"), "viewer.js 必须只在存在人工文案时启用恢复自动");
  assert(viewerCss.includes(".step-editor"), "viewer.css 必须提供步骤编辑区样式");
  assert(viewerCss.includes("flex-wrap: wrap"), "viewer.css 必须允许文案编辑按钮换行");

  const { buildArticleSteps } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([
    {
      id: "node_auto_text",
      sequence: 1,
      action: "click",
      target: { type: "button", text: "提交" },
      generatedInstruction: "点击提交按钮。",
      status: "reviewed"
    }
  ]);
  assert(steps[0].title === "点击 提交", "恢复自动后 ArticleStep 必须回到自动标题");
  assert(steps[0].description === "点击提交按钮。", "恢复自动后 ArticleStep 必须回到自动说明");
});

runCheck("扩展预览页支持手动调整高亮区域", () => {
  const background = readText("extension/background.js");
  const shared = readText("extension/shared/artifacts.js");
  const viewerJs = readText("extension/viewer.js");
  const viewerCss = readText("extension/viewer.css");
  const artifactsJs = readText("extension/viewer_artifacts.js");
  assert(background.includes("recorder:update-node-focus"), "background 必须提供焦点框更新接口");
  assert(background.includes("focusBoxOverride"), "background 必须持久化人工高亮区域");
  assert(background.includes("delete node.focusBoxOverride"), "background 必须支持恢复自动高亮区域");
  assert(background.includes("normalizeFocusBox"), "background 必须校验焦点框数值");
  assert(viewerJs.includes("data-node-action=\"save-focus\""), "viewer.js 必须提供保存高亮入口");
  assert(viewerJs.includes("data-node-action=\"clear-focus\""), "viewer.js 必须提供恢复自动高亮入口");
  assert(viewerJs.includes("!node.focusBoxOverride"), "viewer.js 必须只在存在人工高亮时启用恢复自动");
  assert(viewerJs.includes("data-focus-x"), "viewer.js 必须渲染高亮区域编辑控件");
  assert(viewerCss.includes(".focus-editor"), "viewer.css 必须提供高亮编辑区样式");
  assert(artifactsJs.includes("renderFocusBox"), "viewer_artifacts.js 必须用可复用函数渲染导出高亮框");
  assert(artifactsJs.includes("renderFocusZoom"), "viewer_artifacts.js 必须用 focusBox 渲染局部放大预览");
  assert(artifactsJs.includes("focus-zoom"), "viewer_artifacts.js 必须提供局部放大预览样式");
  const generator = readText("tools/generate_artifacts.js");
  assert(generator.includes("renderFocusZoom"), "离线文章生成器必须渲染局部放大预览");
  assert(artifactsJs.includes("function focusZoomLayout"), "导出文章局部放大框必须按高亮位置布局");
  assert(!artifactsJs.includes("right:16px; bottom:16px"), "导出文章局部放大框不能固定在右下角");
  assert(!artifactsJs.includes(".focus-zoom { display:none; }"), "Word 导出不能隐藏局部放大预览");
  assert(!generator.includes(".focus-zoom { display:none; }"), "离线 Word 导出不能隐藏局部放大预览");
  assert(artifactsJs.includes("widthPercent") && generator.includes("widthPercent"), "局部放大预览尺寸必须随截图响应式缩放");
  assert(artifactsJs.includes("/ viewportWidth * 100"), "导出文章高亮框必须随截图响应式缩放");

  const { buildArticleSteps } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([
    {
      id: "node_focus_priority",
      sequence: 1,
      action: "click",
      target: { type: "button", text: "按钮", boundingBox: { x: 1, y: 2, width: 30, height: 20 } },
      focusBoxOverride: { x: 50, y: 60, width: 70, height: 40 },
      generatedInstruction: "点击按钮。",
      status: "reviewed"
    }
  ]);
  assert(steps[0].focusBox.x === 50, "共享 artifact 必须优先使用人工高亮区域");

  const automaticSteps = buildArticleSteps([
    {
      id: "node_focus_auto",
      sequence: 1,
      action: "click",
      target: { type: "button", text: "按钮", boundingBox: { x: 1, y: 2, width: 30, height: 20 } },
      generatedInstruction: "点击按钮。",
      status: "reviewed"
    }
  ]);
  assert(automaticSteps[0].focusBox.x === 1, "恢复自动后 ArticleStep 必须回到目标元素高亮 x");
  assert(automaticSteps[0].focusBox.width === 30, "恢复自动后 ArticleStep 必须回到目标元素高亮 width");
});

runCheck("扩展预览页支持设置视频片段时长", () => {
  const background = readText("extension/background.js");
  const viewerJs = readText("extension/viewer.js");
  const viewerCss = readText("extension/viewer.css");
  const validator = readText("tools/validate_schema.js");
  assert(background.includes("recorder:update-node-duration"), "background 必须提供视频时长更新接口");
  assert(background.includes("durationOverrideSeconds"), "background 必须持久化人工视频时长");
  assert(background.includes("duration < 1 || duration > 120"), "background 必须限制视频时长范围");
  assert(background.includes("delete node.durationOverrideSeconds"), "background 必须支持恢复自动视频时长");
  assert(viewerJs.includes("data-node-duration"), "viewer.js 必须渲染视频时长输入");
  assert(viewerJs.includes("data-node-action=\"save-duration\""), "viewer.js 必须提供保存视频时长入口");
  assert(viewerJs.includes("data-node-action=\"clear-duration\""), "viewer.js 必须提供恢复自动视频时长入口");
  assert(viewerCss.includes(".editor-panel") && viewerCss.includes(".editor-row"), "viewer.css 必须提供视频时长编辑区样式");
  assert(viewerCss.includes(".editor-row"), "viewer.css 必须支持时长编辑按钮换行");
  assert(validator.includes("durationOverrideSeconds"), "validate_schema 必须校验视频时长覆盖字段");

  const { buildArticleSteps, buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([
    {
      id: "node_duration",
      sequence: 1,
      action: "click",
      tab: { tabId: 1, tabAlias: "标签页 A：业务页", domain: "example.com" },
      target: { type: "button", text: "生成报表" },
      durationOverrideSeconds: 7.5,
      generatedInstruction: "点击生成报表。",
      status: "reviewed"
    }
  ]);
  const timeline = buildVideoTimeline(steps);
  assert(steps[0].durationOverrideSeconds === 7.5, "ArticleStep 必须保留人工视频时长");
  assert(timeline.segments[0].endTime - timeline.segments[0].startTime === 7.5, "VideoTimeline 必须优先使用人工视频时长");

  const automaticSteps = buildArticleSteps([
    {
      id: "node_auto_duration",
      sequence: 1,
      action: "click",
      tab: { tabId: 1, tabAlias: "标签页 A：业务页", domain: "example.com" },
      target: { type: "button", text: "生成报表" },
      generatedInstruction: "点击生成报表。",
      status: "reviewed"
    }
  ]);
  const automaticTimeline = buildVideoTimeline(automaticSteps);
  assert(automaticSteps[0].durationOverrideSeconds === null, "恢复自动后 ArticleStep 不应保留人工视频时长");
  assert(automaticTimeline.segments[0].endTime - automaticTimeline.segments[0].startTime === 3, "恢复自动后 VideoTimeline 必须回到默认估算时长");
});

runCheck("扩展预览页支持设置视频旁白", () => {
  const background = readText("extension/background.js");
  const shared = readText("extension/shared/artifacts.js");
  const viewerJs = readText("extension/viewer.js");
  const viewerCss = readText("extension/viewer.css");
  const validator = readText("tools/validate_schema.js");
  assert(background.includes("recorder:update-node-voiceover"), "background 必须提供视频旁白更新接口");
  assert(background.includes("voiceoverTextOverridden = true"), "background 必须标记人工视频旁白覆盖");
  assert(background.includes("voiceoverText.length > 500"), "background 必须限制视频旁白长度");
  assert(background.includes("delete node.voiceoverText"), "background 必须支持恢复自动视频旁白");
  assert(background.includes("delete node.voiceoverTextOverridden"), "background 必须清理视频旁白覆盖标记");
  assert(shared.includes("voiceoverTextOverridden"), "共享 artifact 必须传递视频旁白覆盖标记");
  assert(viewerJs.includes("data-node-voiceover"), "viewer.js 必须渲染视频旁白输入");
  assert(viewerJs.includes("data-node-action=\"save-voiceover\""), "viewer.js 必须提供保存视频旁白入口");
  assert(viewerJs.includes("data-node-action=\"clear-voiceover\""), "viewer.js 必须提供恢复自动视频旁白入口");
  assert(viewerCss.includes(".video-panel"), "viewer.css 必须提供视频旁白编辑区样式");
  assert(validator.includes("voiceoverTextOverridden"), "validate_schema 必须校验视频旁白覆盖标记");

  const { buildArticleSteps, buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([
    {
      id: "node_voiceover",
      sequence: 1,
      action: "click",
      tab: { tabId: 1, tabAlias: "标签页 A：业务页", domain: "example.com" },
      target: { type: "button", text: "生成报表" },
      descriptionOverride: "点击生成报表按钮。",
      voiceoverText: "Click generate report and wait for the dashboard to refresh.",
      voiceoverTextOverridden: true,
      generatedInstruction: "点击生成报表。",
      status: "reviewed"
    }
  ]);
  const timeline = buildVideoTimeline(steps);
  assert(steps[0].description === "点击生成报表按钮。", "ArticleStep 文章说明不能被视频旁白改写");
  assert(steps[0].voiceoverTextOverridden === true, "ArticleStep 必须保留人工视频旁白覆盖标记");
  assert(timeline.segments[0].caption === "Click generate report and wait for the dashboard to refresh.", "VideoTimeline caption 必须优先使用人工视频旁白");
  assert(timeline.segments[0].voiceoverTextOverridden === true, "VideoTimeline 必须保留人工视频旁白覆盖标记");

  const automaticSteps = buildArticleSteps([
    {
      id: "node_auto_voiceover",
      sequence: 1,
      action: "click",
      tab: { tabId: 1, tabAlias: "标签页 A：业务页", domain: "example.com" },
      target: { type: "button", text: "生成报表" },
      descriptionOverride: "点击生成报表按钮。",
      generatedInstruction: "点击生成报表。",
      status: "reviewed"
    }
  ]);
  const automaticTimeline = buildVideoTimeline(automaticSteps);
  assert(automaticSteps[0].voiceoverText === "点击生成报表按钮。", "恢复自动后 ArticleStep 视频旁白应回到文章说明");
  assert(automaticSteps[0].voiceoverTextOverridden === false, "恢复自动后 ArticleStep 不应保留旁白覆盖标记");
  assert(automaticTimeline.segments[0].caption === "点击生成报表按钮。", "恢复自动后 VideoTimeline caption 必须回到文章说明");
  assert(automaticTimeline.segments[0].voiceoverTextOverridden === false, "恢复自动后 VideoTimeline 不应保留旁白覆盖标记");
});

runCheck("扩展预览页支持截图手动打码", () => {
  const background = readText("extension/background.js");
  const shared = readText("extension/shared/artifacts.js");
  const viewerJs = readText("extension/viewer.js");
  const viewerCss = readText("extension/viewer.css");
  const artifactsJs = readText("extension/viewer_artifacts.js");
  const generator = readText("tools/generate_artifacts.js");
  assert(background.includes("recorder:update-node-mask"), "background 必须提供打码区域更新接口");
  assert(background.includes("privacyMaskBoxes"), "background 必须持久化手动打码区域");
  assert(background.includes("manualMaskApplied"), "background 必须标记已应用手动打码");
  assert(shared.includes("privacyMaskBoxes"), "共享 artifact 必须传递手动打码区域");
  assert(viewerJs.includes("data-node-action=\"save-mask\""), "viewer.js 必须提供保存打码入口");
  assert(viewerJs.includes("data-node-action=\"clear-mask\""), "viewer.js 必须提供清除打码入口");
  assert(viewerJs.includes("renderMaskBoxes"), "viewer.js 必须在预览截图上渲染打码区域");
  assert(viewerCss.includes(".mask-box"), "viewer.css 必须提供预览打码层样式");
  assert(artifactsJs.includes("class=\"mask\""), "viewer_artifacts.js 必须在导出文章中渲染打码层");
  assert(generator.includes("renderMaskBoxes"), "离线文章生成器必须渲染打码层");
});

runCheck("敏感字段录制时会自动生成截图打码区域", () => {
  const content = readText("extension/content.js");
  const background = readText("extension/background.js");
  assert(content.includes("containsSensitiveData: sensitive"), "content.js 必须识别敏感字段");
  assert(content.includes("isEmailValue(value)"), "content.js 必须按输入值识别邮箱");
  assert(content.includes("isPasswordElement(element)"), "content.js 必须按字段识别密码");
  assert(content.includes("isPasswordElement(element) && hasNonEmptyValue(element)"), "content.js 不应遮挡空密码框");
  assert(content.includes("collectPagePrivacyMaskBoxes"), "content.js 必须扫描页面中后续出现的邮箱/密码区域");
  assert(content.includes("pagePrivacyMaskBoxes"), "content.js 必须把页面级邮箱/密码打码区域传给 background");
  assert(content.includes("\"email\""), "content.js 必须记录邮箱敏感原因");
  assert(content.includes("\"password\""), "content.js 必须记录密码敏感原因");
  assert(!content.includes("\"phone\""), "content.js 不应再把手机号作为默认打码对象");
  assert(!content.includes("\"id_card\""), "content.js 不应再把身份证号作为默认打码对象");
  assert(!content.includes("\"bank_card\""), "content.js 不应再把银行卡号作为默认打码对象");
  assert(content.indexOf("if (isEmailValue(value)) return maskEmail(value)") < content.indexOf("if (sensitive) return \"***\""), "邮箱应保留部分脱敏展示，而不是直接全量 ***");
  assert(background.includes("buildAutoMaskBoxes"), "background 必须根据敏感字段生成自动打码区域");
  assert(background.includes("payload.privacy?.containsSensitiveData"), "自动打码必须基于隐私识别结果");
  assert(background.includes("payload.target?.boundingBox"), "自动打码必须使用目标元素区域");
  assert(background.includes("payload.pagePrivacyMaskBoxes"), "自动打码必须合并页面级邮箱/密码区域");
  assert(background.includes("isEmailOrPasswordPrivacy"), "自动打码必须限制在邮箱和密码");
  assert(background.includes("autoMaskApplied"), "节点隐私元数据必须标记自动打码");
});

runCheck("输入值只持久化 maskedValue 且不保存 rawValue", () => {
  const content = readText("extension/content.js");
  const background = readText("extension/background.js");
  const validator = readText("tools/validate_schema.js");
  const dataModel = readText("DATA_MODEL.md");
  const testing = readText("TESTING.md");
  const readme = readText("README.md");
  const sample = readJson("examples/sample-recording.json");
  assert(content.includes("const maskedValue = getMaskedValue"), "content.js 必须先生成 maskedValue");
  assert(content.includes("maskedValue,") && content.includes("value: action === \"check\""), "content.js must send maskedValue and check-compatible value");
  assert(content.includes("checked: checkedState?.checked ?? null"), "content.js must send checked state");
  assert(background.includes("checked: payload.checked ?? null"), "background must persist checked state on new nodes");
  assert(background.includes("node.checked = payload.checked ?? null"), "background must update checked state on merged nodes");
  assert(!content.includes("rawValue"), "content.js 不应发送 rawValue");
  assert(background.includes("const maskedValue = payload.maskedValue ?? payload.value ?? null"), "background 必须兼容读取 maskedValue");
  assert(background.includes("maskedValue,") && background.includes("value: maskedValue"), "background 新节点必须持久化 maskedValue 并兼容 value");
  assert(background.includes("node.maskedValue = payload.maskedValue ?? payload.value ?? null"), "background 合并节点必须更新 maskedValue");
  assert(!background.includes("node.rawValue") && !background.includes("payload.rawValue"), "background 不应持久化 rawValue");
  assert(validator.includes("rawValue 不允许持久化"), "validate_schema 必须禁止 rawValue");
  assert(validator.includes("node.maskedValue === node.value"), "validate_schema 必须要求 value 与 maskedValue 一致");
  assert(dataModel.includes("不得持久化 `rawValue`"), "DATA_MODEL.md 必须说明 rawValue 禁止持久化");
  assert(testing.includes("不应出现 `rawValue`"), "TESTING.md 必须覆盖 rawValue 禁止持久化");
  assert(readme.includes("不会保存 `rawValue`"), "README.md 必须说明不保存 rawValue");

  const nodesWithMaskedValue = sample.nodes.filter((node) => node.maskedValue !== undefined);
  assert(nodesWithMaskedValue.length >= 4, "示例录制数据必须覆盖多个 maskedValue 节点");
  nodesWithMaskedValue.forEach((node) => {
    assert(node.value === node.maskedValue, `${node.id} value 必须与 maskedValue 一致`);
  });
  assert(!JSON.stringify(sample).includes("rawValue"), "示例录制数据不得出现 rawValue");
});

runCheck("扩展预览页导出前会做隐私检查", () => {
  const viewerHtml = readText("extension/viewer.html");
  const viewerJs = readText("extension/viewer.js");
  const viewerCss = readText("extension/viewer.css");
  const popupJs = readText("extension/popup.js");
  const background = readText("extension/background.js");
  assert(viewerHtml.includes("privacyAudit"), "viewer.html 必须提供隐私检查展示区");
  assert(viewerJs.includes("renderPrivacyAudit"), "viewer.js 必须渲染隐私检查结果");
  assert(viewerJs.includes("getPrivacyAudit"), "viewer.js 必须汇总敏感步骤和未打码步骤");
  assert(viewerJs.includes("confirmPrivacyBeforeExport"), "viewer.js 必须在导出前确认隐私风险");
  assert(viewerJs.includes("window.confirm(message)"), "viewer.js 必须用确认弹窗阻断意外导出");
  assert(viewerJs.includes("unmaskedCount"), "viewer.js 必须识别尚未手动打码的敏感步骤");
  assert(viewerCss.includes(".privacy-card.warn"), "viewer.css 必须提供隐私风险提示样式");
  assert(background.includes("recorder:get-privacy-audit"), "background 必须提供轻量隐私审计接口给 Popup");
  assert(background.includes("function privacyAuditState"), "background 必须实现隐私审计统计");
  assert(background.includes("node.status !== \"discarded\""), "隐私审计必须排除已删除节点");
  assert(popupJs.includes("exportJsonWithPrivacyConfirm"), "popup 必须使用带隐私确认的 JSON 导出流程");
  assert(popupJs.includes("recorder:get-privacy-audit"), "popup 导出前必须先获取隐私审计");
  assert(popupJs.includes("confirmPrivacyBeforeExport"), "popup 必须在导出前确认隐私风险");
  assert(popupJs.includes("window.confirm(message)"), "popup 必须用确认弹窗阻断意外导出");
  assert(!popupJs.includes("bind(\"exportBtn\", \"recorder:export-json\")"), "popup 不应直接绑定 JSON 导出绕过隐私确认");
});

runCheck("录制 JSON 导出不会携带敏感步骤原始截图", () => {
  const background = readText("extension/background.js");
  const validator = readText("tools/validate_schema.js");
  assert(background.includes("sanitizeNodeForJsonExport"), "background 必须在导出 JSON 前清理节点副本");
  assert(background.includes("sanitizeNodeUrlsForOutput(hydratedNode)"), "导出 JSON 使用的完整状态必须先脱敏节点 URL");
  assert(background.includes("sanitizeTabContextsForOutput(runtimeState.tabContexts)"), "导出 JSON 使用的完整状态必须先脱敏标签页 URL");
  assert(background.includes("nodes: fullState.nodes.map(sanitizeNodeForJsonExport)"), "exportJson 必须使用清理后的节点");
  assert(background.includes("redactedForPrivacy: true"), "敏感截图导出时必须标记 redactedForPrivacy");
  assert(background.includes("redactionReason"), "敏感截图导出时必须记录裁剪原因");
  assert(background.includes("const { dataUrl, ...screenshot } = node.screenshot"), "敏感截图导出时必须移除 dataUrl");
  assert(validator.includes("redactedForPrivacy"), "validate_schema 必须校验截图隐私裁剪字段");

  const sensitiveNode = {
    id: "node_sensitive_export",
    action: "input",
    tab: { tabAlias: "标签页 A" },
    target: { type: "input", text: "Email" },
    generatedInstruction: "填写 Email。",
    privacy: { containsSensitiveData: true },
    privacyMaskBoxes: [{ x: 1, y: 2, width: 3, height: 4 }],
    screenshot: { id: "img_sensitive", dataUrl: "data:image/png;base64,SENSITIVE", viewportWidth: 100, viewportHeight: 80 }
  };
  const safeExportNode = {
    ...sensitiveNode,
    screenshot: {
      id: sensitiveNode.screenshot.id,
      viewportWidth: sensitiveNode.screenshot.viewportWidth,
      viewportHeight: sensitiveNode.screenshot.viewportHeight,
      redactedForPrivacy: true,
      redactionReason: "contains_sensitive_data"
    }
  };
  assert(!("dataUrl" in safeExportNode.screenshot), "敏感步骤导出 JSON 不应包含截图 dataUrl");
  assert(safeExportNode.screenshot.redactedForPrivacy === true, "敏感步骤导出 JSON 必须保留隐私裁剪标记");
});

runCheck("文章和视频时间轴导出会保留已打码截图", () => {
  const shared = readText("extension/shared/artifacts.js");
  const viewerJs = readText("extension/viewer.js");
  const viewerArtifacts = readText("extension/viewer_artifacts.js");
  const generator = readText("tools/generate_artifacts.js");
  assert(shared.includes("buildPrivacySafeArticleSteps"), "共享 artifact 必须提供隐私安全导出步骤构建");
  assert(shared.includes("imageMaskedForPrivacy"), "共享 artifact 必须标记文章截图已打码");
  assert(viewerJs.includes("buildPrivacySafeArticleSteps(currentSteps, options)"), "预览页导出必须按隐私开关使用隐私安全步骤副本");
  assert(viewerArtifacts.includes("renderMaskBoxes"), "预览文章必须渲染打码区域");
  assert(generator.includes("buildPrivacySafeArticleSteps(steps)"), "离线导出必须使用隐私安全步骤副本");
  assert(generator.includes("renderMaskBoxes"), "离线文章/分镜必须渲染打码区域");

  const { buildArticleSteps, buildPrivacySafeArticleSteps, buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const originalDataUrl = "data:image/png;base64,RAW_SENSITIVE_SCREENSHOT";
  const steps = buildArticleSteps([
    {
      id: "node_sensitive_image",
      sequence: 1,
      action: "input",
      tab: { tabId: 1, tabAlias: "标签页 A：注册页", domain: "example.com" },
      target: { type: "input", text: "Email", boundingBox: { x: 10, y: 20, width: 120, height: 32 } },
      screenshot: {
        id: "img_sensitive_image",
        dataUrl: originalDataUrl,
        viewportWidth: 400,
        viewportHeight: 240,
        width: 400,
        height: 240
      },
      privacy: { containsSensitiveData: true, autoMaskApplied: true },
      privacyMaskBoxes: [{ x: 10, y: 20, width: 120, height: 32, coordinateSpace: "viewport-css-pixel" }],
      generatedInstruction: "在 Email 中输入内容。",
      status: "auto_generated"
    }
  ]);
  assert(steps[0].image === originalDataUrl, "普通 ArticleStep 应保留内部截图供预览使用");

  const safeSteps = buildPrivacySafeArticleSteps(steps);
  assert(safeSteps[0].image === originalDataUrl, "有打码框的隐私安全导出步骤应保留截图 image");
  assert(safeSteps[0].imageMaskedForPrivacy === true, "有打码框的隐私安全导出步骤必须标记 imageMaskedForPrivacy");
  assert(safeSteps[0].screenshot.dataUrl === originalDataUrl, "有打码框的隐私安全导出步骤应保留截图 dataUrl 供渲染遮挡");
  assert(safeSteps[0].privacyMaskBoxes.length === 1, "隐私安全导出步骤必须保留打码框");

  const timeline = buildVideoTimeline(safeSteps);
  assert(timeline.segments[0].visual === originalDataUrl, "隐私安全 VideoTimeline 应携带已打码截图 visual");
  assert(timeline.segments[0].privacyMaskBoxes.length === 1, "隐私安全 VideoTimeline 必须携带打码区域");
});

runCheck("扩展预览页支持调整步骤顺序", () => {
  const background = readText("extension/background.js");
  const viewerJs = readText("extension/viewer.js");
  const viewerCss = readText("extension/viewer.css");
  assert(background.includes("recorder:move-node"), "background 必须提供步骤排序接口");
  assert(background.includes("runtimeState.nodes.splice"), "background 必须通过移动节点数组调整顺序");
  assert(background.includes("resequenceNodes"), "background 必须在排序后重写 sequence");
  assert(viewerJs.includes("data-node-action=\"move\""), "viewer.js 必须提供排序按钮");
  assert(viewerJs.includes("data-move-direction=\"up\""), "viewer.js 必须提供上移入口");
  assert(viewerJs.includes("data-move-direction=\"down\""), "viewer.js 必须提供下移入口");
  assert(viewerCss.includes("flex-wrap: wrap"), "viewer.css 必须允许步骤操作按钮换行");
});

runCheck("扩展预览页支持合并相邻步骤", () => {
  const background = readText("extension/background.js");
  const viewerJs = readText("extension/viewer.js");
  assert(background.includes("recorder:merge-node-next"), "background 必须提供合并下一步接口");
  assert(background.includes("mergedNodeIds"), "background 必须记录被合并节点");
  assert(background.includes("mergePrivacyFromNodes([current, next])"), "合并相邻步骤时必须聚合隐私元数据");
  assert(background.includes("mergePrivacyMaskBoxesFromNodes([current, next])"), "合并相邻步骤时必须聚合打码区域");
  assert(background.includes("discardReason = `merged_into:"), "background 必须把被合并节点标记为 merged_into");
  assert(viewerJs.includes("data-node-action=\"merge-next\""), "viewer.js 必须提供合并下一步入口");
  assert(viewerJs.includes("hasNextActive"), "viewer.js 必须在没有下一条有效步骤时禁用合并");
});

runCheck("扩展预览页支持合并同一表单字段", () => {
  const content = readText("extension/content.js");
  const background = readText("extension/background.js");
  const viewerJs = readText("extension/viewer.js");
  const validator = readText("tools/validate_schema.js");
  const index = readText("test-pages/index.html");
  const company = readText("test-pages/company.html");
  const sample = readJson("examples/sample-recording.json");
  assert(content.includes("form: getFormMetadata(element)"), "content.js 必须采集目标所属表单元数据");
  assert(content.includes("function getFormMetadata"), "content.js 必须实现表单元数据提取");
  assert(background.includes("recorder:merge-form-fields"), "background 必须提供同表单字段合并接口");
  assert(background.includes("function mergeFormFields"), "background 必须实现同表单字段合并逻辑");
  assert(background.includes("function isFormFieldNode"), "background 必须只允许表单字段参与表单合并");
  assert(background.includes("formMerge"), "background 必须记录表单合并元数据");
  assert(background.includes("mergedFieldCount"), "background 必须记录合并字段数量");
  assert(background.includes("mergePrivacyFromNodes(mergedNodes)"), "同表单字段合并必须聚合隐私元数据");
  assert(background.includes("mergePrivacyMaskBoxesFromNodes(mergedNodes)"), "同表单字段合并必须聚合打码区域");
  assert(background.includes("delete node.formMerge"), "拆分合并步骤时必须清理 formMerge");
  assert(!viewerJs.includes("data-node-action=\"merge-form\""), "viewer.js 不应再提供合并表单字段入口");
  assert(!viewerJs.includes("function canMergeFormFields"), "viewer.js 不应再保留合并表单按钮启用逻辑");
  assert(validator.includes("validateFormTarget"), "validate_schema 必须校验 target.form");
  assert(validator.includes("validateFormMerge"), "validate_schema 必须校验 formMerge");
  assert(index.includes("<form id=\"signupForm\""), "注册测试页必须覆盖具名表单");
  assert(company.includes("<form"), "公司测试页必须覆盖表单字段合并场景");
  assert(sample.nodes.filter((node) => node.target?.form?.selector).length >= 4, "示例录制数据必须覆盖多个同表单字段");

  const { buildArticleSteps, buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([
    {
      id: "node_form",
      sequence: 1,
      action: "input",
      tab: { tabId: 1, tabAlias: "标签页 A：注册页", domain: "example.com" },
      target: { type: "input", labelText: "邮箱", form: { selector: "#signupForm", text: "注册表单" } },
      generatedInstruction: "填写邮箱。",
      titleOverride: "填写 注册表单",
      descriptionOverride: "填写邮箱。填写身份证号。",
      mergedNodeIds: ["node_id_card"],
      formMerge: { formSelector: "#signupForm", mergedFieldCount: 2, mergedAt: "2026-07-24T00:00:00+08:00" },
      privacy: { containsSensitiveData: true, reasons: ["id_card"], maskedFields: ["#idCard"], autoMaskApplied: true },
      privacyMaskBoxes: [{ x: 10, y: 20, width: 120, height: 32, coordinateSpace: "viewport-css-pixel" }],
      status: "reviewed"
    },
    {
      id: "node_id_card",
      sequence: 2,
      action: "input",
      tab: { tabId: 1, tabAlias: "标签页 A：注册页", domain: "example.com" },
      target: { type: "input", labelText: "身份证号", form: { selector: "#signupForm", text: "注册表单" } },
      generatedInstruction: "填写身份证号。",
      status: "discarded",
      discardReason: "merged_into:node_form"
    }
  ]);
  const timeline = buildVideoTimeline(steps);
  assert(steps.length === 1, "同表单字段合并后文章步骤只应输出主节点");
  assert(steps[0].title === "填写 注册表单", "表单合并主节点必须使用人工标题");
  assert(steps[0].description.includes("填写身份证号"), "表单合并主节点必须保留子字段说明");
  assert(steps[0].privacyWarnings.length === 1, "表单合并主节点必须保留子字段隐私提示");
  assert(steps[0].privacyMaskBoxes.length === 1, "表单合并主节点必须保留子字段打码区域");
  assert(timeline.segments[0].caption.includes("填写身份证号"), "表单合并后视频 caption 必须使用合并说明");
  assert(timeline.segments[0].privacyMaskBoxes.length === 1, "表单合并后视频时间轴必须保留打码区域");
});

runCheck("扩展预览页支持拆分已合并步骤", () => {
  const background = readText("extension/background.js");
  const viewerJs = readText("extension/viewer.js");
  const viewerCss = readText("extension/viewer.css");
  assert(background.includes("recorder:split-merged-node"), "background 必须提供拆分合并接口");
  assert(background.includes("splitMergedNode"), "background 必须实现拆分合并逻辑");
  assert(background.includes("delete node.mergedNodeIds"), "background 拆分后必须清理 mergedNodeIds");
  assert(background.includes("item.discardReason !== `merged_into:${node.id}`"), "background 只能恢复合并产生的 discarded 节点");
  assert(background.includes("function markNodeEdited") && background.includes("merged_into:"), "合并子步骤的图片编辑不得把 discarded 状态改回有效步骤");
  assert(viewerJs.includes("data-node-action=\"split-merged\""), "viewer.js 必须提供拆分合并入口");
  assert(viewerJs.includes("function renderMergedChildStep"), "viewer.js 必须将被合并子步骤渲染为紧凑视觉卡片");
  assert(viewerJs.includes("merged-child-spacer") && !viewerJs.includes("step-kind merged"), "被合并子步骤不应再展示子步骤标题和状态标签");
  assert(viewerJs.includes("visual-editor-only"), "被合并子步骤必须保留高亮/打码图片编辑区");
  assert(viewerJs.includes("step-title-line") && viewerCss.includes(".step-title-line"), "步骤类型标签必须跟随标题同行展示");
  assert(viewerJs.includes("isMerged"), "viewer.js 必须只对已合并步骤启用拆分");
});

runCheck("恢复被合并子步骤时会自动拆分主步骤", () => {
  const background = readText("extension/background.js");
  assert(background.includes("node.discardReason?.startsWith(\"merged_into:\")"), "setNodeStatus 必须识别被合并子步骤");
  assert(background.includes("return splitMergedNode({ nodeId: parentId })"), "恢复被合并子步骤必须走拆分主步骤逻辑");
  assert(background.includes("if (status === \"discarded\") delete node.discardReason"), "普通删除时必须清理过期 discardReason");
});

runCheck("离线工具和预览页复用同一份 artifact 构建逻辑", () => {
  const generator = readText("tools/generate_artifacts.js");
  const shared = readText("extension/shared/artifacts.js");
  assert(generator.includes("require(\"../extension/shared/artifacts\")"), "离线生成器必须 require 扩展共享 artifact 库");
  assert(shared.includes("buildArticleSteps"), "共享库缺少 ArticleStep 构建");
  assert(shared.includes("buildVideoTimeline"), "共享库缺少 VideoTimeline 构建");
  assert(shared.includes("tab_transition"), "共享库缺少 tab_transition 处理");
  assert(shared.includes("navigation"), "共享库缺少 navigation 处理");
});

runCheck("已删除步骤不会进入文章步骤和视频时间轴", () => {
  const { buildArticleSteps, buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([
    {
      id: "node_kept",
      sequence: 1,
      action: "click",
      target: { type: "button", text: "保留" },
      generatedInstruction: "点击保留按钮。",
      status: "auto_generated"
    },
    {
      id: "node_discarded",
      sequence: 2,
      action: "click",
      target: { type: "button", text: "删除" },
      generatedInstruction: "点击删除按钮。",
      status: "discarded"
    }
  ]);
  const timeline = buildVideoTimeline(steps);
  assert(steps.length === 1, "ArticleStep 必须过滤 discarded 节点");
  assert(steps[0].nodeId === "node_kept", "过滤后应保留未删除节点");
  assert(timeline.segments.length === 1, "VideoTimeline 不应包含 deleted/discarded 步骤");
});

runCheck("人工编辑文案会同步进入文章步骤和视频字幕", () => {
  const { buildArticleSteps, buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([
    {
      id: "node_edited",
      sequence: 1,
      action: "click",
      target: { type: "button", text: "原始按钮" },
      generatedInstruction: "点击原始按钮。",
      titleOverride: "人工标题",
      descriptionOverride: "人工说明会用于文章和视频。",
      status: "reviewed"
    }
  ]);
  const timeline = buildVideoTimeline(steps);
  assert(steps[0].title === "人工标题", "ArticleStep 必须优先使用人工标题");
  assert(steps[0].description === "人工说明会用于文章和视频。", "ArticleStep 必须优先使用人工说明");
  assert(timeline.segments[0].caption === "人工说明会用于文章和视频。", "VideoTimeline 字幕必须复用人工说明");
});

runCheck("视频时间轴会携带截图元数据用于真实帧渲染", () => {
  const { buildArticleSteps, buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([
    {
      id: "node_screenshot_meta",
      sequence: 1,
      action: "click",
      target: { type: "button", text: "按钮", boundingBox: { x: 10, y: 20, width: 80, height: 32 } },
      screenshot: {
        dataUrl: "data:image/png;base64,AAA",
        viewportWidth: 400,
        viewportHeight: 240,
        width: 400,
        height: 240
      },
      generatedInstruction: "点击按钮。",
      status: "auto_generated"
    }
  ]);
  const timeline = buildVideoTimeline(steps);
  assert(timeline.segments[0].visual === "data:image/png;base64,AAA", "VideoTimeline 必须携带截图 dataUrl");
  assert(timeline.segments[0].screenshot.viewportWidth === 400, "VideoTimeline 必须携带截图视口宽度");
});

runCheck("人工调整高亮区域会同步进入文章步骤和视频时间轴", () => {
  const { buildArticleSteps, buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([
    {
      id: "node_focus",
      sequence: 1,
      action: "click",
      target: {
        type: "button",
        text: "自动区域",
        boundingBox: { x: 10, y: 20, width: 30, height: 40 }
      },
      focusBoxOverride: { x: 100, y: 110, width: 120, height: 60, coordinateSpace: "viewport-css-pixel" },
      generatedInstruction: "点击按钮。",
      status: "reviewed"
    }
  ]);
  const timeline = buildVideoTimeline(steps);
  assert(steps[0].focusBox.x === 100, "ArticleStep 必须优先使用人工高亮 x");
  assert(steps[0].focusBox.width === 120, "ArticleStep 必须优先使用人工高亮 width");
  assert(timeline.segments[0].highlight.x === 100, "VideoTimeline highlight 必须复用人工高亮区域");
});

runCheck("手动打码区域会同步进入文章步骤和视频时间轴", () => {
  const { buildArticleSteps, buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([
    {
      id: "node_mask",
      sequence: 1,
      action: "input",
      target: {
        type: "input",
        text: "手机号",
        boundingBox: { x: 10, y: 20, width: 120, height: 32 }
      },
      privacyMaskBoxes: [{ x: 12, y: 22, width: 118, height: 28, coordinateSpace: "viewport-css-pixel" }],
      privacy: { containsSensitiveData: true, manualMaskApplied: true },
      generatedInstruction: "填写手机号。",
      status: "reviewed"
    }
  ]);
  const timeline = buildVideoTimeline(steps);
  assert(steps[0].privacyMaskBoxes.length === 1, "ArticleStep 必须保留手动打码区域");
  assert(steps[0].privacyMaskBoxes[0].x === 12, "ArticleStep 打码区域坐标必须保持不变");
  assert(steps[0].privacyWarnings.length === 1, "ArticleStep 必须保留隐私警告");
  assert(timeline.segments[0].privacyMaskBoxes.length === 1, "VideoTimeline 必须携带手动打码区域");
});

runCheck("自动打码区域会同步进入文章步骤和视频时间轴", () => {
  const { buildArticleSteps, buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([
    {
      id: "node_auto_mask",
      sequence: 1,
      action: "input",
      target: {
        type: "password",
        text: "Password",
        boundingBox: { x: 20, y: 30, width: 160, height: 36 }
      },
      privacyMaskBoxes: [{ x: 20, y: 30, width: 160, height: 36, coordinateSpace: "viewport-css-pixel", source: "target_sensitive_input" }],
      privacy: { containsSensitiveData: true, autoMaskApplied: true, manualMaskApplied: false },
      generatedInstruction: "在 Password 中输入内容。",
      status: "auto_generated"
    }
  ]);
  const timeline = buildVideoTimeline(steps);
  assert(steps[0].privacyMaskBoxes[0].width === 160, "ArticleStep 必须保留自动打码区域");
  assert(steps[0].privacyWarnings.length === 1, "ArticleStep 必须保留自动打码隐私警告");
  assert(timeline.segments[0].privacyMaskBoxes[0].height === 36, "VideoTimeline 必须携带自动打码区域");
});

runCheck("同一页面后续敏感步骤会继承已有打码区域", () => {
  const { buildArticleSteps, buildPrivacySafeArticleSteps } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildPrivacySafeArticleSteps(buildArticleSteps([
    {
      id: "node_email_mask",
      sequence: 1,
      action: "input",
      tab: { tabId: 1, tabAlias: "标签页 A：登录页", url: "https://example.com/login" },
      target: { type: "input", text: "Email", boundingBox: { x: 100, y: 120, width: 220, height: 36 } },
      screenshot: { dataUrl: "data:image/png;base64,SCREENSHOT_EMAIL", viewportWidth: 800, viewportHeight: 600 },
      privacy: { containsSensitiveData: true, autoMaskApplied: true },
      privacyMaskBoxes: [{ x: 100, y: 120, width: 220, height: 36, source: "email_password_scan" }],
      generatedInstruction: "填写 Email。",
      status: "auto_generated"
    },
    {
      id: "node_password_mask",
      sequence: 2,
      action: "input",
      tab: { tabId: 1, tabAlias: "标签页 A：登录页", url: "https://example.com/login" },
      target: { type: "password", text: "Password", boundingBox: { x: 100, y: 180, width: 220, height: 36 } },
      screenshot: { dataUrl: "data:image/png;base64,SCREENSHOT_PASSWORD", viewportWidth: 800, viewportHeight: 600 },
      privacy: { containsSensitiveData: true, autoMaskApplied: true },
      privacyMaskBoxes: [{ x: 100, y: 180, width: 220, height: 36, source: "target_sensitive_input" }],
      generatedInstruction: "填写 Password。",
      status: "auto_generated"
    }
  ]));
  assert(steps[0].privacyMaskBoxes.length === 1, "账号步骤应包含账号打码框");
  assert(steps[1].privacyMaskBoxes.length === 2, "密码步骤应同时遮挡账号和密码区域");
  assert(steps[1].image === "data:image/png;base64,SCREENSHOT_PASSWORD", "密码步骤截图应保留并叠加遮挡");
});

runCheck("节点数组顺序会决定文章步骤和视频时间轴顺序", () => {
  const { buildArticleSteps, buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([
    {
      id: "node_second",
      sequence: 1,
      action: "click",
      target: { type: "button", text: "第二步" },
      generatedInstruction: "移动后的第一段。",
      status: "auto_generated"
    },
    {
      id: "node_first",
      sequence: 2,
      action: "click",
      target: { type: "button", text: "第一步" },
      generatedInstruction: "移动后的第二段。",
      status: "auto_generated"
    }
  ]);
  const timeline = buildVideoTimeline(steps);
  assert(steps[0].nodeId === "node_second", "ArticleStep 必须按当前节点数组顺序生成");
  assert(steps[0].sequence === 1 && steps[1].sequence === 2, "ArticleStep 必须按导出顺序重新编号");
  assert(timeline.segments[0].stepId === "article_step_001", "VideoTimeline 必须沿用文章步骤顺序");
  assert(timeline.segments[0].caption === "移动后的第一段。", "VideoTimeline 第一段必须来自排序后的第一步");
});

runCheck("合并后的步骤会过滤被合并节点并复用合并说明", () => {
  const { buildArticleSteps, buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([
    {
      id: "node_merged",
      sequence: 1,
      action: "click",
      target: { type: "button", text: "第一步" },
      generatedInstruction: "点击第一步。",
      descriptionOverride: "点击第一步，然后填写第二步。",
      mergedNodeIds: ["node_discarded_after_merge"],
      status: "reviewed"
    },
    {
      id: "node_discarded_after_merge",
      sequence: 2,
      action: "input",
      target: { type: "input", text: "第二步" },
      generatedInstruction: "填写第二步。",
      discardReason: "merged_into:node_merged",
      status: "discarded"
    }
  ]);
  const timeline = buildVideoTimeline(steps);
  assert(steps.length === 1, "ArticleStep 必须过滤被合并的 discarded 节点");
  assert(steps[0].nodeId === "node_merged", "ArticleStep 必须保留合并后的主节点");
  assert(steps[0].description === "点击第一步，然后填写第二步。", "ArticleStep 必须使用合并后的说明");
  assert(timeline.segments.length === 1, "VideoTimeline 必须只包含合并后的步骤");
  assert(timeline.segments[0].caption === "点击第一步，然后填写第二步。", "VideoTimeline 字幕必须使用合并后的说明");
});

runCheck("拆分已合并步骤后会恢复多步骤导出", () => {
  const { buildArticleSteps, buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([
    {
      id: "node_split_main",
      sequence: 1,
      action: "click",
      target: { type: "button", text: "第一步" },
      generatedInstruction: "点击第一步。",
      descriptionOverride: "点击第一步。",
      status: "reviewed"
    },
    {
      id: "node_split_restored",
      sequence: 2,
      action: "input",
      target: { type: "input", text: "第二步" },
      generatedInstruction: "填写第二步。",
      status: "auto_generated"
    }
  ]);
  const timeline = buildVideoTimeline(steps);
  assert(steps.length === 2, "拆分后 ArticleStep 必须恢复为多个步骤");
  assert(steps[0].nodeId === "node_split_main", "拆分后第一步应保留主节点");
  assert(steps[1].nodeId === "node_split_restored", "拆分后第二步应恢复原节点");
  assert(timeline.segments.length === 2, "拆分后 VideoTimeline 必须恢复多个片段");
});

runCheck("tab_open 后的即时 tab_switch 会被去重", () => {
  const background = readText("extension/background.js");
  assert(background.includes("shouldSkipTabSwitch"), "background 缺少 tab switch 去重函数");
  assert(background.includes("last.action !== \"tab_open\""), "去重函数必须检查上一节点是否 tab_open");
  assert(background.includes("last.toTab?.tabId === toContext.tabId"), "去重函数必须检查 tab_open 目标与 tab_switch 目标一致");
});

runCheck("没有后续有效操作的标签页切换不会进入最终产物", () => {
  const { buildArticleSteps, buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const shared = readText("extension/shared/artifacts.js");
  assert(shared.includes("filterMeaningfulTransitionNodes"), "共享 artifact 必须过滤无后续操作的 tab 切换");
  assert(shared.includes("hasLaterOperationInTab"), "共享 artifact 必须按目标 tab 检查后续有效操作");

  const steps = buildArticleSteps([
    {
      id: "node_a_click",
      sequence: 1,
      action: "click",
      tab: { tabId: 1, tabAlias: "标签页 A：业务页", domain: "example.com" },
      target: { type: "button", text: "打开帮助" },
      generatedInstruction: "点击打开帮助。",
      status: "auto_generated"
    },
    {
      id: "node_switch_unused",
      sequence: 2,
      action: "tab_switch",
      fromTab: { tabId: 1, tabAlias: "标签页 A：业务页", url: "https://example.com" },
      toTab: { tabId: 2, tabAlias: "标签页 B：无操作页", url: "https://help.example.com" },
      generatedInstruction: "切换到标签页 B：无操作页。",
      status: "auto_generated"
    },
    {
      id: "node_a_input",
      sequence: 3,
      action: "input",
      tab: { tabId: 1, tabAlias: "标签页 A：业务页", domain: "example.com" },
      target: { type: "input", labelText: "名称" },
      generatedInstruction: "在名称中输入内容。",
      status: "auto_generated"
    }
  ]);
  const timeline = buildVideoTimeline(steps);
  assert(!steps.some((step) => step.nodeId === "node_switch_unused"), "无后续操作的 tab_switch 不应进入 ArticleStep");
  assert(!timeline.segments.some((segment) => segment.type === "tab_transition"), "无后续操作的 tab_switch 不应进入视频时间轴");
  assert(steps.length === 2, "过滤后应只保留两个有效操作步骤");
});

runCheck("短暂往返标签页切换不会污染最终产物", () => {
  const { buildArticleSteps, buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const shared = readText("extension/shared/artifacts.js");
  assert(shared.includes("findNextOperation"), "共享 artifact 必须按下一次真实操作判断 tab 切换是否有意义");
  assert(shared.includes("currentMeaningfulTabId"), "共享 artifact 必须跟踪当前有意义标签页，避免保留切回原页的无效步骤");

  const steps = buildArticleSteps([
    {
      id: "node_a_click",
      sequence: 1,
      action: "click",
      tab: { tabId: 1, tabAlias: "标签页 A：业务页", domain: "example.com" },
      target: { type: "button", text: "打开帮助" },
      generatedInstruction: "点击打开帮助。",
      status: "auto_generated"
    },
    {
      id: "node_switch_to_b",
      sequence: 2,
      action: "tab_switch",
      fromTab: { tabId: 1, tabAlias: "标签页 A：业务页", url: "https://example.com" },
      toTab: { tabId: 2, tabAlias: "标签页 B：临时页", url: "https://help.example.com" },
      generatedInstruction: "切换到标签页 B：临时页。",
      status: "auto_generated"
    },
    {
      id: "node_switch_back_a",
      sequence: 3,
      action: "tab_switch",
      fromTab: { tabId: 2, tabAlias: "标签页 B：临时页", url: "https://help.example.com" },
      toTab: { tabId: 1, tabAlias: "标签页 A：业务页", url: "https://example.com" },
      generatedInstruction: "切换到标签页 A：业务页。",
      status: "auto_generated"
    },
    {
      id: "node_a_input",
      sequence: 4,
      action: "input",
      tab: { tabId: 1, tabAlias: "标签页 A：业务页", domain: "example.com" },
      target: { type: "input", labelText: "名称" },
      generatedInstruction: "在名称中输入内容。",
      status: "auto_generated"
    }
  ]);
  const timeline = buildVideoTimeline(steps);
  assert(!steps.some((step) => step.nodeId === "node_switch_to_b"), "没有真实操作的临时目标标签页不应进入 ArticleStep");
  assert(!steps.some((step) => step.nodeId === "node_switch_back_a"), "切回原有意义标签页不应进入 ArticleStep");
  assert(!timeline.segments.some((segment) => segment.type === "tab_transition"), "短暂往返标签页切换不应进入视频时间轴");
  assert(steps.map((step) => step.nodeId).join(",") === "node_a_click,node_a_input", "过滤后只应保留真实操作步骤");
});

runCheck("浏览器内部页和扩展页不会进入录制上下文", () => {
  const background = readText("extension/background.js");
  const readme = readText("README.md");
  const testing = readText("TESTING.md");
  assert(background.includes("function isIgnoredTab"), "background 必须用原始 tab URL 判断是否忽略内部页");
  assert(background.includes("if (isIgnoredTab(tab))"), "tab 激活、创建或更新入口必须跳过内部页");
  assert(background.includes("delete runtimeState.pendingNavigations[tabId]"), "tab 更新到内部页时必须清理 pending navigation");
  assert(background.includes("delete runtimeState.tabContexts[tabId]"), "tab 更新到内部页时必须清理 tab context");
  assert(!background.includes("if (isIgnoredTab(tab)) {\n    runtimeState.activeTabId = null"), "激活内部页时不应清空最近业务 tab，避免之后切到业务页时丢失来源上下文");
  assert(background.includes("if (runtimeState.activeTabId === tabId) runtimeState.activeTabId = null"), "同一 tab 更新到内部页时仍必须清空当前业务 tab");
  assert(background.includes("chrome-untrusted://"), "内部页过滤必须覆盖 chrome-untrusted 页面");
  assert(background.includes("devtools://"), "内部页过滤必须覆盖 DevTools 页面");
  assert(background.includes("isIgnoredUrl(sender.tab.url)"), "content script 上报仍必须按原始 sender.tab.url 跳过内部页");
  assert(readme.includes("浏览器内部页、扩展页和 DevTools 页面不会进入录制上下文"), "README.md 必须说明内部页过滤");
  assert(testing.includes("浏览器内部页、扩展页和 DevTools 页面不应进入录制上下文"), "TESTING.md 必须覆盖内部页过滤");
});

runCheck("初始 about:blank 的新标签页会在真实 URL 出现后补记 tab_open", () => {
  const background = readText("extension/background.js");
  const readme = readText("README.md");
  const testing = readText("TESTING.md");
  assert(background.includes("pendingTabOpens"), "background 必须暂存初始不可记录的新标签页");
  assert(background.includes("function isInitialBlankTab"), "background 必须区分初始空白页和真实内部页");
  assert(background.includes("if (isInitialBlankTab(tab)) rememberPendingTabOpen(tab)"), "onCreated 只能为 about:blank 等初始空白页暂存 tab_open");
  assert(background.includes("if (!isInitialBlankTab(tab)) delete runtimeState.pendingTabOpens?.[tabId]"), "onUpdated 的 about:blank 更新不能清掉 pending tab_open");
  assert(background.includes("function rememberPendingTabOpen"), "background 必须实现 pending tab_open 暂存");
  assert(background.includes("triggerNodeId: triggerNode?.id || null"), "pending tab_open 必须立即保存触发点击节点 ID");
  assert(background.includes("function createTabOpenNodeForTab"), "background 必须在真实 URL 出现后补写 tab_open");
  assert(background.includes("runtimeState.pendingTabOpens?.[tabId]"), "onUpdated 只能为暂存过的新标签页补写 tab_open");
  assert(background.includes("await createTabOpenNodeForTab(tab, tab.windowId, context)"), "onUpdated 首次得到真实 URL 时必须补写 tab_open");
  assert(background.includes("function findTabOpenTriggerNode"), "延迟 tab_open 必须支持按暂存 triggerNodeId 找回触发节点");
  assert(background.includes("runtimeState.nodes.find((node) => node.id === triggerNodeId)"), "延迟 tab_open 必须按 triggerNodeId 回找触发节点");
  assert(background.includes("const openerTabId = tab.openerTabId || pending?.openerTabId || null"), "延迟 tab_open 必须保留 openerTabId");
  assert(background.includes("delete runtimeState.pendingTabOpens[tab.id]"), "补写 tab_open 后必须清理 pendingTabOpens");
  assert(background.includes("if (!runtimeState.pendingTabOpens) runtimeState.pendingTabOpens = {}"), "hydrateState 必须兼容旧状态里的 pendingTabOpens 缺失");
  assert(background.includes("activeTab?.id && !isIgnoredTab(activeTab)"), "从内部页开始录制时不应创建空 tab context");
  assert(readme.includes("初始 about:blank 的新标签页会在真实 URL 出现后补记 tab_open"), "README.md 必须说明延迟 tab_open");
  assert(testing.includes("初始 about:blank 的新标签页应在真实 URL 出现后补记 tab_open"), "TESTING.md 必须覆盖延迟 tab_open");
});

runCheck("video timeline supports a 2 second title intro", () => {
  const { buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const fallbackTimeline = buildVideoTimeline([
    {
      id: "node_intro_fallback",
      sequence: 1,
      type: "operation",
      description: "Click Add.",
      tabAlias: "Tab A",
      focusBox: null,
      privacyMaskBoxes: []
    }
  ], { forceTitleIntro: true });
  assert(fallbackTimeline.segments[0].type === "title_intro", "first video segment must always be title_intro");
  assert(fallbackTimeline.segments[0].caption === "操作步骤", "title_intro must use a default title when no title is provided");
  const timeline = buildVideoTimeline([
    {
      id: "node_intro_check",
      sequence: 1,
      type: "operation",
      description: "Click Add.",
      tabAlias: "Tab A",
      focusBox: null,
      privacyMaskBoxes: []
    }
  ], { title: "ZKBio TimeCloud" });
  assert(timeline.segments[0].type === "title_intro", "first video segment must be title_intro when article title is present");
  assert(timeline.segments[0].startTime === 0 && timeline.segments[0].endTime === 2, "title_intro must last exactly 2 seconds");
  assert(timeline.segments[1].startTime === 2, "first operation segment must start after title_intro");
  const viewerJs = readText("extension/viewer.js");
  const renderVideoJs = readText("tools/render_video.js");
  assert(viewerJs.includes("drawTitleIntroFrame"), "viewer.js must draw the video title intro");
  assert(renderVideoJs.includes("renderTitleIntroFrame"), "render_video.js must render title_intro SVG frames");
  assert(!viewerJs.includes("SOP Video") && !renderVideoJs.includes("SOP Video"), "video title intro must not render redundant SOP Video label");
  assert(!viewerJs.includes("\\u5f00\\u5934 2 \\u79d2\\u6807\\u9898\\u9875") && !renderVideoJs.includes("\\u5f00\\u5934 2 \\u79d2\\u6807\\u9898\\u9875"), "video title intro must not explain its own 2 second duration");
  assert(viewerJs.includes("isCloseControlSegment") && renderVideoJs.includes("isCloseControlSegment"), "focus zoom must skip close controls and compact UI controls");
});

runCheck("video timeline reuses the previous screenshot for no-image steps", () => {
  const { buildVideoTimeline } = require(path.join(root, "extension/shared/artifacts.js"));
  const timeline = buildVideoTimeline([
    {
      id: "node_with_image",
      sequence: 1,
      type: "operation",
      description: "Click Area.",
      image: "data:image/png;base64,PREVIOUS",
      screenshot: { dataUrl: "data:image/png;base64,PREVIOUS", viewportWidth: 1280, viewportHeight: 720 },
      focusBox: { x: 10, y: 10, width: 80, height: 32 },
      privacyMaskBoxes: []
    },
    {
      id: "node_without_image",
      sequence: 2,
      type: "operation",
      description: "Confirm the result.",
      image: null,
      screenshot: null,
      focusBox: { x: 300, y: 220, width: 120, height: 40 },
      privacyMaskBoxes: [{ x: 300, y: 220, width: 120, height: 40 }]
    }
  ]);
  assert(timeline.segments[1].visual === "data:image/png;base64,PREVIOUS", "no-image video steps must reuse the previous screenshot");
  assert(timeline.segments[1].inheritedVisual === true, "no-image video steps must mark inherited visuals");
  assert(timeline.segments[1].highlight === null, "no-image video steps must not render stale highlights on inherited screenshots");
  assert(timeline.segments[1].privacyMaskBoxes.length === 0, "no-image video steps must not render masks on inherited screenshots");
});

runCheck("viewer video export uses filename as title fallback", () => {
  const viewerJs = readText("extension/viewer.js");
  assert(viewerJs.includes("els.articleTitleInput?.value || els.exportFileNameInput?.value || defaultExportBaseName"), "video export options must use export filename as title fallback");
});

runCheck("target-only privacy masks do not leak into later ordinary steps", () => {
  const { buildArticleSteps } = require(path.join(root, "extension/shared/artifacts.js"));
  const steps = buildArticleSteps([
    {
      id: "node_password_target_mask",
      sequence: 1,
      action: "input",
      tab: { tabId: 1, tabAlias: "Tab A", url: "https://example.com/company/area" },
      target: { type: "password", text: "Password", boundingBox: { x: 40, y: 60, width: 200, height: 36 } },
      privacy: { containsSensitiveData: true, autoMaskApplied: true },
      privacyMaskBoxes: [{ x: 40, y: 60, width: 200, height: 36, source: "target_sensitive_input" }],
      generatedInstruction: "Type password.",
      status: "auto_generated"
    },
    {
      id: "node_area_name",
      sequence: 2,
      action: "input",
      tab: { tabId: 1, tabAlias: "Tab A", url: "https://example.com/company/area" },
      target: { type: "input", text: "Area Name", boundingBox: { x: 40, y: 120, width: 200, height: 36 } },
      privacy: { containsSensitiveData: false, autoMaskApplied: false },
      privacyMaskBoxes: [],
      generatedInstruction: "Type Area Name.",
      status: "auto_generated"
    }
  ]);
  assert(steps[0].privacyMaskBoxes.length === 1, "current sensitive target must still be masked");
  assert(steps[1].privacyMaskBoxes.length === 0, "later ordinary steps must not inherit target-only mask boxes");
});

runCheck("close buttons and checkbox clicks keep the intended target", () => {
  const content = readText("extension/content.js");
  const { buildArticleSteps } = require(path.join(root, "extension/shared/artifacts.js"));
  const closeSteps = buildArticleSteps([{
    id: "node_dialog_close",
    sequence: 1,
    action: "click",
    tab: { tabId: 1, tabAlias: "Tab A", domain: "example.com" },
    target: {
      type: "button",
      text: "Are you sure to clear all the pending commands?",
      selector: ".ant-modal-close",
      attributes: { className: "ant-modal-close", tagName: "button" },
      boundingBox: { x: 850, y: 438, width: 34, height: 34, coordinateSpace: "viewport-css-pixel" }
    },
    generatedInstruction: "Click close.",
    status: "auto_generated"
  }]);
  assert(closeSteps[0].title === "\u70b9\u51fb\u5173\u95ed\u5f39\u7a97", "dialog close click title must not use modal body text");
  assert(content.includes("const checkableAtPoint = findCheckableAtPoint(clickPoint)"), "click handler must resolve checkbox/switch by point before generic click targets");
  assert(content.includes("function isCloseButtonLike"), "content target extraction must identify compact modal close buttons");
});

runCheck("viewer supports editable filenames and no review status UI", () => {
  const viewerHtml = readText("extension/viewer.html");
  const viewerJs = readText("extension/viewer.js");
  const background = readText("extension/background.js");
  const viewerCss = readText("extension/viewer.css");
  assert(viewerHtml.includes("exportFileNameInput"), "viewer.html must render editable export file name input");
  assert(viewerHtml.includes("title-field"), "viewer.html must mark article title as a prominent field");
  assert(viewerJs.includes("exportBaseName()"), "viewer.js must use the editable export base name");
  assert(viewerJs.includes("data-export-title"), "viewer.js must render the visible flow title from export file name");
  assert(viewerJs.includes("refreshMetaTitle"), "viewer.js must refresh the visible flow title when export names change");
  assert(viewerJs.includes("sanitizeFileBaseName"), "viewer.js must sanitize editable file names");
  assert(background.includes("sanitizeDownloadFilename"), "background.js must sanitize JSON export filenames");
  assert(!viewerJs.includes("data-node-status=\"reviewed\""), "viewer.js must not show a confirm action");
  assert(!viewerJs.includes("step-status"), "viewer.js must not show review status text");
  assert(!viewerJs.includes("function statusText"), "viewer.js must not keep unused review status text");
  assert(viewerCss.includes(".export-options .title-field span"), "viewer.css must enlarge the article title label");
  assert(viewerJs.includes("function recordingStatusLabel"), "viewer.js must show user-facing recording status labels");
  assert(viewerJs.includes("sessionStatus === \"completed\"") && viewerJs.includes("\\u5df2\\u7ed3\\u675f"), "completed sessions must display as ended instead of idle");
  assert(viewerCss.includes("#timelineBtn") && viewerCss.includes("display: none"), "video timeline export must be hidden from the main preview actions");
});

runCheck("video exporters keep the tail frames visible", () => {
  const viewerJs = readText("extension/viewer.js");
  const renderVideoJs = readText("tools/render_video.js");
  const packageJson = readJson("package.json");
  assert(viewerJs.includes("VIDEO_FINAL_HOLD_MS") && viewerJs.includes("holdLastVideoFrame"), "preview WebM export must hold the final frame before stopping");
  assert(viewerJs.includes("recorder.start(250)"), "preview WebM export must flush MediaRecorder chunks periodically");
  assert(renderVideoJs.includes("FINAL_HOLD_SECONDS"), "offline MP4 export must explicitly hold the final concat frame");
  assert(packageJson.scripts["render-video:4k"] === "node tools/render_video.js --resolution=4k", "package.json must expose a 4K MP4 render script");
});

runCheck("video highlight style matches article focus frame", () => {
  const viewerJs = readText("extension/viewer.js");
  const renderVideoJs = readText("tools/render_video.js");
  assert(viewerJs.includes("drawVideoHighlight") && viewerJs.includes("paddedBoxToFrameRect"), "preview video export must render a padded highlight frame");
  assert(viewerJs.includes("rgba(0,0,0,.30)") && viewerJs.includes("\"#ffffff\", 8") && viewerJs.includes("\"#f18a2a\", 5"), "preview video highlight must use dim overlay plus white/orange double stroke");
  assert(!viewerJs.includes("destination-out"), "preview video highlight must not erase screenshot pixels");
  assert(renderVideoJs.includes("renderVideoHighlight") && renderVideoJs.includes("paddedBoxToFrameRect"), "offline video export must render a padded highlight frame");
  assert(renderVideoJs.includes("fill-rule=\"evenodd\"") && renderVideoJs.includes("stroke=\"#ffffff\" stroke-width=\"8\"") && renderVideoJs.includes("stroke=\"#f18a2a\" stroke-width=\"5\""), "offline video highlight must use dim overlay plus white/orange double stroke");
  assert(viewerJs.indexOf("maskBoxes.forEach") < viewerJs.indexOf("drawVideoHighlight(ctx, segment.highlight, frame)"), "preview video export must draw highlight borders above privacy masks");
  assert(renderVideoJs.indexOf("${masks}") < renderVideoJs.indexOf("${highlight}"), "offline video export must draw highlight borders above privacy masks");
});

for (const check of checks) {
  if (check.error) {
    console.error(`FAIL ${check.name}`);
    console.error(`  ${check.error.message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${check.name}`);
  }
}

function runCheck(name, fn) {
  try {
    fn();
    checks.push({ name });
  } catch (error) {
    checks.push({ name, error });
  }
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assertExists(relativePath) {
  assert(fs.existsSync(path.join(root, relativePath)), `${relativePath} 不存在`);
}

function assertSchemaRejectsHref(href, expectedMessage) {
  assertSchemaRejectsRecordingUrl((fixture) => {
    const linkNode = fixture.nodes.find((node) => node.id === "node_005");
    assert(linkNode?.target?.attributes, "示例必须包含可修改的链接 target.attributes");
    linkNode.target.attributes.href = href;
  }, expectedMessage);
}

function assertSchemaRejectsRecordingUrl(mutator, expectedMessage) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sop-schema-href-"));
  try {
    const fixture = readJson("examples/sample-recording.json");
    mutator(fixture);
    const fixturePath = path.join(tmpDir, "recording.json");
    fs.writeFileSync(fixturePath, JSON.stringify(fixture), "utf8");

    const result = spawnSync("node", ["tools/validate_schema.js", fixturePath], { cwd: root, encoding: "utf8" });
    assert(result.status !== 0, "validate_schema 应拒绝不安全 URL");
    assert(`${result.stderr}\n${result.stdout}`.includes(expectedMessage), `validate_schema 错误信息应包含：${expectedMessage}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
