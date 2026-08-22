# Artifact 高度链路 V2：源码、Inline 与 Canvas 分治

## 状态

Implemented（2026-08-22）

## 现象与证据

两个实际会话暴露了同一条链路的不同失败形态：

1. 一个回复中的 Artifact 后面仍有 Markdown，但中间出现大块空白；这不是消息结尾。
2. 一个普通 `html` 代码围栏被直接 Inline 成完整应用，iframe 高度被截断；点击后只增加少量高度，仍无法完整展示。
3. 目标书法应用同时包含 `calc(100vh - 205px)`、
   `max-height: calc(100vh - 130px)` 和 `window.innerHeight`。父层根据子内容增高
   iframe，子页面又根据新的 iframe viewport 增高，形成正反馈。
4. 历史补丁又增加了 CSS 正则改写、canvas/video 场景预算、ready/resize 两种消息、
   window resize 重测和超时兜底。它们只能遮住个别页面，不能建立稳定契约。
5. 外层 transcript virtualizer 把已挂载行的真实测量也限制为 4000px；因此即使
   Artifact 内层高度正确，后续消息仍可能被错误定位或看起来被截断。

## 最终不变量

### 1. 入口语义

- `artifact-html`/Artifact marker = 明确 Artifact 声明。
- 普通 `html`/`htm`/`svg` = 原生代码，默认展示源码。
- descriptor 明确记录 `declaration` 与 `documentKind`，不再从渲染阶段反推意图。

### 2. 三种展示拥有三种尺寸模型

- Static Inline：消毒后的 Shadow DOM，自然参与父文档流，无高度协议。
- Sandbox Inline：仅适用于可内容定高的 fragment；一个根节点、一个
  ResizeObserver、一个 revisioned size stream。
- Canvas：固定面板 viewport + 内部滚动，不参与内容测高。

完整 HTML document、viewport height 单位/脚本、fixed page shell 不满足 Inline
component contract。它们保持源码，用户可主动在 Canvas 预览。运行时不改写 CSS、
不猜场景、不自动改变 surface。

### 3. 唯一协议

```ts
type ArtifactBridgeMessage = {
  type: 'piwin-artifact:size';
  channelId: string;
  height: number;
  viewportHeight: number;
  revision: number;
};
```

- iframe 只读取 `.piwin-artifact-root.getBoundingClientRect().height`。
- 相同高度不重复发送；父层拒绝旧 revision。
- Browser 必须匹配当前 iframe `contentWindow`；native handler 继续做 frame、大小、
  类型与 channel 边界校验。
- 5 秒无消息时精确切到 640px fallback；迟到的合法新 revision 可恢复。

### 4. 外层 transcript

- 实际挂载行的 DOM measurement 不设 4000px 上限。
- 缓存和首次 estimate 仍限制为 4000px，并对明显偏离内容的旧缓存降级为内容估算。
- 缓存只用于未挂载阶段，不能覆盖 fresh measurement。

## 删除项

- `layout-contract.ts` 及 `100vh`/`min-height` 正则修复。
- ready/resize 双消息及 ready phase 判断。
- canvas/video 场景探测、viewport-fill 400px 预算和对应稳定器。
- iframe `window.resize` 高度触发、document/body/scrollHeight 多口径测量。
- transcript 中未被生产入口使用的第二套 item virtualizer。
- `MarkdownView.tsx` 内混杂的 Artifact/代码块状态机；已拆到独立模块。

## 实现位置

- `packages/artifact/src/presentation-policy.ts`：唯一展示路由与 Inline compatibility。
- `packages/artifact/src/parser.ts`：声明类型、document 类型与原始源码保留。
- `packages/artifact/src/srcdoc.ts`：full-document host 注入与单尺寸 bootstrap。
- `packages/artifact/src/bridge-protocol.ts`：唯一 size message parser。
- `apps/desktop/src/artifact-frame-bridge.ts`：revision/source/channel 校验与 fallback。
- `apps/desktop/src/markdown-code-fence.tsx`：源码优先、Inline/Canvas 用户动作闭环。
- `apps/desktop/src/transcript-turn-height.ts`：actual measurement 与 cache estimate 分离。

## 回归门槛

1. 书法页面中的两个 `100vh` 规则与 `innerHeight` 必须被判为 Inline incompatible。
2. 普通 full-document `html` fence 首屏只有源码；点击仅打开 Canvas。
3. Canvas srcdoc 只能有一个 `html` document，不得添加 Inline root，不得包含
   ResizeObserver/size message。
4. Inline sandbox 连续高度消息按 revision 生效；旧 revision 和 foreign window 被拒绝。
5. 6000px transcript turn 的实际占位必须大于 6000px；缓存仍最多 4000px。
6. Artifact、Desktop、Rust bridge 定向测试、workspace typecheck 与 build 全部通过。

## 验证结果（2026-08-22）

- `@piwin/artifact`：16 个测试文件、133 个测试全部通过。
- Desktop：318 个测试文件、2097 个测试全部通过；生产构建通过。
- Workspace typecheck 与 package-boundary 检查通过。
- Tauri Artifact bridge 定向测试通过。
