# SOP Recorder MVP

这是一个用于验证 SOP 自动生成产品核心闭环的 Chrome 插件原型。

当前能力：

- 录制点击、输入、选择、勾选、提交等基础网页操作。
- 记录当前标签页上下文。
- 记录新标签页打开、标签页切换和关闭。
- 为操作节点截图。
- 在预览页中显示步骤、当前标签页和焦点高亮。
- 导出录制 JSON。
- 从预览页直接导出 SOP 文章 HTML 和视频时间轴 JSON。

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
- `dist/video-timeline.json`
- `dist/video-storyboard.html`

示例数据覆盖了“业务系统注册页 -> 邮箱标签页 -> 切回业务系统”的多标签页流程。

也可以使用 npm 脚本：

```powershell
npm run generate
npm run verify
```

`npm run verify` 会检查 manifest、JS 语法、离线生成产物、视频时间轴和多标签页标注。

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

如果本机安装了 FFmpeg，可以运行：

```powershell
npm run render-video
```

该命令会在 `dist/video/sop-video.mp4` 输出基础 MP4。没有安装 FFmpeg 时，脚本会保留已生成的视频帧并提示安装 FFmpeg。

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
- 还没有 PDF/Word 导出。
- 当前已支持生成视频帧；如本机安装 FFmpeg，可进一步合成 MP4。
- 录制状态存储在 `chrome.storage.local`；截图 dataUrl 存储在 IndexedDB，长流程仍需要后续做清理和容量管理。
- 多标签页已记录为节点，但复杂多窗口并行录制还未支持。
