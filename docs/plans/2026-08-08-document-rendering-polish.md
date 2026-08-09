# 文档生成展示修复与排版调研

日期：2026-08-08

## 问题证据

会话 `session-mskcz6eh-8mv59r6y` 的 transcript 中，最新 assistant message 的文本以完整段落结束，落盘数据没有截断。当前“半截”的体验来自展示层：

- transcript 底部的 mask 会把最后约 64px 渐隐；
- inline Artifact 达到 900px 后，iframe 文档的 `html/body` 使用 `overflow: hidden`，超出区域无法在 iframe 内继续滚动；
- Walkthrough 卡片只显示三行摘要，没有明确的“打开全文”入口；
- 文档预览虽然支持完整 Markdown，但内容面没有明确的阅读纸面和稳定的可读宽度。

## 调研结论

1. 长内容应从聊天流中分离到专用工作区。OpenAI Canvas 将长写作/编码内容放入右侧工作区，并提供版本、复制和导出入口；Anthropic Artifacts 也把“重要且自包含”的内容放到独立窗口中，而不是要求用户在聊天气泡里读完。
2. 内容可以有摘要卡，但摘要必须明确标注为摘要，并提供可见、可聚焦的全文入口。否则用户会把视觉截断误认为生成失败。
3. 长内容的任意限制都必须保留本地滚动或其它可达路径，不能只依赖渐隐、`line-clamp` 或 `overflow: hidden`。这也符合 WCAG 2.2 关于 reflow、可见焦点和焦点不能被作者内容遮挡的要求。
4. 文档预览采用稳定的阅读宽度、明确的标题层级、代码/表格的局部滚动；聊天流本身不再用遮罩隐藏正文末尾。

## 第二轮调研：GitHub Markdown renderer 与 Antigravity

上一轮只修复了容器裁切和可达性，没有解决 Markdown 解析本身的质量问题。当前 Desktop 同时维护 `MarkdownView` 和 `EnhancedMarkdownView` 两套正则分块器，导致嵌套列表、任务列表、跨行表格、链接和流式未闭合围栏的行为不一致。

### 候选方案

| 方案 | 优点 | 不采用的原因 |
| --- | --- | --- |
| [`vercel/streamdown`](https://github.com/vercel/streamdown) | 面向 AI 流式 Markdown；支持未闭合 block、GFM、数学、代码组件覆盖和安全处理；React 组件 API 与现有 Desktop 兼容 | 默认样式依赖 Tailwind 设计令牌，不能直接照搬；需要由 piwin 自己提供视觉样式和 Artifact code renderer |
| [`remarkjs/react-markdown`](https://github.com/remarkjs/react-markdown) + `remark-gfm` | unified/micromark 生态成熟，静态文档解析稳定，组件覆盖清晰 | 不负责 AI 流式未闭合语法；需要额外接入和维护 remend/流式收敛逻辑 |
| [`assistant-ui/assistant-ui`](https://github.com/assistant-ui/assistant-ui) | 提供完整聊天壳、滚动、重试、Markdown 与无障碍能力 | 引入的是整套聊天运行时和 UI 组合，不只是 renderer；与 piwin 已有 HostPush、消息动作、Artifact 和滚动权责重叠 |
| [`charmbracelet/glamour`](https://github.com/charmbracelet/glamour) | Antigravity CLI 使用的同类终端 Markdown 排版库，主题/stylesheet 方案成熟 | Go/ANSI 终端 renderer，不能作为 Desktop React renderer |

### Antigravity 可复用的产品原则

Google 的公开 [Antigravity IDE 概览](https://antigravity.google/docs/ide-overview?app=antigravity) 和 [Artifacts 文档](https://antigravity.google/docs/artifacts?1=1)把 rich Markdown、diff、架构图等都定义为 Artifact，并在专门的 review pane 中查看和反馈；没有公开 Desktop 内部 Markdown renderer 的实现。公开的 [`google-antigravity/antigravity-cli` changelog](https://github.com/google-antigravity/antigravity-cli/blob/main/CHANGELOG.md)只确认 CLI 使用 Glamour 改善 Markdown 标题和 block padding，不能推断 IDE 使用了同一套前端库。

因此本次只复用可观察的交互原则：聊天内保持可读的轻量正文，长文档进入独立文档面；Artifact 仍由 piwin 自己的 sandbox/权限边界承载；Markdown parser 选择专为 React AI streaming 设计的 Streamdown，不引入 Antigravity 私有协议或文件格式。

### 选型与实现边界

- Desktop 添加 `streamdown`，并启用 `@streamdown/math` 与 `@streamdown/cjk` 插件；Streamdown 负责 CommonMark/GFM、流式不完整语法和基础安全处理。
- `MarkdownView` 使用 Streamdown 的 `components`/custom renderer 接口：普通 Markdown 走统一 AST；Artifact HTML/SVG、Mermaid、shell disclosure、代码高亮和路径 chip 继续走 piwin 现有组件。
- 模型原始 HTML 不直接注入 Desktop 文档；普通 Markdown renderer 默认跳过 raw HTML。HTML Artifact 只有进入现有 `ArtifactFrame` sandbox 路径才执行。
- 文档预览沿用 Artifact review pane 的独立阅读面，并逐步共享同一 parser；已有行评论和 diff header 等产品特化能力不被通用 renderer 取代。

### 第二轮验收标准

- 流式内容在未闭合强调、链接、代码围栏和表格时不把后续正文吞掉；完成后无需依赖人为补 fence 才能恢复排版。
- GFM 表格、任务列表、删除线、自动链接、嵌套列表和 CJK 段落在聊天与普通文档预览中使用同一解析语义。
- 代码块仍保留 piwin 的行号、折叠、复制、shell 摘要和 Artifact Preview 行为。
- 外部链接和图片不绕过安全策略，原始 HTML 不在父文档执行。

## 本次决策

- 保留 Walkthrough 摘要卡，但增加明确的“打开完整文档”按钮语义和视觉入口。
- 去掉 transcript 正文底部的渐隐 mask。
- Artifact sandbox 允许 document root 自己滚动；height bridge 仍测量完整内容，但父层继续限制 iframe 的可见高度，因此短内容自动收缩，长内容在 iframe 内可滚动。
- Artifact chrome 从 hover-only 改为稳定的轻量 header，避免操作入口不可发现，同时保留 source/preview 切换。
- 文档预览使用居中的 editorial surface，限制正文 measure，保持表格和代码块的局部溢出处理。

## 验收标准

- 生成的长 Markdown 最后一段在 transcript 中不被渐隐遮住，滚动到末尾可完整阅读。
- 超过 inline Artifact 高度上限的内容仍能在 iframe 内垂直滚动。
- Walkthrough 摘要卡明确显示全文入口，键盘可聚焦并触发打开文档。
- 文档预览在窄窗口不横向撑破 stage，标题、段落、列表、代码、表格均可读。
- `@piwin/artifact` 与 Desktop 相关单测、typecheck 通过。

## 本轮实现与验证

- `MarkdownView` 和普通 `EnhancedMarkdownView` 文档预览统一接入 Streamdown；保留 piwin 的 ArtifactFrame、Mermaid、KaTeX、shell disclosure、语法高亮、折叠、行号、路径 chip 和行级评论能力。
- 启用 GFM、CJK 和单美元行内数学；普通 raw HTML 默认跳过，不在父文档执行。
- 增加阅读面排版规则：段落/标题节奏、窄屏换行、局部表格滚动、列表语义、删除线、图片边界和流式 caret。
- 对 `<details>` 与 `[MODIFY]/[NEW]/[DELETE]/[RENAME]` 差异审阅格式保留旧 renderer，避免丢失已有评论和 diff 语义；普通 Markdown 不再经过正则分块器。

验证结果：

- `pnpm --filter @piwin/desktop typecheck` 通过。
- `pnpm --filter @piwin/desktop build` 通过；仅保留现有大 chunk 的 Vite warning。
- Desktop Markdown 相关测试：34/34 通过；全工作区 `pnpm test` 通过。
- `git diff --check` 通过；本地桌面预览启动成功且无新增浏览器 error/warn。
- 全仓 `pnpm typecheck` 仍被工作区已有的 `packages/host-server/src/host-server.ts:336` 缺失 `isSafeRemoteCommand` 阻塞；该错误不在本次 Markdown 改动范围内。

## 参考

- [OpenAI Help — What is the canvas feature in ChatGPT and how do I use it?](https://help.openai.com/en/articles/9930697-what-is-canvas)
- [Anthropic Help — What are artifacts and how do I use them?](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)
- [W3C WCAG 2.2 — Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow)
- [W3C WCAG 2.2 — Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible)
