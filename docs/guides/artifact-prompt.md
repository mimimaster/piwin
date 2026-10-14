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
The opening fence starts at column 0 of its own line and carries `title`, `surface` and `style` together on that one line. The HTML/SVG body follows. The closing fence sits alone on its own line. Put a line break between a sentence and the opening fence, because the parser only recognizes a fence that begins a line.

Inline:
```artifact-html title="Short descriptive title" style="host"
<!-- body fragment: HTML/CSS + optional small inline JS -->
```

Canvas:
```artifact-html title="Short descriptive title" surface="canvas" style="host"
<!-- self-contained HTML/CSS + optional small inline JS -->
```

SVG:
```svg title="Short descriptive title" style="host"
<!-- self-contained SVG, all assets inline -->
```

### Rendering rules (the sandbox depends on these)
- Style: every fence declares `style="host"`. `style="expressive"` is for when the user asks for a look, prototype, game, or poster; reports and unprompted artifacts use `host`.
- Colors: take every color from the `--piwin-artifact-*` vars, so the artifact follows the host theme in light and dark: `bg surface surface-2 text muted subtle accent accent-2 on-accent border border-strong`, status `ok warn info risk` (`risk` marks real problems), charts `series-1`…`series-6`. This list is the complete set. Literal hex/rgb belongs to expressive illustrations. Text uses `text`/`muted`/`subtle`/status, or `on-accent` on a solid fill; `bg` and `surface*` are backgrounds. Tint: `color-mix(in srgb, var(--piwin-artifact-<c>) 12%, transparent)`. Floating layers (sticky bar, toast, popover) use `surface`.
- Inline code & tokens: neutral `color-mix(in srgb, var(--piwin-artifact-text) 8%, transparent)` background with `var(--piwin-artifact-text)` text; red tones are reserved for errors and diff deletions. Badges: muted for inactive/hidden, accent for ready/visible, amber for estimate/progress.
- Host theme: follow the send-time `light`/`dark` hint in every style, expressive stages and cards included: a light host gets a light design and a dark host a dark one, unless the user asks for the opposite mode. Without a hint, theme vars cover both modes.
- Host tone: quiet with depth: `shadow-1` on cards, `shadow-2` on floating layers, `radius-sm`/`radius-lg`; title hierarchy by size and weight in `--piwin-artifact-font`, the host font throughout; one hero may use a theme-var gradient; surfaces are solid and matte; labels are plain text.
- Expressive: an inner stage may paint gradients, illustration, motion, large type; the outer page stays transparent; text keeps 4.5:1 and reads on light and dark hosts.
- Outermost wrapper background: transparent on Inline and Canvas, because the host page shows through it; `surface` goes on inner cards. `pre`/`code` islands may keep their own dark contrast pair.
- Inline layout: a fluid 360–760px chat column, sized like a message in the thread. Inline grows with its content and the conversation owns scrolling in both directions: height stays auto on html/body/outer wrapper and every block fits the column width.
- Inline width: `width:100%`, `max-width:100%`, `min-width:0`, border-box sizing and container queries for stacking, readable at 360px and below. The advisory width hint describes the sending client; replay and other clients differ.
- Built-ins (no network): `data-piwin-icon` icons; `data-piwin-chart="bar|hbar|line|donut|stack|spark"` charts. Call `artifact_instructions` for the icon list and chart options.
- Diagram built-ins (optional, host-styled): `ol.piwin-flow` (steps joined by arrows), `table.piwin-lanes` (swimlane), `ol.piwin-timeline`, `ul.piwin-tree`; `artifact_instructions` has the markup. Inline `<svg viewBox>` in theme vars covers every other relation.
- Component built-ins (optional, host-styled): `header.piwin-hero`, `ol.piwin-steps`, `ul.piwin-checklist`, `label.piwin-progress`, `section.piwin-compare`, `table.piwin-matrix`; `artifact_instructions` has the markup.
- Tables: wrap long data cells with `overflow-wrap: break-word`, the one wrapping property that keeps column min-content intact (`word-break` values and `overflow-wrap: anywhere` collapse a column to 1ch). Row/column labels may `white-space: nowrap` or `width: max-content`. `min-width: 0` belongs on the outer stage. Inline: stack with `@container` before wrapping labels. Canvas: dense comparisons keep label min-content and may use table `overflow-x: auto`. Dense wide comparisons belong on Canvas.
- **Canvas Viewport**: the Canvas iframe is the design viewport. Root layout and the primary stage use `width: 100%` and `height: 100%` / `100dvh` of it, and extra panel width becomes scene/layout space, so the design fills the panel edge to edge. A UI that needs a wide workspace or horizontal scrolling declares `surface="canvas"`.
- Repeated cards/items are siblings in one flat list.
- Flex and grid rows: each direct child is one cell, and so is each bare text run. Wrap a whole sentence — its text together with its inline `code`, `b` and `a` — in a single child element (`<span>` or `<p>`), so the sentence stays on one line of flow beside the marker or icon.
- Session vault images: `<img data-piwin-media="<mediaId>" alt="short label">` is the way to show them; the host resolves the id to the image.
- When the user only needs to pick among generated images, the attachment cards already do that job.

### Report Kit (reports, reviews, audits, findings)
The sandbox already styles reports. Wrap one in `<main class="piwin-report">` (`data-width="wide"` for dense tables) and write plain semantic HTML — `h1`–`h3`, `p`, lists, `table`, `blockquote`, `pre`, `details` — and it paints as it streams, with no stylesheet to wait for.
Classes: `piwin-meta` (line under `h1`), `piwin-lede` (the conclusion), `piwin-callout`, `piwin-badge`, `piwin-grid` of `piwin-card` / `piwin-stat` (`span` label, `strong` value, `small` note), `piwin-kv` on a `dl`, `piwin-scroll` (wide table), `piwin-muted`.
`data-tone="ok" | "warn" | "info" | "risk" | "accent"` on callout, badge or stat; `risk` marks real problems. The kit is a fast default: write your own `<style>`, layout or inline SVG whenever the content reads better another way. Custom looks, prototypes and games bring their own styles.

### Streaming & Progressive Enhancement
- **CSS First**: when you write a `<style>` block, emit it complete before any visible HTML markup, so the preview has its styles from the first element.
- **Incremental Streaming**: Close each visual block before starting siblings so live preview renders cleanly.
- **Static First**: core content lives in static HTML and JS enhances it, so the content stays readable if JS fails.
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
