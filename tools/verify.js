const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const checks = [];

runCheck("manifest.json 可解析且为 MV3", () => {
  const manifest = readJson("extension/manifest.json");
  assert(manifest.manifest_version === 3, "manifest_version 必须为 3");
  assert(manifest.background?.service_worker === "background.js", "缺少 background service_worker");
  assert(manifest.permissions.includes("tabs"), "需要 tabs 权限记录多标签页");
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
  assertExists("dist/video-timeline.json");
  assertExists("dist/video-storyboard.html");
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

runCheck("视频时间轴包含正确 duration 和 tab_transition", () => {
  const timeline = readJson("dist/video-timeline.json");
  assert(Array.isArray(timeline.segments), "segments 必须是数组");
  assert(timeline.segments.length >= 5, "示例时间轴至少应有 5 个片段");
  const lastEnd = timeline.segments.at(-1).endTime;
  assert(timeline.duration === lastEnd, `duration 应等于最后片段 endTime，当前 ${timeline.duration} != ${lastEnd}`);
  const tabSegments = timeline.segments.filter((segment) => segment.type === "tab_transition");
  assert(tabSegments.length >= 2, "必须包含至少 2 个标签页切换片段");
  assert(tabSegments.some((segment) => segment.fromTabAlias && segment.toTabAlias), "标签页切换片段必须包含 from/to 标签页");
});

runCheck("文章和视频分镜都标注标签页切换", () => {
  const article = readText("dist/article.html");
  const storyboard = readText("dist/video-storyboard.html");
  assert(article.includes("标签页切换"), "article.html 缺少标签页切换标注");
  assert(storyboard.includes("标签页切换片段"), "video-storyboard.html 缺少标签页切换片段");
  assert(storyboard.includes("标签页 A：ZKBio TimeCloud 注册页 -> 标签页 B：邮箱收件箱"), "storyboard 缺少 A -> B 切换");
});

runCheck("视频帧生成器可输出 tab_transition SVG 帧", () => {
  const result = spawnSync("node", ["tools/render_video.js", "--frames-only"], { cwd: root, encoding: "utf8" });
  assert(result.status === 0, result.stderr || result.stdout || "render_video 执行失败");
  assertExists("dist/video/frames/segment_003.svg");
  const frame = readText("dist/video/frames/segment_003.svg");
  assert(frame.includes("标签页切换"), "segment_003.svg 缺少标签页切换标题");
  assert(frame.includes("标签页 A：ZKBio TimeCloud 注册页"), "segment_003.svg 缺少来源标签页");
  assert(frame.includes("标签页 B：邮箱收件箱"), "segment_003.svg 缺少目标标签页");
});

runCheck("测试页覆盖注册、邮箱、新建公司关键操作", () => {
  const index = readText("test-pages/index.html");
  const mail = readText("test-pages/mail.html");
  const company = readText("test-pages/company.html");
  assert(index.includes("SIGN UP"), "注册页缺少 SIGN UP");
  assert(index.includes("target=\"_blank\""), "注册页应新开邮箱标签页");
  assert(mail.includes("Activate Account"), "邮箱页缺少 Activate Account");
  assert(company.includes("Confirm"), "公司页缺少 Confirm");
});

runCheck("扩展预览页支持导出文章和视频时间轴", () => {
  const viewerHtml = readText("extension/viewer.html");
  const artifactsJs = readText("extension/viewer_artifacts.js");
  assert(viewerHtml.includes("articleBtn"), "viewer.html 缺少 SOP 文章导出按钮");
  assert(viewerHtml.includes("timelineBtn"), "viewer.html 缺少视频时间轴导出按钮");
  assert(viewerHtml.indexOf("shared/artifacts.js") < viewerHtml.indexOf("viewer_artifacts.js"), "shared/artifacts.js 必须先于 viewer_artifacts.js 加载");
  assert(viewerHtml.indexOf("viewer_artifacts.js") < viewerHtml.indexOf("viewer.js"), "viewer_artifacts.js 必须先于 viewer.js 加载");
  assert(artifactsJs.includes("SopArtifactShared"), "viewer_artifacts.js 必须使用共享 artifact 库");
});

runCheck("离线工具和预览页复用同一份 artifact 构建逻辑", () => {
  const generator = readText("tools/generate_artifacts.js");
  const shared = readText("extension/shared/artifacts.js");
  assert(generator.includes("require(\"../extension/shared/artifacts\")"), "离线生成器必须 require 扩展共享 artifact 库");
  assert(shared.includes("buildArticleSteps"), "共享库缺少 ArticleStep 构建");
  assert(shared.includes("buildVideoTimeline"), "共享库缺少 VideoTimeline 构建");
  assert(shared.includes("tab_transition"), "共享库缺少 tab_transition 处理");
});

runCheck("tab_open 后的即时 tab_switch 会被去重", () => {
  const background = readText("extension/background.js");
  assert(background.includes("shouldSkipTabSwitch"), "background 缺少 tab switch 去重函数");
  assert(background.includes("last.action !== \"tab_open\""), "去重函数必须检查上一节点是否 tab_open");
  assert(background.includes("last.toTab?.tabId === toContext.tabId"), "去重函数必须检查 tab_open 目标与 tab_switch 目标一致");
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
