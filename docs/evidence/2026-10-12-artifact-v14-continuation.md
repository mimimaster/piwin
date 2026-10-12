# Artifact v14 接手续做与验收（2026-10-12）

用户要求继续 Grok bot 中的 Artifact 自由度改造。设计源文件是
`~/piwin-artifact-design/design.md`；已有实现与待提交修复位于
`feat/artifact-expressive`，工作区为 `.worktrees/artifact-expressive`。
本轮延续该工作区；主工作区里其他进行中的改动未合入本分支。

## 本轮结果

- 接手并验证图表语义配色：成功/通过使用 `ok`，失败/阻塞使用 `risk`，
  建议/警告使用 `warn`；支持显式 `tone`、环形图 `tones` 和状态名称回退。
  图例与图形一致，中性系列从蓝色开始。
- 接手并验证纸主题自由卡片的浅色舞台；深色主题仍用深色舞台。
  主题检测增加不透明渐变，反向主题舞台显示提示，可手动切换主题样式。
- 浏览器回归发现并修复 WebKit 全屏退出后的焦点丢失；Inline 与 Canvas
  都在打开前聚焦触发按钮，退出时恢复。
- Host 全套最初仅两项 CHT-803 失败（2657 > 2500）。精简重复运行时文字，
  将组件示例保留在按需说明中，两项检查已通过，预算上限保持 2500。
- 增加 `apps/desktop/e2e/artifact-v14-viewer.spec.ts`，覆盖纸/墨主题的图表、
  自由舞台、反向主题提示与恢复、全屏宽度、独立预览主题及焦点恢复。

## 验证

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过（默认脚本不包含 Mobile） |
| `@piwin/artifact` 全套 | 320 项通过 |
| `@piwin/contracts` 全套 | 798 项通过 |
| `@piwin/theme` 全套 | 10 项通过 |
| Desktop 全套 | 5734 项通过；焦点改动后的相关 60 项再次通过 |
| Host 全套（最终版本） | 3923 项通过 |
| Host 提示词、编译与布局相关 | 136 项通过，含两项 CHT-803 |
| 新增 v14 浏览器回归 | Chromium / WebKit 各 6 项，共 12 项通过 |
| 原有渲染与画布连续性回归 | Chromium 19 项通过 |
| `piwin-artifact-webview` 离线原生测试 | 12 项通过 |
| `pnpm test:architecture` | 通过 |

## 查看结果

本轮独立页面：
`http://127.0.0.1:14491/#/e2e/artifacts?id=v14-showcase&theme=paper`
（将 `paper` 换成 `ink` 可看墨主题；需要本轮 Vite 服务仍在运行）。

新截图保存在：
`/Users/yorickjue/.codex/visualizations/2026/10/12/01a12dff-67d5-7272-88a6-95ffcbdf3aef/artifact-v14/`
，包含纸/墨的 dashboard、stage、canvas、fullscreen；截图页没有脚本错误。
画廊同时展示 5 份 Artifact，会触发既有的 3 个实时 iframe 上限；检查某份被回收
的内容时点击“加载预览”，无需调整产品内存限制。

## 仍待后续验收

- 本轮 WebKit 浏览器测试使用内联 kit；打包版 WKWebView 从
  `piwin-artifact://…/lib/v1/kit.js` 加载子资源后的 IPC 隔离仍需原生实测。
- 未做 iOS 真机验收；按会话种类强制 host（语音、自动化、子代理）仍是
  ADR 0088 已记录的未实现项。
- 本轮未合并到主工作区、未发布安装包。当前结果是实施分支上的修复与验收。
