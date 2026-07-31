# Artifact 渲染提示词（最小必要版）

> 用于测试 piwin artifact 具现功能。只包含运行时**没有**兜底、去掉就真的会坏的规则。
> 其余约束（主题修复、外部资源阻断、嵌入 guard、桥接测量）已由运行时处理，不重复塞进 prompt。

## 最小可用的 system prompt 片段

把下面这段拼到模型 system prompt 末尾（或作为首条 user 消息）：

```text
## HTML Artifact 输出契约

当需要可视化或交互内容时，用 artifact-html 代码块输出自包含 HTML：

```artifact-html title="简短标题"
<!-- 自包含的 HTML/CSS 和可选的小段内联 JS，只输出 body 片段 -->
```

规则：

1. **主题变量**：颜色一律用主题 CSS 变量（前缀 `--piwin-artifact-`），不要写死颜色值。
   示例：`background: var(--piwin-artifact-surface); color: var(--piwin-artifact-text);`
   常用角色：`surface`（卡片/面板）、`text`（文字）、`muted`（次要文字）、
   `accent`（按钮/链接）、`border`（边框）、`bg`（背景）。

2. **根容器透明**：最外层 wrapper（`.piwin-artifact-root`）背景必须是
   transparent，不要给它上背景色。只有内层的卡片/面板/输入框才用
   `var(--piwin-artifact-surface)` 或 `var(--piwin-artifact-bg)`。
   否则整块 UI 会变成白色矩形，和聊天背景色差明显。

3. **窄列布局**：按 360-760px 宽的聊天列设计，不是浏览器视口。
   用流式网格（如 `repeat(auto-fit, minmax(min(100%, 10rem), 1fr))`），
   不写死列数/像素宽度；不要输出整页 landing page。

4. **嵌套防御**：重复卡片/项目必须是同级兄弟，禁止一个卡片套另一个卡片。

5. **静态 HTML 先于 JS**：主内容必须是静态 HTML，JS 只做增强
   （筛选/折叠/复制/计数）。JS 失败时内容仍应可见。

6. **嵌入式布局**：Artifact 显示在聊天列中，不是独立网页。
   - 不要对 `html`、`body` 或最外层 wrapper 使用 `height/min-height: 100vh`、`100dvh`、`100svh` 或 `100lvh`。
   - 不要对 `html`、`body` 或最外层 wrapper 使用固定高度或 `height: 100%`。
   - 不要在 `html`、`body` 或最外层 wrapper 上使用 `overflow: hidden`、`auto` 或 `scroll`。
   - 让主内容使用正常文档流自然撑开；`overflow` 只用于局部可折叠面板或视觉裁切区域。
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

---

## 为什么只有这 5 条（与运行时分工）

| 规则 | 运行时兜底 | 是否写进 prompt |
|------|-----------|----------------|
| 主题变量 | `applyArtifactThemeContract` 软修复写死浅色 | ✅ 模型需知道变量名 |
| 根容器透明 | srcdoc 强制 `.piwin-artifact-root` 透明，但模型可能用别的类名 | ✅ 否则整块白底 |
| 窄列布局 | srcdoc 无 layout guard | ✅ 运行时无兜底 |
| 嵌套防御 | 无嵌套检测 | ✅ 运行时无兜底 |
| 静态 HTML 先于 JS | 流式预览剥离 JS | ✅ 否则流式预览白屏 |
| 禁止浅色列表 | 已软修复 | ❌ 运行时兜底 |
| 禁外部资源 | `classifyArtifactSecurity` 阻断 | ❌ 运行时兜底 |
| 嵌入 URL 规则 | srcdoc embed guard | ❌ 运行时兜底 |
| 折叠释放高度 | bridge 重测 | ❌ 运行时兜底 |
| 推荐 CSS / self-check | — | ❌ 删（prompt 是贵的资源） |

长期改进：给 srcdoc 加 layout guard CSS + 嵌套检测，把 root 透明/窄列/嵌套也挪到运行时。
