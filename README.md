# SOP Recorder MVP

这是一个用于验证 SOP 自动生成产品核心闭环的 Chrome 插件原型。

当前能力：

- 录制点击、输入、选择、勾选、单选、表格单元格、上传文件、提交，以及 Enter/Escape 键盘关键动作等基础网页操作。
- 同一输入框的连续输入会自动合并为一个节点，减少流水账步骤。
- 输入防抖期间如果用户立即点击、提交表单、刷新、离开或隐藏页面，会先刷新待发送输入，降低最后一次输入漏记风险。
- 同一目标的快速重复点击会自动合并，并保留最后一次点击截图。
- 预览页可将同一表单内连续填写的多个字段手动合并为一个“填写表单”步骤，并继承子字段的隐私风险和打码区域。
- 目标元素名称会按可见文本、aria-label、label、placeholder、title、邻近文本、name/id 兜底识别。
- 目标元素会保存安全 `target.attributes` 摘要，例如 tagName、role、href、inputType、required、disabled、checked，用于复现操作但不保存输入值；链接 `href` 只保留不含查询串和片段的安全路径。
- 录制节点和标签页上下文中的页面 URL 也只保留不含查询串和片段的安全路径，避免会话 token 或筛选条件进入导出文件。
- 点击图标、按钮内部文字或表格单元格内部内容时，会归一到最近的可操作元素，避免高亮框落在过小的子节点上。
- 空白区域和普通布局容器点击会被过滤，带 `role`、`onclick`、`tabindex` 或 pointer 光标的自定义控件仍会记录。
- 操作节点会记录事件发生时的视口尺寸、`devicePixelRatio` 和 `scrollX/scrollY`，截图元数据也会保留滚动偏移，便于校准高亮位置。
- 点击节点会记录 `clickPoint`，用于保留用户实际点击坐标，辅助复现和排查高亮偏移。
- 键盘关键动作会在 HTML、Markdown、Word 兼容导出、视频分镜和视频帧中显示按键名称。
- 目标元素会记录可见性；不可见或 0 尺寸目标不会生成坏步骤或坏高亮。
- 记录当前标签页上下文。
- 记录新标签页打开、标签页切换和关闭。
- 浏览器内部页、扩展页和 DevTools 页面不会进入录制上下文，也不会切断前后两个业务页之间的标签页切换关系。
- 如果从浏览器内部页开始录制，当前业务标签页保持为空，直到进入第一个可记录页面。
- 初始 about:blank 的新标签页会在真实 URL 出现后补记 tab_open，并保留触发点击节点；真实浏览器内部页不会进入这个延迟队列。
- 没有后续有效操作的标签页切换，以及短暂切到其他页又切回原业务页的往返切换，不会进入最终文章或视频。
- 记录同一标签页内的页面变化，等待目标页面加载完成后截图；同域同系统内的页面变化会合并到触发操作里，跨域变化才作为独立页面变化步骤。
- 记录页面弹窗出现和关闭，并在 SOP 文章和视频中作为普通步骤展示。
- 点击或提交触发页面跳转时，会把操作节点和 `navigation` 节点双向关联，方便回溯“哪个操作导致了跳转”。
- 点击触发新标签页打开时，也会把操作节点和 `tab_open` 节点双向关联。
- 记录耗时较长的页面加载等待节点，并跳过紧跟页面跳转的重复等待提示。
- 为操作节点截图。
- 截图元数据会记录 `captureTiming`，区分点击前优先截图、输入/选择/弹窗后截图和跳转后截图。
- 在预览页中显示步骤、当前标签页和焦点高亮。
- 预览页侧栏会显示步骤分组和组内步骤锚点，长流程可以快速跳转。
- SOP 文章和视频帧会基于高亮区域生成局部放大预览，帮助读者快速看到操作目标。
- 在预览页中编辑步骤标题和说明，也可恢复自动文案；支持删除/恢复、合并/拆分、调整顺序。
- 在预览页中设置单个步骤的视频片段时长，覆盖自动估算时长，也可恢复自动估算。
- Popup 支持开始、暂停、继续、停止，并在不同状态下禁用不适用操作。
- 手动调整高亮区域并可恢复自动高亮；也可为截图添加或清除打码区域。
- 自动识别密码、验证码、邮箱、手机号、身份证号、银行卡号等敏感字段，默认脱敏并生成截图打码区域。
- 输入、选择和上传节点只持久化 `maskedValue`，不会保存 `rawValue`；旧字段 `value` 仅作为兼容别名。
- Popup 和预览页导出前都会显示隐私检查结果，提示仍含敏感信息但未手动打码的步骤。
- 导出录制 JSON 时，含敏感信息或打码区域的步骤会移除原始截图 `dataUrl`，只保留截图元数据和 `redactedForPrivacy` 标记。
- 导出 SOP 文章、Markdown、Word 兼容文档和视频时间轴时，如步骤已有可靠打码区域，会保留截图并叠加遮挡；没有可靠打码区域的敏感截图才会移除原始 `dataUrl`。
- 导出录制 JSON。
- 从预览页直接导出 SOP 文章 HTML、Markdown、Word 兼容 `.doc` 和视频时间轴 JSON。
- 离线工具可基于 SOP HTML 生成基础 PDF，用于归档和分享。
- SOP 文章按操作步骤导出，避免把同一系统内的路径变化写成章节教学。
- 视频时间轴默认只输出步骤片段，不插入章节开场片段。
- 可在预览页为单个步骤设置视频旁白，让视频字幕/口播和 SOP 文章说明分开调整，也可恢复使用步骤说明。
- 视频时间轴和视频帧会复用同一批步骤截图、高亮、页面跳转和打码数据；MP4 画面以页面截图为主体，操作说明作为底部字幕展示，不在画面中显示“几秒到几秒”的时间范围。

## 本地运行

1. 打开 Chrome。
2. 进入 `chrome://extensions/`。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择 `C:\Users\Administrator\Documents\article\extension`。
6. 打开任意普通网页，点击扩展图标开始录制。
7. 操作页面后，点击“打开预览”查看 SOP 节点。

更完整的手动验收流程见 [TESTING.md](C:/Users/Administrator/Documents/article/TESTING.md)。

## 本地测试流程

仓库内置了三个静态测试页，用于验证多标签页 SOP 场景：

- `test-pages/index.html`：模拟注册页。
- `test-pages/mail.html`：模拟邮箱激活页。
- `test-pages/company.html`：模拟公司创建页。

推荐验证步骤：

1. 启动本地静态服务：

```powershell
python -m http.server 8080
```

2. 在 Chrome 中打开 `http://localhost:8080/test-pages/index.html`。
3. 点击扩展图标，开始录制。
4. 在注册页填写 Email、Phone、Password，勾选协议，点击 `SIGN UP`。
5. 点击 `打开邮箱收件箱`，浏览器会新开邮箱标签页。
6. 在邮箱标签页点击 `Activate Account`。
7. 在公司创建页填写公司名称、选择 Location、勾选协议、点击 `Confirm`。
8. 点击扩展图标，打开预览页，检查是否出现普通操作步骤和“标签页切换”步骤。

如果直接打开 `file://` 页面，需要在 Chrome 扩展详情中开启“允许访问文件网址”；更推荐使用上面的本地 HTTP 服务。

## 生成离线示例

不安装插件也可以先验证文章和视频时间轴生成：

```powershell
node tools/generate_artifacts.js
```

命令会读取 `examples/sample-recording.json`，生成：

- `dist/article.html`
- `dist/article.md`
- `dist/article.doc`
- `dist/video-timeline.json`
- `dist/video-storyboard.html`

示例数据覆盖了“业务系统注册页 -> 邮箱标签页 -> 切回业务系统”的多标签页流程。

也可以使用 npm 脚本：

```powershell
npm run generate
npm run generate:pdf
npm run verify
```

`npm run generate:pdf` 需要本机安装 Chrome，脚本会把 `dist/article.html` 打印为 `dist/article.pdf`。`npm run verify` 会检查 manifest、JS 语法、schema 契约、录制状态一致性、离线生成产物、视频时间轴、多标签页标注、页面跳转和弹窗标注、编辑器能力、同表单字段合并、隐私打码链路和视频帧渲染。

数据模型契约见 [DATA_MODEL.md](C:/Users/Administrator/Documents/article/DATA_MODEL.md)。

## 打包扩展

运行：

```powershell
npm run package:extension
```

产物：

- `dist/package/sop-recorder-mvp/`
- `dist/package/sop-recorder-mvp.zip`

`dist/package/sop-recorder-mvp/` 可以作为已解压扩展目录加载；zip 用于分发测试。

## 生成视频帧和 MP4

当前脚本已经能把 `dist/video-timeline.json` 转成视频帧：

```powershell
npm run render-video:frames
```

产物：

- `dist/video/frames/*.svg`
- `dist/video/concat.txt`

如果本机安装了 Chrome 和 FFmpeg，可以运行：

```powershell
npm run render-video
```

该命令会先把 SVG 帧渲染为 `dist/video/png-frames/*.png`，再在 `dist/video/sop-video.mp4` 输出基础 MP4。没有安装 Chrome 或 FFmpeg 时，脚本会保留已生成的 SVG 视频帧并提示安装依赖。

## 文件结构

```text
extension/
  manifest.json
  background.js
  db.js
  content.js
  popup.html
  popup.css
  popup.js
  shared/
    artifacts.js
  viewer.html
  viewer.css
  viewer_artifacts.js
  viewer.js
PRD.md
DEVELOPMENT_DESIGN.md
DATA_MODEL.md
TESTING.md
examples/
test-pages/
tools/
package.json
```

## 当前限制

- 还没有后端服务。
- PDF 当前为基于 SOP HTML 的基础打印导出，尚未做精细排版；Word 支持为兼容 `.doc` 文档，复用 SOP 文章内容。
- 当前已支持基于截图生成 SVG 视频帧；如本机安装 Chrome 和 FFmpeg，可进一步通过 PNG 中间帧合成 MP4。
- 录制状态存储在 `chrome.storage.local`；截图 dataUrl 存储在 IndexedDB。重新开始录制或清空时会清理已知旧截图；单次录制会保留最近 120 张截图，超出后淘汰最早截图并保留步骤文本和截图元数据。
- 多标签页已记录为节点，并会按下一次真实操作过滤没有业务意义的切换和短暂往返切换；复杂多窗口并行录制还未支持。
