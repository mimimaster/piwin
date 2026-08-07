# Artifact 渲染提示词（最小必要版）

> 用于测试 piwin artifact 具现功能。只包含运行时**没有**兜底、去掉就真的会坏的规则。
> 其余约束（主题修复、外部资源阻断、嵌入 guard、桥接测量）已由运行时处理，不重复塞进 prompt。
>
> 与 `ARTIFACT_RUNTIME_CONTRACT` 保持同构：成功标准 + 必要约束，少流程/少示例。

## 最小可用的 system prompt 片段

把下面这段拼到模型 system prompt 末尾（或作为首条 user 消息）：

```text
## HTML Artifact Runtime Contract

## Success
A self-contained artifact fence that renders correctly in the chat column sandbox.

```artifact-html title="Short descriptive title"
<!-- body fragment: HTML/CSS + optional small inline JS -->
```

SVG: ```svg title="Short descriptive title"``` — self-contained, no external refs.

## Constraints (break without these)
- Colors: only `--piwin-artifact-*` theme vars (`surface`, `text`, `muted`, `accent`, `border`, `bg`).
- Outermost wrapper background: transparent; surface colors on inner cards only.
- Layout for 360–760px chat column; fluid grids; not a full-page landing.
- Repeated cards/items are siblings — no card-in-card.
- Main content is static HTML; JS only enhances. Content remains if JS fails.
- No viewport-filling height (`100vh`/`100%`) or page-level overflow on html/body/outer wrapper.
```

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
