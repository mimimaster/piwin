# piwin Live 多渠道 Provider Adapter — 可执行实现规格

2026-08-31 补充：[稳定性修订与实测](./2026-08-31-live-reliability.md)。owner/key 重放同时固定 session/provider；媒体 connected + data channel open 才 active；Host 唯一回传；紧急 end 不受 activity revision 变化阻挡。旧文冲突描述以该修订为准。

| 字段 | 值 |
|------|----|
| 状态 | **Executable — 已完成设计审查，可按工作包施工** |
| 日期 | 2026-08-29 |
| 产品名 | piwin Live |
| 一句话 | 在当前工作会话里说、听、打断；可切换语音渠道；明确工作仍进入同一个 Agent 会话。 |
| 首期渠道 | `openai-codex`、`google-gemini`、`openai-realtime`（OpenAI Realtime 兼容网关，如 xgrok） |
| 范围 | `@piwin/contracts`、`@piwin/voice`、Host Runtime、Host transport/server、Desktop/Mobile Live 与设置 |
| 上位产品规格 | [2026-08-28-codex-live-product.md](./2026-08-28-codex-live-product.md) |
| 现有技术规格 | [2026-08-28-codex-live-voice-lane.md](./2026-08-28-codex-live-voice-lane.md) |
| 现有 ADR | [ADR 0065](../adr/0065-piwin-live-voice-work-session.md) |
| 相关故障规格 | [2026-08-29-live-start-bounce-handoff.md](./2026-08-29-live-start-bounce-handoff.md) |

本文把 piwin Live 从 Codex 单渠道扩展为多渠道。本文通过后，渠道、设置、建连材料和 Provider Adapter 结构以本文为实现基线；会话准入、权限、单 Host 单通话、挂断不取消已接纳 Run、原始音频不落盘等不变量继续沿用上位规格。

本文与 ADR 0065、PRD、architecture、dev-plan 的 Codex-only 表述存在有意冲突。按照 `AGENTS.md` §0.1，实施工作包 WP0 必须先把这些文档同步为多渠道事实，旧文档不是拒绝本设计的理由。

---

## 0. 审查结论

原草案的产品方向成立，但不能直接开工。以下问题已在本文中关闭：

| 原问题 | 风险 | 本文决定 |
|--------|------|----------|
| 仅用 `mediaKind` 选择 Shell 实现 | 多家都用 WebSocket/PCM 时，消息、工具调用和恢复协议仍不同；“同 mediaKind 自动复用”不成立 | 分成 Host Provider Adapter 与 Shell Media Driver；`mediaKind` 只描述载体，`mediaDriverId` 决定客户端协议实现 |
| Host adapter 同时 `subscribe` 上游事件，但媒体由 Shell 直连 | Host 实际收不到直连链路事件，职责自相矛盾 | Shell Driver 把上游事件归一化为 `LiveOwnerEvent` 再报 Host；Host 把它当不可信输入并做 owner/call/schema/幂等校验 |
| “短时令牌只在 Host”同时又返回电脑 | 安全边界无法实现 | 长期 OAuth/API key 永不离开 Host；一次性短时令牌可且只能出现在同一 owner 的 start response 和 owner 内存中 |
| `settingsSchema` 是未约束字段表 | UI、Host 校验和 Provider 默认值可能漂移 | 公共合约使用封闭控件联合类型；Host 对默认值、选项、提交键和值做双重校验 |
| “同幂等键返回同一路通话”未定义秘密材料重放 | Gemini token 一次使用，错误重试可能再次消费 | 幂等范围固定为 `(ownerDeviceId, idempotencyKey)`；只缓存同一 owner 的原 start response，Desktop 每次新尝试生成新 key |
| 单个 `pendingWork` 追踪结果 | 第二次委派会覆盖第一次，排队 Run 也无法关联 | 使用有界 delegation ledger，以 `(callId, providerDelegationId)` 关联 `messageId/queueId/runId` |
| 失败即清 slot 并推 `call: null` | Desktop 会先 abort start，真实上游错误被吞掉 | 失败响应/`show-error` 先于 `release-media` 和最终 `call: null`；顺序纳入测试 |
| API key 配置中持久化“已配置”布尔值 | 可能与密钥库真相漂移 | `keyConfigured` 每次从 Host secret store 派生，不写入 `config.json` |
| Codex 智能程度“运行时探测”未定义 | 打开设置页可能创建计费通话，且没有 SDP | 这是发布前 wire spike，不是设置页运行时探测；证据通过后由 adapter capability 开启字段 |
| Gemini 事实没有发布门禁 | Preview 型号、令牌、会话恢复可能变化 | 先完成官方 API spike 与去敏证据；未通过不得登记成可选渠道 |

### 0.1 审查后的可实施判断

本方案在以下前提下可实施：

1. 先改公共 contracts，再改所有实现者；不得在 Desktop 或 Host Runtime 里先塞厂商字段。
2. Provider Registry 由 `host-runtime` 组合，Provider wire 只在 `@piwin/voice` 和对应 Shell Media Driver 内出现。
3. Gemini 必须使用受约束短时令牌直连，长期 API key 不进 renderer。
4. Codex 智能程度与 Gemini 真链路分别有 Go/No-go；失败时隐藏能力或停止该渠道，不伪造成功。
5. 在扩展前先拆分已超过主动拆分阈值的 `live-call-coordinator.ts` 和 `use-live-call.ts`。

---

## 1. 产品决定与不变量

### 1.1 已确认决定

1. 首期登记 `openai-codex`、`google-gemini` 和 `openai-realtime`。
2. Codex 复用 Accounts 中的套餐 OAuth；Gemini 使用 Gemini API key。
3. Live 渠道只负责实时对话和委派；工作 Run 继续使用当前会话已经选择的文本模型与思考程度。
4. Codex 智能程度已关（2026-08-31 AVAS 拒收 `session.intelligence`）。`CODEX_LIVE_INTELLIGENCE_ENABLED = false`。
5. Gemini 可选 Live 型号、音色和 `minimal / low / medium / high` 思考程度。
6. Desktop 或已配对 Mobile 直接连接上游媒体；Host 只交换建连材料并保有通话、准入和结果关联权威。
7. 顶栏、Composer Live 按钮、失败自关、错误通知和委派展示对各渠道共用。

### 1.2 强制不变量

1. 一个 Host 同时最多一个活动 Live call。
2. call 创建后固定绑定 `sessionId`、`ownerDeviceId`、`providerId`、`mediaDriverId` 和 settings snapshot；通话中不改绑。
3. Voice 模型不获得 Agent/MCP/权限工具目录。Gemini 只登记一个产品工具：请求 Host 把指令委派到绑定会话。
4. 只有 Host 成功持久化/排队委派后，语音侧才可声称“已交给 Agent”。
5. 忙会话默认 steer 当前 Run；`STOP_CURRENT_RUN` 才 abort；挂断不取消已经接纳的 Run。
6. 原始音频、闲聊 transcript、SDP、长期凭证、短时令牌和原始上游报文不写 transcript、config、日志或 HostPush journal。
7. 非 owner 只能看到去敏 `LiveCallView`；建连材料与 owner action 只给 owner。
8. `expectedRevision` 是实际并发门，不是装饰字段。过期写操作返回 `live-conflict`。
9. Host 重启、owner 断联超时、会话失效、当前渠道退出登录/清密钥、Host dispose 都必须结束 call 并释放媒体。
10. Provider/媒体失败必须先保留可见错误，再清理资源；不得静默退回 idle。

### 1.3 首期不做

- CLI/Web 不持麦；已配对 Mobile 与 Desktop 一样可以作为 Live owner。
- Host PCM 音频中继。
- 保存录音或完整闲聊 transcript。
- 关键词猜测委派。
- 通话中热切换渠道、设备、会话或型号。
- 从 Host 下载或执行 Provider 插件代码；首期 Provider 与 Shell Driver 都是随版本静态注册。
- 为 Codex/Gemini 另造聊天 `ModelRef`；OpenAI-compatible Live 复用模型配置里的 `realtime-audio` capability。

---

## 2. 目标架构

```text
Settings UI ── settings schema ───────────────┐
Composer / Live Bar ── product state ─────────┤
                                               ▼
Desktop/Mobile Live Controller ─────── HostCommand / HostPush
        │                                      │
        │ selects by mediaDriverId             ▼
        ▼                              LiveCallCoordinator
Desktop/Mobile Media Driver Registry           │
  ├─ codex-webrtc-v1                           ├─ readiness / owner / revision
  ├─ gemini-live-v1beta                        ├─ delegation ledger / Session admission
  └─ openai-realtime-ws-v1                     └─ result correlation / cleanup
        │ direct media
        ▼                                      │
     Upstream                           Host Provider Registry
                                          ├─ openai-codex adapter
                                          └─ google-gemini adapter
                                                   │
                                                   └─ auth + start material only
```

### 2.1 为什么有两个登记台

Host 与各 Shell 不共享可执行代码，也不承担同一职责：

| 登记台 | 选择键 | 职责 | 不得做 |
|--------|--------|------|--------|
| Host Provider Registry | `providerId` | 描述渠道、鉴权、字段表、校验设置、创建/关闭上游 session bootstrap | 开麦、播放音频、渲染 UI |
| Desktop/Mobile Media Driver Registry | `mediaDriverId` | 开麦、连接、收发音频、解析厂商客户端事件、写回 ack/结果、关闭本地媒体 | 读取长期凭证、直接创建 Agent Run |

`mediaKind` 仅用于能力提示与粗粒度分类：

```ts
type LiveMediaKind = 'webrtc-sdp' | 'pcm-websocket';
type LiveMediaDriverId =
  | 'codex-webrtc-v1'
  | 'gemini-live-v1beta'
  | 'openai-realtime-ws-v1';
```

以后新增 Provider 时：

- 若其 wire 与现有 Shell Driver **完全相同**，可复用 `mediaDriverId`。
- 仅仅同为 WebRTC 或 WebSocket/PCM 不算相同；消息、鉴权、工具、恢复任一不同就新增 Driver。
- 新 Driver 先加 contracts 的 bootstrap 分支和 Desktop/Mobile 实现，再登记 Provider。

### 2.2 包边界

| 层 | 允许 | 禁止 |
|----|------|------|
| `@piwin/contracts` | 公开产品类型、命令、push、settings/config | Provider URL、原始报文、SDK runtime 依赖 |
| `@piwin/voice` | Provider Registry 接口、纯状态机、Codex/Gemini Host adapter、fixture、错误映射 | Pi、Session、Desktop DOM/media API |
| `@piwin/host-runtime` | 组合登记、call 权威、secret resolution、Session admission、结果关联 | Provider wire 解析散落、PCM relay |
| `host-server` / `host-transport` | owner/audience、non-journal、response redaction | token/SDP/短时令牌进入 push/replay |
| `apps/desktop`, `apps/mobile` | Media Driver、麦克风/播放器、共用 Live UI | Pi、长期凭证、直接开 Run |
| `agent-host` | 无新增 Live 职责 | import `@piwin/voice` 或处理实时音频 |

---

## 3. 公共合约

以下是结构约束，不要求逐字复制；实现命名必须表达相同边界。

### 3.1 Provider 与设置字段

```ts
type LiveProviderId = string;

type LiveProviderAuthView =
  | { kind: 'subscription-oauth'; providerId: string; ready: boolean }
  | { kind: 'api-key'; providerId: string; keyConfigured: boolean };

type LiveSettingOption = { value: string; label: string };

type LiveSettingField = {
  key: string;
  control: 'select';
  label: string;
  description?: string;
  required: boolean;
  defaultValue: string;
  options: LiveSettingOption[];
};

type LiveProviderDescriptor = {
  providerId: LiveProviderId;
  title: string;
  mediaKind: LiveMediaKind;
  mediaDriverId: LiveMediaDriverId;
  auth: LiveProviderAuthView;
  settings: LiveSettingField[];
};

type LiveSettingsView = {
  revision: number;
  selectedProviderId: LiveProviderId;
  providers: LiveProviderDescriptor[];
};
```

约束：

- 首期 settings control 只有 `select`；API key 由 auth 区块渲染，不伪装成普通 setting。
- 每个字段 `defaultValue` 必须存在于 `options`。
- 每个 Provider 内字段 key 唯一；每个 option value 唯一。
- Host 返回前验证 schema；Desktop/Mobile 不接受未知 control。
- 保存时只接受 schema 中的 key/value；缺少 required 字段或提交额外键都失败。
- `providerId` 对外是稳定 string，不用两值 union 锁死未来扩展；registry 负责存在性校验。

### 3.2 Status 与 readiness

```ts
type LiveReadyMissing =
  | 'provider-auth'
  | 'microphone'
  | 'media-unsupported'
  | 'session'
  | 'call-busy'
  | 'provider-unavailable'
  | 'invalid-settings';

type LiveStatusData = {
  ready: boolean;
  selectedProviderId: string;
  /** Provider 未登记时不存在。 */
  mediaKind?: LiveMediaKind;
  /** Provider 未登记时不存在。 */
  mediaDriverId?: LiveMediaDriverId;
  missing: LiveReadyMissing[];
  call: LiveCallView | null;
};

type LiveStatusInput = {
  sessionId?: string;
  capabilities: {
    microphone: boolean;
    mediaDriverIds: LiveMediaDriverId[];
  };
};
```

readiness 由 Host 与 owner 能力共同计算：

```text
ready = provider 已登记且 authReady
  ∧ settings snapshot 有效
  ∧ owner 报告 microphone 可用
  ∧ owner 报告支持 mediaDriverId
  ∧ session 可绑定
  ∧ 无其它活动 call
```

Desktop/Mobile 在每次请求 `status` 时带 `LiveStatusInput` 的本地 capability snapshot。不能继续用 `undefined = 有麦/有 WebRTC` 的乐观默认；start 还要重复校验同一组能力，不能只信之前的 status。

### 3.3 Start 的判别联合

```ts
type LiveClientBootstrapInput =
  | { mediaDriverId: 'codex-webrtc-v1'; offerSdp: string }
  | { mediaDriverId: 'gemini-live-v1beta' }
  | { mediaDriverId: 'openai-realtime-ws-v1' };

type LiveStartInput = {
  sessionId: string;
  providerId: string;
  settingsRevision: number;
  idempotencyKey: string;
  bootstrap: LiveClientBootstrapInput;
};

type LiveOwnerBootstrap =
  | { mediaDriverId: 'codex-webrtc-v1'; answerSdp: string }
  | {
      mediaDriverId: 'gemini-live-v1beta';
      endpoint: string;
      ephemeralToken: string;
      inputSampleRateHz: 16_000;
      outputSampleRateHz: 24_000;
      modelId: string;
      voice: string;
      thinkingLevel: 'minimal' | 'low' | 'medium' | 'high';
    }
  | {
      mediaDriverId: 'openai-realtime-ws-v1';
      endpoint: string;
      bearerToken: string;
      inputSampleRateHz: 24_000;
      outputSampleRateHz: 24_000;
      modelId: string;
      voice: string;
    };

type LiveStartData = { call: LiveCallView; bootstrap: LiveOwnerBootstrap };
```

安全和并发规则：

1. `providerId` 必须等于 `settingsRevision` 对应的 selected Provider；不匹配返回 `live-conflict`。
2. `bootstrap.mediaDriverId` 必须等于 Provider descriptor；不匹配返回 `live-media-unsupported`。
3. Codex `offerSdp` 保留现有 UTF-8 byte cap、CRLF 与终止行要求。
4. `LiveStartData.bootstrap` 仅存在于 owner-only response；不得进入任何 push、status、journal、诊断或 persisted error。
5. `(ownerDeviceId, idempotencyKey)` 相同则返回同一 in-flight/cached start 结果；不同 owner 即使 key 相同也不得复用。
6. 当前 owner shell（Desktop 或配对 Mobile）一次逻辑 start 只消费一次 bootstrap；用户手动 Retry 必须生成新 key。
7. 缓存随 call cleanup 清除。Host 重启不恢复 call 或 bootstrap。

### 3.4 Call 投影

```ts
type LiveCallView = {
  callId: string;
  revision: number;
  phase: 'starting' | 'active' | 'reconnecting' | 'ending' | 'ended' | 'failed';
  activity?: 'listening' | 'user-speaking' | 'assistant-speaking' | 'muted'
    | 'agent-working' | 'waiting-for-permission';
  boundSessionId: string;
  boundSessionLabel: string;
  ownerDeviceId: string;
  providerId: string;
  mediaDriverId: LiveMediaDriverId;
  voiceModelId: string;
  startedAt: string;
  endedAt?: string;
  errorCode?: LiveCallErrorCode;
};
```

`LiveCallView` 不含 settings、SDP、endpoint、token、API key、上游 event id 或原始错误 body。

### 3.5 Owner event 与 owner action

Desktop/Mobile Driver 只上报归一化产品事件：

```ts
type LiveOwnerEvent =
  | { type: 'delegation'; providerDelegationId: string; instruction: string }
  | { type: 'activity'; activity: 'listening' | 'user-speaking' | 'assistant-speaking' }
  | { type: 'media-active' }
  | { type: 'media-reconnecting' }
  | { type: 'media-failed'; mappedCode?: LiveCallErrorCode }
  | { type: 'media-closed' };
```

Host 不把 Shell 事件视为上游真实性证明。Host 必须验证：认证 owner、callId、expectedRevision、当前 phase、payload byte cap、Provider 允许的事件类型、delegation 幂等与预算。

Host 给 owner 的 action 保持产品语义：`ack-delegation`、`append-context`、`show-error`、`release-media`。两家 wire ack / tool response / context append 都由当前 Shell Driver 翻译，不进入公共合约。

### 3.6 Commands

| Command | 输入/输出 | 规则 |
|---------|-----------|------|
| `voice/live/settings-schema` | `LiveSettingsView` | 只读；无秘密 |
| `voice/live/apply-settings` | `expectedRevision`, `providerId`, `values` | Host 校验并原子保存；Provider/活跃设置变化会结束 call |
| `voice/live/set-provider-key` | `providerId`, `operation: set\|clear`，set 时带 key | 只允许 registry 中 `api-key` Provider；复用 Host secret resolver；响应不回显 key |
| `voice/live/status` | `LiveStatusInput` → `LiveStatusData` | status 无秘密；start 前重新计算 |
| `voice/live/start` | §3.3 | loopback Desktop or authenticated paired Mobile owner；bootstrap response non-journal |
| `voice/live/media-state` | 合并入 `report-event` 或保留兼容壳 | 不保留两套状态真相 |
| `voice/live/set-muted` | `callId`, `expectedRevision`, `muted` | owner + revision gate |
| `voice/live/end` | `callId?`, `expectedRevision?`, `reason` | owner；幂等；in-flight start 可取消 |
| `voice/live/report-event` | `callId`, `expectedRevision`, `LiveOwnerEvent` | owner；输入不可信 |

`set-provider-key` 内部复用现有 secret store，而不是另造凭证文件。为支持 clear，给通用 SecretResolver 增加明确的 delete port；禁止写空字符串冒充删除。

### 3.7 Push、audience 与顺序

| Push | Audience | Journal | 内容 |
|------|----------|---------|------|
| `voice/live-updated` | 已授权 shell | 否 | 去敏 `LiveCallView | null` |
| `voice/live-owner-action` | 当前 owner | 否 | ack、短结果、错误、释放媒体 |

失败顺序必须是：

```text
start response failure 或 owner show-error
  → release-media
  → voice/live-updated(call: null)
```

同一 owner 传输必须保持此顺序。Desktop/Mobile 不得因为先看到 `call: null` 就 abort 并吞掉仍在途的 start failure。对应回归测试必须覆盖 companion spec 中的 bounce race。

---

## 4. 配置与秘密

### 4.1 Config shape

```ts
type SpeechLiveConfig = {
  providerId?: string;
  byProvider?: Record<string, Record<string, string>>;
  voice?: string;   // 旧字段，仅迁移读取
  enabled?: boolean; // 旧字段，继续忽略
};
```

首期落盘：

```text
speech.live.providerId
speech.live.byProvider.openai-codex.voice
speech.live.byProvider.openai-codex.intelligence       # 已撤下：旧值读取时忽略，不发送
speech.live.byProvider.google-gemini.model
speech.live.byProvider.google-gemini.voice
speech.live.byProvider.google-gemini.thinkingLevel
```

规则：

1. `providerId` 缺失时默认 `openai-codex`。
2. 只有旧 `speech.live.voice` 时，把它作为 Codex voice 的读取 fallback；下一次成功保存迁移到 `byProvider`。
3. 默认值仅用于字段缺失。已有但非法的值不得静默替换；status 返回 `invalid-settings`，设置页要求修复。
4. 保存当前 Provider 时不删除其它 Provider 的设置。
5. settings revision 每次成功写入递增；start 固定读取同一 revision 的 snapshot。
6. 配置更新通过现有 ConfigStore 原子写路径，不直接改 JSON。

### 4.2 Secret shape

- Codex：复用 `openai-codex` subscription credential。
- Gemini：复用 Host secret id `google-gemini`，不在 `config.json` 保存 plaintext 或 `keyConfigured`。
- `settings-schema` 的 `keyConfigured` 由 secret store 实时派生。
- set/clear 当前通话所用凭证时，Host 先让 coordinator 进入 ending 并完成 cleanup，再报告设置成功。
- 所有错误只返回稳定 mapped code；不得包含 key、token、endpoint query、上游 response body。

---

## 5. Host Provider Registry 与 Adapter

### 5.1 接口

```ts
type LiveProviderRegistration = {
  descriptor(): Promise<LiveProviderDescriptor> | LiveProviderDescriptor;
  authReady(): Promise<boolean>;
  validateSettings(values: Readonly<Record<string, string>>):
    | { ok: true; normalized: Readonly<Record<string, string>> }
    | { ok: false; field?: string; message: string };
  start(input: {
    callId: string;
    sessionId: string;
    settings: Readonly<Record<string, string>>;
    clientBootstrap: LiveClientBootstrapInput;
    signal: AbortSignal;
  }): Promise<{
    voiceModelId: string;
    ownerBootstrap: LiveOwnerBootstrap;
    close: () => Promise<void>;
  }>;
};
```

实现约束：

- Registry 构造函数拒绝重复 `providerId`。
- descriptor 的 `mediaDriverId` 与 start 输入/输出必须一致。
- adapter 自己解析凭证与 wire；coordinator 不出现 Codex header 或 Gemini token endpoint。
- `close` 幂等；失败要记录去敏 boundary diagnostic，不能 silent catch。
- 所有 start 接受 AbortSignal 和明确 deadline。
- Registry 只在 `host-runtime` composition root 注册，`agent-host` 不参与。

### 5.2 Codex 注册

| 项 | 值 |
|----|----|
| `providerId` | `openai-codex` |
| `mediaKind` | `webrtc-sdp` |
| `mediaDriverId` | `codex-webrtc-v1` |
| auth | `subscription-oauth` → `openai-codex` |
| voice model | `gpt-live-1-codex`（adapter-private wire 常量，view 可显示 id） |
| voice default | `cove` |

固定 voice allowlist：`juniper` `maple` `spruce` `ember` `vale` `breeze` `arbor` `sol` `cove`。

Codex intelligence：

1. **已关。** 2026-08-31 AVAS 返回 400 `Unknown parameter: 'intelligence'`。
2. `CODEX_LIVE_INTELLIGENCE_ENABLED = false`：设置页隐藏，call-create 不发送，config 旧值忽略。
3. 设置页打开不能触发真实通话探测。

### 5.3 Gemini 注册

| 项 | 值 |
|----|----|
| `providerId` | `google-gemini` |
| `mediaKind` | `pcm-websocket` |
| `mediaDriverId` | `gemini-live-v1beta` |
| auth | `api-key` → Host secret id `google-gemini` |
| default model | `gemini-3.1-flash-live-preview` |
| default voice | `Kore` |
| default thinking | `minimal` |

截至 2026-08-29 的官方事实基线：

- [Live API overview](https://ai.google.dev/gemini-api/docs/live-api)
- [Ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens)
- [WebSocket guide](https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket)
- [Capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities)
- [Tool use](https://ai.google.dev/gemini-api/docs/live-api/tools)
- [Deprecations](https://ai.google.dev/gemini-api/docs/deprecations)

实现要求：

1. Host 用 API key 调 `v1beta/auth_tokens` 创建 `uses = 1` 的 constrained ephemeral token。REST body 用 proto 字段 `bidiGenerateContentSetup`（不要发 SDK 名 `liveConnectConstraints`，Google 会 400）。
2. `newSessionExpireTime` 取官方允许范围内的短值，首期目标 60 秒；session expiry 首期目标 30 分钟。
3. `liveConnectConstraints` 至少锁定 model 与 `AUDIO` response modality；API 支持约束的 session resumption、context compression 和工具定义也必须锁定。不得发一个可任意建 Live session 的宽 token。
4. Gemini Driver 只连接 adapter 允许的 `wss://generativelanguage.googleapis.com/...BidiGenerateContentConstrained` endpoint；禁止配置任意 WebSocket URL。
5. 输入发送 raw little-endian 16-bit PCM，首期重采样为 16 kHz；输出按 24 kHz 播放。
6. 开启 context window compression、session resumption；处理 `GoAway`、resumption token、generation complete 与连接预算。
7. Gemini 3.1 使用 `thinkingLevel`，allowlist 为 `minimal / low / medium / high`。
8. model allowlist 由 Host 维护并附官方核对日期；Preview 型号变更必须更新 fixture、默认值和文档，不能接受任意字符串。
9. voice allowlist 由 adapter fixture 固定，默认 `Kore`；不能只写“约 30 个”而没有精确列表与测试。

首期 voice allowlist（官方 Live 文档说明 native audio 可使用 TTS voice catalog；发布前由 WP1 逐项或分批 smoke）：

`Zephyr` `Puck` `Charon` `Kore` `Fenrir` `Leda` `Orus` `Aoede`
`Callirrhoe` `Autonoe` `Enceladus` `Iapetus` `Umbriel` `Algieba`
`Despina` `Erinome` `Algenib` `Rasalgethi` `Laomedeia` `Achernar`
`Alnilam` `Schedar` `Gacrux` `Pulcherrima` `Achird` `Zubenelgenubi`
`Vindemiatrix` `Sadachbia` `Sadaltager` `Sulafat`

Gemini 只声明一个 function：

```text
delegate_to_work_session(instruction: string)
```

Desktop/Mobile Driver 收到 function call 后：

1. 用上游 function call id 作为 `providerDelegationId`；
2. 上报 Host `delegation`；
3. 等 `ack-delegation`；
4. 用同一 function call id 写回成功/失败 response；
5. Run 结束后把 `append-context` 的去敏短结果写回 Live session。

Gemini 3.1 Live 的 function calling 是同步路径；在 Host ack 前不能伪造“已交付”。Agent 工作耗时长于上游 tool 等待预算时，首个 tool response 只确认“已接纳/已排队”，最终结果走后续 context append，不让工具调用一直悬挂到 Run 完成。

---

## 6. Host Call Coordinator

### 6.1 状态与单槽

Coordinator 持有：

```text
call identity + owner + bound session
provider/settings/media snapshot
phase/activity/revision
start idempotency record
provider close handle
bounded delegation ledger
owner disconnect timer
cleanup state
```

不得继续把 Provider 固定字段（`openai-codex`、`sdpAnswer`、Codex auth）放在通用 slot 上。

### 6.2 Start 事务

```text
validate owner capability + settings revision + provider/auth/session
  → reserve singleton slot
  → create adapter and prepare cleanup before network start
  → provider.start(..., AbortSignal)
  → store voiceModelId + close handle + owner bootstrap
  → return owner-only start response
  → wait owner media-active
  → phase active
```

任一步失败：

1. 保存稳定 error code；
2. 先完成 start failure response 或发送 `show-error`；
3. 幂等关闭 Provider；
4. 发送 `release-media`；
5. 清 delegation ledger 与 bootstrap cache；
6. 最后发布 `call: null`。

### 6.3 Revision gate

- `set-muted`、`end`、`report-event` 必须比较 `expectedRevision`。
- 相等才执行并递增 revision；不相等返回 `live-conflict` 与最新去敏 call。
- 幂等 `end` 在 slot 已不存在时返回成功；不得因为重复 end 再弹错误。
- owner mismatch 永远是 `live-not-owner`，不能被 `call-busy` 覆盖。

### 6.4 Owner 断联与重连

- 首期允许 local Desktop 或 authenticated paired Mobile 成为 media owner。
- owner transport 断联进入 20 秒 grace；恢复同一 device identity 可继续控制。
- WebRTC/WS 媒体重连预算：10 秒内最多 2 次；Gemini 同时遵守 resumption token 生命周期。
- 超预算：`show-error` → cleanup；不得无限重连或重复 mint token。

### 6.5 Settings/auth 影响

以下变更会结束当前 call，但不取消已接纳 Run：selected Provider 改变、当前 Provider 任一生效字段改变、当前 Provider key 清除、当前 subscription Provider logout、Host shutdown/dispose。非当前 Provider 的设置或 key 变化不影响正在进行的 call。

---

## 7. 委派、队列与结果关联

### 7.1 Admission

Host 对每个 delegation：

1. 验证 owner、call、phase、绑定 session 和 Provider event policy；
2. trim instruction，拒绝空字符串和超过 `LIVE_DELEGATION_INSTRUCTION_MAX_BYTES` 的内容；
3. 以 `(callId, providerDelegationId)` 查 ledger；重复请求返回原 admission 结果，不产生第二轮；
4. 空闲时进入 foreground Run，忙时进入 queued turn；
5. 持久化用户轮 metadata：`source: 'voice-delegation'`、`callId`、`providerId`；不写 provider event id 到正文；
6. 持久化/排队成功后才回 owner ack；
7. 使用现有 Session/Run/Permission，不提供 Voice bypass。

### 7.2 Delegation ledger

```ts
type LiveDelegationRecord = {
  callId: string;
  providerDelegationId: string;
  sessionId: string;
  messageId: string;
  queueId?: string;
  runId?: string;
  admission: 'accepted' | 'rejected';
  resultDelivered: boolean;
};
```

约束：

- 按 call 有界，首期上限 64；超限拒绝新委派并返回稳定错误。
- queued turn 真正开工时补上 `runId`。
- turn ended 必须用 `sessionId + runId/messageId` 精确匹配，不能用“当前 pendingWork”。
- 同一 call 可有多个已接纳/排队 delegation；结果不可串线。
- call cleanup 后 ledger 可从内存清除；幂等的持久真相仍由 message/queue id 保证。

### 7.3 短结果

- 文字 transcript/assistant reply 是持久真相。
- Host 只发送有界、去敏、可口述的 summary；不含 diff、路径清单、tool 原文、错误栈或秘密。
- 每条结果只投递一次；Driver 失败不得改变 Session Run 的完成状态。
- 通话已结束时不再口述，但 Run 继续完成并留在 transcript。

---

## 8. Shell 实现

### 8.1 共用 Live Controller

共用层负责 status/settings、capability snapshot、start/end/mute/retry、本地与 Host state 合并、owner action 顺序、共用 UI、Driver 生命周期与 cleanup。Desktop 与 Mobile 各自提供平台媒体 Driver；共用层不解析 Codex data channel 或 Gemini WebSocket 报文。

### 8.2 Media Driver 接口

```ts
type DesktopLiveMediaDriver = {
  id: LiveMediaDriverId;
  isSupported(): boolean;
  prepareStart(): Promise<LiveClientBootstrapInput>;
  connect(bootstrap: LiveOwnerBootstrap, signal: AbortSignal): Promise<void>;
  setMuted(muted: boolean): void;
  handleOwnerAction(action: LiveOwnerActionPush): Promise<void>;
  subscribe(listener: (event: LiveOwnerEvent) => void): () => void;
  close(): Promise<void>;
};
```

Driver registry 在重复 id、input/output 分支不匹配时立即失败。每个 Driver 的 `close` 可重复调用并总能停止 track、AudioContext、WebSocket/RTCPeerConnection 和 listener。

### 8.3 UI

设置页：

1. 说明 Live 是实时语音，工作使用当前会话文本模型。
2. Provider 下拉来自 schema；未 ready Provider 仍可选，并显示缺项与恢复动作。
3. 动态 setting 只用 `@piwin/ui-kit` 控件。
4. subscription auth 链到 Accounts；api-key 提供保存、更换、清除，不回显原 key。
5. Preview/套餐/额度文案按 Provider 分开，不能把 Gemini API 额度写成 Codex 套餐能力。

Live surface：

- Composer 入口始终可发现；未 ready 点击显示缺项。
- 本地开始开麦后立即显示连接中，不等 Host call push。
- 连接中、聆听、用户说话、模型说话、静音、Agent 工作、权限等待、重连、失败可区分。
- 失败保留 Retry/Dismiss；不得闪回 idle。
- 控件不小于 44×44px，键盘、读屏、reduced motion 可用。

---

## 9. 错误与用户恢复

| 条件 | code | UI 恢复 |
|------|------|---------|
| Provider 未登记/被构建禁用 | `live-provider-unavailable` | 更新应用或选择其它渠道 |
| subscription/key 缺失或失效 | `live-provider-auth` | 登录或保存 key |
| 麦克风拒绝 | `live-microphone-denied` | 系统设置后 Retry |
| Driver 不支持 | `live-media-unsupported` | 选择其它渠道或更新应用 |
| 已有 call | `live-call-busy` | 返回现有 Live / 先挂断 |
| session 不可用 | `live-session-unavailable` | 选择有效工作会话 |
| settings/revision 过期 | `live-conflict` | 刷新状态后重试 |
| Codex 私有 endpoint 403 | `live-provider-access-denied` | 说明请求被拒，不推断官方套餐资格 |
| 上游配额/限流/拒绝 | `live-provider-rejected` | 检查额度或稍后再试 |
| wire/解析/超时 | `live-protocol-failed` | Retry；保留去敏诊断 |
| owner 断联 | `live-owner-disconnected` | 同设备恢复或重开 |
| 委派重复 | `live-delegation-duplicate` | 返回已有 admission 结果 |
| 委派无效/超预算 | `live-delegation-rejected` | 重新表达或查看会话 |

Provider adapter 只返回稳定 code。原始 HTTP body、WebSocket close reason、token query 和 stack 只在 boundary 内映射；持久诊断通过现有 redaction 后再写。

---

## 10. 可执行工作包

依赖顺序：

```text
WP0 文档同步
  → WP1 双渠道 spike
  → WP2 contracts/config
  → WP3 Host registry + settings
  → WP4 coordinator 拆分与多渠道化
  → WP5 Codex 迁移
  → WP6 Gemini Host adapter + Desktop Driver
  → WP7 UI
  → WP8 transport/security/hardening
  → WP9 端到端验收
```

### WP0 — 文档同步

- ADR 0065：从 Codex-only 改为 Provider Registry + Desktop Driver 双登记结构。
- `docs/architecture.md`：更新 Live topology、package map、秘密边界。
- `docs/prd.md`：LIVE-01/02 改为 Codex OAuth + Gemini BYOK，Desktop 可持一次性 Gemini token。
- `docs/dev-plan.md` 与原 execution plan：新增 Gemini spike 与工作包。
- 上位 product/tech spec：标记本文 supersede 的章节，避免双重真相。

出口：`rg` 不再把 “renderer never holds token” 当成所有 Provider 的绝对不变量；应明确“长期凭证不离 Host，一次性 owner token 例外”。

### WP1 — Go/No-go spike

Codex 保留已验证 201/SDP、voice catalog、CRLF 证据，新增 intelligence 三档 wire probe。Gemini 验证 API key → constrained token、Desktop WebSocket 音频、function call → Host fake admission → tool response、context compression、GoAway、resumption 和清理。

证据只保存去敏状态、耗时、mapped code、型号与协议版本。任一核心项失败，停止对应渠道，不用长期 key 直塞 renderer 绕过。

### WP2 — Contracts 与 config

```text
packages/contracts/src/voice-live.ts
packages/contracts/src/voice-live.test.ts
packages/contracts/src/config.ts
packages/contracts/src/ipc.ts
packages/contracts/src/remote-protocol.ts
packages/contracts/src/index.ts
```

实现 §3/§4 类型，更新全部 reader，保留必要兼容读取。测试判别联合穷尽、schema 校验、无 secret 的 status/push、bootstrap 仅 response、旧 config migration。

### WP3 — Provider Registry、settings 与 secret delete

```text
packages/voice/src/live-provider-registration.ts
packages/voice/src/live-provider-registry.ts
packages/voice/src/live-settings-schema.ts
packages/host-runtime/src/voice/live-settings-service.ts
packages/host-runtime/src/commands/voice-live-settings-commands.ts
packages/host-runtime/src/secret-resolver.ts
```

实现 registry invariant、schema/validation、config revision、set/clear key、auth readiness、composition root 登记。测试重复 Provider、非法默认值、额外 key/value、非 api-key Provider 写 key、clear 真删除、key 不进 config/response/push/log。

### WP4 — Coordinator 拆分与多渠道化

当前 `live-call-coordinator.ts` 已超过 400 行，扩展前拆分：

```text
packages/host-runtime/src/voice/live-call-coordinator.ts
packages/host-runtime/src/voice/live-call-readiness.ts
packages/host-runtime/src/voice/live-call-cleanup.ts
packages/host-runtime/src/voice/live-delegation-ledger.ts
packages/host-runtime/src/voice/live-result-router.ts
```

删除 Codex 固定字段、接 Registry、revision gate、idempotency owner scope、delegation ledger、失败顺序、owner grace。测试并发 start、同 key 重放、跨 owner 同 key、过期 revision、两次委派不串线、queued run 补关联、cleanup close error 去敏记录、start bounce race。

### WP5 — Codex 迁移

把现有 `CodexLiveAdapter` 改为 Host Provider Registration；现有 Desktop peer 改为 `codex-webrtc-v1` Driver；保持已验证 call-create wire 与 SDP 修复。现有 fixtures 全绿；voice invalid settings 可见失败；intelligence capability 按 WP1 证据开/关。

### WP6 — Gemini 实现

```text
packages/voice/src/gemini-live-adapter.ts
packages/voice/src/gemini-live-schema.ts
packages/voice/src/gemini-live-adapter.test.ts
apps/desktop/src/live/media/gemini-live-driver.ts
apps/desktop/src/live/media/gemini-live-codec.ts
apps/desktop/src/live/media/gemini-live-events.ts
apps/desktop/src/live/media/gemini-live-driver.test.ts
```

实现 constrained token、固定 endpoint、setup、PCM、audio playback、VAD/barge-in、function call、tool response、context append、resumption/GoAway、close。测试使用去敏 fixtures；网络真测只进手工 evidence，不进默认 CI。

### WP7 — Desktop Controller 与设置 UI

`use-live-call.ts` 已超过 400 行，扩展前拆分：

```text
apps/desktop/src/live/use-live-call.ts
apps/desktop/src/live/use-live-start.ts
apps/desktop/src/live/live-owner-actions.ts
apps/desktop/src/live/live-status-projection.ts
apps/desktop/src/live/media/live-media-driver-registry.ts
apps/desktop/src/live/live-settings.tsx
```

实现 Driver registry、动态 schema、Provider auth UI、两渠道 copy、local/Host state 合并、Retry/Dismiss、a11y。测试未知 Driver、未 ready Provider、切换 Provider 结束 call、API key save/replace/clear、失败顺序、owner action target、keyboard/screen reader state。

### WP8 — Transport 与安全硬化

- start bootstrap owner-only、non-journal、non-replay；
- `voice/live-owner-action` audience；
- remote start 拒绝；
- error redaction 覆盖 token query、API key、SDP；
- start/delegation/reconnect budget；
- dispose/logout/key clear 的确定性 cleanup。

测试序列化泄漏扫描、HostPush journal 无 `sdp/token/authorization/apiKey`、跨 device 控制拒绝。

### WP9 — 端到端与发布门禁

执行 §11 的自动化和 native matrix。两家都通过才把本文状态改为 Implemented；只通过 Codex 不能声称“首期双渠道完成”。

---

## 11. 验收矩阵

### 11.1 自动化验收

| ID | 验收 |
|----|------|
| REG-1 | Host registry 与 Desktop Driver registry 分离；重复 id 启动失败 |
| REG-2 | 新 Provider 只有在 wire 完全相同时才可复用 Driver；未知 Driver 报 unsupported |
| CFG-1 | schema default/options/required 由 Host 校验，Desktop 按封闭控件渲染 |
| CFG-2 | Codex/Gemini 设置分开持久化；切换不丢另一家设置 |
| CFG-3 | 旧 `speech.live.voice` 迁移读取；非法旧值可见失败 |
| CFG-4 | Gemini key save/replace/clear；keyConfigured 派生；config 无 key/boolean |
| CALL-1 | 同 Host 并发 start 只成功一路 |
| CALL-2 | 同 owner+key 返回同 call；跨 owner 不复用；手动 Retry 新 key |
| CALL-3 | stale revision 返回 conflict，且不改变 call |
| CALL-4 | start failure 的真实 code 在 release/null 前到达 UI |
| CALL-5 | logout、clear key、settings change、dispose 都清媒体和 slot |
| DEL-1 | 两家委派都生成 `voice-delegation` 用户轮并走现有权限 |
| DEL-2 | duplicate id 不产生第二轮；忙会话默认 steer，steer 失败才可见排队 |
| DEL-3 | 连续两次委派的 message/queue/run/result 不串线 |
| DEL-4 | Host ack 前 Driver 不向上游宣称已交付 |
| DEL-5 | 挂断后已开工/已排队工作继续，结果留 transcript |
| SEC-1 | 长期 credential 永不进 Desktop；Gemini token 只在 owner start response |
| SEC-2 | status/push/journal/log 无 SDP、token、API key、原始上游 body |
| ISO-1 | Provider wire 仅存在于对应 adapter/Driver/fixture；共用 UI 只消费产品事件 |
| A11Y-1 | Composer/Live Bar/失败恢复可键盘和读屏操作，控件 ≥44px |

### 11.2 Native Desktop matrix

每家至少执行：

1. 首次麦权限允许、拒绝、拒绝后恢复。
2. 开始、听、说、barge-in、mute/unmute、挂断。
3. 上游 401/403/429、超时、协议错误、中途断开。
4. 会话空闲委派、忙会话 steer（失败才排队）、权限等待、Run 成功/失败；filler 拒绝。
5. 通话中切换其它会话；Live Bar 仍明确绑定原会话。
6. 通话中修改当前 Provider 设置/凭证，确定性结束。
7. 快速 start/end、重复 end、Host 退出、renderer reload。
8. 长通话覆盖 Gemini resumption/GoAway 与 Codex reconnect 预算。

### 11.3 验证命令

```bash
pnpm test:architecture
pnpm --filter @piwin/contracts test
pnpm --filter @piwin/contracts typecheck
pnpm --filter @piwin/voice test
pnpm --filter @piwin/voice typecheck
pnpm --filter @piwin/host-runtime test
pnpm --filter @piwin/host-runtime typecheck
pnpm --filter @piwin/host-server test
pnpm --filter @piwin/host-transport test
pnpm --filter @piwin/desktop test
pnpm --filter @piwin/desktop typecheck
pnpm typecheck
pnpm test
```

最后执行 source line-count 检查；任何 `.ts/.tsx/.rs/.css` 不得超过 1000 行，接近或超过 400 行的新增职责先拆分。

---

## 12. 迁移、回滚与完成定义

### 12.1 迁移

1. 读旧 `speech.live.voice`，不立即写盘。
2. 第一次保存 Live 设置时写 `providerId = openai-codex` 和 `byProvider.openai-codex.voice`。
3. 保留旧字段一个兼容周期；读取优先级为 `byProvider` > legacy。
4. 现有 Codex call 行为先通过 WP5 回归，再启用 Gemini，避免两条链路同时重写。

### 12.2 回滚

- Provider 注册可由 build/runtime capability 禁用；禁用不删除用户配置或 key。
- Gemini Go/No-go 失败时不登记 `google-gemini`，设置页不展示不可用假入口。
- Codex intelligence probe 失败时仅隐藏该字段，Codex 基础通话继续。
- 不回滚公共多渠道 config shape；否则会破坏已保存的 Provider settings。
- 回滚/禁用 Provider 前先结束使用该 Provider 的 call；已接纳 Run 继续。

### 12.3 Done

- [ ] WP0 文档权威一致，没有 Codex-only 旧决策与本实现冲突。
- [ ] WP1 两家 Go 证据存在且去敏；Codex intelligence capability 有明确结果。
- [ ] contracts 所有实现者更新，typecheck 绿色。
- [ ] 两个 registry、settings、secret、coordinator、两家 adapter/Driver 全部有单测。
- [ ] 自动化验收与 native matrix 通过。
- [ ] 泄漏扫描确认长期凭证、短时令牌、SDP、原始报文未持久化。
- [ ] 失败顺序、owner、revision、幂等、delegation ledger 有回归测试。
- [ ] 无新增跨层依赖、无 Pi import 进入 app/voice、无文件超过 1000 行。
- [ ] 用户文案准确区分 Codex 套餐能力与 Gemini API 额度/Preview 风险。
