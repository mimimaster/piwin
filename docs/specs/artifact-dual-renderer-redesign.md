# Artifact 双渲染器改造设计

> **状态：已否决（2026-08-13）。** worktree 中基于宽泛 Lite/Heavy AST
> 分流和声明固定高度的实现不可用。本设计由
> `docs/plans/2026-08-13-artifact-frame-slimdown.md` 取代：完成后的惰性内容
> 使用消毒后的 Shadow DOM 自然流，只有主动/嵌入型内容使用 sandbox 和单一
> 高度观察流。

| 字段 | 内容 |
|---|---|
| 状态 | 已否决，由 ArtifactFrame 瘦身计划取代 |
| 日期 | 2026-08-13 |
| 范围 | `@piwin/artifact`、Desktop Markdown/Artifact 渲染、Artifact runtime prompt |
| 参考实现 | [DEEIX-Chat HTML Lite](https://github.com/DEEIX-AI/DEEIX-Chat/tree/dev/frontend/shared/components/markdown) |
| 核心决策 | 安全静态内容走父文档 Lite；需要执行隔离的内容走固定高度 Heavy iframe |

## 1. 背景与问题

piwin 当前把 HTML、SVG、流式预览、内容高度和 Artifact action 都集中到
`ArtifactFrame` 重型 iframe 路径中。为了让 Inline Artifact 跟随内容高度，运行时逐步增加了：

- iframe 内高度测量；
- `ready` / `resize` 消息协议；
- 浏览器 `window.postMessage` 兼容通道；
- macOS WKWebView 原生消息桥；
- React 订阅、消息缓冲和 `channelId` 校验；
- 5 秒 ready 超时；
- 高度失败红框和重试按钮；
- 初始高度估算以及流式、完成态两套高度处理。

这些机制的目标是避免裁切，但它们已经反过来破坏主要使用路径：Artifact 内容能够正常渲染时，
只要高度回传失败，Desktop 就会主动隐藏内容并显示错误。该复杂度与用户真正需要的产品行为不匹配。

DEEIX-Chat 已验证一种更简单的双路径：受限 HTML 使用 Markdown 渲染器直接进入聊天 DOM，
只有需要脚本执行的完整 Artifact 才进入 iframe。piwin 采用相同的职责拆分，但保留自己的
安全策略、主题变量和流式生命周期。

## 2. 用户需求（锁定）

1. Artifact UI 块一旦形成，就应当边生成边显示，而不是等生成完成后一次性出现。
2. 纯 SVG、简单 HTML + 内联 CSS 不应使用 iframe，也不应参与高度协议。
3. Lite 内容直接铺在聊天文档中，由浏览器正常布局自然撑开。
4. 包含 JavaScript、外部引用或其他需要隔离能力的内容才进入 Heavy sandbox iframe。
5. Heavy iframe 的高度由模型声明；未声明时只使用一个较高的默认初始高度。
6. 高度在创建时确定一次，不测量、不回传、不持续调整。
7. 流式生成完成后提交最终内容一次，并停止流式更新。
8. 删除高度失败红框、5 秒超时和重试 UI。用户不应因为辅助通道失败而看不到已经渲染的内容。
9. 外部资源进入 Heavy 路由不代表自动放行；仍遵守现有 CSP、iframe allowlist 和安全分类。

## 3. 术语

### 3.1 HTML Lite

父聊天文档内的受限 HTML/SVG 渲染路径：

- 无 iframe；
- 无脚本；
- 无外部资源；
- 通过标签、属性和 CSS 值白名单清洗；
- 使用 React/Streamdown 组件渲染，不把原始模型字符串直接写入 DOM；
- 随聊天 Markdown 一起流式更新并自然占据文档高度。

Lite 可以拥有视觉上的 Artifact UI 块，但该“块”只是聊天 DOM 中的布局节点，不是沙箱容器。

### 3.2 Heavy Artifact

需要隔离执行能力的完整 Artifact：

- 使用 `sandbox="allow-scripts"` iframe；
- 使用严格 CSP；
- iframe 具有声明高度或固定默认高度；
- 生成期间只接受父页面发来的 DOM 快照；
- 完成后停止接收流式快照；
- 不向父页面回传高度。

### 3.3 高度声明

Heavy fence 元数据中的静态输入，例如：

````markdown
```artifact-html title="Counter" height=720
<!-- HTML/CSS/JS -->
```
````

高度声明是输入契约，不是运行时探测结果。

## 4. 路由规则

路由必须由纯函数完成并单元测试。建议返回显式联合类型：

```ts
type ArtifactRenderRoute =
  | { kind: 'lite-html'; sanitizedSource: string }
  | { kind: 'lite-svg'; sanitizedSource: string }
  | { kind: 'heavy'; height: number; heightSource: 'declared' | 'default' }
  | { kind: 'code' }
  | { kind: 'blocked'; reason: ArtifactSecurityBlockReason };
```

### 4.1 路由矩阵

| 输入 | 路由 | 行为 |
|---|---|---|
| 纯 SVG，无脚本、事件属性和外部引用 | Lite SVG | 清洗后直接渲染，按 `viewBox`/宽高比自然撑开 |
| HTML 结构 + `style="..."` 内联 CSS，无脚本和外部引用 | Lite HTML | 清洗后直接渲染，父文档自然布局 |
| `html-lite` fence | 尝试 Lite | 不满足 Lite 安全条件时不静默降权执行；转 Heavy 或显示源码由下述规则决定 |
| 原生 `html` / `svg` fence，且满足 Lite 条件 | Lite | 自动走轻路径 |
| 包含 `<script>` 或可执行事件属性 | Heavy | sandbox iframe，固定高度 |
| 包含 `<style>` 样式表 | Heavy | 避免选择器污染父文档；固定高度 |
| `surface="canvas"` | Heavy Canvas | 使用 Canvas 自己的固定面板布局 |
| 使用 Artifact action（flashcard、composer proposal） | Heavy | action 通道保留，但与高度协议分离 |
| 外部 URL / iframe / media / font / stylesheet | Heavy 或 blocked | 先进入重路径分类；是否允许仍由现有策略决定 |
| 普通代码 fence | Code | 保持源码渲染 |

### 4.2 Lite 的严格边界

Lite 不是“把任意 HTML 塞进主页面”。以下任一条件出现时都不得走 Lite：

- `<script>`；
- `on*` 事件属性；
- `<style>` 或外部 stylesheet；
- `<iframe>`、`<object>`、`<embed>`；
- `<form>` 或会触发导航/提交的能力；
- `http:`、`https:`、协议相对 URL 或可执行 URL；
- 未列入安全 schema 的 HTML/SVG 标签和属性；
- CSS `url()`、`@import`、`expression()`、`javascript:`；
- 能脱离聊天块影响宿主布局的 fixed/sticky/超大 z-index 等样式。

Lite 清洗失败时不能“尽量执行”。显式 `html-lite` 默认软失败为源码；原生 `html/svg`
如果确实需要脚本或样式表，则由分类器明确转为 Heavy。

## 5. Lite 渲染设计

### 5.1 参考 DEEIX-Chat，但不复制组件

参考实现的关键思想：

- `normalizeHTMLVisualMarkdownFences` 识别视觉 HTML fence；
- Streamdown 的 raw HTML parser 负责建立语法树；
- rehype sanitize schema 决定允许的标签和属性；
- HTML 标签映射到受控 React 组件；
- `sanitizeHTMLStyle` 逐项过滤内联 CSS 属性和值。

piwin 只移植纯规则和测试，不复制 DEEIX React 组件，也不把第三方 UI 组件塞进
`@piwin/artifact`。这符合“Adapters over forks”和 Artifact pure TS 约束。

### 5.2 包职责

`@piwin/artifact` 负责纯逻辑：

- fence 元数据解析；
- Lite/Heavy 路由判断；
- HTML/SVG 标签、属性和 CSS 白名单；
- 静态 URL/脚本/事件属性检测；
- 高度元数据解析与规范化；
- 路由、安全和 golden tests。

Desktop 负责 UI 适配：

- 配置 Streamdown raw + sanitize 管线；
- 将允许的标签映射到 React 元素；
- 注入 `--piwin-artifact-*` 主题变量；
- 控制 Lite UI 块的展示和流式状态；
- Heavy iframe 的固定尺寸与单向流式发布。

### 5.3 Lite CSS

首版只支持 `style` 属性中的受限 CSS，不支持模型提供 `<style>` 块。原因：

- 内联样式天然限定到当前节点；
- `<style>` 选择器可能影响聊天主页面其他节点；
- 属性和值白名单比完整 CSS parser 更容易审计；
- 与 DEEIX HTML Lite 已验证的方案一致。

颜色优先使用 `--piwin-artifact-*` 变量。布局属性可允许 flex/grid、spacing、border、
typography、宽高和 overflow，但禁止网络型值和逃逸聊天布局的定位方式。

### 5.4 Lite SVG

SVG 直接渲染前必须经过独立 SVG schema，至少处理：

- 允许常用绘图、文本、分组、渐变和裁剪标签；
- 删除 `<script>`、`foreignObject`、动画标签和事件属性；
- `href` / `xlink:href` 只允许同文档 `#id` 引用；
- 禁止外部 image/use/font/filter URL；
- 保留安全的 `viewBox`、尺寸和 `preserveAspectRatio`；
- 宿主样式确保 `display:block; max-width:100%; height:auto`。

SVG 不再估算 iframe 高度。浏览器使用其 intrinsic ratio 在父文档中自然排版。

## 6. 流式生命周期

### 6.1 总原则

流式展示是保留功能，不是可删除的优化。任何改造都必须满足：UI 块具备安全结构后立即出现，
随后在模型生成期间渐进更新。

### 6.2 Lite 流式

```text
token 到达
  → Streamdown 修复未闭合 Markdown/HTML
  → Lite 分类和 sanitize
  → React DOM 更新
  → 浏览器自然重新布局
  → 完成后渲染最终内容并停止 streaming 状态
```

Lite 不需要自定义高度逻辑，也不需要单独定时器。React/Streamdown 的正常流式更新就是唯一更新源。

为保证“块一形成就出现”，提示词优先输出 fence 头、根节点和基础布局，再填充内容；解析器仅在
形成可安全清洗的结构快照后 materialize，不能执行未闭合属性或脚本片段。

### 6.3 Heavy 流式

Heavy 保留现有稳定 iframe 和单向 DOM 流，但职责缩小为：

1. fence 头可识别且安全结构快照形成后挂载一次 iframe；
2. 生成期间，父页面最多每 300ms 向同一 iframe 发布一次清洗后的 DOM 快照；
3. iframe 原地协调 DOM，不重建 iframe；
4. 完成时立即提交最终快照一次；
5. 移除 iframe 的 stream listener，不再刷新；
6. 完成后允许最终内联脚本按现有安全规则激活一次；
7. 整个生命周期没有子页面到父页面的高度消息。

这里保留的 `postMessage` 只有父页面到 iframe 的单向内容发布，不是高度桥。

## 7. Heavy 高度契约

### 7.1 解析优先级

```text
fence height 属性
  → 合法整数并限制到安全范围
  → 否则 DEFAULT_HEAVY_ARTIFACT_HEIGHT
```

只在 descriptor 创建时解析一次。React 后续重渲染、iframe load、内容完成、点击和动画都不得
重新计算高度。

### 7.2 待确认常量

用户已锁定“默认高度应当较高”，但具体数字尚未确认。实施前只需确认一个产品常量：

```ts
DEFAULT_HEAVY_ARTIFACT_HEIGHT = TBD;
```

建议候选为 `720px`，但在用户确认前不得写入实现。安全上仍需保留一个静态最大值，防止模型
声明极端高度；该 clamp 只运行一次，不构成动态高度系统。

### 7.3 Prompt 合同

Artifact runtime prompt 改为双输出协议：

````text
Static visual content without JavaScript or external resources:
```html-lite title="Short title"
<!-- HTML with inline style attributes only, or a self-contained SVG -->
```

Interactive or isolated content:
```artifact-html title="Short title" height=720
<!-- self-contained HTML/CSS/JS -->
```
````

约束：

- Heavy 必须声明适合 360–760px 聊天列的像素高度；
- 模型应根据内容预留完整空间，宁可略高，不得故意压缩导致裁切；
- Lite 不声明高度；
- 静态内容优先 Lite；只有确实需要脚本、样式表、action 或 Canvas 时才输出 Heavy；
- 不允许模型依赖高度回传或父页面 DOM API。

## 8. 删除清单

实施时删除以下能力，而不是留作“兼容备用”：

### 8.1 协议与前端

- `piwin-artifact:ready`；
- `piwin-artifact:resize`；
- `ArtifactBridgeMessage` 和高度 message parser；
- `useArtifactFrameBridge` 中的高度、ready 状态和 timer；
- `artifact-native-bridge.ts`；
- native payload 缓冲；
- iframe 发送完成高度的脚本；
- 流式 snapshot 后的高度上报；
- 高度失败 red state；
- “无法读取预览的真实高度”文案；
- “重试预览”按钮；
- 高度估算、测量 ladder、observer 和交互后重测；
- 仅为高度变化触发的 transcript scroll signal。

### 8.2 macOS 原生层

- `artifact_bridge.rs`；
- `WKScriptMessageHandler` 注册；
- 为该桥新增的 `objc2` / `objc2-web-kit` 直接依赖及 lockfile 条目；
- `lib.rs` 中的安装调用。

### 8.3 保留项

- Heavy iframe sandbox；
- 严格 CSP 和外部资源策略；
- Artifact action 白名单（单独协议，不得与高度协议耦合）；
- Heavy 父到子的单向流式 DOM 更新；
- final snapshot 一次性提交；
- iframe init 并发限制和必要的历史资源管理；
- Canvas 独立布局；
- Show code / copy raw source；
- 主题变量和必要的安全修复。

## 9. UI 行为

### 9.1 Lite

- UI 块直接出现在 assistant 消息正文中；
- 不显示 iframe 边框或加载高度占位；
- 生成中按当前 Artifact activity 动画表达正在形成；
- 完成后只移除 streaming/activity 状态，不替换整块 DOM；
- 源码入口可以保留，但不能要求先点击 Preview 才显示 Lite 内容。

### 9.2 Heavy

- 创建时直接使用声明高度或默认高度；
- 内容超出时由 iframe 自己滚动，不能动态挤压聊天列；
- 不因缺少任何 ready 消息切换为错误 UI；
- HTML/JS 自身运行错误可以在沙箱内部展示，但不能把整个 Artifact 隐藏；
- 生成完成后画面保持，不继续刷新。

## 10. 安全不变量

1. 模型输出始终是不可信输入。
2. Lite 必须经过 AST 级 sanitize；禁止对原始模型 source 使用未经清洗的
   `dangerouslySetInnerHTML`。
3. Lite 不得执行 JavaScript、发起网络请求、提交表单或访问宿主 API。
4. Lite 样式必须按属性和值白名单过滤，不能只用正则删除 `<script>`。
5. Heavy 保持 `sandbox="allow-scripts"` 且不增加 `allow-same-origin`。
6. Heavy 外部资源默认仍受阻断/allowlist 策略控制。
7. Copy/download 始终使用模型原始 source，不复制清洗后的 React DOM 或包装文档。
8. Artifact action 仍需 action 白名单、来源绑定和业务数据二次校验。
9. Lite 路由失败必须软失败到源码或明确进入 Heavy，不能半清洗半执行。

## 11. 目标模块结构

建议结构如下，名称可在实现时小幅调整，但职责不能重新混合：

```text
packages/artifact/src/
  render-route.ts             # Lite / Heavy / Code / Blocked 纯路由
  lite-html-policy.ts         # HTML tag/attribute/style schema
  lite-svg-policy.ts          # SVG schema
  artifact-metadata.ts        # title/surface/height 解析
  heavy-document.ts           # Heavy srcdoc/CSP，不含高度上报
  streamable-preview.ts       # Heavy 安全结构快照

apps/desktop/src/
  ArtifactLite.tsx            # 受控 React/Streamdown 适配
  ArtifactFrame.tsx           # 固定高度 Heavy 表现层
  artifact-frame-stream.ts    # 父到子单向流；完成即停
```

不得重新创建一个同时负责路由、安全、iframe 生命周期、高度、错误 UI 和资源回收的 God component。

## 12. 实施顺序

按 TDD 分成四个可独立审查的步骤：

### 阶段 A：纯路由与元数据

1. 为 Lite/Heavy 路由写 golden tests；
2. 增加 `height` fence 属性解析测试；
3. 实现路由纯函数；
4. 更新 prompt 合同及对应测试。

### 阶段 B：HTML/SVG Lite

1. 先写 XSS、安全属性、CSS 值和 SVG 外部引用测试；
2. 配置 Streamdown raw + sanitize schema；
3. 增加 Lite React 组件；
4. 接入流式 Markdown，并验证自然高度；
5. 保证静态内容不再创建 iframe。

### 阶段 C：Heavy 简化

1. 添加固定高度/声明高度/默认高度测试；
2. 保留 iframe 单向流和 final-stop 测试；
3. 删除所有高度测量、回传、timeout、failure/retry 分支；
4. 删除 macOS 原生桥及依赖；
5. 保持 action 与 Canvas 测试通过。

### 阶段 D：文档和正式包验收

1. 更新 ADR 0005，明确本设计取代 2026-08-13 高度桥 amendment；
2. 更新 `docs/artifact-research.md` 和 `docs/todo-deferred.md`；
3. Artifact、Desktop、Rust、typecheck、architecture 测试全绿；
4. 打与日常使用相同的 release 正式包；
5. 使用真实 `~/.piwin` 会话验证 Lite 和 Heavy。

## 13. 测试矩阵

| 层 | 必测用例 |
|---|---|
| Route | 静态 HTML→Lite；纯 SVG→Lite；script/style/action/canvas→Heavy；普通代码→Code |
| Lite HTML | script、事件属性、外部 URL、style URL、fixed 逃逸被拒绝或删除 |
| Lite SVG | script/foreignObject/event/external href 被拒绝；viewBox 与安全图形保留 |
| Metadata | 合法高度；缺失高度；负数/小数/极大值/非数字；title/surface 共存 |
| Streaming Lite | 块形成即出现；中间快照安全；完成后内容稳定；无 iframe |
| Streaming Heavy | 同一 iframe；最多 300ms 更新；final 立即一次；完成 300ms 后无新消息 |
| Heavy height | 只读声明/默认高度；无 ready/resize listener；无 timer；无 failure UI |
| Security | Heavy CSP/sandbox/external-resource golden cases保持通过 |
| Actions | flashcard rate/open-source、composer proposal 白名单保持通过 |
| History | 历史 Lite 自然渲染；Heavy 固定高度；会话切换不残留 stream listener |

## 14. Release 验收标准

### 14.1 Lite 验收

- 请求生成纯 SVG；首个可安全结构出现后，图形边生成边显示；
- 完成后完整保留，页面自然撑高；
- DOM 中没有该内容对应的 iframe；
- 等待 30 秒不会出现错误框、重试按钮或后续刷新；
- 简单 HTML + 内联 CSS 同样通过；
- 恶意脚本/外链用例不能执行或请求网络。

### 14.2 Heavy 验收

- 请求生成带 JS 的交互 UI；生成时在同一 iframe 内渐进显示；
- iframe 高度等于 fence 声明高度；
- 缺失声明时使用已确认的较高默认高度；
- 完成后交互可用，DOM 不继续流式刷新；
- 等待 30 秒不会切换错误 UI；
- Dev 和 packaged macOS 行为一致；
- 不存在 WKWebView Artifact 高度 handler。

### 14.3 回归验收

- 普通 Markdown、代码 fence、Mermaid、KaTeX 不受影响；
- Show code、复制、Canvas、flashcard actions 可用；
- Artifact 逻辑不引入 Pi 包或破坏 package 依赖方向；
- 无新增未解释依赖；
- 正式包使用真实 `~/.piwin` 配置和历史数据完成验证。

## 15. 明确不做

- 不追求 Lite 执行任意网页；
- 不允许 Lite JavaScript；
- 不为 Heavy 恢复任何自动高度测量；
- 不通过 MutationObserver、ResizeObserver、点击或动画重新计算 iframe 高度；
- 不因固定高度可能略有空白而重新引入高度回传；
- 不在本次改造中改变外部资源默认安全策略；
- 不复制 DEEIX-Chat 的 React UI，只采用其 Lite/Heavy 分层和 sanitize 思路。

## 16. 实施前唯一待确认项

`DEFAULT_HEAVY_ARTIFACT_HEIGHT` 的具体像素值。本文建议 `720px`，但该数字尚未锁定。
除这一常量外，路由、流式、删除范围和安全边界均按本文执行。
