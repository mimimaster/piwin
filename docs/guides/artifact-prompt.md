# Artifact 提示词（精简版）

2026-10-19：默认常驻指令从 11,936 字符缩至 1428 字符、22 行，减少约 88%。
默认配置及产品限制组合由测试约束在 2,000 字符以内；用户自定义决策提示词保持原文。

## 实际常驻文本

下面由 `formatArtifactInstructions(createDefaultArtifactConfig())` 导出。

````text
## Decision Criteria
Use Markdown for short answers, code explanations, debugging, patches or requested source.
Use Artifacts proactively when a diagram, structured comparison or interaction helps.
Inline: content read in the conversation. Canvas: standalone reports, reviews, audits, prototypes or tools. Choose by user intent, not length.

## HTML Artifact Runtime Contract
Artifacts use Markdown code fences, never XML wrapper tags. Fence markers start on their own lines at column 0; opening attributes stay on that line. Keep prose outside.
Inline (omit surface):
```artifact-html title="Title" style="host"
<main class="piwin-report">...</main>
```
Canvas:
```artifact-html title="Title" surface="canvas" style="host"
<main class="piwin-report">...</main>
```
SVG may use a `svg` fence with the same attributes.
- Self-contained HTML/CSS/JS, no network. Core content in HTML; CSS before markup, JS for enhancement.
- Default `style="host"`: semantic HTML in `piwin-report` gets host styling. Custom CSS uses `--piwin-artifact-*` vars; outer background stays transparent.
- `style="expressive"` is for requested custom looks, prototypes or games; follow the host light/dark theme.
- Inline: fluid width, auto height, no nested page scroll. Canvas fills its viewport.
- Images: `<img data-piwin-media="ID" alt="description">`.
- Call `artifact_instructions` only for theme/layout details, charts, diagrams, icons or JS APIs.
````

## 中文对照

### 选择呈现方式

简单回答、代码解释、调试、补丁及用户要求的源码用 Markdown。
示意图、结构化比较或交互有助理解时，主动使用 Artifact。
Inline 用于在对话中阅读的内容；Canvas 用于独立报告、评审、审计、原型或工具。按用户意图选择，不按长度选择。

### 输出协议

Artifact 使用 Markdown 代码围栏，禁止 XML 包装标签。围栏标记独占一行，从行首开始，属性写在起始行上；说明文字放在围栏外。

Inline 省略 surface：

```artifact-html title="标题" style="host"
<main class="piwin-report">...</main>
```

Canvas：

```artifact-html title="标题" surface="canvas" style="host"
<main class="piwin-report">...</main>
```

SVG 可以使用属性相同的 `svg` 围栏。

- HTML/CSS/JS 自包含，不联网。核心内容写在 HTML 中；先输出 CSS，再输出页面标记；JS 用于增强。
- 默认 `style="host"`：`piwin-report` 内的语义 HTML 自动获得宿主样式。自定义 CSS 使用 `--piwin-artifact-*` 变量；最外层背景透明。
- 用户要求自定义视觉效果、原型或游戏时，可用 `style="expressive"`；跟随宿主明暗主题。
- Inline 宽度自适应、高度自动，不嵌套页面滚动；Canvas 填满其视口。
- 图片使用 `<img data-piwin-media="ID" alt="说明">`。
- 仅在需要主题/布局细节、图表、示意图、图标或 JS API 时调用 `artifact_instructions`。

## 按需工具与运行时分工

- 基础报告直接写语义 HTML，复用宿主已经提供的 CSS 和渲染脚本，无需先读组件手册。
- `artifact_instructions` 仅返回详细创作参考，不重复返回常驻决策与围栏协议；同一会话、runtime generation、run 内最多完整返回一次。
- `explicit-only`、`host-only` 和单 surface 限制继续作为短前缀生效。关闭所有 surface 时不注入指令、不注册工具。
- 注入仍以实际工具执行器可用为前提；自定义决策提示词仍被完整保留。
- 主题、基础排版、图表/图标绘制、尺寸/滚动和安全校验由现有运行时负责，无需新增脚本执行入口。

源码：`packages/contracts/src/artifact.ts`；详细参考：`packages/contracts/src/artifact-rendering-reference.ts`；工具：`packages/host-runtime/src/artifact-instructions-tool.ts`。
