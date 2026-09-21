# Artifact 渲染提示词（最小必要版）

> 用于测试 piwin artifact 具现功能。只包含运行时**没有**兜底、去掉就真的会坏的规则。
> 其余约束（主题修复、外部资源阻断、嵌入 guard、桥接测量）已由运行时处理，不重复塞进 prompt。
>
> 与 `formatArtifactProtocol()` / `ARTIFACT_RUNTIME_CONTRACT` 保持同构。
> 生产路径：`config.artifact.enabled` 打开时，system prompt 保留简短路由提示；
> 模型通过 `artifact_instructions` 按需获取决策策略和本契约。
> 不要把 `evaluateCodeFence` 或 `splitMarkdownBlocks` 写进 prompt。
>
> 作用域限制：`config.artifact.scopes` 关掉某个 surface 时，`formatArtifactInstructions`
> 只在最前面加一行约束（`ARTIFACT_INLINE_ONLY_HINT` / `ARTIFACT_CANVAS_ONLY_HINT`），
> 决策提示词和下面的运行时契约文本保持逐字不变——与 `explicit-only` 的前缀机制相同。
> 两个 surface 都关掉时不注入任何指令，`artifact_instructions` 也不注册。
>
> 出厂默认：通用会话两个 surface 都开；**项目会话（Agent chat）两个 surface 都关**。
> 因此 Agent 会话默认既没有 resident 契约，也没有 `artifact_instructions` 工具，
> 每轮的 `inlineArtifactWidthPx` / host theme advisory 块也会被丢掉——
> 想让它生成 Artifact，需要在设置里把对应 surface 打开。

## 最小可用的 system prompt 片段

把下面这段拼到模型 system prompt 末尾（或作为首条 user 消息）：

````text
## HTML Artifact Runtime Contract

### Success
A self-contained artifact fence that renders correctly in the chat column sandbox.

### Fences
Opening fence starts at column 0 of its own line. Keep `title` and `surface` on that same opening line; do not wrap attributes onto the next line. HTML/SVG body follows. Closing fence alone on its own line. Never append the opening fence to a sentence.

Inline:

```artifact-html title="Short descriptive title"
<!-- body fragment: HTML/CSS + optional small inline JS -->
```

Canvas:

```artifact-html title="Short descriptive title" surface="canvas"
<!-- self-contained HTML/CSS + optional small inline JS -->
```

SVG:

```svg title="Short descriptive title"
<!-- self-contained SVG, no external refs -->
```

### Constraints (break without these)
- Colors: for proactive artifacts (including reports, reviews, and voice-delegated tasks), use only `--piwin-artifact-*` theme vars (`surface`, `text`, `muted`, `accent`, `border`, `bg`) to adapt to host theme. These six are the whole set: never invent other names (e.g. `surface-elevated`), never write `var(--piwin-artifact-x, <fallback>)` with your own palette, and never hard-code hex/rgb colors for text, backgrounds, or borders (no `color: #fff`, no dark slate cards). For states, tint with `color-mix(in srgb, var(--piwin-artifact-accent) 12%, transparent)`. Only when the user explicitly asks for a custom look (e.g. custom SVG, a styled HTML page, or an explicit UI design) may you style freely with custom colors.
- Proactive visual tone is flat and quiet: no gradients, glows, glassmorphism, or decorative emoji in headings or labels. Hierarchy comes from type size/weight, spacing, borders, and grouping.
- Outermost wrapper background: transparent; surface colors on inner cards only.
- Inline layout is a 360–760px chat column; fluid grids; not a full-page landing. Inline grows with its content: no page-level or nested vertical scroll regions; let the conversation own vertical scrolling; never add horizontal scrolling to Inline. No viewport-filling height (`100vh`/`100%`) or page-level overflow on html/body/outer wrapper for Inline.
- Tables: wrap long data cells with `overflow-wrap: break-word` only. Never `word-break: break-word`, `word-break: break-all`, or `overflow-wrap: anywhere` — they collapse column min-content to 1ch. Row/column labels may `white-space: nowrap` or `width: max-content`. `min-width: 0` is for the outer stage, not table columns. Inline: no page-level horizontal scroll; stack with `@container` before wrapping labels. Canvas: dense comparisons keep label min-content; table `overflow-x: auto` is allowed. Dense wide comparisons belong on Canvas.
- **Canvas Viewport**: The Canvas iframe is the design viewport. Root layout (and the primary stage) uses `width: 100%` and `height: 100%` / `100dvh` of that iframe. Do not lock a phone/poster width or an `aspect-ratio` that letterboxes empty bars; extra panel width is scene/layout space. If the UI needs a wide workspace or horizontal scrolling, declare `surface="canvas"`.
- Repeated cards/items are siblings — no card-in-card.
- Session vault images: `<img data-piwin-media="<mediaId>" alt="short label">`. Never `data:image`, never local filesystem paths, never markdown images for vault assets.
- If the user only needs to pick among generated images, the attachment cards are enough — do not wrap them in a second HTML copy.

### Streaming & Progressive Enhancement
- **CSS First**: Emit complete `<style>` blocks before any visible HTML markup.
- **Incremental Streaming**: Close each visual block before starting siblings so live preview renders cleanly.
- **Static First**: Core content must exist in static HTML; JS strictly for enhancement (content remains readable if JS fails).
````

Flashcards are structured tool results (`display.cards`), not `artifact-html`
fences. Code-first is an Inline preview preference and does not change Canvas
routing.

## 具现质量建议（2026-09-05 review）

现有协议已包含 CSS First / Static First，不建议重复加尺寸约束来掩盖渲染问题。
可在可编辑的决策提示词里试用下面的质量要求，再用真实对话对比效果：

> 当空间关系、状态变化或交互探索能帮助理解时，主动用 Artifact 将核心信息具现。
> 先确定用户需要比较、观察或操作什么，再选择图表、示意图或交互组件。
> 第一屏直接呈现核心关系和可读结果，避免把普通文字拆成大量装饰卡片。
> 控件必须改变有意义的结果；关键内容先写在静态 HTML 中，再增强交互。
> 数据不足时标注假设，不捏造数值。内容较长本身不是进入 Canvas 的理由。
>
> 默认决策提示词 v8 已把这条写成 MUST：用户要的是 review / 报告 / 审计 /
> 发现清单时，必须用 PiWin 右侧栏 Canvas（`surface="canvas"`），不要用
> Markdown 长文顶替。针对具体代码片段的解释、改代码、出 PR 仍用 Markdown。

这属于生成质量建议，尚未做模型对照验证，不自动覆盖用户已有决策提示词。

---

## 测试用例

### 用例 1：基础卡片 + 主题变量

```
做一个居中卡片：标题 "Hello piwin"，正文 "artifact 渲染测试"，背景用
var(--piwin-artifact-surface)，文字用 var(--piwin-artifact-text)。
```

### 用例 2：流式网格（窄列布局 + 嵌套防御）

```
用 artifact 输出一个商品列表，6 个商品卡片，用流式网格布局，
卡片必须是同级兄弟不能嵌套。每个卡片含标题、价格、一个按钮。
```

### 用例 3：静态 HTML + JS 增强

```
用 artifact 做一个可搜索的命令速查表。表格数据必须写成静态 HTML，
搜索框用内联 JS 过滤已渲染的行。
```

### 用例 4：仪表盘（多面板）

```
用 artifact 做一个迷你仪表盘：4 个指标卡片（数字 + 标签），
下面是两张对比表。全部用主题变量配色。
```

### 用例 5：Canvas 工作区

```
用 surface="canvas" 的 artifact-html 做一个可配置的部署表单，
需要把结果写回 Composer。
```
