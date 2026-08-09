# Mobile shell implementation progress plan

状态：实施中：远程 Host + 移动聊天/权限/图片首版已落地，配对和完整产品面仍待实现  
日期：2026-08-08  
执行依据：[iOS mobile shell execution plan](./ios-mobile-shell-execution-plan.md)、ADR 0036、ADR 0037

## 1. 本轮目标

本轮不把目标定义成“把所有页面一次写完”，而是先完成一条真实、可测试、可继续扩展的远程 Host vertical slice：

    Mobile shell
      → HostClient
      → WebSocket transport
      → Host Server
      → HostRuntime

完成后，移动端至少可以建立真实 Host 连接、读取安全状态、订阅 HostPush，并在断线后按序列恢复。当前已进一步落地聊天、权限决策和小图片 asset 引用上传；配对凭据、artifact 和完整产品面仍按后续切片推进。

## 2. 当前已完成

- apps/mobile Tauri 2 iOS/Android scaffold。
- React/Vite 移动首屏和移动安全区样式。
- 复用 contracts、ui-kit 和现有图标。
- iOS Simulator 不签名构建、安装、启动。
- ADR 0037、architecture 和 dev-plan 登记。
- HostEgressHub、exhaustive push policy、bounded channel、replay journal 和 cursor batch 已接入 HostServer。
- WebSocket transport 已支持指数退避重连、Host ping 心跳和关闭清理；HostClient 不再跨序号直接提交缺口后的事件。
- 移动端已支持 permission request/resolve，以及图片选择 → Host media/save → opaque `remote-asset:<id>` prompt attachment。

## 3. 本轮实施顺序

### Step 1：远程 contracts

- 版本化 wire envelope。
- ClientHello、HostHello、token gate 和设备/client identity seam。
- Host status safe projection。
- command request/response correlation。
- HostPush seq/eventId、replay request、snapshot cursor。
- stable error code 和 retryable 标记。
- media asset ref 使用 RemoteMediaAsset；Host 本地绝对路径不进入移动端协议。

验收：所有 envelope 有 fixture，decode/encode 和错误分支有单测；contracts 不依赖其他 Piwin 包。

### Step 2：Host transport

- 定义 transport-neutral HostTransport。
- 实现浏览器/Tauri WebSocket client。
- 实现 JSON frame codec、连接状态、心跳和关闭。
- 实现 request correlation、push subscription、lastSeq 保存接口。
- 实现 replay/snapshot 的基础状态机、自动心跳、指数退避重连和网络恢复后的 read-model refresh。
- 用 in-memory transport 测试断线、重连、重复响应和 seq gap。

验收：不依赖真实 Host 也能验证连接和恢复；不引入 Pi、HostRuntime 或 React。

### Step 3：HostClient

- 从 transport 接收 HostCommand/HostResponse/HostPush。
- 提供 typed host/status、project/session 查询和控制命令入口。
- 只在 HostClient 生成 requestId/idempotencyKey。
- 把 host status、connection state、run/session push 通过公共订阅暴露。
- 保留 Desktop 当前 local transport 的适配方向，但本轮先不大规模重写 Desktop。

验收：Mobile 能通过同一个 public client API 连接 fake server；Desktop 旧代码不被破坏。

### Step 4：最小 Host Server

- 创建 packages/host-server 和 apps/host。
- 以 HostRuntime 为唯一业务执行权威。
- 支持 loopback WebSocket。
- 支持 host/ping、host/status、project/list、session/list、session/messages、session/resume、session/prompt、session/abort、permission resolve 和受限 media/save。
- 绑定一个 HostEgressHub，维护策略分类、projection 合并、bounded replay journal、per-client queue 和 cursor batch。
- 先实现 mock HostRuntime 模式用于端到端验证；真实 SDK HostRuntime 通过同一入口启动。

验收：fake/mobile client 可以完成 connect → status → list → push → reconnect replay；不暴露 piwinRoot 等 Host 本地路径。

### Step 5：Mobile 真实连接状态

- 移除静态“配对入口”作为唯一行为。
- 增加 Host endpoint/token 输入和开发环境连接入口。
- 显示连接中、已连接、断线、重连、Host 不可用。
- 显示安全 Host status、项目/会话列表、消息读取和文本 prompt。
- 显示权限卡；图片以 Host asset id 方式上传，不显示 Host path。
- 不在本轮伪造 QR、Keychain 或生物识别；先把协议和可测试连接跑通。

验收：iOS Simulator 连接本机 fake/standalone Host，首屏显示真实连接状态。

## 4. 后续连续切片

完成本轮后继续：

1. 一次性 pairing token、device credential、Keychain/Keystore。
2. HTTP/分片媒体上传和图片预览/压缩。
3. Markdown/diff/plan/artifact 渲染和通知。
4. Desktop/CLI 迁移到同一 HostClient/egress batch 路径。

## 5. 明确不在本轮强行完成

- 公共 Gateway、E2EE、APNs 后台推送。
- 远程 PTY。
- MCP/Skill 管理。
- 大文件分片上传。
- 完整 Android 真机适配。
- 复制 Desktop 的大部分页面。

## 6. Definition of done

- [x] contracts fixture 和类型检查通过。
- [x] transport/client 单测通过。
- [x] Host Server fake/runtime-port smoke 通过。
- [x] Mobile 真实显示连接状态、项目/会话列表和基础聊天。
- [x] reconnect replay 基础不重复、不乱序；自动重连和心跳已覆盖 transport fixture。
- [x] permission request/resolve 已通过移动端 HostClient 控制 lane。
- [x] 小图片 opaque asset 上传和 prompt attachment 已通过 HostServer 集成测试。
- [x] architecture boundary check 通过。
- [x] Desktop 原有 local sidecar 路径未被本轮改坏（全仓库 typecheck 通过）。
- [x] docs/ADR/plan 状态同步。
