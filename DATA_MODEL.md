# SOP Recorder 数据模型

本文档定义 MVP 阶段的数据契约。插件录制、SOP 文章、视频时间轴都应围绕这些结构流转。

## 1. RecordingSession

```json
{
  "id": "rec_sample_zkbiotime",
  "browser": "Chrome",
  "startedAt": "2026-07-22T10:00:00+08:00",
  "endedAt": "2026-07-22T10:03:00+08:00",
  "status": "completed"
}
```

要求：

- `id` 必填，作为录制会话唯一标识。
- `browser` MVP 固定为 `Chrome`。
- `startedAt` 必填。
- `status` 可为 `recording`、`paused`、`completed`、`idle`。

## 2. TabContext

```json
{
  "tabId": 101,
  "tabAlias": "标签页 A：ZKBio TimeCloud 注册页",
  "windowId": 1,
  "firstUrl": "https://biotimecloud.info/onboard/sign-in",
  "currentUrl": "https://biotimecloud.info/onboard/sign-in",
  "title": "ZKBio TimeCloud",
  "domain": "biotimecloud.info"
}
```

要求：

- `tabId` 必填。
- `tabAlias` 必填，用于文章和视频展示。
- `domain` 建议必填。
- `firstUrl` 和 `currentUrl` 用于区分同一标签页内跳转。

## 3. OperationNode

普通操作节点：

```json
{
  "id": "node_001",
  "sequence": 1,
  "action": "click",
  "tab": {
    "tabId": 101,
    "tabAlias": "标签页 A：ZKBio TimeCloud 注册页",
    "domain": "biotimecloud.info"
  },
  "target": {
    "type": "button",
    "text": "SIGN UP",
    "boundingBox": {
      "x": 860,
      "y": 520,
      "width": 160,
      "height": 44
    }
  },
  "generatedInstruction": "在登录页点击 SIGN UP，进入新用户注册流程。",
  "status": "auto_generated"
}
```

标签页节点：

```json
{
  "id": "node_003",
  "sequence": 3,
  "action": "tab_open",
  "fromTab": {
    "tabId": 101,
    "tabAlias": "标签页 A：ZKBio TimeCloud 注册页",
    "url": "https://biotimecloud.info/onboard/sign-in"
  },
  "toTab": {
    "tabId": 102,
    "tabAlias": "标签页 B：邮箱收件箱",
    "url": "https://mail.example.com"
  },
  "reason": "user_switch",
  "generatedInstruction": "打开标签页 B：邮箱收件箱，查收账号激活邮件。",
  "status": "auto_generated"
}
```

要求：

- `id` 必填。
- `action` 必填。
- 普通操作节点必须有 `tab`。
- 普通操作节点建议有 `target` 和 `target.boundingBox`，用于焦点高亮。
- `tab_open`、`tab_switch`、`tab_close` 必须包含 `fromTab` 或 `toTab`。
- 标签页切换节点必须能生成 `fromTabAlias` 和 `toTabAlias`，用于文章和视频标注。
- `generatedInstruction` 必填或可由共享库根据 action 自动生成。

## 4. ArticleStep

由 `extension/shared/artifacts.js` 的 `buildArticleSteps(nodes)` 生成。

```json
{
  "id": "article_step_003",
  "nodeId": "node_003",
  "sequence": 3,
  "type": "tab_transition",
  "title": "打开标签页 B：邮箱收件箱",
  "description": "打开标签页 B：邮箱收件箱，查收账号激活邮件。",
  "tabAlias": "标签页 B：邮箱收件箱",
  "fromTabAlias": "标签页 A：ZKBio TimeCloud 注册页",
  "toTabAlias": "标签页 B：邮箱收件箱",
  "focusMode": "none",
  "privacyWarnings": [],
  "editStatus": "auto"
}
```

要求：

- `type` 可为 `operation` 或 `tab_transition`。
- `tab_transition` 必须保留 `fromTabAlias` 或 `toTabAlias`。
- 普通操作步骤如有 `focusBox`，文章渲染器应绘制焦点高亮。

## 5. VideoTimeline

由 `buildVideoTimeline(articleSteps)` 生成。

```json
{
  "version": "0.1.0",
  "duration": 18,
  "segments": [
    {
      "id": "segment_003",
      "stepId": "article_step_003",
      "type": "tab_transition",
      "startTime": 9,
      "endTime": 11,
      "caption": "打开标签页 B：邮箱收件箱，查收账号激活邮件。",
      "currentTabAlias": "标签页 B：邮箱收件箱",
      "fromTabAlias": "标签页 A：ZKBio TimeCloud 注册页",
      "toTabAlias": "标签页 B：邮箱收件箱",
      "storyboardVisualType": "tab_transition"
    }
  ]
}
```

要求：

- `duration` 必须等于最后一个 segment 的 `endTime`。
- `segments` 必须按时间递增。
- `tab_transition` 片段必须有 `fromTabAlias` 或 `toTabAlias`。
- `storyboardVisualType` 对标签页切换必须为 `tab_transition`。

## 6. 共享构建规则

以下逻辑只能维护在一处：

```text
extension/shared/artifacts.js
```

使用方：

- 扩展预览页：导出 SOP 文章和视频时间轴。
- 离线工具：生成 `dist/article.html`、`dist/video-timeline.json`、`dist/video-storyboard.html`。

不要在扩展端和离线端分别维护 `tab_transition` 规则。
