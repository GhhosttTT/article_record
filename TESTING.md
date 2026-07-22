# SOP Recorder MVP 测试说明

## 1. 自动验收

运行：

```powershell
npm run verify
```

该命令会检查：

- `manifest.json` 是否为 MV3。
- 插件和工具脚本语法。
- 离线文章、视频时间轴、视频分镜是否可生成。
- 视频时间轴是否包含 `tab_transition`。
- 视频 SVG 帧是否标注来源标签页和目标标签页。
- 测试页是否覆盖注册、邮箱激活、创建公司。
- 扩展预览页是否支持导出 SOP 文章和视频时间轴。

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
2. 在注册页填写 Email。
3. 填写 Phone。
4. 填写 Password。
5. 勾选协议。
6. 点击 `SIGN UP`。
7. 点击 `打开邮箱收件箱`，浏览器应新开邮箱标签页。
8. 在邮箱标签页点击 `Activate Account`。
9. 在公司创建页填写 Company Name。
10. 选择 Location。
11. 勾选协议。
12. 点击 `Confirm`。
13. 点击扩展图标，点击“打开预览”。

## 5. 预期结果

预览页应出现：

- 普通操作步骤，例如点击、输入、勾选、选择。
- 当前步骤所在标签页名称。
- 操作截图和焦点高亮。
- 至少一个“标签页切换”步骤。
- 从注册页打开邮箱页的切换说明。

导出按钮应可用：

- `导出录制 JSON`
- `导出 SOP 文章`
- `导出视频时间轴`

视频时间轴中应包含：

```json
{
  "type": "tab_transition",
  "fromTabAlias": "标签页 A：...",
  "toTabAlias": "标签页 B：..."
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
- `dist/video-timeline.json`
- `dist/video-storyboard.html`
- `dist/video/frames/*.svg`
- `dist/video/concat.txt`

## 7. 常见问题

### 7.1 截图没有出现

可能原因：

- 当前页面是 `chrome://`、扩展页或浏览器内部页面。
- Chrome 对当前页面截图权限受限。
- 录制时未处于 `recording` 状态。

### 7.2 file 页面无法录制

更推荐使用本地 HTTP 服务。如果必须录制 `file://` 页面，需要在扩展详情中开启“允许访问文件网址”。

### 7.3 没有生成 MP4

当前机器需要安装 FFmpeg。没有 FFmpeg 时，仍可生成 SVG 视频帧和 concat 清单。

### 7.4 标签页切换太多

当前 MVP 已做基础去重，但真实业务中仍可能出现多余切换步骤。后续应继续加强规则：

- 没有后续有效操作的 tab 切换不进入最终 SOP。
- 短时间内多次往返切换只保留最后一次有效切换。
