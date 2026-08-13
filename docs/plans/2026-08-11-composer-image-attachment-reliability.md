# Composer 图片附件可用性与可靠性方案

| 字段 | 内容 |
| --- | --- |
| 状态 | Proposed |
| 日期 | 2026-08-11 |
| 范围 | Desktop 首发；合同、Host、远程客户端共用同一条附件链路 |
| 架构决定 | [ADR 0045](../adr/0045-draft-scoped-media-upload-and-recovery.md) |
| 相关 | ADR 0005、ADR 0037、ADR 0041、`2026-08-09-file-attachment-support-recommendation.md` |

> 实施进度（2026-08-13）：ADR 0045「Compatibility and migration」路径已落地 —
> 粘贴/拖入只创建本地 chip（`queued`），`media/save` 推迟到 Send 且先于
> `session/prompt`；发送失败时文本 + ready chip 完整恢复，仅在 prompt ACK 后释放
> File/blob URL。upload-ticket 二进制上传仍属后续工作（Phase 2）。
> 测试覆盖：paste 不创建 session、失败恢复 + 重试复用已保存附件、保存失败不发气泡。
> （见 `apps/desktop/src/hooks/use-composer-media.test.tsx`）

## 1. 要解决的不是一个 Retry 按钮

当前截图里的 `Retry` 表示图片没有成功保存到 Host 媒体目录。它不是模型重试，
也不是 DeepSeek 的模型状态。当前 Desktop 把失败状态直接盖在缩略图上，并且只要
有一个失败附件就禁用发送按钮。

现有链路是：

```text
粘贴/拖入图片
  -> WebView 立即显示 blob 缩略图
  -> 如无会话则提前创建 Host session
  -> 浏览器解码/压缩
  -> 整张图片转 Base64
  -> 作为普通 media/save JSON 命令发送
  -> Host 校验并写入 ~/.piwin/media/<session>/
  -> ready 后才能发送 prompt
```

这条链路的失败点过多，而且 UI 把所有失败都压成同一个 `Retry`：

- Host 正在启动、重连或请求超时；
- 新建会话失败，但 UI 看起来像图片失败；
- WebView 无法解码/压缩某个图片格式；
- Base64 带来约 33% 体积膨胀和额外内存复制；
- 图片超过 `media.maxPasteBytes`；
- MIME、敏感内容或磁盘写入被 Host 拒绝；
- 远程 Host 的普通协议帧上限与本地 sidecar 不一致。

本次截图没有留下可持久查询的结构化附件错误，所以不能负责任地断言是哪一个具体
错误。方案必须同时补上可观察性，下一次不再靠猜。

## 2. 产品目标

用户应获得以下稳定体验：

1. 粘贴后 100 ms 内看到缩略图，不需要先创建会话。
2. 普通截图和照片可以稳定上传；进度、失败原因和可执行动作清晰可见。
3. Host 短暂重连时自动恢复，不把网络/进程问题伪装成“图片不支持”。
4. 一张失败图片不能锁死整条文字消息。
5. 不能静默丢图；用户明确选择后才允许“仅发送文字”。
6. 上传成功和模型能否看图分开处理。
7. 本地 Desktop、远程 Desktop、Mobile 复用同一合同与资产身份。
8. 图片仍由 Host 保存，模型仍接收原生 `ImageContent`，不把 Base64 塞进文本。

## 3. 最终交互

### 3.1 附件 chip

图片缩略图保持干净，不再覆盖大块红色 `Retry`。推荐布局：

```text
┌────────┐
│        │  screenshot.png · 1.8 MB
│ 缩略图 │  图片未添加：Host 连接已中断
│        │  [重试] [移除]
└────────┘
```

窄 composer 下可以折叠成：

```text
[缩略图]  添加失败  [重试] [×]
```

要求：

- 状态和操作位于缩略图旁边或下方，不遮挡图片；
- 中文界面只显示中文，英文界面只显示英文；
- 不依赖 hover 才能看到原因；
- `重试`、`移除` 使用 `@piwin/ui-kit` 的公共按钮/菜单能力；
- 错误区域具有 `role="status"` 或适当的 live-region 语义；
- 保留“复制错误详情”二级操作，用于诊断，不显示内部堆栈为主文案。

### 3.2 状态文案

| 状态 | 主文案 | 用户动作 |
| --- | --- | --- |
| `queued` | 正在准备图片… | 移除 |
| `preparing` | 正在处理图片… | 取消 |
| `uploading` | 正在添加图片 46% | 取消 |
| `waiting-for-host` | Host 正在重连，连接后继续 | 移除 |
| `ready` | 不显示成功遮罩 | 预览、移除 |
| `failed` 可重试 | 图片未添加：连接中断 | 重试、移除、复制详情 |
| `failed` 不可重试 | 图片未添加：超过 10 MB 限制 | 压缩后重选、移除 |
| `failed` 安全策略 | 该文件可能包含敏感信息，未添加 | 了解详情、移除 |

### 3.3 发送规则

| Composer 内容 | 发送按钮行为 |
| --- | --- |
| 文字 + 全部附件 ready | 正常发送 |
| 仅 ready 附件 | 正常发送 |
| 有 uploading 附件 | 点击后进入“正在添加图片…”，完成即自动发送；可取消 |
| 文字/ready 附件 + failed 附件 | 发送按钮保持可用；点击后出现三选一 |
| 只有 failed 附件 | 主按钮改为“重试图片”，不显示无解释的禁用发送按钮 |
| 无文字、无附件 | 发送按钮禁用 |

失败附件确认框：

```text
有 1 张图片未添加成功

这张图片不会被模型看到。你可以重试，或移除失败图片后发送其余内容。

[重试图片] [仅发送其余内容] [返回]
```

默认焦点是“重试图片”。选择“仅发送其余内容”时，失败 chip 从本次 prompt 中移除，
并在发送前明确更新 composer，绝不静默丢弃。

### 3.4 自动重试

只对明确的瞬时错误自动重试：

- `host-offline`
- `timed-out`
- `upload-interrupted`
- `disk-unavailable` 中被 Host 标记为暂时性的情况

策略：最多 2 次，延迟 500 ms、1500 ms；Host 处于 reconnecting 时不空转计数，
等待 `host/status ready` 后继续。用户手动点击“重试”会开始一个新 attempt，但复用
同一个 `clientAttachmentId`，避免重复资产。

以下错误不自动重试：过大、不支持格式、解码失败、敏感内容、资产过期。

## 4. 功能架构

### 4.1 新的端到端链路

```text
Client paste/drop/picker
  -> 本地 blob 预览
  -> 创建 draftId + clientAttachmentId
  -> HostCommand: media/upload-ticket（只传元数据）
  -> Host 返回 assetId + 一次性 upload ticket + 限额
  -> 独立二进制上传通道（进度/取消）
  -> @piwin/media 流式写临时文件、校验、原子完成
  -> staged asset ready
  -> session/prompt 引用 assetId
  -> Host 创建/确认 session
  -> Host 原子 claim staged asset 到 session media 目录
  -> PromptPreparation 路由
       ├─ 视觉模型 -> native ImageContent
       ├─ 视觉委派 -> delegation
       └─ 明确的文本 fallback -> path injection（仅兼容兜底）
```

### 4.2 为什么必须是 draft-scoped staging

粘贴图片是编辑草稿的一部分，不应创建一个空会话。Host staged asset 解决三个问题：

- 新会话附件不依赖 `session/create`；
- 上传完成后 Host 重启仍可恢复 asset；
- 同一条链路可服务 Desktop 和 Mobile，不暴露 Host 绝对路径。

推荐目录：

```text
~/.piwin/media/.staging/<asset-id>/payload.part
~/.piwin/media/.staging/<asset-id>/payload
~/.piwin/media/.staging/<asset-id>/metadata.json
```

完成上传使用同目录原子 rename。prompt 接受时再移动到：

```text
~/.piwin/media/<session-id>/<asset-id>.<ext>
```

未 claim 的 staged asset 默认保留 7 天，显式移除草稿时立即 `media/release`；Host 启动
和每日维护任务清理过期 staging 与 `.part` 文件。已进入 transcript 的资产由 session
生命周期管理，不能被 staging 清理误删。

### 4.3 合同先行

在 `packages/contracts` 增加下列公开概念，具体名称实现时可微调，但语义不可退化：

```ts
type AttachmentFailureCode =
  | 'host-offline'
  | 'timed-out'
  | 'upload-interrupted'
  | 'disk-unavailable'
  | 'too-large'
  | 'unsupported-type'
  | 'decode-failed'
  | 'unsafe-content'
  | 'asset-expired'
  | 'asset-not-found'
  | 'internal';

type StagedMediaAssetRef = {
  assetId: string;
  name: string;
  mimeType: string;
  byteSize: number;
  digest: string;
  contentKind: 'image' | 'text' | 'source' | 'document';
  width?: number;
  height?: number;
};

type MediaUploadLimits = {
  maximumFileBytes: number;
  allowedMimeTypes: string[];
  ticketExpiresAt: string;
};
```

新增命令/能力：

- `media/upload-ticket`
- `media/upload-status`
- `media/upload-abort`
- `media/release`
- `host/capabilities.mediaUpload = true`

`session/prompt` 接受 opaque asset reference。绝对路径只存在于 Host 内部存储投影；
远程客户端永远不接收可执行的 Host 路径。

### 4.4 二进制上传

普通 `HostCommand` 不再携带整张图片的 Base64。Host sidecar 和 Host Server 都提供
同一语义的上传端点：

- local sidecar：仅监听 `127.0.0.1` 的随机端口；
- remote Host：复用已认证 Host Server 的 HTTP(S) listener；
- ticket：128-bit 以上随机值、一次性、短 TTL、绑定 client/asset/预期大小；
- body：流式读取，超过限制立即终止；
- 完整性：Host 流式计算 SHA-256，完成后返回 digest；
- 安全：MIME sniff、允许列表、路径约束、敏感内容策略仍由 `@piwin/media` 执行；
- 取消：中止请求并删除 `.part`；
- 进度：Client 使用带 upload progress 的 transport adapter；UI 不依赖某个浏览器 API。

`media/save` 在迁移期保留，但新 Desktop 不再调用它；禁止通过简单提高普通协议帧上限来
掩盖问题。

### 4.5 图片规范化

上传存储和模型输入变体分开：

1. Host 在额度内保存用户原图，保留查看和后续重新处理能力。
2. 模型发送前按模型 profile 生成 model-ready derivative，例如最长边 2048 px。
3. UI 截图优先保留 PNG/WebP，避免 JPEG 把小字压糊；照片可使用 JPEG/WebP。
4. GIF 保留动画预览，模型默认收到明确标记的首帧派生图；动画理解继续属于后续能力。
5. HEIC/HEIF 若客户端能够可靠转换，显示“转换中”；不能转换时给出明确格式错误。
6. 派生文件记录 `derivedFromId`，不覆盖原始资产。

限额建议：

- 图片单文件默认 20 MB；
- 单条 prompt 图片合计默认 50 MB；
- 单图最长边硬上限与解码像素上限由 Host 配置；
- model-ready derivative 默认最长边 2048 px，质量由图片类型决定；
- 客户端可预判限额，但 Host 是最终权威。

这些值进入 `~/.piwin/config.json` 和 Host capability response，不散落为互相冲突的
Desktop 常量。

## 5. 错误与可观察性

### 5.1 用户错误映射

| code | 用户文案示例 | retryable |
| --- | --- | --- |
| `host-offline` | Host 未连接，连接后会继续 | 是 |
| `timed-out` | 添加图片超时 | 是 |
| `upload-interrupted` | 连接中断，图片未添加完整 | 是 |
| `too-large` | 图片为 26 MB，超过 20 MB 限制 | 否 |
| `unsupported-type` | 暂不支持 HEIC，请转换为 PNG/JPEG | 否 |
| `decode-failed` | 无法读取这张图片，文件可能已损坏 | 否 |
| `unsafe-content` | 文件触发敏感内容保护，未添加 | 否 |
| `disk-unavailable` | Host 无法写入媒体目录 | 由 Host 决定 |
| `asset-expired` | 草稿图片已过期，请重新选择 | 否 |
| `internal` | 图片未添加，可复制错误详情 | 否，除非 Host 指定 |

### 5.2 结构化诊断

Host 和 Desktop 记录不含文件内容的诊断字段：

```text
clientAttachmentId, assetId, attempt, stage, failureCode,
declaredBytes, receivedBytes, normalizedMime, transport,
durationMs, hostInstanceId, sessionId(if claimed)
```

禁止记录 Base64、文件内容、访问 ticket、用户绝对来源路径和密钥。Host Log Panel 可按
`assetId` 查询最近事件。UI 的“复制错误详情”只复制稳定 code、阶段、时间和 request ID。

### 5.3 产品指标

本地统计即可，不要求外发遥测：

- paste-to-preview p50/p95；
- upload success rate；
- 各 failureCode 计数；
- 自动重试恢复率；
- 用户选择“仅发送文字”的次数；
- staging orphan 清理数量。

## 6. 包与文件职责

| 层 | 改动职责 |
| --- | --- |
| `packages/contracts` | asset ref、ticket/status、failure code、capability、prompt input |
| `packages/media` | staging、流式写入、MIME/digest/policy、claim/release/cleanup |
| `packages/host-runtime` | 命令编排、session claim、PromptPreparation、错误映射 |
| `packages/host-server` | HTTP upload endpoint、ticket 验证、remote projection |
| `packages/host-client` / `host-transport` | upload transport port、能力发现、取消/进度 |
| `apps/desktop` | paste/drop/picker 状态机、草稿绑定、localized UI、发送选择 |
| `apps/mobile` | 复用 upload transport 和 asset ref；移动端选择器另行适配 |
| `packages/agent-host` | 不负责上传；只消费 Host Runtime 准备好的 native images |
| `packages/ui-kit` | 如缺少 compact attachment notice/action，再增加公共组件 |

禁止：Desktop 直接写 media 目录、`agent-host` 依赖 media/host-runtime、UI 解析 Pi 事件、
在 prompt 文本里塞 Base64。

## 7. 分阶段实施

### Phase 0：立即恢复可用性

目标：不等新上传协议就先消灭“Retry 盖图 + 整个 composer 锁死”。

- 去掉缩略图中央的 `Retry` 覆盖层；
- 失败原因和“重试/移除”放在 chip 外侧；
- 完成中英文 localization；
- failed attachment 不再直接设置 `send.disabled = true`；
- 发送时使用“重试 / 仅发送其余内容 / 返回”确认；
- 只有失败附件时，主按钮变成“重试图片”；
- 显示当前 `uploadError`，并把 Host 连接错误与图片策略错误区分开；
- 添加 Desktop 组件与交互测试。

Phase 0 不改变 Host 合同，风险低，应作为独立提交先落地。

### Phase 1：稳定错误语义和有限自动恢复

- contracts 增加 `AttachmentFailureCode` 与 `retryable`；
- Host 将大小、MIME、安全、磁盘、超时错误映射为稳定 code；
- Desktop 限定自动重试 2 次；Host reconnecting 时等待 ready；
- Host Log Panel 增加 attachment request 诊断；
- 删除依赖英文字符串匹配的重试判断。

### Phase 2：draft-scoped staging 与二进制上传

- 接受 ADR 0045；
- 实现 media staged asset store、metadata、claim、release、TTL cleanup；
- 实现 local loopback 与 remote HTTP(S) upload ticket；
- contracts/prompt 改为 opaque asset ref；
- Desktop 不再在粘贴时调用 `ensureSession`；
- Desktop 不再把图片转成 Base64 `media/save`；
- prompt 接受时再创建 session、claim asset、写 transcript；
- 断开、取消、Host 重启与幂等恢复测试全部落地。

### Phase 3：草稿恢复与全客户端一致

- Desktop draft 保存 ready asset refs，切换会话后可恢复；
- App 重启后恢复未过期的 staged assets；
- Mobile 使用同一 upload ticket 与 asset ref；
- fork/duplicate/cleanup 明确 asset ownership；
- remote projection 不再暴露 Host absolute path；
- 第一方客户端全部迁移后废弃 Base64 `media/save`。

### Phase 4：图片质量与模型 profile

- Host-owned model-ready derivative；
- PNG/WebP 截图与 JPEG 照片使用不同策略；
- provider/model format profile 和图片数量/大小约束；
- GIF 关键帧、HEIC 转换等后续能力按明确 profile 增量加入。

## 8. 测试计划

### 单元测试

- attachment state transition 与非法 transition；
- failure code -> localization/action mapping；
- 自动重试仅覆盖 retryable code，次数和 backoff 正确；
- MIME sniff、扩展名伪造、大小上限、像素炸弹、路径穿越；
- ticket TTL、单次消费、client/asset 绑定；
- staging claim/release/cleanup 幂等；
- prompt 不接受 failed/unclaimed/expired asset；
- SDK/RPC 得到相同的 native image preparation。

### Desktop 组件测试

- 失败文案不覆盖缩略图；
- 中文环境不出现 `Retry`；
- 文字 + failed attachment 时发送按钮可用；
- “仅发送其余内容”不会包含失败 asset；
- attachment-only failed 状态显示重试主操作；
- saving 状态点击发送会等待并自动继续；
- 移除/取消不会被晚到异步结果重新加回；
- Host reconnecting -> ready 后自动恢复。

### 集成/E2E

- 新草稿粘贴图片不会创建 session；
- 100 KB、5 MB、19 MB 图片成功；21 MB 显示准确限额；
- 上传中杀掉/重启 Host，恢复后可重试；
- 上传中取消，无 `.part` 残留；
- 同一 clientAttachmentId 重试不产生重复资产；
- 本地 sidecar 与远程 Host 行为一致；
- 视觉模型收到 native image；纯文本模型得到明确委派/兼容提示；
- transcript 恢复、fork、duplicate、session delete 的资产引用正确。

### 手工 smoke

- macOS 截图粘贴；
- Finder 拖入 PNG/JPEG/WebP/GIF；
- 连续粘贴 4 张图后立即按 Enter；
- Host 离线时粘贴并恢复连接；
- 一张失败、一张成功、带文字发送；
- 中文和英文 UI；键盘操作与 VoiceOver 标签。

## 9. 验收标准

以下条件全部满足才算完成：

1. 正常 PNG/JPEG/WebP 粘贴、拖入、选择均可发送并被视觉模型读取。
2. UI 不再出现覆盖缩略图的 `Retry`，失败原因无需 hover 即可看见。
3. 一张失败图片不能无解释地锁死文字发送。
4. 系统不会静默丢图；仅发送文字必须由用户明确选择。
5. 新草稿粘贴图片不会提前创建 Host session。
6. 图片二进制不再进入普通 HostCommand/Base64 JSON 帧。
7. Host 重启、超时和中断被分类为可恢复错误；策略错误不无限重试。
8. Client 使用 opaque assetId，Host 仍是 `~/.piwin/media` 唯一写入权威。
9. prompt 对视觉模型使用 native `ImageContent`，不在文本中注入 Base64。
10. `pnpm typecheck`、相关包测试、架构测试、Desktop build 和上述 smoke 全绿。

## 10. 推荐提交顺序

每个提交只处理一个关注点：

1. `desktop: make failed attachments understandable and non-blocking`
2. `contracts: add attachment failure and staged asset contracts`
3. `media: add staged asset lifecycle`
4. `host: add upload ticket and binary ingest`
5. `desktop: migrate composer media to staged assets`
6. `host: claim assets during prompt preparation`
7. `mobile: adopt shared media upload`
8. `media: remove first-party base64 upload path`

不要把 UI 热修、合同迁移、Host 上传服务和模型图片派生塞进一个大提交。

## 11. 实施优先级结论

第一优先级不是让 `Retry` 好看一点，而是先恢复用户控制权：失败原因可见、文字仍可
发送、不会静默丢图。随后立即拆掉“粘贴图片 -> 创建 session -> Base64 普通命令”这条
脆弱链路，切到 draft-scoped staged asset 和 Host-owned binary upload。

这样既能快速修复当前无法使用的问题，也不会留下只适用于本地 Desktop 的临时方案。
