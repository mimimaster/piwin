# 会话上下文环：重启 / 重开后必须显示

日期：2026-09-01。状态：S1–S6 代码已落地；自动化验收见 §8；手工 UI 矩阵未执行；全仓 `pnpm typecheck` 被无关 `@piwin/host-server` `ws` 类型错误阻塞。  
上游：[ADR 0067](../adr/0067-session-context-telemetry.md)、[2026-08-30 占用遥测修复](./2026-08-30-context-usage-repair.md) §2.2。  
问题来源：用户重开历史会话或重启 Desktop 后 composer 上下文环消失。

ADR 0067 的「首响应前隐藏」仍然成立。本文记录已验证的占用权威规则：Host 严格同边界 current occupancy 提升，与 Desktop presentation-only stale fallback 分离。

## 1. 目标、范围与非目标

目标：有过可展示助手响应、且 Host 曾确认过占用的会话，在 **重启 Host、重开会话、A→B→A 切回** 后立刻显示上下文环；数值为该上下文版本的上次确认占用（measured 或 estimated），不是 0、不是账单 ledger。`runtime-generation-mismatch` 不得把旧值写成 Host 当前 occupancy；Desktop 仅在该精确场景以待测量文案展示 stale 数字。

包含：contracts 权威提升规则、Host merge / publisher / hydrate / 污染修复、`session/resume` / `session/context-get`、Desktop selector 展示降级、切会话 warm 与 offline、派生会话 occupancy 隔离。

不包含：改 Pi core、新 tokenizer、从 usage ledger 反推占用、为 `never-sampled` 会话编造百分比、重做用量统计页、分类 breakdown、缓存 TTL、改 compact/branch 失效语义。

## 2. 已核实事实（不要再当「没落盘」修）

权威已经在落盘。`session/resume` 已返回 `contextSnapshot`；Desktop `use-session-resume` 已 `context-telemetry/snapshot` hydrate。

| 层 | 现状 |
| --- | --- |
| 存储 | `transcript.sqlite3.session_context_state` 存完整 `SessionContextSnapshot` |
| Host | `session-context-coordinator.getSnapshot` hydrate 磁盘行（先 repair 再 settle）；resume / context-get 走这条路径 |
| 客户端 | 环只吃 `selectContextRingView`；当前 `occupancy.kind === 'known'` 显示为 current；仅精确 mismatch 可 presentation-only 读 `lastConfirmed` |
| `lastConfirmed` | 写入快照。Host 只在 §4.1 提升为当前 occupancy。Desktop 只在 §4.2 展示，不改 snapshot |

健康会话（idle + known，同边界）落盘完整，resume 后显示 current ring。用户体感「重开就没环」主要来自脏 unknown 行（idle + `waiting-for-response` + 有 `lastConfirmed`）以及被错误提升的跨 leaf known 行。

## 3. 根因

`applyRunStarted` 把当前 occupancy 清成 `unknown(waiting-for-response)`，把上一轮 known 挪到 `lastConfirmed`。这是对的：新 Run 首响应前必须藏环。

后续两条路径没有把 known 写回来：

1. **采样发生在首响应证据之前。** `applyMeasurement` 在 `phase === 'waiting-response' && !currentRunHasResponse` 时只更新 `lastConfirmed`，occupancy 仍 unknown。证据翻开后必须再走 contracts 提升，否则 terminal 后仍可能留下 idle + `waiting-for-response`。
2. **进程在 Run 中途退出。** 磁盘留下 idle + `waiting-for-response` + 有 `lastConfirmed`。hydrate 必须按 §4.1 结算，不能原样交给 UI 当「永远隐藏」。

切会话：离开的会话 stash 进 `warmBySessionId`；切回必须立即提回 displayed。`selectSession` 不得把 `disconnected` 置 false。

旧补丁把 `runtime-generation-mismatch`（含 moved leaf）提升为当前 known 并落盘。那是错误权威，不是产品规则。现行规则：Host 永不提升 mismatch；冷 hydrate 按 §4.7 把可识别污染行降回 unknown；Desktop 按 §4.2 展示 stale。

## 4. 产品规则（已验证，实现不得再解释）

Host 当前权威与 Desktop 展示降级是两条路径。contracts `canPromoteLastConfirmed` / `promoteLastConfirmed` 是 Host 当前 occupancy 门；Desktop 可对 displayed 做同规则浅投影但不写回 Host。mismatch 不可提升，不得写成 known snapshot。

### 4.1 Host：何时把 `lastConfirmed` 提升为当前 occupancy

全部成立才提升：

- `phase === 'idle'`
- `occupancy.kind === 'unknown'` 且 reason 为 `waiting-for-response` 或 `run-ended-without-response`
- `lastConfirmed` 存在且 `occupancy.kind === 'known'`
- 至少一条证据：`currentRunHasResponse || historyHasDisplayableResponse`
- 严格 `contextBoundaryCompatible(lastConfirmed.contextBoundary, snapshot.contextBoundary)`（active leaf 计入）

提升后：

- `occupancy = lastConfirmed.occupancy`（不改 quality / basis / sampledAt）
- `lastConfirmed` 保留
- **不** bump `contextVersion`，**不**改 phase
- hydrate / 写路径 CAS 落盘后成为权威；`session/resume` / `session/context-get` 返回该快照

**永不提升**（即使有 `lastConfirmed`）：

- `runtime-generation-mismatch`（含 leaf 已变）
- abort / error
- compact-unmeasured
- store-unavailable
- branch / schema invalidated
- empty
- live `waiting-response` 且尚无当前 Run 首响应
- model / compaction / capability / seed / stamped leaf 不兼容

禁止：用 usage ledger 拼占用；用 transcript 字符数估算填环；把 `lastConfirmed` 在 waiting-response 无证据时画成当前环。

### 4.2 Desktop：presentation-only stale fallback

优先级：

1. 当前 snapshot 经严格 `promoteLastConfirmed` 后 occupancy known 且 phase 不是 `invalidated`：显示为 **current**（「已确认」/「估算」）。
2. 否则，仅在下列条件全部成立时显示 `lastConfirmed`，`occupancySource: 'last-confirmed'`：
   - `phase === 'invalidated'`
   - unknown reason **严格等于** `runtime-generation-mismatch`
   - `historyHasDisplayableResponse`
   - 没有 live waiting-response 首响应门槛
   - model、compaction boundary、capability fingerprint、seed fingerprint 兼容；只允许 active leaf 不同
3. 其它 unknown / invalidated / unavailable 全部不使用 `lastConfirmed`。

第 2 类时：

- snapshot 本身仍是 unknown/invalidated，不生成伪 known snapshot，不改 phase
- 文案必须是「上次确认，当前上下文待测量」 / 「Last confirmed; current context pending measurement」，不能显示普通「已确认 / Confirmed」
- compact / 模型切换预算不得消费这个值

### 4.3 必须继续隐藏

- 空草稿、`never-sampled` 且无合格展示占用
- 当前 Run 已开始、尚无文本/思考/模型 tool
- abort / error、compact-unmeasured、store-unavailable、branch/schema invalidated（即使带 `lastConfirmed`）
- model / compaction / capability / seed 不兼容
- Host 无 `contextTelemetryVersion: 1`
- compact 成功但占用 unknown（沿用「已压缩，用量待更新」）

### 4.4 Publisher 持久语义

`snapshotPersistEqual` 比较持久状态，不是「画面看起来一样」。必须比较：`sessionId`、`contextVersion`、`phase`、`runId`、`runtimeGenerationId`、occupancy（含 `sampledAt`）、`contextBoundary`、`coveredMessageId`、`coveredRequestId`、responseEvidence 标志与 `evidenceMessageId`、`lastConfirmed`（occupancy、boundary、`sampledAt`）。仅可忽略 `revision` / `updatedAt`。

`lastConfirmed` 单独变化必须 persist。首响应前采样写入的 `lastConfirmed` 不得被丢弃。

### 4.5 派生会话

`seedDerivedSessionContextState`：目标 occupancy 固定 `unknown(derived-session)`，直到针对目标 active path 有新测量。

- 可以复制 `historyHasDisplayableResponse`
- 不得复制 occupancy、`lastConfirmed`、live owner（`runId` / `runtimeGenerationId`）、源 `revision` / `contextVersion`
- 目标自己的 `sessionId`，`revision=1`，`contextVersion=1`，active leaf 用目标路径

截断 fork（目标 leaf 早于源末尾）同样 unknown，不继承源末尾数字。

### 4.6 Warm / offline

- A→B→A：若 A 在 warm 中，切回立即恢复 `displayed` 与 `lastRequestUsage`
- `selectSession` 不把 `disconnected` 置 false；只有 `reconnect` 恢复在线
- 离线时切会话：warm 数据若显示必须标 offline；不得偷偷变回在线
- 切到无 warm 的会话：`displayed` / `lastRequestUsage` 为 null，不串用旧会话
- HostInstance 变化清空该 Host 的 warm

### 4.7 冷 hydrate：旧污染行修复

仅当全部成立才自动修复（旧补丁特有的 idle+known 跨 leaf 错误提升）：

- `phase === 'idle'`
- 当前 `occupancy.kind === 'known'`
- `lastConfirmed` 存在，且当前 occupancy 与 `lastConfirmed.occupancy` 完整相等（含 `sampledAt`）
- 无 `runId`，`currentRunHasResponse === false`，`historyHasDisplayableResponse === true`
- 当前 `contextBoundary.activeLeafMessageId` 非空，且不同于 `lastConfirmed` 的 leaf
- `coveredMessageId === lastConfirmed.contextBoundary.activeLeafMessageId`
- `coveredMessageId !== contextBoundary.activeLeafMessageId`
- 除 active leaf 外的 model / compaction / capability / seed 兼容

修复结果：

- `phase = 'invalidated'`
- `occupancy = unknown(runtime-generation-mismatch)`
- 保留当前 `contextBoundary`、`contextVersion`、`runtimeGenerationId` 和 `lastConfirmed`
- 清除过时的 `coveredMessageId` / `coveredRequestId`
- 不 bump `contextVersion`；CAS 写入获得新 revision
- 只在 hydrate persisted row 时执行；修复后再 hydrate 幂等 no-op
- 随后 settle 使用 §4.1，mismatch 不可提升

不扫描全库、不升 schema、不按「leaf 不同」单一条件改写。正常当前测量（`coveredMessageId === current leaf`）不得修复。

### 4.8 文案与预算

- current known：按 occupancy quality 显示「已确认」或「估算」
- stale lastConfirmed：§4.2 待测量文案，不得伪装成 Confirmed current
- `readContextOccupiedTokens` 只读 `occupancy.kind === 'known'`；unknown 不是 0，也不回退 `lastConfirmed`

## 5. 设计（与实现对齐）

- contracts：`canPromoteLastConfirmed` / `promoteLastConfirmed`；`PROMOTABLE_UNKNOWN_REASONS` 仅 `waiting-for-response` 与 `run-ended-without-response`；`ringOccupancyFromSnapshot` 只返回当前 known。
- Host merge：证据 / terminal 走 contracts 提升；publisher 用 `snapshotPersistEqual`。
- Host hydrate：`repairPersistedCrossLeafKnownPollution` 然后 `settlePersistedOccupancy`。
- Desktop selector：current vs `occupancySource: 'last-confirmed'`；不写回 Host。
- Desktop reducer：warm 回填；`selectSession` 保留 `disconnected`。
- session store：派生会话 unknown(derived-session)。

实施分阶段见 [subagent plan](../plans/2026-09-01-session-context-telemetry-repair-subagent-plan.md) S1–S6。本文旧 WP 列表不再作为实现入口。

## 6. 手工冒烟（本 agent 未执行）

1. 健康历史会话：重启/重开立即显示 current ring。
2. 同边界 dirty idle：恢复并持久化 known。
3. runtime generation mismatch：Host/context-get 保持 unknown/invalidated；Desktop 显示 stale ring 和明确待测量文案。
4. 新响应产生匹配测量后：stale 标识消失，改为 current。
5. branch / compact-unmeasured / abort / store unavailable：不显示旧数字。
6. A→B→A 在线立即恢复；离线切换仍显示 offline。
7. fork 到较早 assistant：目标 occupancy unknown，不继承源末尾数值。
8. compact/model-switch 的预算读取不使用 stale lastConfirmed。

## 7. 完成定义

- S1–S6 代码落地；S7 定向测试与四包 typecheck 绿（§8）
- 架构边界检查绿
- 文档区分 Host current authority 与 Desktop presentation-only stale fallback
- 不从 ledger 恢复占用
- 全仓 typecheck 与手工矩阵见 §9 未完成项

## 8. 自动化验收记录（S7，2026-09-01）

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @piwin/contracts exec vitest run src/context-telemetry.test.ts` | 13 passed |
| `pnpm --filter @piwin/session exec vitest run src/session-context-state-store.test.ts` | 9 passed |
| `pnpm --filter @piwin/host-runtime exec vitest run` merge/publish/repair/coordinator/context-get | 36 passed (5 files) |
| `pnpm --filter @piwin/desktop exec vitest run` selector/reducer/ring | 42 passed (3 files) |
| `pnpm --filter @piwin/contracts typecheck` | green |
| `pnpm --filter @piwin/session typecheck` | green |
| `pnpm --filter @piwin/host-runtime typecheck` | green |
| `pnpm --filter @piwin/desktop typecheck` | green |
| `pnpm test:architecture` | Package boundaries OK |
| `pnpm typecheck` | **未完成**：`@piwin/host-server` 缺 `ws` 类型声明（与本修复无关，未改） |
| `git diff --check` | clean |

手工矩阵 §6：未执行。
