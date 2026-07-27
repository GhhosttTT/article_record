# SOP Recorder MVP 测试说明

## 1. 自动验收

运行：

```powershell
npm run verify
```

该命令会检查：

- `manifest.json` 是否为 MV3。
- 插件和工具脚本语法。
- Popup 录制控制状态是否和导出会话状态一致。
- 离线文章、视频时间轴、视频分镜是否可生成。
- 示例录制数据是否满足 schema 契约。
- 视频时间轴是否包含 `tab_transition`。
- 页面跳转是否在目标页面加载完成后生成 `navigation` 步骤、保存截图元数据，并在文章、Markdown、视频分镜和 SVG 视频帧中标注。
- 页面弹窗出现和关闭是否生成 `modal_open` / `modal_close` 步骤，并进入文章和视频时间轴。
- 操作节点和截图元数据是否保存 `viewport`、`devicePixelRatio`、`scrollX/scrollY`，用于滚动和缩放场景下的高亮校准。
- 点击节点是否保存 `clickPoint`，并在 Markdown/Word 导出中保留点击坐标。
- 截图元数据是否保存 `captureTiming`，用于区分点击前、操作后、跳转后和等待后截图。
- 耗时较长的页面加载是否能生成 `wait` 节点，且紧跟页面跳转的重复等待不会污染最终步骤。
- 视频 SVG 帧是否标注来源标签页和目标标签页。
- 视频 SVG 帧是否能渲染真实截图、高亮框、局部放大预览和打码遮罩。
- 如本机安装 Chrome 和 FFmpeg，视频生成器是否能通过 PNG 中间帧输出非空 MP4。
- 测试页是否覆盖注册、邮箱激活、创建公司。
- 测试页是否覆盖单选按钮和表格单元格点击，并验证点击目标会归一到可操作元素。
- 空白区域点击是否被过滤，自定义可点击控件是否仍能记录。
- 扩展预览页是否支持导出 SOP 文章和视频时间轴。
- 扩展预览页是否支持导出 SOP Markdown 和 Word 兼容 `.doc`。
- 离线 PDF 导出脚本是否能复用 SOP HTML，并在本机 Chrome 可用时生成非空 `dist/article.pdf`。
- 扩展预览页是否显示章节列表，并能通过章节/步骤锚点快速定位长流程。
- SOP 文章 HTML/Markdown 是否按连续页面和标签页上下文生成章节，且章节只组织同一份 ArticleStep。
- 视频时间轴和 SVG 视频帧是否包含 `chapter_intro` 章节开场片段。
- 扩展预览页是否支持删除/恢复、合并/拆分、排序、编辑标题说明、恢复自动文案、调整高亮区域和恢复自动高亮。
- 扩展预览页是否支持将同一表单内连续字段手动合并为一个“填写表单”步骤，并继承子字段隐私风险和打码区域。
- 扩展预览页是否支持设置和恢复步骤视频时长，并在 VideoTimeline 中覆盖或恢复自动估算时长。
- 扩展预览页是否支持设置和恢复步骤视频旁白，并在 VideoTimeline caption 中覆盖或恢复文章说明。
- 密码、验证码、邮箱、手机号、身份证号、银行卡号等敏感字段是否自动脱敏、自动生成截图打码区域，并在 Popup 和预览页导出前提示隐私风险。
- 输入、选择、上传节点是否只保存 `maskedValue`，且不出现 `rawValue`。
- 录制 JSON 导出时，含敏感信息或打码区域的步骤是否移除原始截图 `dataUrl`，并保留 `redactedForPrivacy` 元数据。
- SOP 文章、Markdown、Word 兼容文档和视频时间轴导出时，含敏感信息或打码区域的步骤是否移除原始截图 `dataUrl`，并显示隐私裁剪提示或保留裁剪元数据。
- 文件上传控件是否生成 `upload` 节点，并且只保存脱敏后的文件名摘要。
- 同一输入框连续输入是否合并为一个节点，而不是每次停顿都生成新步骤。
- 输入后立即点击、提交、刷新、离开或隐藏页面时，防抖中的待发送输入是否会先刷新，避免最后一次输入漏记。
- 同一目标快速重复点击是否合并为一个节点，并保留最后一次点击截图。
- 同一表单内的连续输入、选择、上传、勾选字段是否可在预览页合并为一个表单步骤。
- 重新开始录制或清空录制时，旧步骤截图是否会被清理；单次长流程超过截图上限后，最早截图是否标记为 `pruned` 并从 IndexedDB 淘汰。
- 无 label 控件是否能通过 `title`、`name/id` 或邻近文本生成可读标题。
- 目标元素是否记录安全 `target.attributes`，并避免把输入 `value` 当作属性持久化；链接 `href` 不应包含查询串或片段。
- 录制节点和标签页上下文中的 URL 字段不应包含查询串或片段，例如 `beforeUrl`、`afterUrl`、`pageUrl`、`navigationTargetUrl`、`tabTargetUrl`、`tab.url`、`fromTab.url`、`toTab.url`、`firstUrl`、`currentUrl`。
- 浏览器内部页、扩展页和 DevTools 页面不应进入录制上下文，也不应留下 pending navigation 或 tab context；从业务页切到内部页再切到另一个业务页时，仍应保留两个业务页之间的上下文关系。
- 从浏览器内部页开始录制时，activeTabId 应保持为空，直到进入第一个可记录页面。
- 初始 about:blank 的新标签页应在真实 URL 出现后补记 tab_open，并保留 openerTabId 与触发点击节点关联；即使真实 URL 延迟出现，也不应丢失触发点击节点。真实浏览器内部页不应进入延迟 tab_open 队列。
- 没有后续有效操作的标签页切换、短暂切到其他页又切回原业务页的往返切换，是否不会进入最终 SOP 和视频时间轴。
- 不可见、视口外或 0 尺寸目标是否被过滤，且预览页和导出产物都不会生成错误高亮框。

## 2. 手动加载扩展

1. 打开 Chrome。
2. 访问 `chrome://extensions/`。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择：

```text
C:\Users\Administrator\Documents\article\extension
```

## 3. 启动本地测试页

在项目根目录运行：

```powershell
python -m http.server 8080
```

打开：

```text
http://localhost:8080/test-pages/index.html
```

## 4. 推荐手动测试流程

1. 点击扩展图标，点击“开始”。
2. 点击“暂停”，确认暂停后不会继续采集操作；点击“继续”恢复录制。
3. 在注册页填写 Email。
4. 填写 Phone。
5. 填写 Password。
6. 勾选协议。
7. 点击 `SIGN UP`。
8. 点击 `打开邮箱收件箱`，浏览器应新开邮箱标签页。
9. 在邮箱标签页点击 `Activate Account`。
10. 在公司创建页填写 Company Name。
11. 选择 Location。
12. 选择 Company Type 单选项。
13. 选择 Business License 文件。
14. 勾选协议。
15. 点击 `Review Details` 打开弹窗，再点击 `Close Review` 关闭弹窗。
16. 点击 Recent Companies 表格中的 `Acme Singapore` 单元格。
17. 点击 `Open Audit Trail` 自定义控件。
18. 点击 `Confirm`。
19. 点击扩展图标，点击“打开预览”。

## 5. 预期结果

预览页应出现：

- 普通操作步骤，例如点击、输入、勾选、选择。
- 当前步骤所在标签页名称。
- 侧栏章节列表，以及章节内步骤跳转入口。
- 操作截图和焦点高亮。
- 截图元数据应包含 `captureTiming`；点击节点应优先标记 `before_action_preferred`，跳转节点应标记 `after_navigation`。
- SOP 文章和视频帧应基于焦点区域显示局部放大预览。
- 节点数据中应保留事件发生时的视口尺寸、设备像素比和滚动偏移。
- 至少一个“标签页切换”步骤。
- 没有后续有效操作的临时标签页切换，以及短暂切到其他页又切回原业务页的往返切换，不应出现在最终步骤中。
- 同一标签页内跳转应显示为“页面跳转”步骤。
- 打开和关闭公司信息确认弹窗时，应出现 `modal_open` 和 `modal_close` 步骤，文章标题应区分“弹窗出现”和“关闭弹窗”。
- 点击或表单提交触发跳转时，原操作节点应记录 `triggeredNavigationNodeId`，对应 `navigation` 节点应记录 `triggeredByNodeId`。
- 点击触发新标签页打开时，原操作节点应记录 `triggeredTabNodeId`，对应 `tab_open` 节点应记录 `triggeredByNodeId`。
- 文件上传应显示为 `upload` 操作步骤，节点值只应包含脱敏文件名摘要，不应包含本地完整路径。
- 按 Enter 或 Escape 应生成 `key` 操作步骤；普通字符键和长按重复键不应生成步骤。
- Enter 键立即触发同一目标或同一表单 submit 时，不应重复生成 key 与 submit 两个步骤。
- `key` 操作步骤导出为 ArticleStep 和视频时间轴时，应继续保留结构化 `key` 字段。
- `key` 操作步骤导出为 HTML、Markdown、Word 兼容文档、视频分镜和视频帧时，应显示按键名称。
- 单选按钮应作为 `check` 操作步骤采集，`target.type` 应为 `radio`。
- 点击表格单元格内部文本时，节点 `target.type` 应为 `table_cell`，高亮区域应覆盖整个单元格而不是文字子节点。
- 点击普通空白区域或布局容器不应生成步骤；点击 `Open Audit Trail` 这类带 `tabindex` 的自定义控件应生成步骤。
- 同一输入框多次连续输入后，预览页应只保留一个输入步骤，并在节点数据中记录 `mergedEventCount`。
- 同一按钮快速重复点击后，预览页应只保留一个点击步骤，并在节点数据中记录 `mergedClickCount`。
- 没有 label 的输入框应仍能生成类似 `填写 Support Contact` 的可读标题。
- 目标 `visibility.canHighlight` 为 false 时，导出的 ArticleStep 应使用 `focusMode: "none"`。
- 从注册页打开邮箱页的切换说明。
- 可编辑步骤标题和说明，也可恢复自动标题和说明。
- 可删除/恢复步骤、合并/拆分已合并步骤、上移/下移调整顺序。
- 同一表单内连续字段应可合并为一个“填写表单”步骤；如子字段包含身份证号或银行卡号，合并后的主步骤仍应显示隐私检查提示并保留打码区域。
- 可调整高亮区域，也可恢复自动高亮。
- 可设置视频时长，导出后对应片段的 `endTime - startTime` 应等于设置值；恢复自动后应回到默认估算。
- 可设置视频旁白，导出后对应片段的 `caption` 应等于旁白，文章步骤说明不应被同步改写；恢复自动后应回到文章步骤说明。
- Email、Phone、Password 等敏感输入应显示隐私检查提示，并在截图中出现打码区域。
- Legal Representative ID、Billing Bank Card 等证件号/银行卡号输入也应显示隐私检查提示，节点值只能保留脱敏摘要。
- 节点数据中不应出现 `rawValue`；如存在旧兼容字段 `value`，必须与 `maskedValue` 完全一致。
- 点击 Popup 或预览页导出按钮前，如存在敏感步骤，应弹出隐私确认提示。
- 导出的录制 JSON 中，含敏感信息或打码区域的节点截图不应包含 `dataUrl`，应包含 `redactedForPrivacy`。
- 导出的 SOP 文章、Markdown 和视频时间轴中，含敏感信息或打码区域的步骤不应包含原始截图 `dataUrl`。

导出按钮应可用：

- `导出录制 JSON`
- `导出 SOP 文章`
- `导出 SOP Markdown`
- `导出 SOP Word`
- `导出视频时间轴`

文章导出中应包含“章节 1”“章节 2”等章节标题，章节内步骤编号仍沿用全流程顺序。

视频时间轴中应包含：

```json
{
  "type": "chapter_intro",
  "storyboardVisualType": "chapter_intro",
  "chapterId": "chapter_001"
}
```

```json
{
  "type": "tab_transition",
  "fromTabAlias": "标签页 A：...",
  "toTabAlias": "标签页 B：..."
}
```

页面跳转片段应包含：

```json
{
  "type": "navigation",
  "storyboardVisualType": "navigation",
  "fromUrl": "https://...",
  "toUrl": "https://...",
  "screenshot": {
    "viewportWidth": 1440,
    "viewportHeight": 900
  }
}
```

普通操作片段如有截图，应包含：

```json
{
  "type": "operation",
  "visual": "data:image/...",
  "screenshot": {
    "viewportWidth": 1440,
    "viewportHeight": 900
  },
  "highlight": {
    "x": 860,
    "y": 520,
    "width": 160,
    "height": 44
  },
  "privacyMaskBoxes": []
}
```

## 6. 离线生成验证

运行：

```powershell
npm run generate
npm run render-video:frames
```

应生成：

- `dist/article.html`
- `dist/article.md`
- `dist/article.doc`
- `dist/article.pdf`
- `dist/video-timeline.json`
- `dist/video-storyboard.html`
- `dist/video/frames/*.svg`
- `dist/video/concat.txt`

如本机安装 Chrome 和 FFmpeg，可继续运行：

```powershell
npm run render-video
```

应额外生成：

- `dist/video/png-frames/*.png`
- `dist/video/sop-video.mp4`

## 7. 常见问题

### 7.1 截图没有出现

可能原因：

- 当前页面是 `chrome://`、扩展页或浏览器内部页面。
- Chrome 对当前页面截图权限受限。
- 录制时未处于 `recording` 状态。

### 7.2 file 页面无法录制

更推荐使用本地 HTTP 服务。如果必须录制 `file://` 页面，需要在扩展详情中开启“允许访问文件网址”。

### 7.3 没有生成 MP4

当前机器需要安装 Chrome 和 FFmpeg。没有其中任一依赖时，仍可生成 SVG 视频帧；完整 MP4 路径会先用 Chrome 把 SVG 帧渲染为 PNG，再交给 FFmpeg 合成。

### 7.4 标签页切换太多

当前 MVP 已过滤没有后续有效操作的 tab 切换，并会按下一次真实操作判断短暂往返切换是否有业务意义；`tab_open` 后立即跟随的同目标 `tab_switch` 也会做基础去重。复杂多窗口并行录制仍未覆盖。
