# ArtifactFrame 瘦身计划

## 背景

`apps/desktop/src/ArtifactFrame.tsx` 已从 80px 高度调整前的 351 行增长到
工作区版本的 967 行。组件同时承担 iframe 配额、初始化队列、流式 DOM
更新、消息传输、高度状态、滚动跟随、Canvas/Inline 展示和产品动作分发，
生命周期之间已经发生耦合。

本次不回退 Artifact 的安全模型，也不以移动代码冒充瘦身。目标是删除失效
策略、减少状态数量，并把仍然必要的机制收敛到单一职责模块。

## 最终策略（2026-08-13 修订）

### 1. 静态 Artifact 不使用 iframe

完成后的 Inline HTML/SVG 同时满足以下条件时，直接进入 Desktop 的父文档流：

1. 不含 `<script>`、事件处理属性、`javascript:` URL 等 JavaScript 能力；
2. 不含 iframe/object/embed/form 等独立浏览上下文或提交能力；
3. 不引用外部 URL、样式、媒体或网络内容；
4. 不是 Canvas，且不处于尚未完成、能力仍可能变化的流式阶段。

父文档渲染必须先消毒，并放入 Shadow DOM 隔离模型 CSS。Shadow host 参与
transcript 的正常文档流，因此高度由浏览器自然排版决定，不存在 bridge、猜测、
上限状态机或开发/打包差异。

允许配置的 YouTube/Google Maps iframe 仍属于 iframe 路径。`openwebui_m` 的
allowlist 只放行这些嵌入；外部脚本、样式表、图片、字体和 API 继续被安全策略
拦截。

### 2. 剩余 iframe 只保留一条高度路径

有 JS、允许的外部 iframe、Canvas 或流式未完成内容继续使用 sandbox iframe。
Inline iframe 内只保留一个 `ResizeObserver`：观察实际 Artifact 根节点，布局
变化后读取同一套可见内容高度并去重上报。父层对每个合法高度做同一套 clamp 后
直接应用；不再区分 protected/final-trim/interactive，不再使用测量阶梯、交互缩高
确认或 grow-only 锁。

macOS 开发和打包均优先使用同一个 WKWebView frame 级消息通道；普通浏览器使用
`postMessage` fallback。两种传输承载完全相同的协议和高度值。

### 3. 高度通道失败是降级，不是渲染错误

Inline iframe 在 5 秒内没有收到高度时仍保持可见，切换到 640px 的有界回退
视口并允许内容裁切。状态只作为诊断记录；不得隐藏 iframe、显示红色错误卡或把
Artifact 标记为工具错误。迟到的合法高度仍可恢复真实尺寸。

## 保留能力

1. sandbox iframe、严格 CSP、安全分类和动作白名单。
2. 静态 Inline 内容直接参与 transcript 自然流；交互型 Inline iframe 按真实
   测量高度流入 transcript。
3. 流式阶段保持同一个 iframe，最多每 300ms 原地更新一次 DOM；完成时立即
   提交最终 DOM，之后停止更新。
4. Canvas 使用固定面板高度，不参与 Inline 自动测高。
5. 历史 Artifact 的 iframe 数量上限与初始化队列。
6. 浏览器开发环境的 `window.postMessage` 兼容路径。
7. 打包 WebView 的 frame 级原生消息回传路径。
8. iframe SVG 的 `viewBox` 初次展示比例，仅作为加载占位尺寸，不冒充最终测量；
   静态 SVG 不需要占位或测量。
9. Artifact 文档使用受 CSP 保护的 `data:` 导航，绕开 WKWebView 中失灵的
   sandboxed `srcdoc` 路径。`data:` 文档天然是独立来源，不会变成主应用同源。
10. macOS 正式包注册 `WKScriptMessageHandler`，只接收非主 frame 的有界白名单
    消息，主界面再严格匹配 Artifact `channelId`；不向 Artifact 暴露 Tauri
    invoke 权限。

## 删除能力与残骸

1. 删除无人使用的 viewport TTL 策略、Near/Offscreen 优先级和对应测试。
2. 删除已废弃的 900px/2200px 展开高度常量。
3. 删除 HTML/CSS 正则静态猜高度。静态内容自然布局；iframe 通道失败采用明确
   的 640px 有界降级，但不得中断预览。
4. 删除 `ArtifactHeightSignal` 的 App 全局重渲染路径；统一使用 transcript
   scroll port 的局部通知。
5. 删除交互缩高确认计时器和重复的 `phase` React state；高度阶段只保留在
   bridge controller 内。
6. 删除未使用的 overflow 标记和重复的 rAF + timer 高度节流层。
7. 删除 MutationObserver、测量阶梯以及 resize/click/input/动画结束后的重复
   触发，只保留一个根节点 ResizeObserver；保留 frame 级原生回传和生成期间
   必要的 300ms 流式 DOM 推送。

## 目标结构

- `ArtifactFrame.tsx`：在静态自然流与 sandbox iframe 之间路由，并组合
  blocked/live/recycled 展示。
- `ArtifactStatic.tsx`：消毒后写入 Shadow DOM，隔离 CSS 并自然撑开 transcript。
- `artifact-frame-host.ts`：iframe 配额和初始化队列。
- `artifact-frame-stream.ts`：生成期间节流推送 DOM；完成时立即提交最后一版并停止。
- `artifact-frame-bridge.ts`：接受单一高度流、超时降级和动作分发。
- `@piwin/artifact/render-route.ts`：纯函数判定 static-flow / sandbox。
- `@piwin/artifact/srcdoc.ts`：一个 ResizeObserver 驱动统一高度流；正式包走
  WKWebView frame 消息，浏览器保留 window 消息兼容回传。

## 失败语义

Inline iframe 在 5 秒内收不到真实高度时保留内容，使用 640px 有界回退高度并
允许裁切；不显示错误卡、不隐藏 iframe。Canvas 不依赖内容高度，仍按面板尺寸
显示。静态 Artifact 没有高度通道，因此不会进入该降级。

## 验证

1. `@piwin/artifact` 类型检查和完整测试。
2. Desktop 类型检查、`ArtifactFrame` 和 Markdown/Transcript 相关测试。
3. Desktop production build。
4. Tauri dev 与 release 包分别实测同一交互 Artifact；release 即使消息通道失败
   也必须继续显示回退内容，不能出现错误卡或空白。
