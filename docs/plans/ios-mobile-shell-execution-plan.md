# Piwin iOS 移动端壳执行计划

状态：实施中：Host 连接/只读/聊天/权限/小图片 asset 初始切片已完成，配对和完整产品面仍待实现  
日期：2026-08-08  
范围：iOS first，同时保持 Android 使用同一套前端和 Host 协议  
目标：在尽量复用现有 Piwin 代码的前提下，交付一个可安全连接私有 Host 的移动端 Agent cockpit，而不是把桌面 IDE 缩小到手机上。

## 0. 结论先行

推荐路线如下：

1. 客户端使用 Tauri 2 Mobile + React/TypeScript/Vite。
2. iPhone 不运行 Node、Pi、MCP server、Skill 执行器或项目终端。所有真实执行都发生在 Host。
3. 先补齐统一的 Host Server、HostClient、HostTransport 边界，再做移动 UI。
4. Desktop 保持现有 Tauri sidecar 模式，但改为复用同一套 HostClient 和 contracts；移动端通过 WebSocket 连接远程 Host。
5. 命令/事件使用 WebSocket；图片和文件使用受限的 HTTP 二进制上传；不要把文件路径或 base64 塞进 prompt 文本。
6. 首版只面向私有网络：Tailscale/Headscale、WireGuard、私有 LAN 或 SSH forwarding。暂不做公共云中继、多人租户和公网匿名访问。
7. 优先复用仓库现有的 contracts、HostRuntime、agent-host、media、artifact、ui-kit 和规范化 AgentEvent；外部仓库只借鉴协议和交互，不整体复制 UI 或运行时。

这条路线的核心收益是：

    iOS/Android UI
        ↓
    @piwin/host-client
        ↓
    @piwin/host-transport
        ↓
    Host Server
        ↓
    @piwin/host-runtime
        ↓
    @piwin/agent-host
        ↓
    Pi SDK/RPC

移动端不需要“懂” Pi、MCP 或 Skill 的内部实现。它只展示 Host 返回的能力和执行结果，并发送受 Host 策略约束的产品命令。

## 1. 依据和现状

本计划以以下仓库规则和文档为约束：

- AGENTS.md：客户端不得导入 Pi；只有 agent-host 可以依赖 Pi；跨边界能力先进入 contracts；Host 是唯一执行权威。
- docs/prd.md：Piwin 是私有 coding-agent shell，Desktop/CLI 是现有 shell，移动端是未来 shell。
- docs/architecture.md：目标依赖方向是 client → Host → application services → agent-host → Pi。
- docs/adr/0036-host-server-multi-client-deployment.md：已接受的 Host Server、多客户端、设备身份、推送序列、重连、回放和安全边界。
- docs/adr/0013-pty-tauri.md：PTY 是 Desktop 本地能力，不应在移动端假装成远程 PTY。
- docs/adr/0015-async-desktop-turn-transport.md：prompt 快速返回 runId，执行事件通过 HostPush 推送；控制命令独立于普通事件队列。
- docs/adr/0033-mcp-outside-permission-layer.md：MCP 由 Host 用户自己承担 OS 权限风险，不进入产品权限提示层。

当前仓库已经具备的可复用基础：

- packages/contracts：HostCommand、HostPush、AgentEvent、run、permission、session、media 等类型。
- packages/host-runtime：产品组合根，负责把应用服务和 agent-host 接起来。
- packages/agent-host：Pi SDK/RPC 双模式和 Pi 事件归一化边界。
- packages/media：Host 侧媒体落盘、MIME/大小/path traversal 校验。
- packages/artifact：便携的 artifact 纯逻辑和安全策略。
- packages/ui-kit：纯 UI 组件和主题能力。
- Desktop 现有 HostClient、Tauri JSONL sidecar、Markdown/运行状态/权限展示等实现。
- HostPush 已有 seq/eventId 的方向，Async Turn 已经使用 runId。

当前阻塞移动端直接开工的缺口：

- packages/host-client 尚不存在，HostClient 仍直接放在 apps/desktop/src/host-client.ts。
- packages/host-transport 尚不存在，Desktop 的 Tauri invoke/listen 和 JSONL sidecar 是应用内实现。
- apps/host 和 packages/host-server 尚不存在，远程 Host 只有 contracts/ADR 层面的 seams。
- HostStatusData 目前包含 piwinRoot 等本地信息，远程返回必须使用安全投影，不能泄露 Host 路径。
- 当前 media attachment 仍以 Host 本地 path 为核心，移动端必须改为 opaque assetId。
- Desktop Rust 入口无条件包含 host_bridge、pty_host、pet_overlay 等桌面专属模块；移动 target 必须做平台隔离。

因此，先做移动 UI 会产生第二套临时协议和第二套状态机，最终必然返工。Host seams 是硬前置。

## 2. 产品边界

### 2.1 移动端的定位

移动端是“远程 Agent cockpit”：

- 查看正在运行的任务和最近会话。
- 发送问题、补充要求、停止或继续任务。
- 在 Host 请求时做明确的权限决策。
- 查看 Markdown、代码块、diff、计划、运行阶段和错误。
- 从手机拍照或选择文件，作为 Host 任务的附件。
- 在断线后恢复当前视图，不重复提交命令。

移动端不是：

- 移动版 VS Code。
- 本地 Node/Pi 运行器。
- 远程终端或远程 PTY。
- MCP/Skill 安装和编辑控制台。
- Provider API key、密钥文件或权限配置的编辑器。
- 公网 SaaS 控制面板。

### 2.2 MCP 和 Skill 在移动端如何处理

移动端不直接管理 MCP 或 Skill：

- MCP server、Skill 文件、模型 Provider、权限配置都留在 Host。
- Host 在会话执行时按自己的配置调用它们。
- 移动端只显示安全的 capability summary，例如“当前 Host 启用了哪些能力”，不显示本地路径、环境变量、密钥和完整配置。
- MCP 工具执行结果作为普通 tool activity/AgentEvent 展示。
- 由于 ADR 0033 明确 MCP 在产品 permission layer 之外，MCP 不应该被移动端包装成普通“允许/拒绝”权限卡；若未来要加 MCP 管理，必须另写 ADR 和独立管理协议。
- Skill 的编辑、安装、删除、启停同样不属于首版移动功能。

## 3. 功能列表和优先级

### 3.1 P0：第一版必须完成

| 功能 | 移动端行为 | Host 行为 | 验收结果 |
|---|---|---|---|
| 私有 Host 配对 | 扫 QR；也支持手动输入短码/地址 | 生成短时、单次 pairing token，签发可撤销 device credential | 新设备能配对；token 过期、重复使用和撤销均失败 |
| Host 连接状态 | 显示连接中、已连接、断线、恢复中、Host 不可用 | 返回 protocolVersion、hostInstanceId、安全 capability summary | 用户能分辨“手机断线”和“Host 正在执行” |
| 运行中任务总览 | 首页显示 active runs、阶段、耗时、最近事件 | 从 HostPush 推送 run/phase、agent/event、terminal | 任务离开聊天页仍可被找到 |
| 项目列表 | 选择 Host 上已授权的项目 | 返回 projectId、显示名、有限元信息，不返回绝对路径 | 手机不需要知道项目本地路径 |
| 会话列表 | 最近会话、运行中会话、未读会话 | 使用现有 session authority | 列表与 Desktop/CLI 看到的是同一 Host 数据 |
| 创建/恢复会话 | 选择项目后创建或恢复 | 创建或恢复真正的 Host session | 同一 session 可被多客户端观察 |
| 对话流 | 文本输入、发送、追加要求、查看流式消息 | prompt 快速返回 runId，通过 HostPush 推送归一化 AgentEvent | 首个响应持续流式到达，不依赖轮询 |
| 任务控制 | stop、abort；必要时 steer/follow-up | 使用已有 async-turn/control lane，按 runId 控制 | 停止后不再把旧 run 的晚到事件混入新 run |
| 权限处理 | 显示风险、目标、命令/文件范围和 Host 给出的上下文；允许/拒绝 | Host 侧重新检查策略、session、requestId 和 device policy | 手机不能越权；拒绝后任务收到明确结果 |
| 结果查看 | Markdown、代码块、diff、计划摘要、tool activity、错误 | 返回 normalized AgentEvent 和产品结果模型 | 不解析 Pi 原始事件；离线恢复后内容一致 |
| 图片/文件附件 | 相机、照片库、Files 选择；显示上传进度和取消 | 生成 upload ticket，校验 MIME/大小/hash，保存到 ~/.piwin/media | prompt 只引用 assetId；Host 负责把图片作为原生 ImageContent 传给 Pi |
| 断线恢复 | 自动重连；恢复会话和当前 run；避免重复发送 | 按 lastSeq 回放，过旧则发 snapshot；支持 requestId/idempotency | 弱网切换后事件不重复、不乱序、不丢关键状态 |
| 基础设置 | Host 列表、设备名称、锁定/解锁、通知开关、退出设备 | 设备撤销和 Host capability 由 Host 管理 | 清除设备后旧 credential 立即失效 |

### 3.2 P1：P0 稳定后增加

- APNs/Android push：任务结束、权限请求、Host 离线等重要事件。
- 多 Host 切换和每个 Host 独立的设备状态。
- 会话 fork/duplicate。
- 只读 Git 状态、变更文件和 diff。
- 模型和 thinking level 选择；选项必须来自 Host capability，不允许手机伪造。
- 只读查看 Host 当前启用的 Skill/MCP/工具摘要。
- artifact 安全预览。
- 分享或导出一段结果。
- 语音输入；语音转文字放客户端或明确的 Host 服务，不让 Pi 直接接收不可控音频。
- 细化通知过滤、免打扰、后台同步。

### 3.3 明确不做

- 远程 PTY、远程 shell 交互终端。现有 PTY 设计是 Tauri Desktop 本地能力；远程 PTY 需要单独的安全与流控设计。
- 手机本地 Node、Pi、MCP server、Skill 执行。
- 手机直接读 Host 文件系统、直接传 Host 绝对路径。
- 手机修改 provider secrets、权限规则、MCP JSON、Skill 文件。
- 公网暴露 Host、匿名链接、多人租户、云端保存会话。
- 在移动端复制整套 Desktop IDE、文件树和复杂面板。

## 4. 目标架构和包边界

### 4.1 目标依赖图

    apps/mobile
        ↓
    @piwin/host-client + @piwin/client-state + @piwin/ui-kit
        ↓
    @piwin/host-transport + @piwin/contracts
        ↓
    apps/host
        ↓
    @piwin/host-server
        ↓
    @piwin/host-runtime
        ├── application packages
        └── @piwin/agent-host
                ↓
             Pi SDK/RPC

    apps/desktop
        ↓
    @piwin/host-client
        ↓
    apps/desktop/src/local-host-transport
        ↓
    Tauri JSONL sidecar
        ↓
    HostRuntime

移动端和 Desktop 共享 HostClient、contracts、状态模型、ui-kit 和可移植渲染逻辑，但不共享桌面专属 Rust 命令或桌面布局。

### 4.2 推荐的工程形态

新增 apps/mobile 作为 Tauri 2 Mobile shell，不复制 apps/desktop 的整套 UI。共享逻辑必须先抽到公共包，通过包的 public exports 引用；禁止从 apps/desktop/src 深层相对导入。

这样做比把 Desktop 的 PTY、sidecar、pet overlay、目录选择器和桌面布局全部条件编译进同一个入口更容易控制边界。新增 apps/mobile 属于架构目标的一部分，实施前同步更新 docs/architecture.md 和 ADR，不以临时目录方式绕过规范。

第一阶段只做一个 iOS target 的可运行垂直切片；Android 复用同一套 TypeScript、contracts、HostClient、HostTransport 和大部分 UI，随后做 Android 真机 smoke test。不要维护两套移动前端。

### 4.3 新增或调整的包

#### packages/contracts

增加或调整：

- RemoteHello、RemoteChallenge、RemoteHostInfo、RemoteCapabilitySummary。
- DeviceCredential、PairingRequest、PairingResult、DeviceRevoke。
- HostCommandEnvelope、HostResponseEnvelope、HostPushEnvelope。
- protocolVersion、hostInstanceId、deviceId、requestId、idempotencyKey、seq、eventId。
- ReplayRequest、ReplayResult、SnapshotCursor、ReplayTooOld。
- Remote-safe HostStatus projection。
- MediaUploadTicket、MediaAssetRef、MediaUploadComplete。
- 稳定的 remote error code 和 retryability。

保留现有 HostCommand/HostPush/AgentEvent 作为产品语义层；传输 envelope 只负责路由、认证、序列、幂等和错误，不复制 Pi 事件类型。

#### packages/host-transport

只依赖 contracts 和必要的标准运行时能力，不依赖 Pi、HostRuntime、React 或 Tauri。职责：

- transport port 和连接生命周期。
- wire envelope 编解码、版本协商。
- WebSocket client transport。
- 重连退避、心跳、最大帧和关闭原因。
- push 订阅和连接诊断。

本包不负责业务命令策略、不保存 provider secrets、不执行 Host 工具。

#### packages/host-client

只依赖 contracts、host-transport 和必要的纯客户端类型。职责：

- typed request/response API。
- requestId、idempotencyKey 生成。
- HostPush 分发、subscription 管理。
- lastSeq 持久化接口。
- replay/snapshot 恢复编排。
- command timeout、abort 和控制 lane。
- capability gating 的客户端提示；真正的权限检查仍在 Host。

现有 apps/desktop/src/host-client.ts 的行为先迁移到这里，再接入两种 transport。迁移期间保持 Desktop API 兼容适配层，完成后删除重复实现。

#### packages/client-state

仅在抽取现有 Desktop 状态后创建。只放跨 shell 共享的纯 reducer、selector 和 view model：

- connection state。
- session list/detail state。
- run state 和 runId 隔离。
- permission request state。
- replay/snapshot hydration。
- unread/active run 状态。

不放 Tauri invoke、React hooks、fs、网络和 Pi 类型。若现有状态足够小，可先放在 host-client 内；只有确实被 Desktop 和 Mobile 共同使用时才拆出本包，避免过度分包。

#### packages/host-server

只依赖 contracts、host-runtime、Node HTTP/WebSocket 运行时和必要的小型基础库。职责：

- 监听地址和 TLS/私有网络配置。
- WebSocket session。
- pairing、device authentication、revoke。
- command admission 和 RemoteCommandPolicy。
- HostPush fan-out、订阅过滤和每客户端有界队列。
- seq/eventId、replay buffer、snapshot。
- health/capability endpoint。
- media upload ticket 和上传入口的 Host 侧适配。

它是 HostRuntime 的适配边界，不把 Pi 导入到 server transport 层。

#### apps/host

Node 可部署入口：

- 读取 ~/.piwin 和 Host 配置。
- 创建 HostRuntime。
- 创建 HostServer。
- 提供 serve、status、pair、device revoke 等 CLI 操作。
- 本地默认安全策略和日志脱敏。

Desktop 本地 sidecar 和独立 apps/host 必须最终使用同一 HostRuntime 组合根，不能各自实现一套业务。

#### apps/mobile

薄壳：

- Tauri 2 iOS/Android native project。
- React/TypeScript 移动布局。
- 只调用 HostClient、client-state、ui-kit 和公共渲染包。
- Tauri 原生能力只通过明确的 mobile capability adapter 使用。

## 5. 远程协议设计

### 5.1 连接和握手

建议 WebSocket 承载 JSON envelope。每条消息都带 kind、protocolVersion 和 requestId 或 eventId，避免让客户端猜测消息形状。

连接流程：

1. Mobile 读取已保存的 Host endpoint、deviceId 和 device credential。
2. Mobile 建立 wss 或私有网络 ws 连接，并发送 ClientHello：
   - protocolVersion。
   - clientType：mobile。
   - clientVersion。
   - deviceId。
   - lastSeq。
   - 订阅范围。
3. Host 返回 challenge、hostInstanceId 和可协商 capability。
4. Mobile 使用 device credential 对 challenge 做 HMAC-SHA-256 响应。
5. Host 验证 credential、设备是否撤销、Host policy 和版本兼容性。
6. Host 返回 HostHello：
   - hostInstanceId。
   - negotiatedProtocolVersion。
   - safe capability summary。
   - currentSeq。
   - replay/snapshot 结果。
7. 连接进入 ready；客户端先 hydrate snapshot，再应用严格递增的 HostPush。

不在 QR 或日志中放 provider secret、Pi 配置、Host 绝对路径或长期明文密码。

### 5.2 配对

P0 推荐使用“短时一次性 pairing token 换设备 credential”：

1. 用户在已信任的 Desktop/CLI/Host 本地终端执行 pair。
2. Host 生成高熵随机 token，保存 token hash，设置短 TTL（建议 10 分钟）和 one-time 使用标记。
3. QR payload 只包含 Host endpoint、hostInstanceId、protocolVersion、token 和过期时间。
4. Mobile 扫描 QR 或手动输入。
5. Mobile 生成 deviceId 和随机 device secret；通过 TLS 和一次性 token 发送 pairing request。
6. Host 验证 token 后保存 device secret 的 hash，返回 device credential 和设备显示信息。
7. Mobile 将 device secret 写入 iOS Keychain/Android Keystore；应用内只保留不可逆的设备标识和显示偏好。
8. Pairing token 立即失效；用户可在 Host 端查看、命名、撤销设备。

设备认证不需要自创 E2EE。首版要求非 loopback 连接使用 TLS，并把 credential 只用于设备认证；内容保密由 TLS 负责。若未来要穿越不可信中继，再另立 E2EE ADR。

Keychain/Keystore 的具体实现必须在 Phase 0 做真机验证。Tauri Stronghold 不能在没有当前版本验证的情况下直接作为长期承诺；若跨 iOS/Android 行为不稳定，使用经过审计的 keystore 插件或写一个极小的定向 native adapter，只暴露 get/set/delete 三个操作。

### 5.3 命令 envelope

每个客户端命令至少包含：

- requestId：一次请求的关联 ID。
- idempotencyKey：所有可能重试的写操作必须有。
- deviceId。
- command：现有 HostCommand。
- clientTimestamp：仅用于诊断，不作为安全判定。

Host response 至少包含：

- requestId。
- ok。
- data 或稳定 error。
- retryable。
- hostInstanceId。

只读查询可以在网络恢复后重新发起。prompt、create session、permission resolve、abort 等写操作必须通过 requestId/idempotencyKey 去重，避免移动系统重试导致重复执行。

### 5.4 Push、序列和重连

HostPush 统一增加或规范化：

- hostInstanceId。
- seq：Host 单调递增序列。
- eventId：事件唯一 ID。
- sessionId/runId（适用时必填）。
- emittedAt。
- payload。

重连策略：

1. Mobile 本地记录最后确认消费的 seq，但不把它当作 Host 业务状态。
2. 重连时带 lastSeq。
3. Host 能回放：返回 replay，并从 lastSeq + 1 严格发送。
4. Host 回放窗口不足：返回 replay-too-old 和 snapshot cursor。
5. Mobile 先替换指定 session/run 的 snapshot，再接收 snapshot 之后的事件。
6. seq gap、hostInstanceId 变化、协议不兼容都进入明确的 resync 状态，不静默拼接。
7. 服务端为每个客户端设置有界发送队列；慢客户端被断开并要求 snapshot 恢复，不能无限吃 Host 内存。
8. 普通 agent event 和控制 lane 分离。permission/resolve、abort、steer 等控制命令不能被大量日志事件堵住。

客户端 UI 必须按 runId 严格隔离事件。旧 run 的晚到事件可以记录诊断，但不得改变新 run 的状态。

### 5.5 媒体上传

不要让移动端发送：

- Host 本地绝对路径。
- file:// 路径给 Host 解释。
- 放在 prompt 文本里的 base64。

推荐 P0 流程：

1. Mobile 发送 media/upload-ticket，包含 sessionId、mimeType、byteSize、sha256 和原始文件名的安全显示部分。
2. Host 返回短时 upload ticket、opaque assetId、最大大小和一次性上传 URL。
3. Mobile 用 HTTP multipart/ArrayBuffer 上传二进制，支持 AbortController 和进度回调。
4. Host 校验 ticket、身份、大小、MIME、hash、文件名和 media 根目录。
5. Host 将文件保存到 ~/.piwin/media/，返回 assetId。
6. Mobile 发送 prompt 时只传 MediaAssetRef：assetId、mimeType、byteSize、sha256、displayName。
7. Host 在 PromptPreparation 中把 assetId 解析为受控的 Host 内部路径，并按 AGENTS.md 的规则以原生 ImageContent 传给 Pi。

首版先限制单文件大小，例如 20 MB，并使用单次上传；不要一开始写分片协议。只有真机实测大文件、弱网恢复确实需要时，再增加 chunk/complete/abort。上传和 WebSocket 命令分离，避免二进制占满事件通道。

### 5.6 状态和路径安全

远程 HostStatus 只能返回：

- ready、mode、hostInstanceId。
- protocolVersion。
- active session/run 数量和 opaque IDs。
- capability flags。
- 可选的项目显示名。

禁止返回 piwinRoot、piRoot、环境变量、密钥路径、MCP 配置路径和完整命令行。

Host 内部可以继续使用绝对路径；跨边界只使用 projectId、sessionId、runId、assetId 和经过服务端生成的 bounded content。

## 6. Host Server 实现策略

### 6.1 Transport 选择

首版使用标准 WebSocket 协议：

- Node Host Server 使用 ws；它可以挂在已有 HTTP/S server 上，也有成熟的心跳、鉴权和客户端管理模式。
- Mobile/Web 客户端优先使用运行时原生 WebSocket，避免再引入一个浏览器端 socket 封装。
- 不使用 Socket.IO：现有 HostCommand/HostPush 已经是产品协议，Socket.IO 会增加另一层事件语义和部署约束。
- 不直接依赖通用 reconnecting-websocket 解决问题：Piwin 必须自己实现 lastSeq、replay、snapshot、幂等和控制 lane；退避算法可以参考成熟实现。

### 6.2 Server 内部模块

建议每个文件只承担一个边界：

- host-server.ts：HTTP/WS 生命周期和组合。
- websocket-client.ts：单客户端连接、解析和关闭。
- device-authenticator.ts：challenge、credential、撤销检查。
- pairing-service.ts：pairing token 的生成、hash、TTL、one-time 消费。
- command-admission.ts：设备 ceiling、RemoteCommandPolicy、参数大小和命令 allowlist。
- push-broker.ts：订阅、过滤、有界队列、控制 lane。
- replay-buffer.ts：seq、eventId、回放窗口和 snapshot-too-old。
- host-status-projection.ts：远程安全状态投影。
- media-upload-service.ts：ticket 和上传校验。

不要写一个包含 auth、session、WS、文件上传和 HostRuntime 调用的 server.ts God module。

### 6.3 Host 权威和幂等

Host 是唯一的 session/run/job authority：

- Mobile 的本地状态只是投影和缓存。
- prompt 的最终状态以 Host response/HostPush 为准。
- Host 保存短期 idempotency record，至少覆盖网络可能重试的 mutation。
- Host 决定设备能否执行命令；客户端 capability 只是 UX 优化，不能当作安全边界。
- Host command handler 复用现有 HostRuntime，不在 server 层重新实现 session、permission、run 或 Pi 调用。

## 7. 移动 UI 计划

### 7.1 页面结构

建议首版用 5 个主要 surface，避免桌面式多栏布局：

1. Connection/Pairing：
   - 已配对 Host 列表。
   - 扫码、手动配对、连接状态、证书/网络错误。
2. Inbox：
   - active runs。
   - permission requests。
   - 最近会话和未读结果。
3. Sessions：
   - project picker。
   - session list。
   - 新建/恢复会话。
4. Conversation：
   - 消息流。
   - tool/run activity timeline。
   - Markdown/code/diff/plan。
   - 底部 composer、附件、stop/continue。
5. Settings：
   - 设备名。
   - Host capability summary。
   - 通知设置。
   - 撤销当前设备或重新配对。

Permission request 用 bottom sheet/card；必须先显示 Host 生成的结构化风险信息，再提供 allow/deny。不要在卡片中显示不必要的绝对路径和秘密值。

### 7.2 复用 UI 和渲染

优先复用：

- @piwin/ui-kit 的 Button、Input、Card、Dialog、Notice、Toast、主题和 Mantine 集成。
- 现有 normalized AgentEvent、run activity、permission context 和 artifact policy。
- 现有 Markdown、代码高亮、KaTeX、Mermaid 的纯渲染逻辑；先检查其对 DOM/窗口尺寸/桌面资源的依赖，再抽公共包。
- @piwin/artifact 的安全策略；artifact 预览必须 sandbox + CSP，默认阻断外部资源。

不要：

- 从 Desktop 的 src 目录深层导入组件。
- 把外部项目的 Svelte/React Native 页面直接粘进 packages。
- 为移动端重新发明 Button、Dialog、Toast 等基础控件。
- 为了“看起来像桌面”而把文件树、PTY、复杂设置搬到手机。

### 7.3 移动生命周期

- App 进入后台时，WebSocket 不能被视为可靠的永久连接。
- 进入前台立即做 reconnect + lastSeq replay/snapshot。
- 正在运行的任务状态以 Host 为准；本地只显示“后台期间可能有更新”。
- P0 只保证前台实时流和回到前台后的恢复。
- 任务完成时，如果 App 仍活跃，可以用 Tauri notification 做本地提醒。
- 真正的 App 被系统挂起或杀死后的提醒，放到 P1 的 APNs/FCM 方案，不把本地 notification 当远程 push 替代品。

## 8. Tauri 2 和原生能力复用策略

### 8.1 首选官方插件

先使用 Tauri 官方 plugins-workspace 中已经维护的能力，并在 iOS 真机和 Android 真机各做一次 smoke test：

| 能力 | 方案 | 优先级 | 注意事项 |
|---|---|---:|---|
| QR 扫描 | @tauri-apps/plugin-barcode-scanner | P0 | 只读 pairing payload；需要相机权限和 Info.plist/Android 权限 |
| 文件/照片选择 | 官方 dialog/fs 或平台原生 picker | P0 | 选择后立刻读成 bytes 上传；不能把移动 file URL 当 Host path |
| 本地通知 | @tauri-apps/plugin-notification | P1/P0-lite | 只解决 App 可运行时本地提醒；不是 APNs |
| 生物识别 | @tauri-apps/plugin-biometric | P1 | Face ID/Touch ID 用于解锁本地 credential；iOS 需要 NSFaceIDUsageDescription |
| UI 偏好 | @tauri-apps/plugin-store | P0 | 仅保存主题、Host 别名、开关等非秘密偏好 |
| WebSocket | JS 原生 WebSocket | P0 | 先验证 Tauri WebView 行为；不必为一个稳定 Web API 添加 native bridge |

Stronghold 不作为未经验证的长期凭据方案。当前计划要求先做版本、iOS Keychain、Android Keystore 和锁屏/卸载行为验证；如果不满足要求，再评估小型 keystore 插件或定向原生 adapter。

### 8.2 Desktop 专属代码隔离

apps/desktop/src-tauri/src/lib.rs 需要将以下模块按 target 隔离：

- host_bridge：Desktop sidecar only。
- pty_host：Desktop local PTY only。
- pet_overlay：Desktop only。
- 桌面窗口、外部 binary、shell plugin 相关能力。

apps/mobile 的 Rust 入口只注册移动端需要的插件和最小命令；不能尝试启动 bundled Node sidecar。移动端 Host endpoint 通过用户配对或受控配置提供。

### 8.3 构建和分发

本地开发/构建目标：

- iOS simulator：验证 UI、协议 fake server、无相机/Keychain 的基础路径。
- iOS physical device：验证网络权限、相机、Keychain、后台/前台、TLS 和真实 Host。
- Android emulator/physical device：验证同一套 JS 代码和 Keystore 行为。
- TestFlight：P0 内部验收和回归。

CI 可评估 tauri-apps/tauri-action 的 mobile 支持，但不要在没有本地构建成功前把实验性 mobile CI 当作发布链路。签名证书、provisioning profile、Apple team、Android keystore 都必须放在 CI secret 中，不能进入仓库。

## 9. 外部调研和复用结论

### 9.1 可以直接优先采用的基础设施

| 项目 | 结论 | 复用边界 |
|---|---|---|
| Tauri 2 Mobile | 采用 | 作为移动 shell 和 iOS/Android 构建基础 |
| Tauri official plugins-workspace | 采用官方能力 | barcode、biometric、notification、dialog/fs；逐插件真机验证 |
| ws | Host Server 候选 | 只作为 WebSocket server transport；Piwin 自己负责协议、回放和策略 |
| node-qrcode | pairing QR 生成候选 | 可用于 Desktop/CLI 展示 QR；版本和 license 在加依赖前复核 |
| @zxing/browser | Web/PWA fallback 候选 | Tauri native 优先用官方 barcode plugin，不把浏览器摄像头方案带进原生首版 |

### 9.2 可以借鉴但不直接引入的 GitHub 项目

| 项目 | 可借鉴内容 | 不直接采用的原因 |
|---|---|---|
| [Shahfarzane/opencode-mobile](https://github.com/Shahfarzane/opencode-mobile) | QR pairing、实时流、权限卡、任务追踪、移动手势和 Face ID UX | Expo/React Native；运行时协议不是 Piwin；直接复制会绕开 Host 边界 |
| [happier-dev/happier](https://github.com/happier-dev/happier) | 多客户端、relay、断线恢复、设备/会话模型 | 它的 relay 参与状态和执行桥接；Piwin 要求 Host 保持唯一执行权威 |
| [jacobaraujo7/remote_pi](https://github.com/jacobaraujo7/remote_pi) | QR 配对、WebSocket TLS relay、typed action、ACK、图片动作 | Pi extension + 自有 relay；不能替代 Piwin HostCommand/HostPush，也不应让移动端直接依赖 Pi |
| [pugliatechs/polpo](https://github.com/pugliatechs/polpo) | Session takeover、abort、图片和长连接交互 | 外部 runtime 和协议；只能作行为参考 |
| [agegr/pi-web](https://github.com/agegr/pi-web) | Pi 会话浏览、Markdown、文件和流式 UI 参考 | 直接访问 ~/.pi、缺少 Piwin Host auth；AGENTS.md 也禁止粘贴其 UI |
| TelePi | 语音、图片、通知和 handoff 的功能想法 | Telegram bridge，不是移动原生 shell；无必要引入 |

结论：没有找到一个既符合 Piwin Host 权威模型、又能直接装进本仓库的完整移动客户端。最可控的复用组合是官方 Tauri 插件 + ws + 现有 Piwin 包；外部项目只用于交互和协议对照。

## 10. 分阶段执行计划

以下顺序是硬顺序。每一阶段有产出和退出门槛；未通过门槛不进入下一阶段。

### Phase 0：架构冻结和移动构建预检

目标：先确认平台和边界，不写业务 UI。

任务：

- 将本计划纳入 docs/dev-plan.md。
- 新增移动远程壳 ADR，记录 Tauri 2、Host authority、私有网络、无远程 PTY、媒体 assetId 和通知边界。
- 更新 docs/architecture.md，加入 apps/mobile、apps/host、host-client、host-transport、host-server。
- 检查当前 apps/desktop 的 Vite/React/Tauri 配置，确认哪些模块可抽取、哪些只能留在 Desktop。
- 用最小 Tauri Mobile scaffold 验证 iOS simulator、iOS physical device 和 Android 构建前置条件。
- 验证官方 barcode、notification、biometric、dialog/fs 插件在目标 Tauri 版本的安装和 capability 配置。
- 对 Keychain/Keystore 做一个无业务的 save/read/delete/lock-screen smoke test。

退出门槛：

- iOS simulator 能启动空壳。
- 至少一台 iOS 真机能安装开发包。
- Android 能完成 compile 或明确记录环境阻塞。
- 已决定 credential storage 方案；未验证前不进入配对实现。

### Phase 1：Contracts 和 wire protocol

目标：让协议先成为单一事实源。

任务：

- 在 contracts 增加 handshake、device、pairing、envelope、replay、snapshot、media ticket、remote-safe status 类型。
- 将 seq/eventId/hostInstanceId/runId 约束写成可测试的类型和 invariant。
- 把 MediaAttachmentRef 从“跨边界 path”迁移为 assetId ref；Host 内部另保留 path-resolved 类型。
- 增加稳定错误码，例如 unauthorized、forbidden、not_found、conflict、replay_too_old、payload_too_large、unsupported_version、host_unavailable。
- 定义 command allowlist 和 RemoteCommandPolicy 的映射。
- 为每种 envelope 编写 fixture 和 decode/encode round-trip 测试。
- 不让 contracts 依赖任何其他 @piwin/* 包。

退出门槛：

- pnpm typecheck 通过。
- contracts fixture 覆盖握手、失败、重放过旧、幂等冲突和 media ref。
- 旧 Desktop local JSONL 协议有明确兼容策略，不因新增字段破坏现有 host。

### Phase 2：Host Server 最小可部署垂直切片

目标：先让一个浏览器/fake client 能远程完成一次 prompt。

任务：

- 创建 packages/host-server 和 apps/host。
- 复用 host-runtime 的组合根；不在 server 中导入 Pi。
- 实现健康检查、WebSocket handshake、设备认证、HostHello。
- 实现 host/status、project/list、session/list、session/create、session/messages、session/prompt、session/abort。
- 实现 PushBroker、seq/eventId、lastSeq replay、snapshot fallback。
- 实现 requestId/idempotencyKey 的 mutation 去重。
- 将普通事件通道和控制 lane 分开。
- 默认只监听 loopback 或显式私有网卡；非 loopback 强制 TLS 或明确的安全配置检查。
- 记录结构化审计信息，但脱敏 credential、token、API key、文件路径和 prompt 中的秘密。

退出门槛：

- 两个 client 同时连接同一个 Host，可观察同一 session。
- prompt ack 快速返回 runId，AgentEvent 和 terminal 正确推送。
- 断线后 replay 不重复、不丢；replay window 不足时 snapshot 可恢复。
- 重试 create/prompt/permission resolve 不会重复执行。
- 未配对、已撤销、过期 token、错误 device credential 全部被 Host 拒绝。

### Phase 3：抽取并统一 HostClient

目标：让 Desktop 和 Mobile 调用同一产品客户端 API。

任务：

- 把 apps/desktop/src/host-client.ts 的 transport-neutral 逻辑迁移到 packages/host-client。
- 把 Tauri invoke/listen、JSONL sidecar 适配成 Desktop local transport；Tauri 依赖留在 apps/desktop。
- 实现 remote WebSocket transport；浏览器/Tauri WebView 都走同一协议。
- 保留 mock transport 给 UI 单测和没有 Host 的开发模式。
- 抽取 client-state 中真正跨 shell 的 reducer/selector。
- 迁移 Desktop 的 session/run/permission 订阅，确保行为不退化。
- 删除重复的 Desktop HostClient 实现，保留必要的兼容 façade 直到迁移完成。

退出门槛：

- Desktop local mode 行为和当前一致。
- Desktop 可选择 local 或 remote Host，均只经过 HostClient。
- packages/host-client 不依赖 Tauri、Node-only API 或 Pi。
- CLI/desktop 的公共 contracts 和移动端协议使用同一类型。

### Phase 4：Mobile shell 和配对

目标：iOS 真机能安全完成配对、连接和断线恢复。

任务：

- 创建 apps/mobile Tauri 2 工程，接入 React/Vite 和 @piwin/ui-kit。
- 先做 Connection/Pairing 和 Inbox 空状态。
- 接入官方 barcode scanner；同时提供手动输入 fallback。
- 实现 device credential 的 secure storage adapter。
- 实现 Host 列表、设备命名、退出/撤销本地 credential。
- 实现前台 reconnect、lastSeq、snapshot hydration 和清晰的错误状态。
- 接入 Tauri capability、iOS camera/network usage description 和 Android permission。
- 不接入 Node sidecar、PTY、pet overlay、Desktop shell plugin。

退出门槛：

- iOS 真机扫码配对成功。
- App 杀死后重新启动仍能安全恢复 credential。
- Host 撤销设备后客户端不能重新建立 ready 连接。
- 切换 Wi-Fi/蜂窝或短暂关闭 Host 后恢复不造成重复命令。

### Phase 5：P0 移动功能

目标：完成远程 Agent cockpit 的第一版。

任务：

- Inbox：active runs、permission requests、未读结果。
- Projects/Sessions：选择项目、列表、创建、恢复、查看消息。
- Conversation：文本 prompt、streaming message、tool activity、run phase。
- Controls：stop、abort、steer/follow-up；根据 Host capability 隐藏不支持项。
- Permission card：结构化风险摘要、allow/deny、超时和失效状态。
- Result renderer：Markdown、code、diff、plan、error。
- 基础设置和 Host capability summary。
- 将所有 UI 操作接入 client-state，不在页面组件内直接管理 transport 细节。

退出门槛：

- 完成“配对 → 选项目 → 开会话 → prompt → 流式输出 → 权限 → 结果 → stop”的真实链路。
- 同一 session 在 Desktop/CLI/Mobile 间可互相观察。
- UI 不解析 Pi 原始事件、不读 Host 文件路径、不调用 fs/child_process。
- 手动 smoke 和关键 reducer/transport 单测完成。

### Phase 6：媒体、artifact 和移动通知

目标：补足移动端最有价值的输入和结果能力。

任务：

- media/upload-ticket、单次 multipart upload、hash/size/MIME 校验、取消和进度。
- Host media asset 生命周期、过期清理和 session 引用检查。
- PromptPreparation 使用 assetId 解析成 ImageContent；补图片 fixture。
- artifact 以 sandboxed WebView/iframe 预览，默认 block 外部资源。
- App 活跃时使用 local notification。
- 先实现前台重要事件提醒；APNs/FCM 另做 device-token 注册、Host push gateway 和隐私设计。

退出门槛：

- 相机/照片/Files 至少各完成一次 iOS 真机上传。
- Host 目录 traversal、伪造 MIME、超大文件、hash 不匹配均被拒绝。
- Pi 收到的是原生图片内容，不是 prompt 文本中的 path/base64。
- artifact 无法越过 sandbox 访问 Host 或客户端本地敏感数据。

### Phase 7：安全、性能和分发硬化

目标：达到内部 TestFlight 可用，不把实验性远程服务暴露成公网入口。

任务：

- TLS/私有网络配置、host bind 默认值、设备撤销、pair token TTL 和 rate limit。
- WS 最大 frame、HTTP upload 最大 body、单设备连接数、队列上限和超时。
- slow client、seq gap、snapshot 恢复、Host 重启、Host instance change 测试。
- 日志脱敏和审计事件。
- iOS/Android keychain/keystore、锁屏、退出登录、卸载重装测试。
- Apple signing、TestFlight、Android internal track 的构建链路。
- GitHub Actions 只在本地发布成功后接入。
- 更新 docs/guides、ADR、dev-plan 和 release checklist。

退出门槛：

- 安全测试和多客户端恢复测试通过。
- pnpm typecheck、pnpm test、Rust check 和移动构建通过。
- TestFlight 内部设备可从私有网络连接真实 Host。
- 明确记录 P1 push、remote PTY、公共 gateway 的后续设计，不混入 P0。

## 11. 测试计划

### 11.1 Contracts 和纯逻辑

- envelope encode/decode round-trip。
- protocol version negotiation。
- seq 单调性、eventId 唯一性、hostInstanceId 变化。
- replay、replay-too-old、snapshot hydration。
- requestId/idempotencyKey 去重和冲突。
- RemoteCommandPolicy allow/deny golden cases。
- remote-safe status 不包含路径、secret、环境变量。
- media asset ref 不接受 path traversal、绝对路径和未授权 assetId。

### 11.2 Host Server

- pairing token TTL、one-time、hash 存储和撤销。
- device credential challenge/HMAC、错误次数和连接关闭。
- 多 client 同 session 的 push fan-out。
- 慢客户端有界队列。
- prompt ack 和异步 run 事件。
- abort、steer、permission resolve control lane 不被普通事件堵塞。
- Host 重启后 hostInstanceId 和 snapshot 行为。
- TLS off-loopback、未认证连接、过大 payload 和错误 origin/upgrade。

### 11.3 Client transport

- 首次连接、重连退避、网络切换、后台/前台。
- seq gap 和 snapshot fallback。
- mutation retry 不重复。
- abort signal 在 HTTP upload、prompt 等长操作中生效。
- push unsubscribe 不泄漏 listener。
- Desktop local transport 与 remote transport 使用同一 fake Host fixture。

### 11.4 UI 和真机

- UI 逻辑用 mock transport 测试，不能依赖真实 Pi。
- 关键路径：pair、session、prompt、permission、stop、attachment、reconnect。
- iOS simulator：布局、键盘、旋转、深色模式、无相机 fallback。
- iOS physical：相机、Keychain、蜂窝/Wi-Fi 切换、后台恢复、TLS。
- Android physical：camera、Keystore、back gesture、网络恢复。
- accessibility：Dynamic Type、VoiceOver/TalkBack、触控区域、颜色对比。

### 11.5 完成命令

每个阶段至少执行：

- pnpm typecheck。
- pnpm test。
- 受影响 package 的定向测试。
- apps/desktop Rust cargo check/test。
- apps/mobile 的 Tauri iOS/Android build 或对应 simulator/device smoke。

具体命令以仓库现有 package scripts 为准；新增 script 必须写进 dev-plan 或相关 package 文档。

## 12. 安全设计清单

- Host 默认不监听公网；私有远程必须显式配置。
- 非 loopback 使用 TLS；不要把“有 token”当作 TLS 替代品。
- pairing token 短时、一次性、只存 hash、不能进日志。
- device credential 可撤销、可轮换，Host 只存 hash。
- mobile secure storage 只保存 credential，不保存 provider secret。
- Host 永远重新执行 command admission；客户端隐藏按钮不是安全措施。
- secrets、API keys、环境变量、Host 本地路径、MCP/Skill 原始配置不进入远程 status、push、错误或诊断日志。
- 所有远程资源用 opaque IDs；Host 根据 session/device 权限重新验证归属。
- media 上传有 size、MIME、hash、扩展名和根目录限制。
- WebSocket/HTTP 都有 payload、连接数、队列、超时和速率限制。
- artifact 默认 sandbox/CSP；模型输出和 artifact HTML 一律当作不可信。
- 不在 P0 开放远程 process start、extension install、secret edit、PTY。
- MCP 仍遵守 ADR 0033：Host 用户拥有其 OS 权限风险，移动端不伪造 MCP permission UI。

## 13. 预估和关键路径

以下是单个熟悉 TypeScript/Node/Tauri 的开发者的粗估，不能替代实现后的排期：

| 阶段 | 粗估 | 关键风险 |
|---|---:|---|
| Phase 0 | 1–2 天 | Xcode、签名、插件和 Keychain 环境 |
| Phase 1 | 2–4 天 | 现有 media/path contracts 的迁移范围 |
| Phase 2 | 4–7 天 | Host Server、回放、幂等和安全 |
| Phase 3 | 3–5 天 | Desktop HostClient 抽取和回归 |
| Phase 4 | 2–4 天 | Tauri mobile、扫码和 secure storage |
| Phase 5 | 5–8 天 | 移动 UI、事件状态和权限流 |
| Phase 6 | 3–5 天 | 真机媒体、artifact sandbox 和通知 |
| Phase 7 | 持续 | TLS、弱网、签名、TestFlight |

P0 关键路径约为 17–30 个开发日，最大不确定项是现有 Desktop HostClient/媒体模型的抽取和 Host Server 的回放/安全实现。纯 UI 并不是主要风险；先把 Host seam 做对，后续 Android、Web 或其他 shell 都能复用。

## 14. “快”应该如何理解

最快的可验证顺序不是先堆十几个移动页面，而是先完成一个窄的端到端切片：

    Host serve
      → 配对
      → host/status
      → session/list
      → session/prompt
      → run/phase + agent/event
      → session/abort
      → 断线 replay

这个切片跑通后，再把同一 API 接入完整 UI。这样可以尽早暴露真正的难点：Host 部署、身份、协议、重连和移动生命周期；不会在错误的本地模拟协议上堆 UI。

为控制代码量，首版不写：

- 自定义 E2EE。
- 自定义 QR 编码器。
- 自定义 Markdown 引擎。
- 自定义 UI 基础组件。
- 自定义通用重连库。
- 分片上传。
- 公共 relay/gateway。
- 远程 PTY。

这些能力都有明确的后续边界或成熟基础设施可用。

## 15. 交付验收清单

### 架构

- [ ] apps/mobile 不导入任何 @earendil-works/pi-*。
- [ ] 只有 packages/agent-host 依赖 Pi。
- [ ] apps/host 通过 host-server → host-runtime 组合，不自行实现业务。
- [ ] Desktop 和 Mobile 通过同一 HostClient/contracts。
- [ ] contracts 不依赖其他 @piwin/*。
- [ ] 无 package 深层相对导入。

### 功能

- [ ] iOS 真机可扫码或手动配对。
- [x] 可列出 Host project/session 并恢复会话。
- [x] 可流式收发 prompt。
- [ ] 可看到 run/tool/plan/diff/Markdown/error。
- [ ] 可 stop/abort/steer/follow-up。
- [x] 可处理 Host permission request。
- [x] 可上传小图片并以 opaque asset ref 作为 attachment 使用。
- [x] 可断线重连并恢复状态。
- [ ] Host 撤销设备后无法继续访问。

### 安全

- [ ] 无 Host path、provider secret、MCP/Skill 原始配置泄露。
- [ ] 无本地 Node/Pi/MCP/Skill 执行。
- [ ] off-loopback 有 TLS 或启动时明确拒绝。
- [ ] pairing/device credential 不进日志。
- [ ] 上传路径、MIME、大小、hash 和 asset ownership 有校验。
- [ ] remote command policy 在 Host 侧生效。

### 质量

- [ ] typecheck/test/Rust check 通过。
- [ ] replay、snapshot、幂等和慢客户端测试通过。
- [ ] iOS simulator、iOS physical、Android 至少完成 smoke。
- [ ] TestFlight 内部构建可安装。
- [ ] docs/architecture、ADR、dev-plan 和 release checklist 已更新。

## 16. 参考资料

调研时间：2026-08-08。以下链接按“直接采用 / 方案参考 / 不直接采用”分类；实际加依赖前仍需锁定版本、阅读 changelog、检查 license，并在真机验证。

官方基础设施：

- [Tauri 2](https://v2.tauri.app/)
- [Tauri 开发文档](https://v2.tauri.app/develop/)
- [Tauri distribute](https://v2.tauri.app/distribute/)
- [Tauri mobile plugin development](https://v2.tauri.app/develop/plugins/develop-mobile/)
- [Tauri official plugins workspace](https://github.com/tauri-apps/plugins-workspace)
- [Tauri plugin documentation](https://v2.tauri.app/plugin/)
- [Tauri sidecar 文档](https://v2.tauri.app/develop/sidecar/)

推荐的基础库候选：

- [websockets/ws](https://github.com/websockets/ws)
- [soldair/node-qrcode](https://github.com/soldair/node-qrcode)
- [zxing-js/browser](https://github.com/zxing-js/browser)
- [tauri-apps/tauri-action](https://github.com/tauri-apps/tauri-action)

安全和通知：

- [Apple remote notification server](https://developer.apple.com/documentation/usernotifications/setting-up-a-remote-notification-server)
- [Apple background updates](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app)
- [Apple TestFlight](https://developer.apple.com/testflight/)
- [impierce/tauri-plugin-keystore](https://github.com/impierce/tauri-plugin-keystore)
- [HuakunShen/tauri-plugin-keyring](https://github.com/HuakunShen/tauri-plugin-keyring)

移动 Agent 产品参考：

- [opencode-mobile](https://github.com/Shahfarzane/opencode-mobile)
- [happier](https://github.com/happier-dev/happier)
- [remote-pi](https://github.com/jacobaraujo7/remote_pi)
- [Polpo](https://github.com/pugliatechs/polpo)
- [Pi Web](https://github.com/agegr/pi-web)
- [remote-pi package page](https://pi.dev/packages/remote-pi)

## 17. 实施开始时的第一批任务

计划批准后，按以下顺序创建小提交：

1. docs：更新 architecture、dev-plan，并新增移动远程壳 ADR。
2. contracts：先落 handshake/device/envelope/replay/media assetId 类型和 fixture。
3. host-transport：定义 transport port、WebSocket 编解码和 fake transport。
4. host-server：完成 pair/status/session/prompt/abort 的最小切片。
5. host-client：从 Desktop 抽取并接回 local transport。
6. apps/mobile：空壳、配对、连接、Inbox。
7. mobile P0：session/chat/run/permission/result。
8. media/artifact/notification：按 Phase 6 增量接入。
9. hardening：安全、弱网、真机、TestFlight。

每个提交只做一个 concern；不把移动 UI、Host Server、协议变更和无关依赖升级混在一起。
