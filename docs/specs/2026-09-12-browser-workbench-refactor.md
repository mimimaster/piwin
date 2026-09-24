# Browser Workbench 可用性与 Agent 调用重构

| 字段 | 值 |
| --- | --- |
| 状态 | Ready for implementation |
| 日期 | 2026-09-12 |
| 表面 | Desktop Browser 工作台、Host BrowserSession、模型 `browser_*` 工具 |
| 关联 | [ADR 0020](../adr/0020-browser-session.md)、[ADR 0057](../adr/0057-browser-takeover-workbench.md)、[保真度规格](./2026-09-09-browser-workbench-fidelity.md)、[诊断记录](../plans/2026-09-12-browser-workbench-review.md) |

## 1. 产品结论

保留 Host 拥有的一份 Playwright Chromium。Desktop 用户与 Agent 继续操作同一页面、同一登录态和同一标签集合。

本次把右侧栏从“可以转发点击的截图”提升为可读、可操作、可被 Agent 主动用于验证的工作台，解决四类问题：

1. 固定 1280×800 页面在不同面板内缩放，造成明显留白或内容过小；
2. 人类输入缺少拖动、修饰键和可靠错误反馈；
3. 浏览器工具虽然直接暴露，但模型缺少使用时机、控制权状态、操作后证据和错误恢复指引。
4. 远程 Browser 帧被安全投影替换，高清帧又无法安全通过通用 JSON 控制通道。

当前 DSF=2、JPEG quality=80、screencast 与 screenshot fallback 已经落地，不重复实现。远程 Host 的 Browser 帧目前会被通用安全投影改写，并受 1 MiB JSON 帧上限约束；本规格把远程画面传输作为必修复项。

## 2. 范围

### 2.1 本次交付

- Desktop 提供“适应面板”和“固定设备”两种页面视口模式；
- 参照用户提供的浏览器界面复刻两层 chrome，以图标操作取代常驻文字按钮；
- 提供页面截图标注并添加到对话的入口；
- 修正刷新、地址草稿与失败反馈；
- 使用 Pointer Events 建立完整的人类指针输入链，补齐常用键盘交互；
- Host 给 Desktop 和模型返回足够的页面、控制权与恢复信息；
- 改进模型可见的浏览器工作流、工具描述、参数校验和截图证据交付；
- 修复远程 Host 下 Browser 帧被脱敏、超限或解码失败后显示空白的问题；
- 保持 browser 工具为直接模型工具，不迁入 `piwin_toolbox`。

### 2.2 本次不做

- iframe、普通 Tauri WebView 或另一份系统浏览器替换 Host Chromium；
- CEF、Chromium 原生嵌入或新的浏览器内核；
- WebRTC、视频编码或独立浏览器媒体服务；
- 自动连接用户日常 Chrome；
- 跨 Host/Desktop 的完整系统剪贴板双向同步；
- 为调用率而强制所有任务打开浏览器。

## 3. 不变量

1. `@piwin/browser` 仍是应用包；只由 `@piwin/host-runtime` 组合。Desktop 不导入 Pi 或调用 Node/文件系统。
2. BrowserSession 是 Host 权威。Gateway 若参与远程连接，只转发契约，不拥有页面、工具或凭证。
3. 人类控制权优先。Agent 不能自动夺取 `user` 锁；只读观察在任何 controller 状态下可用。
4. Agent 写工具从 `idle` 自动取得 `agent` 锁，无需先调用 `browser_lock`。
5. `browser/frame` 的 width/height 始终是 CSS viewport，坐标、snapshot box 与 pick 共用该坐标空间。
6. 固定设备模式不随面板尺寸改变网站响应式断点；适应面板模式才修改 Host CSS viewport。
7. 模型没有获得页面像素或实际交互结果时，不得把视觉验收表述为完成。
8. Desktop 不把低于显示像素密度的帧静默放大；无法满足目标密度时必须保持 100% 显示或明确标出低清镜像状态。
9. Browser JPEG 不经过远程通用字段投影和通用 JSON 控制帧；认证、订阅与控制权仍由同一个 Host 连接负责。

## 4. Desktop 产品行为

### 4.1 视口模式

复用现有 `BrowserViewportMode`，不增加第二套视口概念：

| 模式 | 行为 |
| --- | --- |
| `follow` | Host CSS viewport 跟随 Browser 内容区；用于日常浏览和全宽工作台 |
| `fixed` | 默认 1280×800；页面保持桌面断点，面板只改变显示比例 |
| `mobile` | 使用现有移动设备预设 |
| `custom` | 用户明确输入 CSS width/height |

新安装和没有保存偏好的现有安装默认 `follow`。用户选择保存在 Desktop 本地偏好；实际 viewport 继续由 Host 发布。打开另一台客户端不会静默覆盖当前 Host viewport。

`follow` 的 Desktop 行为：

- 用 `ResizeObserver` 读取 frame 内容区，取整为 CSS px；
- 尺寸连续变化时 150ms 防抖；宽或高变化小于 8px 不发送；
- 仅在 controller 为 `idle` 或 `user` 时发送 `browser/resize`；Agent 持锁期间保留最后意图，释放后再提交一次；
- **一个客户端只有一个浏览器面板**（2026-09-24）：浏览器视图对应的是同一个 Host Chromium，再开一个视图只是同一页面的第二份镜像。Dock 每种工具只保留一个视图（含浏览器，旧布局里多出的浏览器视图加载时合并）；+ 菜单的"再开浏览器"在已有面板里新建 Chromium 标签页。Host 端兜底：`browser/start` 带客户端标识（`devicePrincipalId`，本地为 `local`），同一客户端的新 lease 会作废它仍持有的旧 lease 并记 `host/log` warn——同一客户端出现两个 lease 属于泄漏，不是"另一个窗口"。
- `browser/resize` 携带当前 mirror `leaseId`。多个客户端（如 Mac 与手机）同时挂载时，**当前使用的那个决定尺寸**（此前是全部冻结在最后的实际 viewport，并挂一条无操作的提示条）：
  - Host 在 `viewport.followLeaseId` 里记录由哪个 lease 决定跟随尺寸。`browser/resize { origin: 'follow', claim: true }` 接管；不带 `claim` 的 follow resize 只在自己就是归属方、只有一个 mirror、或归属 lease 已失效时被接受，否则返回 `browser-viewport-owned`；
  - Desktop 在面板打开（窗口在前台）、窗口获得焦点、页面重新可见、指针移入页面区域时发 `claim`；归属窗口离开后，前台客户端接手。Agent 固定的非 follow 视口不会被接手覆盖；
  - **视口相关不出任何文字提示**：非归属客户端只是按比例缩放显示页面；follow resize 失败时静默退回等比显示并重试；
  - 用户仍可通过显式 viewport set 改变共享页面，这会清空 `followLeaseId`；
- mirror lease 随连接回收：客户端连接关闭（崩溃、被杀、断网）而未发 `browser/stop` 时，Host 在 30s 宽限后以 `browser/stop { reason: 'disconnect' }` 代为释放，除非仍有在线连接持有同一 id。断线释放不作废 lease id；Desktop 在 Host 重新 ready 后用同一 id 重新 `browser/start`。只有 panel 卸载的 stop 才作废 id；
- Host 不再使用单一 `maxDimension=1280` 同时限制宽高。`follow` 的 CSS viewport 独立限制为最大 1920×1200、最小沿用现有 viewport 下界；超出时保持比例缩入该矩形；
- resize 失败时保持上一帧和上一实际尺寸，不乐观修改坐标空间。

`fixed/mobile/custom` 默认使用 `fit` 显示，并显示实际缩放百分比。fit 只允许缩小，不允许超过 100% 放大；面板更大时页面按 100% 居中。用户可切到 `100%`，容器滚动显示超出区域。禁止使用 `object-fit: cover` 裁切页面。

### 4.1.1 像素保真策略

当前模糊来自四件事叠加：Host 固定 1280×800、CSS viewport 最长边限制 1280、screencast 物理最长边限制 2560、Desktop 再用 `object-fit: contain` 放大 JPEG。Retina 全宽面板约 1500 CSS px 时需要约 3000 物理像素，2560 源图必然被插值放大；JPEG quality 80 会进一步软化小字。

本规格把 CSS viewport、页面 compositor DPR、编码像素和 Desktop 显示像素分开处理：

```text
CSS viewport        = 页面布局尺寸
source DPR          = Host Chromium 实际 deviceScaleFactor
encoded pixels      = JPEG 真实 width × height
required pixels     = 页面在 Desktop 的显示 CSS 尺寸 × Desktop devicePixelRatio
density ratio       = encoded pixels / required pixels
```

具体规则：

1. Host 自有 Chromium 继续使用 `deviceScaleFactor=2`。`follow` 模式中 CSS viewport 等于受限后的面板内容区，避免把固定 1280 页面再次放大。
2. 删除 capture 路径的单一 `BROWSER_SCREENCAST_MAX_PX=2560` 最长边算法，改为独立上限：最大编码宽 3840、最大编码高 2400、最大面积 9,216,000 px。默认 1920×1200 CSS、DPR 2 可得到 3840×2400 JPEG。
3. screencast 请求尺寸为 `css viewport × source DPR`，再按上述矩形与面积上限等比缩小；禁止只限制一条轴或把 CSS viewport 上限复用为编码像素上限。
4. `fixed/mobile/custom` 不允许显示比例超过 100%，因此 `source DPR=2` 足以覆盖 Retina 2×。需要看更大页面时切换 Responsive，而不是把固定截图放大。
5. `connectOverCDP` 使用页面真实 `window.devicePixelRatio`，不修改用户浏览器 DPR。若外部页面只有 1×，如实报告低密度，不通过图像插值伪造清晰度。
6. 直播继续使用 JPEG quality 80；提高 quality 不是主要修复。截图 fallback 使用相同 viewport/DPR 规则，不能退回 1×。
7. screencast 必须实际接收 BrowserSession 的 `maxFps`。编码面积不超过 5,000,000 px 时上限 12fps，超过时上限 8fps；HostPush 继续只保留最新 frame。
8. BrowserSession 启动后如果 viewport、source DPR 或 capture bound 改变，停止并重启 screencast。旧 screencast 不能继续输出旧尺寸。

Desktop 依据 frame 的真实编码尺寸计算 density ratio。任一轴低于目标的 90% 时，设备图标显示小型警示点，tooltip 展示“低清镜像：实际 encoded、目标 required、producer”；不增加常驻文字横幅。开发抽屉同时展示 CSS viewport、encoded size、source DPR、显示尺寸、density ratio、JPEG quality 和 producer。

部署该改动后必须重建 BrowserSession/Chromium context，不能依赖前端热更新。已有 context 的 deviceScaleFactor 不会自行变化；Host 或 Browser restart 后才采用新策略。

### 4.1.2 镜像完整性与远程帧通道

截图中页面区域左上角出现“Google”、中央出现损坏图片图标，不是 Google 页面加载失败。“Google”是 `<img alt>`，说明 Browser 镜像图片本身无法解码。当前远程链路存在两个确定问题：

1. `projectRemotePush()` 按字段名把 `browser/frame.dataUrl` 改成 `[redacted]`，Desktop reducer 仍把该字符串写入 `<img src>`；
2. Host WebSocket 通用 JSON 帧硬上限为 1 MiB。高清 JPEG 转成 base64 后体积还会增加约三分之一，超过上限时当前发送路径可能关闭整个连接。

不能通过把 `dataUrl` 加入通用投影白名单或整体调大 `HOST_WIRE_HARD_FRAME_BYTES` 修复。这既扩大敏感数据的通用放行面，也会让高频图像和命令、控制权、心跳争用同一 JSON 队列。

#### 帧契约

统一的 `browser/frame` 契约使用可判别 payload；远程 variant 只在控制面发送有界元数据：

```ts
type BrowserFramePush = BrowserTargetIdentity & {
  type: 'browser/frame';
  frameId: string;
  width: number;
  height: number;
  encodedWidth: number;
  encodedHeight: number;
  sourceDpr: number;
  quality: number;
  producer: 'screencast' | 'screenshot-fallback';
  byteLength: number;
  ts: number;
  payload:
    | { kind: 'inline'; dataUrl: string }
    | { kind: 'binary' }
    | { kind: 'unavailable'; reason: 'client-update-required' | 'frame-channel-unavailable' };
};
```

- 本地 sidecar 暂时使用 `inline`，因为它不经过远程投影和 1 MiB WebSocket 上限；
- 远程 Host 在投影前把 payload 转成 `{ kind: 'binary' }`，JSON 中不出现 `dataUrl`；
- Browser package 到 Host runtime 的内部帧结果改为 JPEG bytes + metadata，base64 只存在于本地 JSONL 适配器，不再是领域对象的标准形态；
- `frameId` 在一次 BrowserSession generation 内单调唯一。`generation + pageId + frameId` 是 Desktop 丢弃旧画面的完整键。

#### 远程二进制承载

远程画面复用现有已认证 WebSocket，不新开端口：

1. `HostClientCapabilities` 与 `RemoteCapabilitySummary` 增加 `browserFrameBinary?: true`，双方声明后才发送二进制帧；
2. Host 先发送有序的 `browser/frame` 元数据 push，再发送包含同一 `frameId` 的二进制消息。二进制消息采用 `version + headerLength + UTF-8 JSON header + raw JPEG`，header 至少包含 `frameId`、`generation`、`pageId`、`byteLength` 和 MIME；
3. JSON push 继续进入现有序列与 cursor；JPEG 不进入 replay、hydration 或通用远程 sanitizer。重连后等待下一张实时帧，不用旧 metadata 猜测画面；
4. 二进制接收上限独立设为 12 MiB，同时校验 header 长度、声明 byteLength、JPEG MIME 和最大解码像素。单帧超限时 capture 只重试一次较低质量或较小尺寸，仍超限则丢弃该帧并发 diagnostic，不能关闭控制连接；
5. 每个远程客户端最多保留一张待发送帧和一张待配对帧。产生新帧时覆盖未发送旧帧；WebSocket buffered amount 超过阈值时继续丢旧保新，不排队追赶；
6. 二进制帧只发给已认证、声明能力且拥有活跃 Browser mirror lease 的客户端。通用 `dataUrl` 脱敏规则保持不变；
7. Tauri 原生 WebSocket 已能收到 `Binary` 消息，适配器改为归一化成 `Uint8Array`，不能再把二进制消息当协议错误并断开。

不支持 `browserFrameBinary` 的远程组合不得发送 `[redacted]` 伪图片。Host 只发可识别的 unavailable 状态；Desktop 显示“远程浏览画面需要更新 Host 或 Desktop”，并保留地址、关闭和重连入口。

#### Desktop 解码与恢复

Desktop 不再在 reducer 收到字符串时立即替换当前 `<img>`：

- `inline` 必须通过 `data:image/jpeg;base64,` 前缀和有界长度校验；`binary` 必须先匹配 metadata、组装 `Blob` 并创建 object URL；
- 候选图片先执行 `img.decode()`。只有解码成功、target identity 仍匹配且 frameId 更新时，才原子替换当前画面；
- 解码失败、payload 缺失、超时或收到 `[redacted]` 时保留上一张有效帧，设备图标显示错误点，tooltip 给出稳定原因；没有有效旧帧时显示带重试动作的 Browser 占位层，不渲染浏览器原生破图标；
- 替换或卸载后撤销旧 object URL。最多持有当前与候选两张 JPEG；
- frame metadata 到达后 2 秒仍未收到对应 binary，丢弃候选并记录 `browser-frame-payload-timeout`。迟到 payload 不得覆盖更新画面。

该通道只承载实时 Browser JPEG。`browser_screenshot` 的证据文件继续走 media service；两者不能共用重放或持久化语义。

### 4.2 Chrome 布局

用户提供的截图是本规格的视觉基准。复刻其信息架构、密度和交互层级，使用 piwin 自有主题 token 与 icon system，不硬编码截图的颜色或像素，也不保留没有产品行为的装饰按钮。

```text
┌ [favicon 标题 ×] [+] ───────────── [开发抽屉] [更多] [全宽] [关闭] ┐
│ [后退] [前进] [刷新] [              地址              ] [外部打开] │
│                                           [标注] [选元素] [视口] │
└──────────────────────── 页面视口 ───────────────────────────────┘
```

标签保持单独一行，导航与模式操作在第二行。地址栏占据剩余宽度，不再显示“前往”“重载”“取元素”等常驻文字按钮；Enter 提交地址。第二行最右固定为截图中的三按钮组：铅笔标注、箭头选择元素、设备视口。

图标映射：

| 位置 | 图标与行为 |
| --- | --- |
| 标签 | favicon、标题、关闭；末尾加号新建标签 |
| 顶栏右侧 | 开发抽屉、更多、右栏全宽/退出全宽、关闭 Browser 面板 |
| 地址左侧 | 后退、前进、刷新 |
| 地址尾部 | 在系统浏览器打开当前 committed URL；tooltip 明确“单独会话”，不暗示共享登录态或 Agent 控制 |
| 模式组：铅笔 | 截取当前受控页面并进入标注模式 |
| 模式组：箭头 | 开关选择元素；快捷键 macOS `⇧⌘S`，Windows/Linux `Ctrl+Shift+S` |
| 模式组：设备 | 打开视口菜单 |

按钮统一使用 `@piwin/ui-kit` `IconButton`，尺寸 32px，图标 16–18px，焦点环和圆角复用主题。缺少的浏览器、设备、选择或标注 icon 只在 `ui-kit` 补齐一次。Icon-only 控件必须有本地化 tooltip、`aria-label` 和键盘焦点；tooltip 同时显示快捷键。hover 使用现有 hover surface，active 使用主题强调色，disabled 保持可辨识并在 tooltip 说明原因。

顶栏高度以紧凑、不挤压网页为准：标签行约 36–40px，导航行约 42–46px。Browser 外框、分隔线、地址栏和菜单直接复用现有 surface/line/control token，支持亮色与暗色主题；不能只实现截图中的硬编码黑色主题。

宽度不足时按优先级收纳：地址栏始终保留；开发抽屉、外部打开和低频操作进入“更多”；后退、刷新、选元素和视口仍直接可达；标签行横向滚动，不把按钮压成不可点击尺寸。

视口菜单复刻截图中的单选菜单结构：

| 菜单项 | 映射 |
| --- | --- |
| 响应式 / Responsive | `follow` |
| 桌面 / Desktop | `fixed`，1280×800 |
| 移动端 / Mobile | `mobile`，375×812 |
| 平板 / Tablet | `custom` 预设，768×1024 |
| 自定义 / Custom | `custom`，显示当前 width×height 并可编辑 |

当前项显示 check。若最后一次 viewport 变更来自 Agent，在当前尺寸下方显示“由 Agent 设置 / Set by Agent”；这只是来源说明，不增加新的 controller 状态。

- `idle` 不显示控制权横幅；
- `user` 在模式组附近显示紧凑状态点，tooltip 为“你在控制 · 交还”；
- `agent` 显示不同颜色的状态点，tooltip 为“Agent 正在控制 · 接管”；点击状态点执行对应动作；
- pending dialog、runtime recovering/failed 仍使用独立横幅；
- Console/Network 保持折叠，不常驻占用页面高度；
- 按钮、菜单、提示和通知复用 `@piwin/ui-kit`。

地址栏维护两个值：`draftUrl` 和 Host 发布的 `committedUrl`。输入只改 draft；提交成功后由 Host state 更新 committed。刷新必须调用 `browser/reload`，只刷新 committed 页面，不读取 draft。

所有用户发起的导航、标签、视口、输入和控制权命令都处理 HostResponse。失败显示一条有界、可关闭的面板提示；相同连续错误合并，避免 toast 风暴。

### 4.3 页面标注

铅笔按钮执行一次只读高质量截图并打开覆盖 Browser 内容区的标注层。标注层冻结截图，不继续接收浏览器帧和页面输入；关闭后恢复实时画面。标注不取得 user controller，因此 Agent 持锁时也可使用。

标注工具按参考界面放在底部浮动工具条：自由画笔、直线、箭头、矩形、椭圆、文字、颜色、撤销、重做、删除当前对象、清空、关闭、添加到对话。首版不增加裁剪、模糊、图层面板或图片滤镜。

实现规则：

- Host 通过 media service 保存原始浏览器截图并返回 `MediaAttachmentRef`；Desktop 不读写本地文件；
- Desktop 使用一个专用 canvas 标注组件合成最终 PNG，复用现有 draft-scoped media upload 上传；
- “添加到对话”只把标注后的 PNG 加入当前 composer，不自动发送消息；
- “关闭”丢弃未添加的标注，但不删除 Host 已按媒体生命周期管理的原始资产；
- resize 标注窗口时保持图片纵横比和标注坐标，不重抓页面；
- 铅笔与选元素不能同时 active。进入其中一个模式会退出另一个；
- 标注模式必须显示清晰的关闭路径，并支持 Escape 关闭。

新增或扩展用户命令返回媒体引用，不在 IPC response 中传整张 base64：

```ts
type BrowserCaptureResponse = {
  attachment: MediaAttachmentRef;
  target: BrowserTargetIdentity;
  width: number;
  height: number;
};
```

### 4.4 指针和键盘

frame surface 使用 Pointer Events：

- `pointerdown` 获取 pointer capture，发送 mouse down；
- captured `pointermove` 发送 mouse move；
- `pointerup` 发送 mouse up 并释放 capture；
- `pointercancel`、窗口失焦、组件卸载或 controller 转为 agent 时，释放仍按下的鼠标键和键盘修饰键；
- wheel 保持转发；连续 move/wheel 可合并，down/up/key 不能跨越合并或重排；
- 双击由连续 pointer 事件的 `detail/clickCount` 形成，不再额外叠加一套 click + dblclick 派发。

键盘桥接保留隐藏输入面承接 IME 和 paste，并补齐 Shift、Alt、Control、Meta 的 down/up。路由规则如下：

- 中文组合文本和粘贴使用 `insertText`；
- Enter、Tab、Escape、Backspace、Delete、方向键及其 Shift 组合转发到页面；
- 页面聚焦时，Cmd/Ctrl+A、Z、Shift+Z 转发到页面；
- 应用级快捷键仍由 Desktop 保留，并在一个具名策略模块中列明；
- Cmd/Ctrl+C/X 本轮不声称具备完整远端剪贴板语义。没有实现选区内容回传前，界面提示该限制。

Pick 是只读输入模式修饰符，不取得或夺取 controller，因此 Agent 持锁时仍可选择当前稳定帧上的元素。开启时 pointer up 只执行 pick，不把同一次操作派发给页面；Host 通过浏览器互斥队列串行执行并校验 target identity。切页、导航或退出 pick 时清除旧高亮。

## 5. 契约和 Host 行为

### 5.1 目标身份

复用已有 `generation`、`pageId`、`documentRevision`，扩充 Desktop 写命令：

```ts
type BrowserTargetIdentity = {
  generation: number;
  pageId: string;
  documentRevision: number;
};

type BrowserTargetedInputCommand = {
  type: 'browser/input';
  target: BrowserTargetIdentity;
  events: BrowserInputEvent[];
};
```

`BrowserFramePush` 使用 4.1.2 的契约并携带同一份 target identity。`browser/pick-at` 同样携带 target。Host 在执行前比较当前目标；不一致返回现有 `browser-stale-target`，不派发输入。Host 从 JPEG header 读取 encodedWidth/encodedHeight，不把请求的 screencast size 当作实际结果。`browser/state` 也必须携带足够身份，使 Desktop 为当前显示帧建立 target。兼容旧客户端的可选字段只允许存在于协议迁移期；Desktop、Host 和 contracts 在同一切片完成更新。

`browser/resize` 携带 mirror `leaseId` 并通过 user actor/controller gate，不能绕过 Agent 控制权或由已释放的 panel 改变视口。Host state 返回实际 `viewport`，它是 Desktop 坐标换算的唯一权威。

### 5.2 完整状态

`BrowserRuntimeState` 增加模型与 UI 都需要的只读字段：

```ts
type BrowserRuntimeState = {
  // existing lifecycle / mirror / page fields
  controller: BrowserController;
  agentWantsLock: boolean;
  pendingDialog?: BrowserDialogInfo;
};
```

不暴露 `holderRunId` 给模型。`browser_status` 返回上述状态，并附一个稳定的 `nextAction`：

- `ready` + `idle/agent`：`continue`；
- `ready` + `user`：`read-only-or-wait-for-user`；
- `recovering`：`wait-for-recovery`；
- `failed` 且可恢复：`restart`；
- `stopped`：`navigate-or-observe-will-start`。

静态页面长时间没有新帧不表示断线；UI 根据 lifecycle/mirror/lastFailure 判断健康状态。

## 6. 模型调用策略

### 6.1 暴露规则

Browser 工具继续作为 first-class direct tools。不要通过 `piwin_toolbox` 增加 describe/call 仪式。

本次不改变 Side Chat 的安全边界。普通 Agent 会话继续要求配置为 `browser: agent`、backend ready、具备 browser capability。后续若要为只读会话开放浏览器观察，应单独引入 `browser-observe` 家族并重新评估页面隐私；本次不把 read/write 暴露拆分塞进同一 PR。

### 6.2 能力级系统指引

在 blueprint compiler 仅当最终 Host tools 包含 `browser_status` 与 `browser_snapshot` 时追加以下短指引。实现为独立 `formatBrowserSystemPrompt()`，不复制到每个工具描述：

> When the task changes or evaluates visible web UI, or the user asks you to inspect or operate a page, use the shared browser proactively. Use browser_status to inspect the current page and control state, navigate only when needed, browser_snapshot for current refs, and browser_screenshot for visual layout. After actions, prefer browser_wait_for and verify the resulting state. Browser writes auto-acquire idle control; do not call browser_lock first. If the user has control, continue with read-only observations or wait for an explicit handoff; never loop or steal control. Refresh refs after navigation or a stale-target result. Do not claim visual verification unless screenshot pixels or a vision description were delivered.

不要求纯文档、纯后端、无需运行页面的任务调用浏览器。

### 6.3 工具描述和参数

统一共享写工具后缀：

> Automatically acquires agent control when idle. If the user has control, the call returns browser-user-has-control; do not retry until the user hands it back. Read-only browser tools remain available.

需要修正的工具语义：

| 工具 | 规格 |
| --- | --- |
| `browser_status` | 描述为无副作用入口；返回当前 URL、页面身份、controller、mirror/lifecycle、dialog 和 nextAction |
| `browser_navigate` | 说明用于需要 JS、登录态或真实页面交互；静态资料读取优先 web_fetch |
| `browser_snapshot` | 说明 ref 只对当前 documentRevision 有效，导航或 stale 后重新获取 |
| `browser_click` / `hover` / `type` / `select_option` / `set_checked` / `upload` | prepareArgs 统一校验 ref 或 selector 至少一个；缺失返回 `invalid-input` |
| `browser_type` | 明确“聚焦后追加键入”；替换文本使用 fill |
| `browser_fill_form` | 明确只填 text-like fields；checkbox/select 使用专用工具 |
| `browser_find` | 返回最多 20 个候选 `{ text, ref?, selector? }` 和总数；没有可靠目标时只返回文本，不伪造 ref |
| `browser_select_option` | 本次只接受 value/values；删除“index”描述。需要 index 时以后增加显式参数类型 |
| `browser_scroll` | 增加可选 ref/selector 与 amount；省略目标时滚动主页面，amount 使用有界 CSS px |
| `browser_wait_for` | 描述为导航、渲染和异步结果的首选等待；结果包含实际满足的条件 |
| `browser_wait` | 描述为短动画的固定延时补充，不表示页面加载成功 |
| `browser_screenshot` | 明确结果中的 `evidence.status`；只有 delivered/delegated 才构成模型可见视觉证据 |

`browser_navigate`、click、type、fill、reload 等成功结果附轻量 `page`：

```ts
type BrowserToolPageState = {
  url: string;
  title: string;
  generation: number;
  pageId: string;
  documentRevision: number;
  pendingDialog: boolean;
};
```

不在每次操作后自动返回整棵 snapshot 或截图。模型根据结果决定是否观察，避免输出膨胀。

### 6.4 错误恢复

保留 `retryable` 表示“相同调用可否原样重试”，另在 browser 错误 details 返回 `recovery`：

| code/reason | recovery |
| --- | --- |
| `browser-user-has-control` | `wait-for-user-handoff` |
| `browser-stale-target` | `snapshot-and-retarget` |
| overlay intercept | `snapshot-or-dismiss-overlay` |
| runtime gone | `retry-once-after-recovery` |
| unavailable | `report-browser-unavailable` |
| wait timeout | `inspect-current-state` |

这允许 stale target 保持 `retryable: false`，同时告诉模型换参数后可以继续。副作用操作不得自动重放。

## 7. 截图证据闭环

`browser_screenshot` 区分捕获和模型证据交付：

```ts
type BrowserScreenshotEvidence =
  | { status: 'delivered'; mediaId: string }
  | { status: 'delegated'; mediaId: string; description: string; model: string }
  | { status: 'unavailable'; mediaId: string; reason: string };
```

- 原始截图始终按现有 media service 保存，UI 可展示；
- 支持视觉的主模型优先收到原生图片；超过原生图片上限时，在 Host 内生成仅用于模型结果的有界 JPEG 派生图，原图不覆盖；
- 主模型无视觉能力时沿用 vision delegation；
- 压缩、派生或 delegation 失败时仍返回 capture 成功，但 evidence 为 unavailable，并提供原因；
- inspect 异常不得静默退化为只有 width/height 的普通成功；
- 文案区分“模型无视觉能力”和“图片超过原生上限”。

## 8. 模块与实施切片

### Slice A：调用闭环

改动：

- `packages/host-runtime/src/browser-tool-registrations.ts`
- `packages/host-runtime/src/browser-tool-stage-bc.ts`
- `packages/host-runtime/src/browser-tool-errors.ts`
- `packages/host-runtime/src/browser-screenshot-inspect.ts`
- 新建 `packages/host-runtime/src/browser-system-prompt.ts`
- `packages/host-runtime/src/blueprint-compiler.ts`

完成工具指引、status、参数校验、轻量 page state、错误 recovery 和截图证据。此切片不依赖 Desktop UI。

### Slice B：清晰度、视口与 Chrome

改动：

- `packages/contracts/src/browser.ts` 与浏览器 IPC command
- `packages/browser/src/viewport.ts`
- `packages/browser/src/screencast-size.ts`
- `packages/browser/src/screencast.ts`
- `packages/browser/src/browser-mirror.ts`
- `packages/browser` controller 现有模块
- `packages/host-runtime/src/commands/browser-commands.ts`
- `apps/desktop/src/browser-session-chrome.tsx`
- `apps/desktop/src/browser-session-lease.ts`
- 新建 `apps/desktop/src/hooks/use-browser-viewport.ts`
- `apps/desktop/src/styles/browser-session.css`
- `packages/ui-kit/src/icon-button.tsx` 与缺失的共享 icons
- Browser 所在 right-panel 的全宽/关闭 chrome 接口

先完成独立 CSS/capture bounds、真实 encoded size 上报、density ratio 和 screencast 重启，再按视觉基准完成两层 icon chrome、viewport menu、follow/fixed 显示、刷新语义、命令失败反馈和 target identity。不要新建第二个浏览器状态 store，也不要在 Desktop 私建一套 icon button。

### Slice C：人类输入

改动：

- 从 `browser-session-panel.tsx` 提取 `BrowserViewportSurface.tsx`
- 新建 `apps/desktop/src/hooks/use-browser-input.ts`
- 扩展现有 `browser-workbench-ime.ts` 与 `browser-workbench-pointer.ts`
- 扩展 `packages/browser/src/input.ts`

完成 pointer capture、修饰键、双击、释放路径及 stale input 保护。现有 lease、chrome、pointer 和 IME 模块继续复用；不创建泛化 input framework。

### Slice D：页面标注

改动：

- contracts 增加 browser capture response
- Host browser command 通过现有 media service 保存截图
- 新建 `apps/desktop/src/browser-annotation-overlay.tsx`
- 新建职责明确的标注 canvas state 模块
- 复用现有 draft-scoped media upload 和 composer attachment 接口

完成铅笔入口、冻结截图、基础标注工具和“添加到对话”。标注状态只存在于 Desktop 覆盖层，不进入 BrowserSession，不引入通用画布编辑器。

### Slice E：远程帧通道与解码恢复

改动：

- `packages/contracts/src/ipc-host-push.ts`
- `packages/contracts/src/remote-protocol.ts`
- 新建 `packages/host-transport/src/browser-frame-codec.ts`
- `packages/host-transport/src/websocket-host-transport.ts`
- `packages/host-transport/src/native-websocket.ts`
- `packages/host-server/src/host-server.ts`
- `packages/host-server/src/remote-projection.ts`
- `packages/browser/src/frames.ts` 与 screencast/mirror 的帧结果类型
- `apps/desktop/src/browser-session-lease.ts`
- 新建 `apps/desktop/src/browser-frame-decoder.ts`

完成能力协商、远程二进制编码、latest-only 背压、元数据与 payload 配对、原子解码替换、坏帧恢复和 object URL 回收。`HOST_WIRE_HARD_FRAME_BYTES` 保持 1 MiB；禁止以字段白名单绕过 `REMOTE_SECRET_KEYS`。本地 sidecar 继续由 JSONL adapter 生成 inline payload，但进入 Desktop 后复用同一套校验、身份判断和原子替换。

记录 encoded 尺寸/字节、捕获到显示延迟、payload 配对超时、解码失败、丢帧和 WebSocket 背压。浏览器帧失败只降低镜像能力，不能拖断命令、控制权或心跳。

每个 slice 独立提交；A 不混入 UI，B 不重写输入，C 不改帧传输，D 不扩展为通用图像编辑器，E 不改 Browser 内核。落地行为后同步 ADR 0020、ADR 0057 和 `docs/architecture.md`。

## 9. 必要验证

只保留以下阻断性验证：

1. `pnpm typecheck`，以及 contracts、browser、host-runtime、host-transport、host-server、desktop 受影响测试通过；
2. 一条 Host 工具回放覆盖：主动验证页面、用户持锁、stale ref 恢复、大截图证据；
3. 一次真实 Tauri + 本地/远程 Host Chromium 手测覆盖：远程画面可连续显示且坏帧不产生破图、Retina 全宽 follow 的双轴 density ratio ≥ 90%、fixed 不放大、两层 icon chrome、刷新草稿地址、中文输入、拖动、双击、选元素、标注添加到对话和接管/交还；
4. 源文件无超过 1000 行；接近 400 行的 panel 按本规格拆分。

## 10. 完成定义

用户在分栏和全宽浏览器中得到与参考界面一致的紧凑两层 browser chrome；Retina follow 模式不再把固定 1280/2560 JPEG 放大，无法满足目标像素密度时也有明确状态。远程 Host 不再把 Browser 画面改成 `[redacted]` 或让大图挤断控制连接，坏帧也不会替换最后一张有效画面。用户能通过清晰图标导航、选择视口、选择元素和标注页面并添加到对话；常用输入不再因镜像桥接失真，失败有明确反馈。模型在前端可见任务中知道何时调用浏览器，能判断当前控制权，操作后获得可验证的页面状态或视觉证据，并能从 stale target 等常见错误中恢复。
