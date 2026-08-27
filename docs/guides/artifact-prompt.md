# Artifact 渲染提示词（最小必要版）

> 用于测试 piwin artifact 具现功能。只包含运行时**没有**兜底、去掉就真的会坏的规则。
> 其余约束（主题修复、外部资源阻断、嵌入 guard、桥接测量）已由运行时处理，不重复塞进 prompt。
>
> 与 `formatArtifactProtocol()` / `ARTIFACT_RUNTIME_CONTRACT` 保持同构。
> 生产路径：`config.artifact.enabled` 打开时，模型按需调用只读 Host 工具
> `artifact_instructions` 加载决策策略 + 本契约。不要把 `evaluateCodeFence`
> 或 `splitMarkdownBlocks` 写进 prompt。

## 最小可用的 system prompt 片段

把下面这段拼到模型 system prompt 末尾（或作为首条 user 消息）：

```text
## HTML Artifact Runtime Contract

### Fences
- **Inline**: ```artifact-html title="Short descriptive title"```
- **Canvas**: ```artifact-html title="Short descriptive title" surface="canvas"```
- **SVG**: ```svg title="Short descriptive title"``` (self-contained, no external assets)

### Layout & Sizing
- **Chat Width**: Fluid layout designed for 360–760px column. Outermost background must be `transparent` (apply surface colors to inner cards only).
- **Canvas Viewport**: The Canvas iframe is the design viewport. Root layout (and the primary stage) uses `width: 100%` and `height: 100%` / `100dvh` of that iframe. Do not lock a phone/poster width or an `aspect-ratio` that letterboxes empty bars; extra panel width is scene/layout space.
- **No Page Scrollbars**: Inline height must fit content naturally. Never use `100vh`, `height: 100%`, or root scroll containers. Use `surface="canvas"` if wide/horizontal workspace is needed.
- **Hierarchy**: Flatten repeated items/cards as siblings (avoid card-in-card nesting).

### Styling & Theme
- **Proactive Artifacts**: Use host theme CSS variables: `--piwin-artifact-surface`, `--piwin-artifact-text`, `--piwin-artifact-muted`, `--piwin-artifact-accent`, `--piwin-artifact-border`, `--piwin-artifact-bg`.
- **Explicit User Designs**: Free to use custom palettes when requested.

### Streaming & Progressive Enhancement
- **CSS First**: Emit complete `<style>` blocks before any visible HTML markup.
- **Incremental Streaming**: Close each visual block before starting siblings so live preview renders cleanly.
- **Static First**: Core content must exist in static HTML; use JS strictly for enhancement (content remains readable if JS fails).
```

Flashcards are structured tool results (`display.cards`), not `artifact-html`
fences. Code-first is an Inline preview preference and does not change Canvas
routing.

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
