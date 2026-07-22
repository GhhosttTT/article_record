const fs = require("node:fs");
const path = require("node:path");
const { buildArticleSteps, buildVideoTimeline } = require("../extension/shared/artifacts");

const root = path.join(__dirname, "..");
const inputPath = process.argv[2] || path.join(root, "examples", "sample-recording.json");
const recording = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const errors = [];

validateRecording(recording);

const steps = buildArticleSteps(recording.nodes || []);
validateArticleSteps(steps);

const timeline = buildVideoTimeline(steps);
validateTimeline(timeline);

if (errors.length) {
  for (const error of errors) console.error(`SCHEMA ${error}`);
  process.exit(1);
}

console.log(`Schema OK: ${path.relative(root, inputPath)}`);
console.log(`ArticleSteps: ${steps.length}`);
console.log(`VideoSegments: ${timeline.segments.length}`);

function validateRecording(data) {
  assert(data.session?.id, "session.id 必填");
  assert(data.session?.browser, "session.browser 必填");
  assert(Array.isArray(data.nodes), "nodes 必须是数组");
  assert(data.tabContexts && typeof data.tabContexts === "object", "tabContexts 必须是对象");

  for (const tab of Object.values(data.tabContexts)) {
    assert(Number.isFinite(tab.tabId), `tabContext ${tab.tabAlias || ""} 缺少 tabId`);
    assert(tab.tabAlias, `tabContext ${tab.tabId || ""} 缺少 tabAlias`);
  }

  data.nodes.forEach((node, index) => validateNode(node, index));
}

function validateNode(node, index) {
  const label = node.id || `nodes[${index}]`;
  assert(node.id, `${label} 缺少 id`);
  assert(node.action, `${label} 缺少 action`);
  assert(node.generatedInstruction, `${label} 缺少 generatedInstruction`);

  if (node.action?.startsWith("tab_")) {
    assert(node.fromTab || node.toTab, `${label} 标签页节点必须包含 fromTab 或 toTab`);
    if (node.fromTab) assert(node.fromTab.tabAlias, `${label}.fromTab 缺少 tabAlias`);
    if (node.toTab) assert(node.toTab.tabAlias, `${label}.toTab 缺少 tabAlias`);
  } else {
    assert(node.tab?.tabAlias, `${label} 普通操作节点缺少 tab.tabAlias`);
    if (node.target?.boundingBox) validateBox(node.target.boundingBox, `${label}.target.boundingBox`);
  }
}

function validateArticleSteps(steps) {
  assert(steps.length > 0, "ArticleStep 不能为空");
  steps.forEach((step) => {
    assert(step.id, "ArticleStep 缺少 id");
    assert(step.nodeId, `${step.id} 缺少 nodeId`);
    assert(step.type === "operation" || step.type === "tab_transition", `${step.id} type 非法`);
    assert(step.title, `${step.id} 缺少 title`);
    assert(step.description, `${step.id} 缺少 description`);
    if (step.type === "tab_transition") {
      assert(step.fromTabAlias || step.toTabAlias, `${step.id} 标签页步骤缺少 from/to alias`);
    }
  });
}

function validateTimeline(timeline) {
  assert(timeline.version, "timeline.version 必填");
  assert(Array.isArray(timeline.segments), "timeline.segments 必须是数组");
  assert(timeline.segments.length > 0, "timeline.segments 不能为空");
  assert(timeline.duration === timeline.segments.at(-1).endTime, "timeline.duration 必须等于最后片段 endTime");

  let cursor = 0;
  for (const segment of timeline.segments) {
    assert(segment.startTime === cursor, `${segment.id} startTime 不连续`);
    assert(segment.endTime > segment.startTime, `${segment.id} endTime 必须大于 startTime`);
    assert(segment.caption, `${segment.id} 缺少 caption`);
    if (segment.type === "tab_transition") {
      assert(segment.storyboardVisualType === "tab_transition", `${segment.id} storyboardVisualType 必须为 tab_transition`);
      assert(segment.fromTabAlias || segment.toTabAlias, `${segment.id} 缺少 from/to alias`);
    }
    cursor = segment.endTime;
  }
}

function validateBox(box, label) {
  ["x", "y", "width", "height"].forEach((key) => {
    assert(Number.isFinite(box[key]), `${label}.${key} 必须是数字`);
  });
  assert(box.width >= 0, `${label}.width 不能为负`);
  assert(box.height >= 0, `${label}.height 不能为负`);
}

function assert(condition, message) {
  if (!condition) errors.push(message);
}
