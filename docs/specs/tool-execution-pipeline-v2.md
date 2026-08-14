# Tool Execution Pipeline V2 Specification

> **Status**: Accepted / Ready for Implementation（实现尚未开始）
> **Scope**: `@piwin/contracts`, `@piwin/host-runtime`；`@piwin/agent-host` 仅架构断言，不改执行权
> **Target Package**: `packages/host-runtime/src/tools/*`
> **Architecture Reference**: `AGENTS.md`, `docs/architecture.md`, ADR 0019, ADR 0024, ADR 0033, ADR 0044, ADR 0050
> **Goal**: 把现有 Permission + Tool Router 执行链升级为单一、可响应取消、防重放、收敛参数/Host authority 时间窗的 Tool Execution Pipeline。判定顺序、错误码、action catalog 以本文为准；不得另造平行 taxonomy。

---

## 0. 本文约束

### 0.1 修订说明

相对初稿，本文锁定以下审查结论：

- Fail-closed 发生在 domain policy **之前**。
- 权限 action 冻结为**现网真实字符串**，不引入 `planning:write` / `notes:mutate` / `browser:interact` 这类平行名字。
- Ledger 在 `prepareArgs` 之后对 canonical args 取指纹；去重键是 `(runId, toolCallId)`。
- Ledger 区分 **runner 尚未启动** 与 **runner 已启动**：前者 abort 可删除重入；后者无论 abort / timeout / late completion 都封存 key，不得再次进入 runner。
- 活跃 Run 的 invocation tombstone 不做 LRU 驱逐；结果 replay cache 同时受条数和字节预算约束。结果被驱逐只允许 fail-closed，不允许重跑。
- Timeout 使用 deadline race 返回；AbortSignal 只负责协作取消。后台 runner 不响应 abort 时仍由 ledger 托管到实际 settle，不宣称已被杀死。
- `SessionHostToolExecutionPort` 的 pending / commit / rollback / restrict 世代协议保持不变。
- Approval 是现网记忆模型的**行为等价搬迁**，不是通用 `projects.json` 记忆层。
- V2 不把 `ToolPipelineState` 做成新的 HostPush；不把未使用的 `ToolEffect` / `ToolIdempotency` 写进契约。
- `HostToolExecutionSpec` 只包含 V2 真正执行的 `maxDurationMs`；不暴露会被忽略的 sandbox / remote executor 声明。

### 0.2 Non-goals

- 不引入脱离 Blueprint 的全局 ToolRegistry。
- 不改变 MCP 信任边界（ADR 0033）：MCP 不进规则引擎、不弹权限。
- 不在 V2 实现 sandbox / remote executor。
- 不宣称消除文件系统对象级 TOCTOU：symlink/rename 竞态需要 `openat`/no-follow、OS sandbox 或执行器级能力约束；V2 只保证 policy 与 executor 使用同一 canonical args，并在 runner 启动前重验 Host authority/safety。
- 不新增 pipeline 生命周期 HostPush。
- 不把「Allow for project」的 bash / file-write 持久化清单改成 live 读取（现网 gate 也不读；写入路径保持在 `permission/resolve`）。
- 不把 `requestPermission` 的返回值从 `PermissionDecision` 扩成 `ApprovalScope`。
- 不把 image-gen 现网 dummy-host web-fetch hack 扩散到 video-gen。对齐两者的产品策略是独立变更。

### 0.3 行为不变 vs 刻意改变

| 类别 | 处理 |
|---|---|
| Port 世代状态机、toolbox describe/call 分工、trusted/readOnly 短路、session/project 记忆范围 | **行为等价** |
| 未分类副作用默认 `allow`（现网 `unclassified-tool`） | **刻意改为 deny** |
| 审批等待后不重验 generation / run / safety | **刻意补上** |
| 同 `toolCallId` 可重复执行副作用 | **刻意改为 coalescing + replay** |
| subject 构建失败返回 `permission-denied` | **禁止**；保持 `invalid-input` |
| `network:video-gen` 落入 `unclassified-tool` 默认 allow | **刻意改为 catalog 内显式 `allow`**（`legacy-unclassified-allow`）。V2 **不对齐** image-gen 的 web-fetch 规则，避免重构顺带改成弹窗 |
| runner 启动后的 abort 允许同 id 重入 | **禁止**；返回 abort，但 key 保持 sealed，重试必须使用新的 toolCallId |
| 单个 Run 无界增长 invocation metadata | **刻意加 4096 key 硬上限**；超限新 key fail-closed |
| replay result 可无限占内存 | **刻意加 512 条 / 16 MiB 双限**；结果驱逐后保留 tombstone，重复调用 fail-closed 而非重跑 |

### 0.4 实施策略：单路径演进

生产永远只有一条可调用的执行链。禁止「旁边先长一套 Pipeline，再原子切过去」。

1. **先长在现有 `HostToolExecutionRouter.execute` 上**：`prepareArgs` → canonical 校验 → safety → 现有 gate（吃 canonical）→ 执行前重验 → `execute`。
2. **再就地抽出** `ToolPolicyEvaluator` / `ToolApprovalBroker`，Router 改调它们。抽出前后跑同一组 golden cases。
3. **Ledger 单独一阶段**接入同一条 `execute`。未证明重复帧之前，不要为了完整 V2 叙事提前上。
4. `ToolExecutionPipeline` / `GenerationToolSurface` 是抽出与改名，不是第二条 dispatch。

「禁止双路径」= Port 不能同时打到旧 Router 和新 Pipeline。**必须**在唯一的 Router 上逐项接通不变量。

---

## 1. 架构总览与核心设计原则

1. **Authority Boundary 不变**：`SessionHostToolExecutionPort` 仍是唯一入口，校验 session、active `runtimeGenerationId`、run admission、direct manifest、toolbox target。
2. **唯一组合根不变**：`buildSessionHostTools()` 是 `HostToolRegistration[]` 的唯一 Composition Root。
3. **世代执行面冻结**：`GenerationToolSurface` 替换今天的 `CachedTools`，保存冻结 registrations、toolbox targets、冻结 `PermissionRuleSet`、generation 级 pipeline 与 ledger。Port 的 active / pending / committedPrevious 协议不变。
4. **Router 删除，Pipeline 接管一次调用**：删除 `HostToolExecutionRouter`。`ToolExecutionPipeline` 编排 Prepare → Safety → Policy → Approval → Revalidate → Execute → Settle。
5. **参数先规范化，再做权限决策**：`prepareArgs` 产出的 canonical args 是 policy、safety、approval、executor 的唯一输入。executor / `subjectBuilder` 不得再 `resolvePath` 或把 `String(args.path ?? '')` 当成权威路径。
6. **Policy 与 Approval 解耦**：`ToolPolicyEvaluator` 纯函数、零 IO；`ToolApprovalBroker` 负责现网那几条记忆和 HITL。
7. **未知 action Fail-Closed**：任何 action 不在 §3.3 catalog 的工具都在 compose 期拒绝，运行期再兜底 deny；`trusted` / `readOnly` 不能绕过 catalog。非 `trusted`、非 `readOnly` 的注册还必须声明 prepare 与 subject。
8. **跨后端一致**：SDK 与 RPC Worker 都只走 `SessionHostToolExecutionPort`。agent-host 不拥有权限决策，也不执行 Host 副作用。

---

## 2. 整体调用架构

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                               Pi Kernel                                 │
│                     model → tool call → Agent Host                      │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ @piwin/agent-host (Backend Adapter)                                     │
│ - SDK / RPC normalization                                               │
│ - toolCallId normalization                                              │
│ - ToolResult → Pi projection / 120k output bounding                     │
│                                                                         │
│ [DOES NOT OWN PERMISSION DECISIONS OR WORKSPACE SIDE EFFECTS]           │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     │ HostToolExecutionInput
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ SessionHostToolExecutionPort (Authority Boundary)                       │
│                                                                         │
│ 世代协议（保持现网 API，仅把 CachedTools 换成 GenerationToolSurface）：   │
│   registerActiveGeneration / registerPendingGeneration                  │
│   commitPendingGeneration / rollbackCommittedGeneration                 │
│   discardRetiredGeneration / abortPendingGeneration                     │
│   restrictGeneration (direct ∩ toolbox = ∅)                             │
│                                                                         │
│ 每次 execute：                                                          │
│ 1. isSessionKnown(sessionId)?                                           │
│ 2. input.runtimeGenerationId === activeGenerationId?                    │
│ 3. isRunAdmitted(runId, sessionId, generationId)?                       │
│ 4. active GenerationToolSurface resolved?                               │
│ 5. direct tool ∈ generation manifest?  或 toolbox target admitted?      │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ GenerationToolSurface (Generation-Frozen Execution Surface)             │
│                                                                         │
│ - generationId                                                          │
│ - baseActiveGenerationId?   // pending candidate 绑定的当时 active id   │
│ - registrationsByName                                                   │
│ - directToolNames                                                       │
│ - toolboxTargets                                                        │
│ - rules: PermissionRuleSet  // compose 时冻结                           │
│ - pipeline: ToolExecutionPipeline                                       │
│ - invocationLedger: ToolInvocationLedger                                │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
╔═════════════════════════════════════════════════════════════════════════╗
║                      ToolExecutionPipeline                              ║
║                                                                         ║
║   01 Prepare + Validate   → canonical args 或 invalid-input             ║
║   02 Ledger admit         → 无 toolCallId 则跳过；否则按指纹 coalesce    ║
║   03 Immediate Safety     → live tightening / restriction               ║
║   04 Permission Policy    → 纯 allow / ask / deny                       ║
║   05 Approval Broker      → 仅 ask；记忆 + requestPermission            ║
║   06 Authority Revalidate → session / generation / run（始终执行）      ║
║   07 Safety Recheck       → 审批或 await 之后的 live tightening          ║
║   08 Runner.execute       → 可选 maxDurationMs                          ║
║   09 Settle               → pre-runner abort 可删；runner-started 永久封存 ║
╚═════════════════════════════════════════════════════════════════════════╝
                                     │
                                     ▼
                                ToolResult
```

`baseActiveGenerationId` 语义与现网一致：pending candidate 在 `registerPendingGeneration` 时记下当时的 active generation。`commitPendingGeneration` 仅当 `candidate.baseActiveGenerationId === surfaces.active?.generationId` 时才晋升，防止过期 candidate 覆盖更新的 active。

---

## 3. 契约定义 (`@piwin/contracts`)

### 3.1 `HostToolRegistration` 扩展

文件：`packages/contracts/src/tool-registration.ts`。

```typescript
export type HostToolArgumentPreparation =
  | { ok: true; arguments: Record<string, unknown> }
  | { ok: false; result: ToolResult };

export type HostToolArgumentPreparer = (
  rawArguments: Record<string, unknown>,
  context: HostToolExecutionContext,
  signal: AbortSignal,
) => HostToolArgumentPreparation | Promise<HostToolArgumentPreparation>;

export type HostToolExecutionSpec = {
  /** Hard ceiling for runner.execute only. Does not bound approval wait. */
  maxDurationMs?: number;
};

export type HostToolRegistration = {
  descriptor: HostToolDescriptor;
  family: SessionToolFamily;
  /**
   * Required for every non-trusted, non-readOnly registration.
   * Optional for trusted / readOnly. Compose-time enforced by tool-family-index.
   */
  prepareArgs?: HostToolArgumentPreparer;
  permissionSpec: HostToolPermissionSpec;
  executionSpec?: HostToolExecutionSpec;
  execute: HostToolExecutor;
};
```

V2 **不**新增 `ToolEffect`、`ToolIdempotency`。它们不参与任何判定。

`@piwin/host-runtime` 定义 `MAX_HOST_TOOL_DURATION_MS = 30 * 60 * 1000`。`maxDurationMs` 必须是 `1..MAX_HOST_TOOL_DURATION_MS` 内的 safe integer；缺省表示 Pipeline 不另加 deadline，具体 executor 自己已有的超时仍然生效。

`HostToolPermissionSpec.action` **保持 `string`**。封闭性由 `HOST_TOOL_PERMISSION_ACTIONS` + `isHostToolPermissionAction()` + `tool-family-index` 运行时强制，不靠把契约收成 union 去炸测试假注册。`HostToolPermissionAction` 只是 catalog 的派生类型，供 evaluator 收窄。`subjectBuilder` 仍然只吃 canonical args。

### 3.2 Prepare / Validate 合成一步

没有独立的 `HostToolArgumentValidator`。

- `prepareArgs` 同时做规范化与校验（路径 resolve、URL parse、command trim、缺参）。
- 可预期的校验失败必须返回 `{ ok: false, result: { ok: false, code: 'invalid-input', ... } }`；取消返回 `aborted`。两者都在 safety / policy / prompt **之前**返回。
- 成功后的 `arguments` 就是本 invocation 的唯一参数视图。
- canonical args 必须是 JSON-compatible plain data：`null`、boolean、string、有限 number、array、plain object；object 中的 `undefined` 省略，array 中的 `undefined`、非有限数、BigInt、function、symbol、class instance 一律视为 `invalid-input`。这同时限定 fingerprint 的输入域。
- `prepareArgs` 必须无副作用（允许 `realpath` 这类只读 FS）。禁止在 prepare 里写文件、起进程、打网络。
- `prepareArgs` 在 await 前后检查 `signal.aborted`。已 abort 返回 `aborted`，不得进入 ledger / policy / prompt。
- 可预期的参数错误由 preparer 显式返回 `invalid-input`。若 preparer 意外 throw，Pipeline 记录诊断并映射为 `execution-failed`；若 signal 同时已 abort，则映射为 `aborted`。任何 prepare 失败都不进入 ledger，因此不缓存。

`validateCanonicalArguments(value)` 是 Host-local 纯函数，prepare 成功后、ledger 之前必须跑。算法：

1. 递归深度超过 64 → `invalid-input` / `canonical argument tree too deep`。
2. `null`、`boolean`、有限 `number`、`string` → 通过。
3. `Array.isArray`：按索引 `0..length-1` 逐个递归；洞（`undefined`）→ `invalid-input`。
4. 普通对象（`Object.getPrototypeOf(o) === Object.prototype` 或 `=== null`）：只看 `Object.hasOwn` 的字符串键；若存在 symbol own key → `invalid-input`；值为 `undefined` 的键跳过；其余递归。
5. 其它一律失败：`undefined` 根值、`NaN`/`Infinity`、`bigint`、`function`、`symbol`、`Date`、class instance、稀疏数组洞。

通过后的值才可以交给 `stableCanonicalJson` / policy / executor。

### 3.3 生产 action catalog（封闭）

这是 fail-closed 的唯一分类表。名字必须与现网 `permissionSpec.action` 逐字一致。新增工具 = 本表 + domain evaluator + 测试，同一 PR。

```typescript
export const HOST_TOOL_PERMISSION_ACTIONS = [
  // filesystem / shell
  'filesystem:read',
  'filesystem:list',
  'file-write',
  'bash',
  // network
  'network:web_search',
  'network:web_fetch',
  'network:image-gen',
  'network:video-gen',
  // process
  'process:start',
  'process:stop',
  'process:list',
  'process:logs',
  // browser
  'browser:navigate',
  'browser:screenshot',
  'browser:snapshot',
  'browser:click',
  'browser:type',
  'browser:fill-form',
  'browser:scroll',
  'browser:find',
  'browser:back',
  'browser:forward',
  'browser:wait',
  // notes (permission-policy NotesPermissionAction 加前缀)
  'notes:note_list',
  'notes:note_search',
  'notes:note_read',
  'notes:note_write',
  'notes:note_update',
  'notes:note_delete',
  // flashcards
  'flashcards:create',
  'flashcards:batch-create',
  'flashcards:list',
  'flashcards:delete',
  // planning (Host-owned artifact; domain policy always allow)
  'planning:create',
  'planning:update',
  // other
  'subagent:run',
  'artifact:instructions',
  'toolbox:route',
  'mcp:trusted',
] as const;

export type HostToolPermissionAction = (typeof HOST_TOOL_PERMISSION_ACTIONS)[number];

export function isHostToolPermissionAction(
  value: string,
): value is HostToolPermissionAction {
  return (HOST_TOOL_PERMISSION_ACTIONS as readonly string[]).includes(value);
}
```

禁止在 V2 使用这些**不存在**的名字：`planning:write`、`notes:read`、`notes:mutate`、`flashcards:read`、`flashcards:mutate`、`browser:interact`。

### 3.4 错误码

沿用 `ToolResultErrorCode`。V2 **不**新增 `timeout` 码，避免所有 switch 扩散。超时用 `execution-failed` + 稳定 `details`。

| 场景 | `code` | 说明 |
|---|---|---|
| `prepareArgs` 失败 | `invalid-input` | 含缺参、坏路径、坏 URL |
| `prepareArgs` 意外 throw | `execution-failed` | signal 已 abort 时仍为 `aborted`；必须记诊断 |
| 需要 subject 但 builder 缺失或返回 `undefined` | `invalid-input` | 不是权限拒绝 |
| 未分类副作用 / 未知 action | `permission-denied` | reason: `unclassified-side-effect` |
| policy deny；用户 deny；非交互 ask | `permission-denied` | |
| 调用方 abort；审批等待中 abort | `aborted` | |
| session 不存在；generation 被替换；surface 未注册；工具不在 manifest；run 未准入 | `tool-not-available` | Port 与 Revalidator **同一套码** |
| Immediate Safety 命中 | `tool-disabled` | 必须走 `toolDisabledResult` |
| 同 `(runId, toolCallId)` 指纹不一致 | `tool-not-available` | 协议异常，不执行 |
| invocation key 达到每 Run 上限 | `tool-not-available` | fail-closed，不驱逐活跃 tombstone |
| 已执行但 replay result 被驱逐 | `tool-not-available` | 保留 tombstone，禁止重跑 |
| `maxDurationMs` 到期 | `execution-failed` | `details: { reason: 'timeout', maxDurationMs }` |
| executor throw 且非 abort/timeout | `execution-failed` | |

Port 现网对「run 未准入」已经返回 `tool-not-available`。Revalidator 必须对齐，不得改成 `aborted`。

---

## 4. 核心模块

### 4.1 ToolPolicyEvaluator（纯函数）

- **位置**：`packages/host-runtime/src/tools/tool-policy-evaluator.ts`
- **禁止**：IO、UI、session/project 记忆、改状态。

```typescript
export type ToolPolicyDecision = {
  decision: PermissionDecision; // 'allow' | 'ask' | 'deny'
  reason: string;
  action: HostToolPermissionAction;
  subject?: PermissionSubject;
  rememberable: boolean;
};

export type ToolPolicyOutcome =
  | { kind: 'decision'; policy: ToolPolicyDecision }
  | {
      kind: 'invalid-input';
      action: HostToolPermissionAction;
      reason: 'subject-builder-required';
      message: string;
    }
  | {
      kind: 'unclassified';
      action: string;
      reason: 'unclassified-side-effect';
    };

export interface ToolPolicyEvaluator {
  evaluate(input: {
    registration: HostToolRegistration;
    arguments: Record<string, unknown>; // canonical
    context: HostToolExecutionContext;
    rules: PermissionRuleSet;          // generation-frozen
    mode: PermissionMode;              // live, read once per invocation
    projectRoot: string;
  }): ToolPolicyOutcome;
}
```

#### 判定顺序（不可调换）

1. action 不在 `HOST_TOOL_PERMISSION_ACTIONS` → `unclassified` / `unclassified-side-effect`。运行时检查不得信任 TypeScript union；即使伪装成 trusted/readOnly 也不能绕过 catalog。
2. `admission === 'trusted'` → `decision.allow` / `trusted-admission`。MCP（`mcp:trusted`）走这里。
3. `readOnly === true` → `decision.allow` / `read-only`。
4. action 属于 §4.1.1 `requiresSubject`，且 `subjectBuilder` 缺失或返回 `undefined` → 返回 `invalid-input` / `subject-builder-required`。不得用 `reason` 字符串作为跨层控制流，也不得映射为 policy deny。
5. 调用对应 domain evaluator（从现网 `resolveDomainPolicy` 抽出的纯函数）。
6. 没有 domain evaluator 的 catalog 成员不得落到「默认 allow」。planning 有显式 always-allow；其余必须有 case。

`bypass` / yolo **不能**覆盖步骤 1。未声明 action 是编程错误，不是用户权限。

`bypass` **可以**像现网一样把已匹配的 `ask` 规则提升为 allow；已匹配 `deny` 仍然 deny（ADR 0019）。

#### 4.1.1 需要 subject 的 action

与现网 `evaluateAdmission` 对齐，V2 不扩大：

- `bash`
- `file-write`
- `network:web_fetch`
- `network:web_search`
- `network:image-gen`
- `process:start`
- `process:stop`
- `notes:note_write` / `notes:note_update` / `notes:note_delete`（只读 notes 已在步骤 3 因 `readOnly` 返回）
- `browser:navigate`
- `browser:screenshot`

`flashcards:*` 变更、`planning:*`、`subagent:run`、`network:video-gen` 现网用静态 `subjectBuilder`，不进 `requiresSubject`。保持原样。

#### 4.1.2 Domain evaluator 映射

从 `host-tool-admission-gate.ts` 的 `resolveDomainPolicy` 原样抽出，行为不得漂移：

| action | evaluator | 备注 |
|---|---|---|
| `bash` | `evaluateBashPermission` | |
| `file-write` | `evaluateFileWritePermission` | 含 project-root escape |
| `network:web_fetch` / `network:web_search` | `evaluateWebPermission` | |
| `network:image-gen` | 现网 `evaluateWebPermission('web_fetch', …)` 复用 | 保持现网 dummy-host hack，不在 V2 重做 |
| `network:video-gen` | 显式 `{ decision: 'allow', reason: 'legacy-unclassified-allow' }` | 与抽出前 default-allow 行为等价；**不要**改成 image-gen 那条 web-fetch 规则 |
| `process:start` / `process:stop` | `evaluateProcessPermission` | |
| `browser:navigate` | `evaluateBrowserNavigatePermission` | |
| `browser:screenshot` | 有 file-write subject 则走 file-write；否则 ask-all?ask:allow | |
| 其他 `browser:*` 非 readOnly | ask-all?ask:allow | `browser-interaction` |
| `notes:*` | `evaluateNotesPermission` | |
| `flashcards:create` / `batch-create` / `delete` | bypass?allow:ask | 现网 `flashcards:` 前缀 |
| `planning:create` / `planning:update` | **always allow** | Host-owned SessionPlan 窄写口；Plan/Ask 依赖此例外 |
| `subagent:run` | bypass?allow:ask | |
| `process:list` / `process:logs` / `filesystem:read` / `filesystem:list` / `artifact:instructions` / `toolbox:route` / `flashcards:list` / 只读 notes / 只读 browser | 不应到达这里 | 步骤 2 `readOnly` |

`mcp:trusted` 在步骤 2（`admission === 'trusted'`）返回，不进规则引擎。catalog 校验仍是步骤 1：不在表里的 action 即使标了 trusted 也 fail-closed。

### 4.2 ToolApprovalBroker（记忆 + HITL）

- **位置**：`packages/host-runtime/src/tools/tool-approval-broker.ts`
- Pipeline **只**在 `policy.decision === 'ask'` 时调用。若误传入 `deny`，必须原样拒绝，记忆不得覆盖 deny。

```typescript
export type ToolApprovalOutcome =
  | { allowed: true; source: 'session-memory' | 'project-memory' | 'user' }
  | { allowed: false; reason: string };

export interface ToolApprovalBroker {
  resolve(input: {
    invocationId: string;
    registration: HostToolRegistration;
    arguments: Record<string, unknown>;
    context: HostToolExecutionContext;
    policy: ToolPolicyDecision;
    signal: AbortSignal;
  }): Promise<ToolApprovalOutcome>;
}
```

#### 现网记忆模型（行为等价，禁止摊平）

Broker **不**写入记忆。写入仍在现网 `permission/resolve`：

- `rememberScope === 'session'` → `HostRuntime.rememberSessionPermission`（仅 `bash` / `file-write`）
- `rememberScope === 'project'` → `HostRuntime.rememberProjectPermission`（`bash`、`file-write`、`network:web_search`、`network:web_fetch`）

Broker 只**读取**现网 gate 已经读取的 live 记忆：

```text
Policy === 'deny'  → 直接 Deny（不可被记忆覆盖）
Policy === 'allow' → Pipeline 根本不进 Broker
Policy === 'ask'
    │
    ├─ Session allowlist（仅 bash 精确命令 / file-write 路径）命中
    │     → Allow (session-memory)
    │
    ├─ Project network policy live IO（仅 web_search / web_fetch）
    │     → Allow (project-memory)
    │     查找失败：记诊断，回退为未命中，不得抛成 allow
    │
    ├─ 无 requestPermission（CLI non-interactive）
    │     → resolveNonInteractiveDecision：ask → deny
    │
    └─ requestPermission({ action, detail, defaultDecision, signal })
          → allow / deny
          记忆写入由 UI 的 permission/resolve 完成，Broker 不再写一遍
```

明确**不是** Broker 职责：

- 不把所有 action 都做成通用 session/project 记忆。
- 不 live 读取 `projects.json` 的 bash / file-write allowlist（现网 admission gate 也不读；那份清单供列表/撤销和下一次 generation 规则快照）。
- 不改变 `requestPermission` 签名。

### 4.3 ToolInvocationLedger

- **位置**：`packages/host-runtime/src/tools/tool-invocation-ledger.ts`
- **生命周期**：挂在 `GenerationToolSurface` 上，按 Run 分区；Run terminal 时显式 `releaseRun(runId)`，surface dispose 时统一停止接收并协作取消未完成调用。
- **保证边界**：仅对存在 `toolCallId` 的调用提供 generation + Run 生命周期内的 at-most-once runner admission。无 `toolCallId` 时不承诺防重放。
- **两级存储**：活跃 Run 的 invocation index 保存不可驱逐的 fingerprint/tombstone；可 replay 的完整 `ToolResult` 进入独立、按条数和 UTF-8 字节数双限的 LRU cache。

```typescript
export type InvocationEntry = {
  runId: string;
  toolCallId: string;
  fingerprint: string;
  state: 'pre-runner' | 'runner-active' | 'settled';
  /** Once true, this key can never enter runner again during the Run. */
  runnerStarted: boolean;
  /** Full results live only in the bounded LRU, never directly on the entry. */
  resultState: 'pending' | 'cached' | 'unavailable';
  /** Present only while the shared pipeline body has not published a result. */
  bodyPromise?: Promise<ToolResult>;
  /** Resolves after the underlying runner settles; never retains its ToolResult. */
  runnerCompletion?: Promise<void>;
  abortController?: AbortController;
  waiterCount: number;
};
```

`runnerStarted` 是不可逆位。Pipeline 必须在调用 `runner.execute` 的同一个同步块中先置位，再启动 runner；不能先取得 promise、随后才标记。`runner-active` 可以已经发布 timeout / all-waiters-aborted 结果，但完整结果只进入受限 replay LRU；entry 只保留 `resultState`。在底层 runner 真正 settle 前保留的是不携带 `ToolResult` 的 `runnerCompletion`，用于吸收 late resolution/rejection。

#### 规则

1. **无 `toolCallId`**：不进 ledger。用 `randomUUID()` 生成一次性 `invocationId` 仅供本地诊断。每次都完整走 pipeline；调用方必须接受此兼容路径不提供 at-most-once。
2. **有 `toolCallId`**：去重键 = `(runId, toolCallId)`。同一 generation、不同 run 不得串车。
3. **指纹**：`SHA-256(UTF-8(toolName + '\n' + stableCanonicalJson(canonicalArgs)))`，输出小写 hex。
   - `stableCanonicalJson` 只接受已通过 `validateCanonicalArguments` 的值。
   - `null` / `boolean` / 有限 `number` / `string`：等同 `JSON.stringify`。
   - 数组：`[` + 按索引递归 join `,` + `]`，保持原序。
   - 对象：取 own 字符串键，按 UTF-16 code unit 升序排序（`a < b`，**不是**插入序，也不是 `Object.keys` 的整数键优先枚举），然后 `{` + `JSON.stringify(key) + ':' + recurse(value)` join `,` + `}`。
   - 禁止对 raw args 取指纹，禁止直接 `JSON.stringify` 整个对象。
4. **活跃 Run key 容量**：默认每 Run 最多 4096 个不同 key。达到上限后，新 key fail-closed 为 `tool-not-available` / `tool invocation ledger capacity exceeded`；已有 key 仍可 coalesce/replay。活跃 Run 的 tombstone 不得通过 LRU 驱逐，否则无法维持 at-most-once。
5. **并发相同键**：
   - 指纹不同 → 立即 `{ ok: false, code: 'tool-not-available', message: 'tool call argument mismatch for toolCallId' }`，不加入 waiter。
   - 指纹相同且 `resultState === 'pending'` → `waiterCount++`，等待同一个 `bodyPromise`；不得创建第二个 policy prompt 或 runner。
   - `resultState === 'cached'` → 从 replay LRU 立即返回相同结果，并更新 LRU 访问顺序。
   - `resultState === 'unavailable'` → 返回 `tool-not-available` / `tool call already settled; replay result unavailable`，不得重跑。
6. **waiter abort 隔离**：
   - 单个调用方的 AbortSignal 只让该 waiter 立即得到 `aborted` 并减少 `waiterCount`，不改变其他 waiter，也不把该 waiter 的本地结果写成 shared replay result。
   - 所有 waiter 都 abort 时才触发 shared `abortController.abort()`。
   - 若此时 runner **尚未启动**，shared body 返回 `aborted` 后删除 entry，允许同 id 以后重入。
   - 若 runner **已经启动**，key 保持 sealed。shared body可以向调用方返回 `aborted`，但底层 runner promise 必须继续被托管；同 id 永远不能再次进入 runner，重试必须使用新的 toolCallId。
7. **runner 启动后的 terminal 规则**：
   - success、业务失败、permission-denied、invalid-input、tool-disabled、tool-not-available、execution-failed、aborted、timeout 都会封存 key。
   - timeout / all-waiters-aborted 可以先发布结果并写入 replay LRU，随后底层 runner late settle；late 结果只用于诊断和释放资源，不得改写已经对调用方公开的 replay result。
   - executor 即使声称 aborted，也不能证明完全没有发生部分副作用，因此 runner 启动后禁止删除 entry 重入。
8. **pre-runner terminal 规则**：
   - safety/policy/approval/revalidation 在 runner 启动前返回的非-aborted `ToolResult` 可以 settle/replay。
   - prepare 位于 ledger 外，prepare 失败从不缓存。
   - runner 启动前的 shared abort 删除 entry；这是唯一允许相同 key 重入的路径。
9. **结果 replay cache**：
   - 默认最多 512 个结果、总计最多 16 MiB；按最近访问 LRU 驱逐。大小按 `output` / `message` 的 UTF-8 bytes 加稳定序列化后的 `details` 估算。
   - 单个结果超过总预算时不缓存完整结果，只保留 tombstone。
   - 完整 `ToolResult` 只能存放在 replay LRU，entry 不得再保存一份；驱逐时把对应 entry 的 `resultState` 改成 `unavailable`。fingerprint、sealed 状态和稳定的 replay-unavailable 结果保留到 Run terminal。
   - pipeline body 发布结果后立即清除 `bodyPromise`；底层 runner 实际 settle 后立即清除 `runnerCompletion` / `abortController`。`runnerCompletion` 的 handler 不得捕获或返回完整 `ToolResult`，避免绕过字节预算。
10. **Run / surface 清理**：
   - `releaseRun(runId)` **只**挂在 `RunRegistry.onRunTerminal`。现网 `cancel` / `requestCancel` 只把 status 打成 `cancelling` 并 abort，**并不** terminalize；admission 已关但 Run 仍可能有 in-flight runner。此时删 tombstone 会让重复帧再进 runner。
   - `cancelling` 期间：`isRunAdmitted` 已为 false（现网要求 `status === 'running'`），新调用被拒；tombstone 留到真正 `terminate()`。
   - session / host dispose 不等 terminal：走 `surface.dispose`，整面停收、abort、托管 late settle。
   - `GenerationToolSurface.dispose(reason)` 先标记不再接收调用，再 abort 所有 shared controllers，并为所有未完成 promise 安装 late settlement/rejection handler；不得产生 unhandled rejection。
   - generation rollback/discard/clear 必须走 `dispose`，不能只删除 Map 引用。
11. **已 settled 再到达**：
   - 指纹相同 → 按规则 5 replay 或 replay-unavailable，绝不跑 runner。
   - 指纹不同 → 同上协议异常。
12. **prepare 在 ledger 之外**（见 §4.5）。prepare 必须无副作用，因此并发双 prepare 可接受；canonical fingerprint 之后才 admission。

### 4.4 ToolAuthorityRevalidator

注入 Pipeline。在 `runner.execute` **之前始终**运行，不只在 ask 之后。prepare 可能 await `realpath`，allow 路径同样有时间窗。

| 检查 | 失败码 | message 稳定要点 |
|---|---|---|
| `executionSignal.aborted` | `aborted` | `tool execution aborted after approval` 或 `...before execute` |
| session 已毁或 generation 不是 active | `tool-not-available` | `runtime generation superseded or session dropped` |
| `!isRunAdmitted(runId, sessionId, generationId)` | `tool-not-available` | `run is not admitted for tool execution: ${runId}` |
| live Immediate Safety | `tool-disabled` | `toolDisabledResult(...)` |

`revalidateAuthority` 可以是同步谓词（现网 Port 的三个回调都是 sync）。不要在这里重新跑 policy，也不要重新读冻结 rules。

#### 规则 / mode 的活度

| 数据 | 活度 | 审批等待期间变严如何生效 |
|---|---|---|
| `PermissionRuleSet` | generation compose 时冻结在 Surface | 下一世代才换规则 |
| `PermissionMode` | policy 评估时 live 读一次，事后不重跑 | Host 把 mode/规则收紧记入 Immediate Safety 的 `permissions` domain；步骤 07 挡住所有非只读工具 |
| Immediate Safety domains / restrictions | **每次** safety 检查 live 读 | 步骤 03 与 07 |

V2 依赖现网 `isToolBlockedByTightening('permissions', ...)`：非 `readOnly` 一律挡住。Spec 把这条写成 Revalidate 的前提，而不是再发明一遍 policy。

### 4.5 ToolExecutionPipeline

- **位置**：`packages/host-runtime/src/tools/tool-execution-pipeline.ts`

内部可以留诊断用状态字符串，**不是**对外状态机，不发 HostPush。V2 可观察性 = 现有 tool 事件 + `permission/request`。

```typescript
type ToolInvocationAttempt = {
  invocationId: string;
  /** Shared signal for a tracked invocation; caller signal for an untracked one. */
  signal: AbortSignal;
  /**
   * Atomically seals the invocation before calling `run`, tracks the underlying
   * promise, applies abort/deadline races, and maps throws to ToolResult.
   */
  executeRunner(input: {
    maxDurationMs?: number;
    run: (signal: AbortSignal) => Promise<ToolResult>;
  }): Promise<ToolResult>;
};

export class ToolExecutionPipeline {
  constructor(private readonly options: ToolExecutionPipelineOptions) {}

  async execute(input: {
    registration: HostToolRegistration;
    rawArguments: Record<string, unknown>;
    context: HostToolExecutionContext;
    signal: AbortSignal;
  }): Promise<ToolResult> {
    if (input.signal.aborted) {
      return { ok: false, code: 'aborted', message: 'tool execution aborted before start' };
    }

    // 1. Prepare + Validate on raw args. No side effects and no ledger entry yet.
    let prepared: HostToolArgumentPreparation;
    try {
      prepared = input.registration.prepareArgs
        ? await input.registration.prepareArgs(
            input.rawArguments,
            input.context,
            input.signal,
          )
        : { ok: true, arguments: input.rawArguments };
    } catch (error) {
      this.options.onDiagnostic?.(
        `tool argument preparation failed for ${input.registration.descriptor.name}: ${formatError(error)}`,
      );
      return input.signal.aborted
        ? { ok: false, code: 'aborted', message: 'tool preparation aborted' }
        : {
            ok: false,
            code: 'execution-failed',
            message: `tool argument preparation failed for ${input.registration.descriptor.name}`,
          };
    }
    if (!prepared.ok) {
      return prepared.result;
    }
    if (input.signal.aborted) {
      return { ok: false, code: 'aborted', message: 'tool preparation aborted' };
    }
    const canonicalValidation = validateCanonicalArguments(prepared.arguments);
    if (!canonicalValidation.ok) {
      return canonicalValidation.result;
    }
    const canonicalArgs = prepared.arguments;

    const runBody = async (attempt: ToolInvocationAttempt): Promise<ToolResult> => {
      if (attempt.signal.aborted) {
        return { ok: false, code: 'aborted', message: 'tool execution aborted before start' };
      }

      // 2. Immediate Safety (fail fast, no prompt)
      const disabled = this.options.isToolDisabled?.(
        input.registration,
        canonicalArgs,
        input.context,
      );
      if (disabled) {
        return toolDisabledResult({
          message: disabled.message,
          domain: disabled.domain,
          runtimeGenerationId: input.context.runtimeGenerationId,
        });
      }

      // 3. Pure policy
      const policyOutcome = this.options.policyEvaluator.evaluate({
        registration: input.registration,
        arguments: canonicalArgs,
        context: input.context,
        rules: this.options.rules,
        mode: this.options.getPermissionMode(),
        projectRoot: this.options.projectRoot,
      });

      if (policyOutcome.kind === 'invalid-input') {
        return {
          ok: false,
          code: 'invalid-input',
          message: policyOutcome.message,
        };
      }
      if (policyOutcome.kind === 'unclassified') {
        return {
          ok: false,
          code: 'permission-denied',
          message: `Permission denied for ${input.registration.descriptor.name}: ${policyOutcome.reason}`,
        };
      }
      const policy = policyOutcome.policy;
      if (policy.decision === 'deny') {
        return {
          ok: false,
          code: 'permission-denied',
          message: `Permission denied for ${input.registration.descriptor.name}: ${policy.reason}`,
        };
      }

      // 4. Approval only on ask
      if (policy.decision === 'ask') {
        const approval = await this.options.approvalBroker.resolve({
          invocationId: attempt.invocationId,
          registration: input.registration,
          arguments: canonicalArgs,
          context: input.context,
          policy,
          signal: attempt.signal,
        });
        if (!approval.allowed) {
          return attempt.signal.aborted
            ? { ok: false, code: 'aborted', message: 'tool approval aborted' }
            : { ok: false, code: 'permission-denied', message: approval.reason };
        }
      }

      // 5. Always revalidate before side effects
      if (attempt.signal.aborted) {
        return { ok: false, code: 'aborted', message: 'tool execution aborted after approval' };
      }
      const authority = this.options.revalidateAuthority(input.context);
      if (!authority.allowed) {
        return {
          ok: false,
          code: authority.code,
          message: authority.reason,
        };
      }
      const postDisabled = this.options.isToolDisabled?.(
        input.registration,
        canonicalArgs,
        input.context,
      );
      if (postDisabled) {
        return toolDisabledResult({
          message: postDisabled.message,
          domain: postDisabled.domain,
          runtimeGenerationId: input.context.runtimeGenerationId,
        });
      }

      // 6. `executeRunner` seals the key before invoking runner and owns the
      // abort/deadline race plus late completion tracking.
      return await attempt.executeRunner({
        ...(input.registration.executionSpec?.maxDurationMs !== undefined
          ? { maxDurationMs: input.registration.executionSpec.maxDurationMs }
          : {}),
        run: (runnerSignal) =>
          this.options.runner.execute({
            registration: input.registration,
            arguments: canonicalArgs,
            context: input.context,
            signal: runnerSignal,
          }),
      });
    };

    const toolCallId = input.context.toolCallId;
    if (!toolCallId) {
      return await runBody(
        createUntrackedInvocationAttempt({
          invocationId: randomUUID(),
          signal: input.signal,
          onDiagnostic: this.options.onDiagnostic,
        }),
      );
    }

    return await this.options.invocationLedger.run(
      {
        runId: input.context.runId,
        toolCallId,
        toolName: input.registration.descriptor.name,
        fingerprint: stableFingerprint(input.registration.descriptor.name, canonicalArgs),
        callerSignal: input.signal,
      },
      runBody,
    );
  }
}
```

`ToolInvocationAttempt` 是 Host-local 糖，不进 contracts。也可以不用这个类型，但必须遵守同一顺序：

- **tracked**（有 `toolCallId`）：`ledger.run(key, fingerprint, callerSignal, runBody)`。`runBody` 拿到的是 **shared** signal。`executeRunner` / `seal` 必须在调用 `runner.execute` 的同一个同步块里先置 `runnerStarted`。
- **untracked**（无 `toolCallId`）：不进 ledger。`invocationId = randomUUID()`。deadline/abort race 仍要做，但不 seal、不 replay。

`createUntrackedInvocationAttempt` 若存在，只是给 untracked 路径包一层同样的 deadline race，不得偷偷进 ledger。

`executeRunner()` 的实现顺序是规范的一部分：

1. 同步把 tracked entry 标成 `runnerStarted = true` / `runner-active`；
2. 建立 caller/shared abort controller 与 deadline controller；
3. 在 try/catch 中调用 `run(combinedSignal)`，立刻为返回 promise 安装 resolve/reject handler；
4. 用显式 deadline promise 与 runner promise 做 `Promise.race`，而不是只依赖 `AbortSignal.timeout()`；
5. deadline/abort 先赢时返回稳定 ToolResult，但保留底层 promise 的托管与 sealed tombstone；
6. late completion 只记诊断并释放引用，不制造第二次未处理 rejection，也不改写已经公开的 replay result。

`revalidateAuthority` 的 `code` 只允许 `tool-not-available` 或 `aborted`（后者仅用于信号已取消的别名；generation/run 失败必须是 `tool-not-available`）。

Executor 必须：

- 只使用传入的 `canonicalArgs`；
- 尊重 `signal`（能停则停）；
- 不重做权限判定。

`maxDurationMs` 到期保证调用方按 deadline 得到 timeout `details`，并保证同 key 不再次进入 runner。它不保证底层副作用已经停止；不响应 abort 的 executor 会以 `runner-active + resultState(cached | unavailable)` 留在 ledger 中直到 late settle、Run terminal 或 surface dispose。V2 不用第二个 watchdog 进程强杀。

### 4.6 Toolbox（ADR 0044，不变）

- `piwin_toolbox` 自己的 `permissionSpec.action === 'toolbox:route'` 且 `readOnly: true`。它的 `execute` 仍 fail-closed。生产 describe/call **不**走这个 executor。
- `describe`：读 `surface.toolboxTargets.get(target).descriptor`，返回 JSON。**不进 Pipeline**，不记 ledger，不跑 target 权限。
- `call`：取 target `HostToolRegistration`，把 `arguments.arguments` 和 `toolName: targetName` 交给 **同一个** `surface.pipeline.execute`。权限、safety、prepare、ledger 全部是 **target** 的，不是 toolbox shell 的。
- `restrictGeneration` 继续保证 direct 名与 toolbox 名不相交。
- 删除 `toolboxRouter`。不再为 toolbox 单独建一套 Router。

### 4.7 GenerationToolSurface 与 Port

`GenerationToolSurface` 替换 `CachedTools`，**不是**新的外部协议。

Port 必须继续提供：

| API | 行为 |
|---|---|
| `registerActiveGeneration` | 写入 active；删同 id pending |
| `registerPendingGeneration` | pending 不可执行；记录 `baseActiveGenerationId` |
| `commitPendingGeneration` | 仅当 base 仍指向当前 active 才晋升；旧 active 进入 `committedPrevious` |
| `rollbackCommittedGeneration` | 激活失败时恢复 previous |
| `discardRetiredGeneration` | 发布成功后丢掉 previous |
| `abortPendingGeneration` | 丢掉 candidate，不动 active |
| `restrictGeneration` | 按编译 manifest 裁 direct 集，建立 toolboxTargets；**pipeline / ledger / rules / permission 组件复用同一 surface**，只改名字映射 |
| `releaseRun` | 只从 `RunRegistry.onRunTerminal` 调用；在 active / pending / committedPrevious 上释放该 run 的 tombstone。cancel 期间不调用 |
| `clearSession` / `clear` | 对相关 surface 调用 `dispose(reason)`，不是只删除 Map 引用 |

Surface 生命周期必须显式：

- `abortPendingGeneration` dispose 被丢弃的 candidate；
- `rollbackCommittedGeneration` 恢复 previous 后 dispose 失败 candidate；
- `discardRetiredGeneration` dispose previous；
- 同 id 重复注册不得悄悄创建第二套 pipeline/ledger；要么复用同一 surface，要么先验证无执行中调用再替换；
- disposed surface 拒绝新调用；其未完成 runner 按 §4.3 继续拥有 late handler，不能泄漏 rejection 或在 dispose 后写回新状态。

`ToolDisablePredicate` 从即将删除的 router 文件挪到 `immediate-safety-gate.ts` 或 `tool-disable-predicate.ts`。现网 WP2 谓词继续由 HostRuntime 注入，**live** 读取 tightening domains。

MCP `mcpEnabledServerIds` 仍在 generation compose / capability 层过滤，不进 Evaluator。现网 gate 字段若未参与判定，删除时不要误做成新的运行时检查。

### 4.8 Compose-time 校验（`tool-family-index`）

在现有重复名 / 空 action / 缺 `subjectBuilder` 检查之上增加：

1. `permissionSpec.action` ∈ `HOST_TOOL_PERMISSION_ACTIONS`，否则 `HostToolRegistrationError`。
2. 非 `trusted` 且非 `readOnly` → 必须有 `prepareArgs`。
3. 非 `trusted` 且非 `readOnly` → 必须有 `subjectBuilder`（现网已有）。
4. 若声明 `executionSpec.maxDurationMs`，必须是大于 0 的 safe integer，并受 Host 常量上限约束；非法值 compose 失败，不能在运行时静默忽略。

只读 / trusted 的 `prepareArgs` 可选；高危只读工具（`read_file` / `list_directory`）**应当**仍提供 prepare，避免 executor 里再 parse，但不作为 compose 硬失败。

---

## 5. agent-host 与 Pi built-in

agent-host **不**获得 Pipeline。它继续：

- 归一化 `toolCallId`；
- 把 Host 工具调用代理到 Port；
- 做 ToolResult → Pi 投影和输出封顶。

Pi built-in allowlist 是能力层事实，不是 Pipeline 的一部分。V2 用架构测试锁住，防止再把 Pi 原生 write/bash/edit 放进 worker：

| Session 类型 | 允许的 `piBuiltinToolNames` |
|---|---|
| 默认 coding（`FAMILY_PI_BUILTIN_TOOLS['filesystem-read']`） | 恰好 `read`, `grep`, `ls` |
| Side Chat（`buildSideChatToolPolicy`） | `read`, `grep`, `find`, `ls` |
| 任何 session | **不得**包含 `write` / `edit` / `bash` / `execute` |

测试放在 `host-runtime`（policy resolver / blueprint compiler）和/或 `agent-host` allowlist builder。两边断言不得互相放水。

---

## 6. 文件与目录

```text
packages/contracts/src/
├── tool-registration.ts   # prepareArgs, executionSpec, HostToolPermissionAction catalog
└── index.ts

packages/host-runtime/src/tools/
├── build-session-host-tools.ts      # 唯一组合根
├── session-host-tool-port.ts        # CachedTools → GenerationToolSurface；删 toolboxRouter
├── generation-tool-surface.ts       # NEW
├── tool-execution-pipeline.ts       # NEW
├── tool-policy-evaluator.ts         # NEW（runtime catalog guard + domain dispatch）
├── tool-approval-broker.ts          # NEW
├── tool-invocation-ledger.ts        # NEW
├── tool-runner.ts                   # NEW DirectToolRunner
├── tool-disable-predicate.ts        # NEW；从旧 router 搬出 Host-local 类型
├── tool-family-index.ts             # 加强 compose 校验
├── host-filesystem-tools.ts         # prepareArgs；executor 不再 resolvePath
│
├── host-tool-execution-router.ts    # DELETE
└── host-tool-admission-gate.ts      # DELETE

packages/host-runtime/src/sessions/
└── immediate-safety-gate.ts         # 保留；改从 tool-disable-predicate 导入类型
```

其它注册点（`browser-tools.ts`、`session-tools.ts` / `tools-web`、`process-tools.ts`、`notes-tools.ts`、`flashcard-tools.ts`、`plan-create-tool.ts`、`plan-step-tool.ts`、`subagent-run-tool.ts`、`image-gen-tool.ts`、`video-gen-tool.ts`）按 §4.8 补 `prepareArgs`，不改 action 字符串。

---

## 7. 测试合同

现有 admission / router / port 测试必须在删除旧类型后**改接到 Pipeline**，不允许用「假 allow gate」冒充生产路径。

至少覆盖：

1. **Fail-closed**：未知 action compose 失败；若测试直接调 evaluator，运行期 deny，`bypass` 也不能放行。另备一张表测：`HOST_TOOL_PERMISSION_ACTIONS` 每个成员都有 domain case 或 trusted/readOnly 短路，禁止再落到 default-allow。
2. **invalid-input 先于 prompt**：缺 path / 坏 URL 不调用 `requestPermission`。
3. **subject 失败 = invalid-input**，不是 `permission-denied`。
4. **planning always-allow**：`planning:create` / `planning:update` 在 ask-all 下也不弹窗。
5. **MCP trusted**：不进规则引擎、不弹窗；仍走 safety + ledger + abort。
6. **记忆漏斗**：bash session hit；web_fetch project host hit；deny 不被记忆覆盖；non-interactive ask → deny。
7. **Host authority revalidation**：ask 等待期间 cancel run / 替换 generation → `tool-not-available`，runner 零次调用。
8. **Safety tightening**：等待期间 `permissions` domain tightening → `tool-disabled`。
9. **Ledger 基本合同**：相同 `(runId, toolCallId, fingerprint)` 执行一次；不同指纹拒绝；无 toolCallId 每次都执行；settled replay 不再进 runner。
10. **Ledger abort 分界**：runner 启动前 all-waiters abort 后同 id 可重入；runner 启动后 abort 即使 executor 不响应也不得重入；单 waiter abort 不影响仍在等待的 waiter。
11. **Ledger late settlement**：timeout / all-waiters-aborted 先返回后，runner late success 与 late rejection 都被托管，不改写公开结果、不产生 unhandled rejection、不允许第二次 runner。
12. **Ledger bounds**：超过 512 个或 16 MiB replay results 后，旧结果变 replay-unavailable 但 tombstone 仍挡重跑；超过每 Run key 上限后新 key fail-closed；Run terminal 后释放该 Run metadata。
13. **Timeout**：不响应 AbortSignal 的 fake executor 仍在 deadline 内向调用方返回 timeout；底层 promise 被继续托管，同 id replay 不重跑。
14. **Surface dispose**：pending abort、rollback、retired discard、session clear 都 abort/托管未完成调用；disposed surface 不接新调用。
15. **Toolbox**：describe 不进 pipeline；call 使用 target 的 permissionSpec。
16. **Port 世代**：过期 candidate commit 失败；restrict 后 toolbox-only 名不能 direct 调用。
17. **Pi built-in**：§5 的两张表。

零回归门禁：`pnpm typecheck`、`pnpm test`、`pnpm test:architecture`。

---

## 8. 实施路线图

实现未开始。清单是待办。按 §0.4 单路径演进，**不要** off-path 实现再大爆炸切换。

### Milestone 1 — 不变量接到现有 Router（先交付的 70%）

生产路径仍是 `Port → HostToolExecutionRouter.execute`。在这一个函数里接通：

1. Characterization tests：Port 世代协议、permission 记忆、toolbox、SDK/RPC conformance。
2. contracts：catalog 常量 + `isHostToolPermissionAction`、带 signal 的 `prepareArgs`。`permissionSpec.action` 保持 `string`。
3. Router：有 `prepareArgs` 就先跑，再 `validateCanonicalArguments`，再 safety / gate / execute。gate 和 executor 拿到的都是 canonical args。
4. 高危工具补 `prepareArgs`（`write_file`、`bash`、`run_bash`、`browser:navigate`、`web_fetch`、`web_search`）。**同一 commit** 里 `subjectBuilder` / `execute` 才去掉第二遍 `resolvePath`。没接到 Router 之前禁止删 executor 解析。
5. Router 在 gate 返回后、`execute` 前重验：`signal.aborted`、`isRunAdmitted`、active generation、`isToolDisabled`。
6. `resolveDomainPolicy` default 改为 deny；`network:video-gen` 写成显式 `legacy-unclassified-allow`。`tool-family-index` 拒绝未知 action。

此阶段结束后，现网已经具备：canonical args、执行前重验、未知 action fail-closed。用户可感知的安全收益到这里。

### Milestone 2 — 就地抽出 Policy / Approval

- 从 gate 抽出 `ToolPolicyEvaluator` 与 `ToolApprovalBroker`。
- Router 改调它们；删除 `HostToolAdmissionGate` 文件，但 **Router 还在**，Port 仍 `router.execute`。
- 抽出前后跑同一组 golden cases（bash / file-write / web / planning / MCP / non-interactive）。

### Milestone 3 — Ledger（可独立决定是否做）

- 在同一条 `Router.execute` 上接入修订后的 Ledger（§4.3）。
- `releaseRun` 只挂 `RunRegistry.onRunTerminal`，不要挂 cancel/admission-close。
- 未观察到重复 `toolCallId` 帧时，本里程碑可以停。不要为了改名去上。

### Milestone 4 — 改名与收口（可选）

- `Router.execute` 抽成 `ToolExecutionPipeline`；`CachedTools` 改名 `GenerationToolSurface`；删 `toolboxRouter`（call 走同一 execute）。
- `tool-family-index` 对非 trusted/非 readOnly 强制 `prepareArgs`。
- Pi built-in 架构测试（§5）；更新仍写旧 Router 的 `docs/architecture.md` / phase7 文档。
- 全量 `pnpm typecheck`、`pnpm test`、`pnpm test:architecture`。

---

## 9. 验收标准

按里程碑分别验收。M1 通过即可合并；M3/M4 不是 M1 的门禁。

**M1（必须）**

1. 生产仍只有 `Port → Router.execute`。
2. 权限与 executor 使用同一份 canonical args。
3. 审批等待之后，被取消的 run / 被替换的 generation / 收紧的 safety 都不能再执行。
4. 未知 action compose 失败；运行期 default deny；`bypass` 不能放行。
5. `network:video-gen` 仍不弹窗（显式 allow）。
6. SDK 与 RPC 仍只通过 Port；`pnpm typecheck` / `pnpm test` 绿。

**M3（若做 Ledger）**

7. 同 generation、同 run、同 `toolCallId`、同指纹：runner 至多启动一次。
8. `releaseRun` 只在 Run terminal；cancel 期间 tombstone 仍在。
9. 非协作 timeout：调用方按 deadline 返回，late reject 被托管。

**M4（若改名）**

10. 不再存在 `HostToolAdmissionGate` / `toolboxRouter`。Router 可以改名为 Pipeline，但不得变成第二条 dispatch。
11. `pnpm test:architecture` 绿；architecture / phase7 文档不再把旧双 Router 写成现状。
