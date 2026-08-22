# 运行中暂停/恢复实现计划

| Field | Value |
|---|---|
| Status | Implemented — cooperative checkpoint pause |
| Date | 2026-08-10 |
| Scope | foreground session turn；Desktop/CLI/Mobile 共用 Host 协议 |
| Related | ADR 0015、ADR 0012、ADR 0040、`docs/specs/runtime-refactor.md` |

## 1. 结论与实现语义

当前 Pi `AgentSession` 公开 API 提供 `prompt`、`steer`、`followUp` 和
`abort`，没有原生 `pause/resume`。因此 piwin 不能在不 fork Pi 的前提下冻结
当前 provider 请求，并从同一个 token 位置继续。

本计划实现的是 **可恢复检查点暂停（cooperative checkpoint pause）**（Host/CLI
协议能力）：

1. 调用 `session/pause` 后，Host 立即关闭该 Run 的新工作 admission。
2. 模型生成阶段通过现有 abort/cancellation 路径停止当前 provider 请求；
   当前已生成的 assistant 文本和已完成的工具结果保留在 Transcript。
3. 工具正在执行时不做回滚。默认等待当前工具到达安全边界；若工具本身支持
   AbortSignal，停止仍然是 best-effort，不能声称撤销已经产生的文件、网络或
   进程副作用。
4. Run 以 `interrupted + terminalCode: 'paused'` 结束，并保存一个可恢复检查点。
   这保持现有 Run 的终态不可变规则；恢复会创建新的 Run，而不是复活旧 Run。
5. 调用 `session/resume-run` 后，Host 在同一 product session 中发起新的
   continuation Run。continuation 会读取原始用户消息、已保存的部分回答和工具
   状态，要求模型先检查当前状态，再继续未完成工作。

**Desktop 产品 UX（2026-08-21）**：主 composer 运行中只提供 **一个 Stop**
（与 Cursor / Claude Code 一致），走 `session/abort`。不要把本协议的 pause/
resume 做成第二颗中断按钮，也不要「点暂停 / Esc 停止」双语义。详见
ADR 0042 Product UI。

这不是“逐 token 精确续传”，而是“保留上下文后继续执行”。未来 Pi 提供原生
pause/resume 后，可以在相同 HostCommand 语义下替换 backend 实现。

## 2. 不纳入第一版的范围

- 不 fork、patch 或直接修改 Pi core。
- 不把 Host egress 的 `pauseClient()` 当成 Agent 暂停；那只是暂停网络推送，
  Agent 仍会继续执行。
- 不暂停 Plan/subagent 整棵 Run tree。第一版只支持没有活动子 Run 的前台
  `session-turn`；有子 Run 时返回稳定的 `pause-unsupported-active-descendants`。
- 不提供工具副作用回滚、进程快照、provider HTTP 流恢复或跨 Host 的执行迁移。
- 不把 `session/resume` 改成运行恢复；它继续表示历史/Transcript 恢复。

## 3. 状态与协议设计

### 3.1 Run 生命周期

```text
running/tool-running/waiting-permission
                 │ session/pause
                 ▼
              pausing
                 │ 当前操作完成/取消，checkpoint 持久化成功
                 ▼
  interrupted + terminalCode=paused + resumeCheckpointId
                 │ session/resume-run
                 ▼
        新 runId: queued → running → ...
```

采用终态 `interrupted` 加 `terminalCode: 'paused'`，而不是把 `paused` 做成新的
非终态。这样可以复用 RunRegistry 的 join、重启和 late-event 规则：Host 重启
不会悄悄恢复执行，用户必须显式点击继续。

新增/调整 contracts：

- `SessionRunPhase`：增加 `pausing`。
- `SessionRunTerminalCode` / `RunTerminalCode`：增加 `paused`。
- `SessionRunOutcome`：增加 `paused`，用于 Transcript/UI 投影。
- `ExecutionRunRecord`：增加可选的 `resumeCheckpointId`（只暴露不敏感的
  checkpoint id，不暴露 prompt、secret 或绝对路径）。
- 新增 `SessionPauseCheckpoint`，至少包含：
  `checkpointId`、`sessionId`、`sourceRunId`、`runtimeGenerationId?`、
  `createdAt`、`sourceUserMessageId?`、`lastAssistantMessageId?`、
  `transcriptRevision`、`status`。

HostCommand 增加：

```ts
| { id?: string; type: 'session/pause'; sessionId: string; runId?: string }
| { id?: string; type: 'session/resume-run'; sessionId: string; checkpointId?: string }
```

`session/pause` 和 `session/resume-run` 都是 quick-ack 控制命令；响应只确认
请求已接受/拒绝，最终状态通过现有 `run/updated` 和 `run/terminal` 推送到达。
`session/resume-run` 返回新的 `runId` 和 `checkpointId`。

不新增伪造的 `AgentEvent`。`run/terminal` 携带 `status: 'interrupted'`、
`terminalCode: 'paused'` 和 `resumeCheckpointId`；产品状态仍通过 RunHostPush
表达。

### 3.2 命令互斥规则

| 命令 | 规则 |
|---|---|
| `session/pause` | 只匹配当前 `runId`；重复暂停幂等返回；无活动 Run 返回 `no-active-run` |
| `session/abort` | 仍是不可恢复 Stop；若只有 paused checkpoint，则清理 checkpoint |
| `session/resume-run` | 只接受当前 session 的 active checkpoint；重复 resume 拒绝或返回已消费结果 |
| `session/prompt` | 有 paused checkpoint 时返回 `paused-run`，避免用户无意间丢失恢复点 |
| `session/steer` / `follow_up` | `pausing` 或 paused 时拒绝；恢复后按原语义工作 |

所有控制命令加入 Desktop、CLI、Host Server command lane 和远端协议的 control
lane，确保不会排在正在执行的 `session/prompt` 后面。

## 4. 持久化检查点

### 4.1 所有权

检查点属于产品 session 数据，由 `@piwin/session` 持久化；不属于 Pi JSONL，
也不属于 Desktop 本地状态。

在现有 `transcript.sqlite3` 增加一个小型 `pause_checkpoint` 表，保持“一次
session 最多一个 active checkpoint”。旧 JSON Transcript 在第一次暂停时沿用
现有迁移/打开路径；不能写入时必须返回错误并保持原 Run 可 Stop，不能静默报告
暂停成功。

不保存：API key、完整 provider 配置、base64、未脱敏环境变量、任意 OS handle。
保存的只是 session/run/message/cursor 引用以及恢复所需的安全模型快照引用。

### 4.2 Session package API

为 `SessionTranscriptStore` 增加聚焦的 checkpoint 操作：

- `getActivePauseCheckpoint()`
- `createPauseCheckpoint(input)`，同一 source Run 幂等
- `consumePauseCheckpoint(checkpointId)`
- `clearPauseCheckpoint(checkpointId)`

写入顺序必须是：先 flush 当前 Transcript，再写 checkpoint，再 terminalize
Run。任何一步失败都不能发出带 `resumeCheckpointId` 的 paused terminal。

## 5. Host Runtime 实现顺序

### Phase 0 — 行为 Spike

- 用现有 `MockSession`、真实 SDK、RPC worker 各跑一次 `abort → prompt`。
- 确认 abort 后 partial assistant、tool card、queued steer/follow-up 的实际
  事件和 Transcript 行为。
- 若 Pi abort 会保留 queued message，增加 agent-host 内部的
  `clearPendingInput` 适配端口；不要让 queued user input 在恢复时重复执行。
- 产出 fixture 和结论，作为后续 SDK/RPC conformance 的基线。

### Phase 1 — Contracts、RunRegistry、Session store

- 先更新 `packages/contracts`，再让所有实现者通过 typecheck。
- 在 `run-abort-reason.ts` 增加 `pause-requested`，与 `user-stop` 分开，防止
  paused 被错误地 terminalize 成 cancelled。
- 在 `RunRegistry` 增加显式 `requestPause()` / `isPauseRequested()`，复用
  admission close、AbortSignal 和 revision/push 机制；不要让 UI 直接写 Run 状态。
- 增加 `pausing` phase、paused terminal code 和 checkpoint 字段。
- 在 `packages/session` 实现 SQLite checkpoint CRUD、幂等、过期/已消费校验及
  legacy-session 测试。

### Phase 2 — Foreground Host command path

- 在 `session-live-commands.ts` 增加 `session/pause` 与 `session/resume-run`。
- `pause` 流程：校验 session/run ownership → 检查无活动 descendants → 标记
  `pausing` → 处理 permission/UI wait → 请求当前 Agent/tool 操作停止或等待
  安全边界 → flush recorder → 写 checkpoint → stop run-lifetime Jobs →
  `terminate(..., 'interrupted', 'paused')`。
- `finalizePausedRun` 与 `finalizeCancelledRun` 分开，不能通过复制一份 cleanup
  逻辑造成两个终态 authority。共享底层 join/flush helper。
- `resume-run` 流程：校验 checkpoint → 消费前不创建新 Run → 创建新的
  foreground Run → 激活/重建同一 session runtime → 恢复有限 product history →
  发起内部 continuation prompt → 只有新 Run 成功接受后消费 checkpoint。
- 新 Run 接受失败时 checkpoint 保留；只有成功接受且新 Run 已绑定 runtime 后才
  标记 consumed，避免 provider 配置错误导致恢复点丢失。
- 继续 prompt 必须走现有 PromptPreparation、permission、tool routing 和
  generation identity；不能从 `agent-host` 绕过 HostRuntime 直接调用 Pi。

### Phase 3 — SDK/RPC parity

- 不新增 `session/pause` 的 Pi-native worker frame；现有 abort/control lane
  足以实现 checkpoint 版本。
- SDK 和 RPC 都使用同一个 Host-owned pause coordinator：SDK 走
  `SessionHandle.abort()`，RPC 走现有 `turn/cancel` / `session/abort`。
- 新的 continuation 作为普通新 turn 经过同一 `session/prompt` backend path，
  带新的 product `runId` 和当前 `runtimeGenerationId`。
- 更新 worker late-frame 过滤：旧 paused Run 的 `turn/completed`、tool result
  不能覆盖 paused terminal 或新 Run 的 transcript。
- 将 pause/resume、tool cancellation、permission wait、partial transcript 和
  worker crash 加入 SDK/worker 参数化 conformance suite。

### Phase 4 — Desktop、CLI、Mobile

- `use-session-actions` 增加 `handlePause`、`handleResumeRun`，并保留现有
  `handleAbort` 的 Stop 语义。
- **Desktop composer（产品 UX）**：运行中只显示 **一个 Stop**，对齐 Cursor /
  Claude Code。禁止 Pause+Stop 双按钮，禁止「点击=暂停 / Esc=停止」双语义。
  `session/pause` / `session/resume-run` 留给 CLI 与 Host 协议，不进 composer
  第二中断控件。
- chat reducer 仍投影 Host 的 `paused` terminal（CLI/恢复路径）；Desktop 主路径
  以 Stop/`session/abort` 为准。
- CLI 增加 `session pause <sessionId>`、`session resume-run <sessionId>`，交互式
  chat 也接入同一 Host commands；如果暂时没有快捷键，必须在 CLI help 中明确
  显示命令，而不是只做 Desktop 功能。
- Mobile 复用相同命令和 push projection；不能另建 Agent loop。

### Phase 5 — ADR、可观测性与删除检查

- 新增 ADR（建议 `docs/adr/0042-session-pause-as-resumable-checkpoint.md`），
  记录“checkpoint pause 而非精确 token pause”的决定、工具副作用边界和未来
  Pi native pause 的替换点。
- `host/status` capability matrix 增加 `sessionPause`，只有 contracts、Host、
  客户端和测试全部上线后才报告 true。
- 对 pause 请求、等待安全边界、checkpoint 创建失败、resume 失败记录结构化
  host log；严禁记录 prompt secret 或 provider auth。
- 删除所有只在 UI 维护 paused 标记的临时代码；最终 authority 必须是
  RunRegistry + session checkpoint store。

## 6. 预计涉及文件/包

```text
packages/contracts/
  src/host.ts
  src/run.ts
  src/ipc.ts
  src/session-runtime.ts

packages/session/
  src/transcript-store.ts
  src/pause-checkpoint-store.ts       # 如现有 store 文件过大则拆分

packages/host-runtime/
  src/run-registry.ts
  src/run-abort-reason.ts
  src/commands/session-live-commands.ts
  src/host-runtime.ts
  src/store-transcript-recorder.ts
  src/session-pause-coordinator.ts    # 仅在职责超过 command handler 时新增

packages/agent-host/
  src/backends/*
  src/rpc-sdk-worker-client.ts
  src/rpc/worker-session-runtime.ts
  src/rpc-sdk-worker-protocol.ts      # 仅补 conformance/清理队列所需端口

apps/desktop/
  src/hooks/use-session-actions.ts
  src/composer-dock.tsx
  src/chat-reducer.ts
  src/host-client-mock.ts

apps/cli/、apps/mobile/
  Host command/lane、状态投影和交互入口

docs/adr/0042-session-pause-as-resumable-checkpoint.md
```

实际实现前先以 `rg` 重新确认文件职责；不为了暂停功能把新的跨域逻辑塞入
`host-runtime.ts` God module。

## 7. 测试与验收

### Contracts / pure logic

- paused terminal/outcome/code 类型覆盖所有 implementer。
- pause reason 不能被 `isRunAbortReason` 误判为 user-stop。
- RunRegistry：重复 pause、run mismatch、late completion、terminal immutability。
- checkpoint：幂等创建、单 active checkpoint、消费失败保留、重启读取、损坏数据
  fail closed。

### Host integration

- mock streaming：暂停后 partial text 保留，后续旧 delta 不再进入 UI/transcript。
- model connecting / waiting-first-token / streaming 各阶段暂停。
- tool-running：等待安全边界；明确测试 AbortSignal 工具和不可中断工具。
- permission/UI wait：不会遗留 pending request，也不会误执行工具。
- resume：同 session、新 runId、SDK/RPC 都能继续；cold runtime 也能继续。
- resume 接受前失败、重复 resume、stale checkpoint、普通 prompt 与 paused
  checkpoint 冲突。
- pause/abort 并发、pause/resume 并发、Host shutdown、worker crash、late frame。
- run-lifetime Job 在 paused terminal 后按明确 reason 清理，且不会停止独立
  session/host lifetime Job。

### Client / transport

- Desktop reducer/component：pausing/paused/continue/start-new 状态和 partial
  assistant 保留。
- `host-serve-command-lane`、Desktop HostClient、remote protocol 控制命令不会
  排在 prompt 后面。
- CLI、Mobile 的同一 Host push 可恢复，不维护本地独立状态机。

### Required verification

```bash
pnpm typecheck
pnpm test
pnpm --filter @piwin/contracts test
pnpm --filter @piwin/session test
pnpm --filter @piwin/host-runtime test
pnpm --filter @piwin/agent-host test
```

并运行现有 Host JSONL smoke，新增一条 `prompt → pause → terminal(paused) →
resume-run → terminal(completed)` 场景。

## 8. Definition of Done

- Pause/Continue 在 **CLI 与 Host 协议**上语义一致；Desktop 主路径是 **一个 Stop**。
- Stop（Desktop 点击与 Esc）是不可恢复取消（`session/abort`）；`session/resume`
  仍然只是历史恢复。
- paused Run 的 partial transcript、checkpoint 和新 Run correlation 可跨
  Host reconnect/cold runtime 使用，且不会重复执行旧 tool result。
- SDK/RPC conformance 通过，旧 generation 的 late events 不会污染新 Run。
- 不宣称精确 token pause；文档明确检查点暂停是 Host 能力，不是 Desktop 双中断 UX。
- `pnpm typecheck`、触及包的测试和 Host JSONL smoke 全部通过，public exports
  有意更新，新增 ADR 已落盘。

## 9. 后续增强：原生 Pause capability

如果未来 Pi 暴露真正的 `pause()` / `resume()` 或可序列化 Agent loop checkpoint：

1. 在 `@piwin/agent-host` 增加可选 backend capability，不改变 HostCommand。
2. SDK/RPC conformance 增加 exact-pause 分支。
3. Host 根据 capability 选择 native pause；不支持时继续使用 checkpoint fallback。
4. 只有经过 provider、工具、权限和 worker crash 测试后，才把 UI 文案从“检查点
   暂停”升级为“精确暂停”。

## 10. 实施记录（2026-08-10）

- Phase 0–1：已完成 contracts、RunRegistry、`pause-requested` abort reason 和
  SQLite `pause_checkpoint` 持久化；checkpoint 创建、幂等、消费、清理和重启读取
  均有测试。
- Phase 2–3：已完成 Host foreground pause/resume command path；SDK 与 RPC 通过同一
  Host coordinator 和参数化 smoke，旧 Run 以 `interrupted/paused` 终止，新 Run
  使用内部 continuation prompt。
- Phase 4–5：已接入 Host pause/resume 协议、CLI 命令、Mobile/Host capability；
  Desktop 主 composer **只保留 Stop**（与 Cursor/Claude Code 一致）。检查点
  pause 不作为 Desktop 第二中断按钮；`session/abort` 为 Desktop 点击与 Esc 的
  同一条不可恢复中断路径。
- 2026-08-21 修正：禁止把 Host 的 pause/abort 两套命令映射成 Desktop「暂停 vs
  停止」双按钮或「点暂停 / Esc 停止」双语义（见 ADR 0042 Product UI）。
- 关键验证：`pnpm typecheck` 通过；Contracts、Session、Host Runtime、Host Server、
  CLI 和 Desktop 相关定向测试通过；SDK/RPC `prompt → pause → resume-run` smoke
  通过。
- 全量 `pnpm test` 在 Desktop 的 5 个非暂停相关 renderer/document 内容用例上失败，
  因此不将全量测试标记为完全通过；暂停功能相关定向测试均通过，失败项未改动。
