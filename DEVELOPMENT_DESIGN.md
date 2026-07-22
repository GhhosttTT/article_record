# SOP 操作手册与视频生成插件开发设计文档

## 1. 文档目标

本文档用于指导 MVP 阶段开发，基于 [PRD.md](C:/Users/Administrator/Documents/article/PRD.md) 细化工程架构、模块边界、核心数据模型、事件采集规则、截图聚焦渲染、文章生成、视频生成和多浏览器标签页切换场景。

MVP 目标是先跑通以下闭环：

```text
Chrome 插件录制
-> 事件采集
-> 操作节点生成
-> 截图与焦点标注
-> HTML SOP 文章生成
-> 截图合成 MP4 视频
```

## 2. 总体架构

### 2.1 模块划分

```text
Chrome Extension
  - Popup UI：开始、暂停、继续、停止录制
  - Background Worker：录制状态、tab 管理、截图、事件汇总
  - Content Script：DOM 事件监听、元素识别、坐标采集
  - Local Store：IndexedDB 临时保存录制会话

Web App
  - Flow Editor：步骤编辑器
  - Focus Renderer：截图高亮、放大、打码
  - Article Renderer：HTML SOP 渲染
  - Video Timeline Editor：视频片段与字幕预览

Backend
  - API Service：流程、节点、截图、导出任务
  - Storage：图片、视频、导出文件
  - AI Service：步骤说明润色
  - Video Service：FFmpeg 合成 MP4
```

### 2.2 MVP 技术建议

- 插件：Chrome Extension Manifest V3。
- 前端：React + TypeScript。
- 本地临时存储：IndexedDB。
- 后端：Node.js 或 Python，先保持接口简单。
- 数据库：PostgreSQL。
- 对象存储：本地文件或 S3 兼容存储，MVP 可先本地化。
- 视频合成：FFmpeg。
- 截图处理：前端 Canvas 优先，后端可做批量导出渲染。

## 3. 核心数据流

### 3.1 录制数据流

```text
用户操作页面
-> Content Script 捕获 DOM 事件
-> 提取目标元素信息和坐标
-> 发送 raw event 到 Background Worker
-> Background Worker 判断录制状态和当前 tab
-> 调用截图能力获取当前可视区域截图
-> 生成候选 OperationNode
-> 写入 IndexedDB
-> 停止录制后上传或导入 Web App
```

### 3.2 编辑和生成数据流

```text
OperationNode[]
-> Node Processor 合并/过滤节点
-> ArticleStep[]
-> 用户编辑标题、说明、顺序、焦点区域
-> Article Renderer 生成 HTML SOP
-> Video Timeline Builder 生成 VideoSegment[]
-> Video Service 合成 MP4
```

## 4. Chrome 插件设计

### 4.1 Popup UI

Popup 只负责轻量控制，不承担复杂编辑。

功能：

- 开始录制。
- 暂停录制。
- 继续录制。
- 停止录制。
- 显示当前录制状态。
- 显示已捕获步骤数量。
- 打开编辑器。

### 4.2 Background Worker

职责：

- 维护录制会话状态。
- 管理多标签页上下文。
- 接收 content script 事件。
- 触发截图。
- 写入 IndexedDB。
- 对事件进行基础去重。

关键状态：

```ts
type RecorderStatus = "idle" | "recording" | "paused" | "stopping";

interface RecorderRuntimeState {
  sessionId: string;
  status: RecorderStatus;
  activeTabId: number | null;
  tabContexts: Record<number, TabContext>;
  nodeCount: number;
}
```

### 4.3 Content Script

职责：

- 监听 click、input、change、submit、keydown 等事件。
- 提取目标元素信息。
- 计算元素 bounding box。
- 识别敏感字段。
- 将事件发送给 Background Worker。

MVP 事件监听：

- `click`：按钮、链接、菜单项、表格操作入口。
- `input/change`：输入框、下拉框、复选框、单选框。
- `submit`：表单提交。
- `visibilitychange`：页面可见性变化，可辅助判断 tab 切换。

## 5. 多标签页场景设计

多浏览器标签页切换是必须记录的场景。产品需要区分“同一页面内跳转”和“切换到另一个标签页继续操作”。文章和视频中都要明确标注，让读者知道当前步骤发生在哪个标签页。

### 5.1 需要支持的场景

MVP 应优先支持以下场景：

1. 用户在 A 标签页点击链接，新开 B 标签页。
2. 用户手动从 A 标签页切换到 B 标签页继续操作。
3. 用户在 B 标签页完成操作后，切回 A 标签页。
4. 用户在多个业务系统之间切换，例如系统页面和邮箱页面。
5. 用户在同一站点多个标签页中处理不同对象。

MVP 暂不优先支持：

- 多浏览器窗口并行录制。
- 跨浏览器录制。
- 浏览器外桌面应用。

### 5.2 TabContext 数据模型

```ts
interface TabContext {
  tabId: number;
  tabAlias: string;
  windowId: number;
  openerTabId?: number;
  firstUrl: string;
  currentUrl: string;
  title: string;
  createdAt: string;
  lastActiveAt: string;
  domain: string;
}
```

`tabAlias` 用于文章和视频展示，建议自动生成：

```text
标签页 A：ZKBio TimeCloud 登录页
标签页 B：邮箱激活页面
标签页 C：公司创建页面
```

### 5.3 Tab 事件模型

新增节点类型：

```ts
type OperationAction =
  | "click"
  | "input"
  | "select"
  | "check"
  | "submit"
  | "navigation"
  | "wait"
  | "tab_open"
  | "tab_switch"
  | "tab_close";
```

Tab 相关节点：

```ts
interface TabOperationNode {
  id: string;
  action: "tab_open" | "tab_switch" | "tab_close";
  timestamp: number;
  fromTabId?: number;
  toTabId?: number;
  fromTabAlias?: string;
  toTabAlias?: string;
  reason: "user_switch" | "link_opened" | "window_open" | "system_detected";
  pageUrl?: string;
  pageTitle?: string;
  screenshot?: ScreenshotRef;
  generatedInstruction: string;
}
```

### 5.4 Tab 切换记录规则

应生成 Tab 节点：

- 当前活跃 tab 发生变化，且录制状态为 recording。
- 新 tab 由当前录制中的 tab 打开。
- 用户切换到已存在 tab，并在其中发生下一步有效操作。
- 从邮箱、第三方认证、支付、后台管理等页面切回原业务系统。

应合并或过滤：

- 用户快速切换 tab 但没有后续有效操作，默认不生成最终文章步骤。
- 同一秒内多次来回切换，只保留最后一次有效切换。
- 插件自身页面、空白页、浏览器设置页不进入最终 SOP。

### 5.5 文章中的标注方式

文章中应把 tab 切换作为特殊步骤或章节提示展示。

示例 1：新开标签页

```text
步骤 7：切换到邮箱激活页面

系统已从“标签页 A：ZKBio TimeCloud 注册页”打开“标签页 B：邮箱收件箱”。请在新标签页中查收激活邮件。
```

示例 2：切回业务系统

```text
步骤 10：返回 ZKBio TimeCloud 登录页

完成邮箱激活后，切回“标签页 A：ZKBio TimeCloud 登录页”，继续登录操作。
```

文章 UI 建议：

- 普通操作步骤使用数字步骤。
- Tab 切换步骤使用特殊标签：`标签页切换`。
- 截图上方显示当前 tab 名称和域名。
- 如果一个章节跨多个 tab，章节标题下展示涉及的 tab 列表。

### 5.6 视频中的标注方式

视频中应在 tab 切换时间点展示明显提示。

默认表现：

- 显示 1-2 秒过渡片段。
- 文案示例：`切换到标签页 B：邮箱收件箱`。
- 显示从 A 到 B 的箭头或简化标签页条。
- 切换后的步骤字幕中持续显示当前 tab 名称 1-2 秒。

VideoSegment 示例：

```ts
interface VideoSegment {
  id: string;
  stepId: string;
  type: "operation" | "tab_transition" | "chapter_intro";
  startTime: number;
  endTime: number;
  visual: string;
  caption: string;
  currentTabAlias?: string;
  fromTabAlias?: string;
  toTabAlias?: string;
  highlight?: FocusBox;
}
```

## 6. 操作节点模型

### 6.1 OperationNode

```ts
interface OperationNode {
  id: string;
  sessionId: string;
  sequence: number;
  action: OperationAction;
  timestamp: number;
  tab: {
    tabId: number;
    tabAlias: string;
    windowId: number;
    url: string;
    title: string;
    domain: string;
  };
  target?: ElementTarget;
  clickPoint?: Point;
  screenshot?: ScreenshotRef;
  beforeUrl?: string;
  afterUrl?: string;
  privacy: PrivacyMeta;
  rawEventRef?: string;
  generatedInstruction: string;
  status: "candidate" | "auto_generated" | "reviewed" | "discarded";
}
```

### 6.2 ElementTarget

```ts
interface ElementTarget {
  type: "button" | "link" | "input" | "password" | "checkbox" | "radio" | "select" | "menuitem" | "upload" | "table_cell" | "unknown";
  text?: string;
  ariaLabel?: string;
  placeholder?: string;
  labelText?: string;
  name?: string;
  id?: string;
  selector?: string;
  boundingBox: Box;
}
```

### 6.3 坐标类型

```ts
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  coordinateSpace: "viewport-css-pixel";
}

interface Point {
  x: number;
  y: number;
  coordinateSpace: "viewport-css-pixel";
}

interface ScreenshotRef {
  id: string;
  path: string;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  capturedAt: string;
}
```

## 7. 节点处理规则

### 7.1 生成节点

生成节点前应判断：

- 当前是否处于 recording。
- 事件是否来自可记录页面。
- 目标元素是否可见。
- 事件是否具备业务意义。
- 是否需要立即截图。

### 7.2 合并节点

合并规则：

- 同一输入框连续输入合并为一个输入节点。
- 同一表单多个字段可合并为“填写表单”节点，MVP 默认不自动合并跨字段，先在编辑器中支持手动合并。
- 点击后 2 秒内 URL 变化或 tab 变化，应将变化作为点击节点的结果信息。
- 快速重复点击同一元素，只保留最后一次。

### 7.3 过滤节点

过滤规则：

- 空白区域点击。
- 无页面变化且无目标文本的点击。
- 插件自身 UI 操作。
- 浏览器内部页面。
- 未产生后续有效步骤的快速 tab 切换。

## 8. 截图与焦点渲染设计

### 8.1 截图时机

- 点击：优先点击前截图，必要时补点击后截图。
- 输入：输入完成后截图。
- 下拉：选项展开时截图，若无法捕获则选择后截图。
- 跳转：跳转完成后截图。
- 弹窗：弹窗出现后截图。
- Tab 切换：切换后的 tab 首个有效操作前截图，或生成过渡片段截图。

### 8.2 坐标转换

DOM 坐标以 CSS pixel 记录，截图通常以 device pixel 记录。渲染时使用：

```text
screenshotX = domX * screenshot.width / viewportWidth
screenshotY = domY * screenshot.height / viewportHeight
screenshotWidth = domWidth * screenshot.width / viewportWidth
screenshotHeight = domHeight * screenshot.height / viewportHeight
```

不要只依赖 devicePixelRatio，因为浏览器截图尺寸可能受缩放、显示器和浏览器实现影响。应以实际截图尺寸与记录的 viewport 尺寸做换算。

### 8.3 焦点样式

MVP 默认样式：

- 目标区域外扩 12px。
- 高亮框颜色：蓝色或橙色。
- 边框宽度：3px。
- 背景遮罩：黑色 35% 透明度，可配置。
- 最小高亮区域：48px x 32px。

后续增强：

- 放大镜。
- 局部裁剪图。
- 箭头标注。
- 动画高亮。

## 9. 文章生成设计

### 9.1 ArticleStep

```ts
interface ArticleStep {
  id: string;
  nodeId: string;
  sequence: number;
  type: "operation" | "tab_transition" | "chapter_intro";
  title: string;
  description: string;
  tabAlias?: string;
  image?: string;
  focusBox?: Box;
  focusMode: "highlight" | "spotlight" | "zoom" | "none";
  privacyWarnings: string[];
  editStatus: "auto" | "reviewed";
}
```

### 9.2 HTML 文章结构

```text
标题
流程摘要
涉及系统/标签页列表
章节 1
  步骤 1
  步骤 2
  标签页切换提示
章节 2
  步骤 3
  步骤 4
```

每个步骤包含：

- 步骤编号。
- 步骤标题。
- 当前标签页标识。
- 操作说明。
- 焦点截图。
- 可选备注或风险提示。

## 10. 视频生成设计

### 10.1 视频生成策略

MVP 使用截图合成视频：

- 每个 ArticleStep 生成一个 VideoSegment。
- 普通操作片段展示步骤截图和高亮。
- tab_transition 片段展示标签页切换提示。
- 章节片段展示章节标题。
- 默认每个普通步骤 3-5 秒。
- 文案较长时按阅读速度延长。

### 10.2 时间计算

```text
baseDuration = 3s
readingDuration = caption.length / 8 charsPerSecond
segmentDuration = max(baseDuration, readingDuration)
```

### 10.3 FFmpeg 合成流程

```text
ArticleStep[]
-> Render frame image for each segment
-> Generate subtitle file
-> Optional TTS audio
-> FFmpeg concat images/audio/subtitles
-> output.mp4
```

MVP 可以先不做真实音频，仅生成字幕视频。

## 11. 隐私与安全设计

### 11.1 敏感字段识别

默认敏感：

- input[type=password]
- name/id/placeholder/label 包含 password、token、secret、otp、code、验证码
- 常见邮箱、手机号、身份证号、银行卡号模式

### 11.2 脱敏策略

- 节点数据默认保存 maskedValue。
- rawValue 默认不持久化。
- 截图中敏感输入区域自动加遮罩。
- 用户可在编辑器中手动打码截图区域。
- 导出前运行敏感信息检查。

## 12. API 草案

### 12.1 创建录制会话

```http
POST /api/recording-sessions
```

### 12.2 上传节点

```http
POST /api/recording-sessions/{sessionId}/nodes
```

### 12.3 上传截图

```http
POST /api/assets/screenshots
```

### 12.4 生成文章

```http
POST /api/flows/{flowId}/article:generate
```

### 12.5 生成视频

```http
POST /api/flows/{flowId}/video:generate
```

## 13. MVP 开发顺序

建议按以下顺序开发：

1. 插件录制状态控制。
2. content script 捕获 click/input/change。
3. background 截图和 IndexedDB 存储。
4. OperationNode 数据模型和导出 JSON。
5. Web 编辑器读取 JSON 并展示步骤。
6. Canvas 高亮渲染。
7. HTML SOP 生成。
8. 多标签页事件采集和文章标注。
9. 视频时间轴生成。
10. FFmpeg 截图合成视频。
11. 敏感字段自动脱敏和手动打码。

## 14. MVP 验证用例

必须覆盖：

1. 单页面登录流程。
2. 注册表单填写流程。
3. 下拉选择和复选框流程。
4. 点击后页面跳转流程。
5. 点击后打开新标签页，并在新标签页继续操作。
6. 邮箱激活后切回原系统。
7. 密码输入和验证码输入脱敏。
8. 生成 HTML SOP。
9. 生成包含标签页切换提示的 MP4。

## 15. 未决问题

- 是否 MVP 就接入后端，还是先用本地 JSON 文件完成原型。
- AI 文案润色是否在 MVP 启用，还是先用规则模板。
- TTS 配音是否进入 MVP，还是先只做字幕视频。
- 是否需要从第一版支持团队分享权限。
- 多窗口录制是否进入后续版本。
