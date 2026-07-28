# SOP Recorder 数据模型

本文档定义 MVP 阶段的数据契约。插件录制、SOP 文章、视频时间轴都应围绕这些结构流转。

录制 JSON 根对象只能包含 `session`、`tabContexts` 和 `nodes`；`ok`、运行时 `status`、`activeTabId`、`pendingNavigations`、`pendingTabOpens` 等后台临时状态不得进入导出契约。

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
- `status` 可为 `recording`、`paused`、`completed`、`idle`；停止录制后导出的会话应为 `completed`。

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
- `firstUrl` 和 `currentUrl` 用于区分同一标签页内跳转；持久化 URL 会去掉查询串和片段，只保留安全路径。

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
    "title": null,
    "nearbyText": null,
    "boundingBox": {
      "x": 860,
      "y": 520,
      "width": 160,
      "height": 44
    },
    "visibility": {
      "visible": true,
      "inViewport": true,
      "hasBox": true,
      "canHighlight": true,
      "reason": "visible"
    }
  },
  "generatedInstruction": "在登录页点击 SIGN UP，进入新用户注册流程。",
  "mergedClickCount": 1,
  "titleOverride": "点击 SIGN UP",
  "descriptionOverride": "点击 SIGN UP，进入新用户注册流程。",
  "mergedEventCount": 1,
  "focusBoxOverride": {
    "x": 852,
    "y": 512,
    "width": 176,
    "height": 60,
    "coordinateSpace": "viewport-css-pixel"
  },
  "privacyMaskBoxes": [],
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

页面跳转节点：

```json
{
  "id": "node_002",
  "sequence": 2,
  "action": "navigation",
  "fromTab": {
    "tabId": 101,
    "tabAlias": "标签页 A：ZKBio TimeCloud 注册页",
    "url": "https://biotimecloud.info/onboard/sign-in"
  },
  "toTab": {
    "tabId": 101,
    "tabAlias": "标签页 A：ZKBio TimeCloud 注册页",
    "url": "https://biotimecloud.info/onboard/register"
  },
  "pageUrl": "https://biotimecloud.info/onboard/register",
  "pageTitle": "ZKBio TimeCloud 注册表单",
  "generatedInstruction": "页面跳转到注册表单，继续填写新用户信息。",
  "status": "auto_generated"
}
```

要求：

- `id` 必填。
- `action` 必填。
- 普通操作节点必须有 `tab`。
- 普通操作节点建议有 `target` 和 `target.boundingBox`，用于焦点高亮。
- `target` 可包含 `text`、`ariaLabel`、`labelText`、`placeholder`、`title`、`nearbyText`、`name`、`id`，默认标题会按该顺序选择可读名称。
- `target.attributes` 记录可安全持久化的 DOM 属性摘要，例如 `tagName`、`role`、`href`、`target`、`inputType`、`required`、`disabled`、`checked`、`multiple`；不得记录 `value` 或其他原始输入内容。`href` 会去掉查询串和片段，只保留可复现但更安全的路径。
- `target.type` 可包含 `button`、`link`、`input`、`password`、`checkbox`、`radio`、`select`、`menuitem`、`upload`、`table_cell`、`table_row`、`dialog`、`form`、`page`、`unknown`。
- 点击事件应先归一到最近的可操作祖先元素，例如按钮、链接、菜单项、表格单元格或表格行；`target.boundingBox` 应来自归一后的元素，而不是内部图标或文字节点。
- 空白区域、`body`、普通布局容器等无业务意义点击不应生成节点；自定义控件应通过语义属性、`onclick`、`tabindex` 或 pointer 光标被识别为可记录目标。
- 表单控件的 `target.form` 记录所属表单元数据，包含 `selector` 以及可选的 `id`、`name`、`text`；预览页用它判断连续字段是否属于同一张表单。
- `target.visibility` 记录目标是否可见、是否在视口内、是否有尺寸、是否适合生成高亮；不可高亮目标不应生成 `focusBox`。
- 普通操作节点应保留事件发生时的 `viewport.width`、`viewport.height`、`viewport.devicePixelRatio`、`viewport.scrollX` 和 `viewport.scrollY`，用于还原滚动、缩放和截图坐标映射上下文。
- `click` 节点应保留 `clickPoint.x`、`clickPoint.y` 和 `coordinateSpace: "viewport-css-pixel"`，表示用户实际点击位置；该坐标可与 `target.boundingBox` 一起用于复现操作和排查高亮偏移。
- `upload` 节点的 `target.type` 应为 `upload`，`maskedValue` 只保存脱敏后的文件名摘要，不保存本地完整路径或文件内容；`value` 仅作为旧版本兼容别名，必须与 `maskedValue` 一致。
- `key` 节点只允许记录 `key: "Enter"` 或 `key: "Escape"`，用于保留提交、查询、关闭弹窗等关键键盘动作；不得记录普通字符键，避免形成键盘输入日志。
- Enter 键如果立即触发同一目标或同一表单的 `submit` 事件，后台应跳过重复 submit，避免一个用户意图生成两步；没有 submit 事件时仍保留 `key` 节点。
- 输入、选择、上传、勾选等节点不得持久化 `rawValue`；节点数据默认只保存 `maskedValue`。
- `tab_open`、`tab_switch`、`tab_close` 必须包含 `fromTab` 或 `toTab`。
- `navigation` 必须包含 `fromTab` 或 `toTab`，并建议保存 `pageUrl`、`pageTitle` 和跳转完成后的 `screenshot` 元数据；`pageUrl`、`beforeUrl`、`afterUrl`、`navigationTargetUrl`、`tabTargetUrl`、`tab.url`、`fromTab.url` 和 `toTab.url` 均不得包含查询串或片段。
- 点击或提交触发同标签页跳转时，触发操作节点可记录 `triggeredNavigationNodeId` 和 `navigationTargetUrl`；对应 `navigation` 节点可记录 `triggeredByNodeId`，用于追溯“哪个操作导致了页面变化”。
- 点击触发新标签页打开时，触发操作节点可记录 `triggeredTabNodeId` 和 `tabTargetUrl`；对应 `tab_open` 节点可记录 `triggeredByNodeId`，用于追溯“哪个操作打开了新标签页”。
- `wait` 节点表示页面加载或系统状态变化等待，建议包含 `waitDurationMs`，并使用当前页面作为 `target`。
- `modal_open` 和 `modal_close` 节点表示页面弹窗出现或关闭，`target.type` 应为 `dialog`，并保留弹窗标题、文本、选择器和 bounding box。
- `screenshot.pruned: true` 表示该步骤截图 dataUrl 已因容量上限从 IndexedDB 淘汰；步骤文本、尺寸元数据和导出顺序仍应保留。
- `screenshot.redactedForPrivacy: true` 表示录制 JSON 导出时已移除该步骤截图 `dataUrl`，但保留截图尺寸、ID 和隐私裁剪原因。
- `screenshot.scrollX` 和 `screenshot.scrollY` 记录截图时页面滚动偏移；高亮渲染当前使用 viewport CSS pixel 与截图视口尺寸换算，后续排查滚动/缩放错位时应优先参考这些元数据。
- `screenshot.captureTiming` 记录截图语义，可为 `before_action_preferred`、`after_action`、`after_navigation` 或 `after_wait`；点击节点优先表示操作前截图，输入/选择/上传/弹窗表示操作后截图，页面跳转表示跳转完成后截图。
- 标签页切换节点必须能生成 `fromTabAlias` 和 `toTabAlias`，用于文章和视频标注。
- `generatedInstruction` 必填或可由共享库根据 action 自动生成。
- `titleOverride` 和 `descriptionOverride` 为用户在预览页保存的人工文案，导出时优先于自动文案；字段不存在时表示恢复使用自动标题和说明。
- `mergedEventCount` 表示该节点合并了多少次同一输入框的连续输入事件；未出现时按 1 处理。
- content script 在点击、表单提交、页面隐藏或离页前会刷新防抖中的待发送输入事件，避免最后一次输入因页面生命周期变化而丢失。
- `mergedClickCount` 表示该节点合并了多少次同一目标的快速重复点击；未出现时按 1 处理。
- `focusBoxOverride` 为用户手动调整后的高亮区域，优先于 `target.boundingBox`；字段不存在时表示恢复自动高亮。
- `durationOverrideSeconds` 为用户手动设置的视频片段时长，允许 1 到 120 秒；字段不存在时表示恢复自动估算。
- `voiceoverText` 为用户手动设置的视频旁白/字幕文案；`voiceoverTextOverridden` 为 true 时表示该文案覆盖自动说明；字段不存在时表示恢复使用步骤说明。
- `privacyMaskBoxes` 为截图打码区域，坐标同样使用 viewport CSS pixel。
- `privacy.containsSensitiveData` 表示节点包含敏感信息；`privacy.reasons` 可包含 `email`、`phone`、`id_card`、`bank_card`、`sensitive_field` 等原因；`autoMaskApplied` 和 `manualMaskApplied` 分别表示自动/手动打码状态。
- `mergedNodeIds` 记录被合并进当前步骤的节点；被合并节点使用 `status: "discarded"` 和 `discardReason: "merged_into:<nodeId>"` 标记。
- `formMerge` 表示预览页手动合并了同一表单中的连续字段，包含 `formSelector`、`mergedFieldCount` 和 `mergedAt`；合并主节点必须继承所有子字段的 `privacy` 和 `privacyMaskBoxes`，拆分后会清除该字段。
- `status` 可为 `auto_generated`、`reviewed`、`discarded`。

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
  "focusBox": null,
  "privacyMaskBoxes": [],
  "privacyWarnings": [],
  "editStatus": "auto"
}
```

要求：

- `type` 可为 `operation`、`tab_transition` 或 `navigation`；`wait`、`modal_open`、`modal_close` 节点作为 `operation` 类型进入文章和视频。
- `tab_transition` 必须保留 `fromTabAlias` 或 `toTabAlias`。
- `navigation` 必须保留 `fromUrl`、`toUrl` 或 `pageUrl`，用于文章和视频标注页面变化；如有截图，应来自目标页面加载完成后。
- 没有后续有效操作证明其必要性的 `tab_transition` 不会进入最终 ArticleStep 或 VideoTimeline；短暂切到其他页又切回原业务页、且下一次真实操作仍发生在原业务页时，两次切换都应被过滤。
- 普通操作步骤如有 `focusBox`，文章渲染器应绘制焦点高亮。
- 文章和视频渲染器可基于同一个 `focusBox` 生成局部放大预览；该预览是渲染结果，不需要维护第二套坐标或截图。
- 如设置 `durationOverrideSeconds`，VideoTimeline 应优先使用该时长；否则按步骤类型和说明长度自动估算。
- 如设置 `voiceoverText`，VideoTimeline 的 `caption` 和 `voiceoverText` 应优先使用该旁白；ArticleStep 的 `description` 仍保留文章说明。
- `key` 节点生成的 ArticleStep 和 VideoTimeline segment 应继续保留结构化 `key` 字段，值只允许 `Enter` 或 `Escape`。
- `privacyMaskBoxes` 会在 SOP 文章和视频帧中渲染为遮罩。
- 导出文章、Markdown、Word 兼容文档和视频时间轴时，如步骤包含敏感信息或打码区域，应移除截图 `dataUrl`，设置 `imageRedactedForPrivacy` 或 `screenshot.redactedForPrivacy`，避免导出文件源码携带原始截图。
- 已删除节点不会生成 ArticleStep；合并后的主节点会保留合并说明。

## 5. ArticleChapter

由 `buildArticleChapters(articleSteps)` 按连续页面和标签页上下文生成，用于文章 HTML/Markdown 的章节组织。

```json
{
  "id": "chapter_001",
  "sequence": 1,
  "title": "ZKBio TimeCloud 注册表单",
  "tabAlias": "标签页 A：ZKBio TimeCloud 注册页",
  "pageTitle": "ZKBio TimeCloud 注册表单",
  "pageUrl": "https://biotimecloud.info/onboard/register",
  "steps": []
}
```

要求：

- `id` 和 `sequence` 必须按导出顺序连续生成。
- 每个章节必须有 `title` 和至少一个 `ArticleStep`。
- 章节只能组织现有 ArticleStep，不应维护另一套步骤文案、截图或视频字幕。

## 6. VideoTimeline

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
      "visual": null,
      "screenshot": null,
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
- `storyboardVisualType` 对页面跳转必须为 `navigation`。
- `chapter_intro` 片段用于视频章节开场，必须包含 `chapterId`，`storyboardVisualType` 必须为 `chapter_intro`。
- 普通操作片段的 `visual` 保存截图 dataUrl；`screenshot` 保存截图尺寸和视口尺寸。
- 如果 `screenshot.pruned` 为 true，`visual` 可以为空，视频和文章渲染器应降级为无截图展示。
- `highlight` 复用 ArticleStep 的 `focusBox`。
- `privacyMaskBoxes` 复用 ArticleStep 的打码区域，视频帧渲染器会叠加遮罩。

## 7. 共享构建规则

以下逻辑只能维护在一处：

```text
extension/shared/artifacts.js
```

使用方：

- 扩展预览页：导出 SOP 文章、Markdown、真正 `.docx` Word 文档和视频时间轴。
- 离线工具：生成 `dist/article.html`、`dist/article.md`、`dist/article.doc`、`dist/article.pdf`、`dist/video-timeline.json`、`dist/video-storyboard.html`。

不要在扩展端和离线端分别维护 `tab_transition` 规则。
