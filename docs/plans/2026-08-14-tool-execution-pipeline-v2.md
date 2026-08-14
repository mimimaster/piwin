# Tool Execution Pipeline V2 Implementation Plan

> **Date**: 2026-08-14
> **Status**: Ready（实现尚未开始；勾选需以代码为准）
> **Target Package**: `@piwin/contracts`, `@piwin/host-runtime`；`@piwin/agent-host` 仅架构断言
> **Spec Reference**: [`docs/specs/tool-execution-pipeline-v2.md`](../specs/tool-execution-pipeline-v2.md)
> **ADR**: [`docs/adr/0050-tool-execution-pipeline-v2.md`](../adr/0050-tool-execution-pipeline-v2.md)

按 spec §0.4 / §8 执行：**单路径演进**。规范里的判定顺序、catalog、错误码优先于本计划缩写。

M1 是要交货的部分。M2 是结构整理。M3/M4 可停。

---

## 1. Objectives & Quality Gates

- **Single callable path**: Port 永远只能打到一个 `execute`。在现有 Router 上长不变量，禁止旁边先做一套 Pipeline 再切。
- **M1 ships the safety invariants**: canonical args、执行前重验、未知 action fail-closed。
- **Zero Regression**: 现有测试继续绿。抽出 Evaluator 前后跑同一组 golden cases。
- **Behavior-equivalent approval**: 记忆漏斗按现网搬；video-gen 保持不弹窗。
- **Do not delete resolvePath before Router calls prepareArgs**.

---

## 2. Milestone Breakdown

### Milestone 1: 不变量接到现有 Router（必须做）

#### 1.1 `@piwin/contracts`

- [ ] `packages/contracts/src/tool-registration.ts`：
  - `HostToolArgumentPreparation` / `HostToolArgumentPreparer`（含 `AbortSignal`）。
  - `HOST_TOOL_PERMISSION_ACTIONS` + `isHostToolPermissionAction`。
  - **`permissionSpec.action` 保持 `string`**，不要收成 union。
  - 可选 `prepareArgs`。此阶段不必加 `executionSpec`。
  - 不要加 `ToolEffect` / `ToolIdempotency` / 被忽略的 `executor`。
- [ ] `packages/contracts/src/index.ts` 导出。

#### 1.2 接到 `HostToolExecutionRouter.execute`

- [ ] Characterization tests：Port pending/commit/rollback/restrict、permission 记忆、toolbox、SDK/RPC conformance。
- [ ] Router 顺序：`prepareArgs?` → `validateCanonicalArguments` → safety → gate(canonical) → **重验** `aborted` / `isRunAdmitted` / active generation / `isToolDisabled` → `execute(canonical)`。
- [ ] `validateCanonicalArguments` 按 spec §3.2：深度 64、拒绝 `Date` / 非有限数 / 数组洞 / symbol key。
- [ ] 重验失败码与 Port 对齐：run/generation → `tool-not-available`；safety → `tool-disabled`。

#### 1.3 注册与 fail-closed

- [ ] **同一 commit**：高危工具加 `prepareArgs`，并且 `subjectBuilder` / `execute` 去掉第二遍 `resolvePath`。未接线前禁止先删解析。
  - 必做：`write_file`、`bash`、`run_bash`、`browser:navigate`、`web_fetch`、`web_search`
  - 应当：`read_file`、`list_directory`
- [ ] `resolveDomainPolicy` default → deny。
- [ ] `network:video-gen` 显式 `{ decision: 'allow', reason: 'legacy-unclassified-allow' }`。不要抄 image-gen dummy-host。
- [ ] `tool-family-index`：未知 action compose 失败。
- [ ] 表测：catalog 每个 action 都有 case 或 trusted/readOnly 短路。

M1 完成即可合并。用户侧安全收益到此。

---

### Milestone 2: 就地抽出 Policy / Approval（结构，可紧接 M1）

- [x] `tool-policy-evaluator.ts`：trusted → readOnly 之前先做运行时 catalog 校验。`ToolPolicyOutcome` 区分 invalid-input / unclassified / decision。planning always-allow。
- [x] `tool-approval-broker.ts`：只处理 ask；读 session bash/file-write 与 project network；不写记忆。
- [x] Router 改调 evaluator + broker；删除 `host-tool-admission-gate.ts`。
- [x] **Router 文件保留**，Port 仍 `router.execute`。
- [x] 抽出前后同一组 golden：bash / file-write escape / web / planning / MCP / non-interactive deny。

---

### Milestone 3: Ledger（可停）

只在已经看到或即将上线重复 `toolCallId` 帧时做。

- [ ] `tool-invocation-ledger.ts`：键 `(runId, toolCallId)`；指纹 = SHA-256(UTF-8(toolName + `\n` + 按 UTF-16 排序键的 canonical JSON))。
- [ ] runner 启动前 abort 可删重入；启动后 sealed。
- [ ] 活跃 Run tombstone 不 LRU；每 Run 4096 key；replay 512 条 / 16 MiB。
- [ ] `releaseRun` **只**挂 `RunRegistry.onRunTerminal`。cancel / `requestCancel` / admission close **不要** release。
- [ ] session/host 清理走 surface/port dispose，托管 late settle。
- [ ] 仍从同一个 `Router.execute` 调用；不要平行 Pipeline。

---

### Milestone 4: 改名收口（可停）

- [ ] `Router.execute` 抽/改名为 `ToolExecutionPipeline`；`CachedTools` → `GenerationToolSurface`。
- [ ] 删除 `toolboxRouter`；call 走同一 execute。
- [ ] 非 trusted / 非 readOnly 强制 `prepareArgs`。
- [ ] 可选 `executionSpec.maxDurationMs` + deadline `Promise.race`。
- [ ] 架构测试：coding `['read','grep','ls']`；Side Chat 可加 `find`；禁止 `write`/`edit`/`bash`/`execute`。
- [ ] 更新 `docs/architecture.md`、phase7 里仍写双 Router 的段落。
- [ ] `pnpm typecheck`、`pnpm test`、`pnpm test:architecture`。

---

## 3. Out of scope

- sandbox / remote executor 及预留字段
- 文件系统 symlink/rename 对象级 TOCTOU
- 把 video-gen 改成与 image-gen 相同的权限弹窗
- 新的 pipeline HostPush
- bash / file-write project allowlist 改 live 读取
- `requestPermission` 返回 `ApprovalScope`
- 未证明重复帧就上 Ledger
