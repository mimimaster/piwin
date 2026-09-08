# Workspace 写锁执行计划

日期：2026-09-08。状态：S0–S3 已落地。独立 worktree 跑测试仍不在范围。
依据：[问题与方案](./2026-09-08-workspace-write-gate.md)、[评审](./2026-09-08-workspace-write-gate-review.md)。
相关：[ADR 0012](../adr/0012-rpc-worker-isolation.md)、[ADR 0030](../adr/0030-safe-parallel-subagent-execution.md)。

本文件是可执行说明：改哪些文件、怎么测、怎样才算这一阶段完成。方案语义以问题与方案正文为准；本文不另发明锁规则。

---

## 0. 目标

日常并行 `write_file` 不再报 `workspace-busy`。Host 仍是受管写盘入口。每个可发布提交的互斥关系自洽：不允许「文件已离开整仓锁、Git/integrate 还在旧独占锁上」的中间态上线。

完成后的可见行为：

1. 同一 Run 并行写不同文件全部成功。
2. 同文件（含目录软链接别名）串行，before/after 能连成动作序列。
3. `bash` / Git 写 / integrate 与精确文件写互斥（shell 拿 workspace X）。
4. undo/redo 撞锁立刻 `workspace-busy`，不排队、不延迟执行。
5. `/repo` 与 `/repo/packages/foo` 不能同时持有冲突锁；`/repo` 与 `/repo-other` 可以。

---

## 1. 边界

做：

- `@piwin/git` 公开文件身份 API。
- `@piwin/host-runtime` 内进程锁调度与所有现有 `tryAcquire` 调用方接线。
- 相关单测。行为确认后补短 ADR。

不做：

- 恢复 worker 本地 `write` / `edit` / `bash`。
- 新 HostCommand、跨客户端等待协议、contracts 新命令。
- 跨 Host flock、内容 hash OCC、`apply_patch` 主编辑面。
- Git IPC 的客户端取消（当前 `HostCommandContext` 无每条 Git 请求的 signal；不宣称可取消）。
- 独立 worktree 跑测试（方案第三步，非修 busy）。
- 重写撤销事务 / 崩溃恢复。
- 顺手改 Router 权限引擎、子代理 worktree 策略、worker 工具清单。

包方向：`host-runtime → git` 已存在。禁止 host-runtime 深层相对导入 `packages/git/src/...`，禁止复制 `canonicalizeForContainment`。禁止 host-runtime import Pi。

文件尺寸：`host-filesystem-tools.ts` 现 395 行，加逻辑前先抽出门禁 helper。`subagent-integration-coordinator.ts` 现 510 行，本计划只改 `tryAcquire` 传参，不往里堆调度。gate 实现若接近 400 行，按「根路径 / 调度 / 对外 API」拆文件。

---

## 2. API 契约

`WorkspaceWriteGate.tryAcquire` 扩展为（字段可分阶段启用，类型一次加齐）：

```ts
tryAcquire(input: {
  workspaceId: string;
  rootPath: string;
  kind: 'tool' | 'git' | 'integration' | 'undo';
  mode: 'shared' | 'exclusive';
  wait: boolean;
  paths?: readonly string[];
  runId?: string;
  signal?: AbortSignal;
}): Promise<
  | { ok: true; lease: WorkspaceWriteLease }
  | { ok: false; reason: 'workspace-busy' | 'aborted' }
>
```

| 调用方 | `mode` | `wait` | `paths` | `signal` |
|--------|--------|--------|---------|----------|
| `write_file` / `delete_file`（阶段 A） | exclusive | true | 无 | Run / executor signal |
| `write_file` / `delete_file`（阶段 B） | shared | true | 规范化绝对路径，恰好 1 个 | 同上 |
| `bash` / `run_bash` | exclusive | true | 无 | 同上 |
| Git 写 | exclusive | true | 无 | 不传（本阶段不可取消） |
| integrate | exclusive | true | 无 | 现有 `control.signal` |
| undo / redo | exclusive | false | 无 | 不传 |

规则：

- `wait: false` 且与 **已持有或已排队** 的请求冲突 → `{ ok: false, reason: 'workspace-busy' }`，不入队、不留回调。
- `wait: true` 且 `signal` 在排队中 abort → `{ ok: false, reason: 'aborted' }`，从队列摘除。
- 获锁后 `lease.release()` 必须幂等。获锁后执行未结束，不得因 signal 提前 release。
- `paths` 仅 shared 文件写使用。exclusive 忽略 paths。
- `kind` 只作诊断/调用方标签，不参与冲突计算。`runId` 同。
- 本阶段不实现 `workspace-restoring` / `foreign-host-active`。

工具结果映射：

- `aborted` → `{ ok: false, code: 'aborted', message: '...' }`
- `workspace-busy` → 仅 undo 路径：`fail(..., 'workspace-busy', { code: 'workspace-busy' })`
- Git / integrate 等待成功后执行；被 abort 的 integrate 走现有 retain + `integrationStatus: 'failed'`，error 用 `aborted`，不伪报已 apply。

`@piwin/git` 新增公开函数（名称可微调，语义固定）：

```ts
canonicalizeForContainment(absolutePath: string): Promise<string>
resolveFileLockKey(absolutePath: string): Promise<
  | { ok: true; key: string }
  | { ok: false; reason: 'enotdir' | 'eacces' | 'eloop' | 'invalid' }
>
```

`resolveFileLockKey`：目标存在则用其身份；缺失则 **最近已存在祖先的 realpath + 缺失后缀**。ENOENT 允许走祖先；最终写目标若落在 ENOTDIR 上则失败；EACCES / ELOOP 失败，不得改成另一个 key。叶子软链接不是本函数的跟随写入许可，writer 仍按现规则拒绝。

---

## 3. 调度算法（必须按此实现）

工作区请求进入 **Host 进程内一条公平队列**（可按互不重叠的根分桶，但授权规则相同）。

**根重叠**：两边都先 `normalizeWorkspaceRoot`（`resolve` + `realpathSync`，失败则 resolved）。`relative(a, b)` 为空，或相对路径不以 `..` 开头且非绝对路径，则互为祖先/自身。`/repo` 与 `/repo/packages/foo` 重叠；`/repo` 与 `/repo-other`、`/repo/packages` 与 `/repo/packages-extra` 不重叠。

**冲突**：根重叠，且至少一方 `mode === 'exclusive'`。两个 shared 不冲突。

**授权（tryGrant）**：按排队到达顺序扫描。一条请求可获锁，当且仅当：

1. 不与任何 **已持有** 请求冲突；并且
2. 不与任何 **排在它前面、仍排队** 的请求冲突。

因此：已有 X 在等时，新的 S 不能插队；后来的 X 也不能插到更早的请求前面。互不重叠的根可以越过前面被挡住的请求获锁。

**取消**：只把 `state === 'queued'` 标为 `cancelled` 并摘掉。`acquired` 不受客户端超时影响。获锁与 abort 同时：调用方在 **首写 / commit point 之前** 再看 `signal.aborted`，已获锁则 `release` 且不执行副作用。

**文件 X（阶段 B）**：第二张 Map，key = `resolveFileLockKey` 的结果，跨 session 统一。与 workspace 锁的取锁顺序：先 workspace S/X，再文件 X；释放相反。禁止持有文件锁时再请求 workspace X。一次工具只锁一个路径。等待结束、首写前复查 lock key，变了则 release 并失败，不拿旧 key 写，不升级。

独立 worktree 根与父仓根不是祖先关系，文件 key 也不同，继续并发。不要用 Git common-dir 把它们合成一把大锁。

---

## 4. 阶段与依赖

```text
S0  git 文件身份 API          ← 无锁行为变化，可先合
S1  整仓独占 + 可取消 FIFO
    + 父子根重叠 + undo 非等待  ← 修 busy；互斥与今天相同，只是等待
S2  精确文件写改为 S + 文件 X   ← 必须与 S/X 调度同一发布单元
S3  短 ADR + 方案文档收口       ← 行为验证之后
```

S1 可单独上线。S2 不得在「只有文件锁、没有 workspace S」的状态下发布。S0 可与 S1 同 PR，也可先合。

提交按责任拆（git API / gate 内核 / 调用方 / 测试），有依赖的中间 commit 不单独部署。

---

## 5. S0 — 文件身份

**允许改**

- `packages/git/src/turn-changes/path-policy.ts`（现 165 行）：导出 `canonicalizeForContainment`；新增 `resolveFileLockKey`。
- `packages/git/src/turn-changes/path-policy.test.ts`
- `packages/git/src/index.ts` 公开导出

**做**

1. 把私有 `canonicalizeForContainment` 导出，行为保持给现有 containment 用。
2. `resolveFileLockKey` 实现 §2 语义，单测覆盖：
   - 已存在文件：key = realpath。
   - `alias -> real`，写尚未存在的 `real/new.ts` 与 `alias/new.ts`：**同一 key**。
   - 创建文件后再解析，key 仍指向同一 inode 路径，不分裂队列。
   - 中间段是文件（ENOTDIR）：`ok: false`。
   - 无关前缀 `/repo` vs `/repo-other` 不互相包含。
   - 不强制 lowercase；在当前平台断言真实大小写行为。

**命令**

```bash
pnpm --filter @piwin/git test -- src/turn-changes/path-policy.test.ts
pnpm --filter @piwin/git typecheck
```

**完成**：git 测试绿；host-runtime 尚未调用也可以。

---

## 6. S1 — 排队独占、重叠根、undo

此阶段所有现有写操作仍是 workspace exclusive。只改「拿不到就失败」为「可取消等待」，并补上今天缺失的互斥。

### 6.1 先拆 helper（尺寸）

`host-filesystem-tools.ts` 抽出 `runWithOptionalToolGate` 到例如 `packages/host-runtime/src/tools/run-with-workspace-write-gate.ts`。抽出时行为不变，原 busy 测试仍过。再在 helper 上加 `signal` / `wait` / `mode`。

### 6.2 gate 内核

**允许改**

- `packages/host-runtime/src/turn-changes/workspace-write-gate.ts`
- 若超 ~400 行，拆：
  - `workspace-root.ts`：`normalizeWorkspaceRoot`、`workspaceRootsOverlap`
  - `workspace-lock-scheduler.ts`：队列与 tryGrant
  - `workspace-write-gate.ts`：对外 `createWorkspaceWriteGate`
- `packages/host-runtime/src/turn-changes/workspace-write-gate.test.ts`
- `packages/host-runtime/src/index.ts` 若导出类型有变

**实现要点**

- 默认不再 fail-fast。exclusive + `wait: true` 排队。
- undo 用 `wait: false`。
- 重叠根：父根 Git lease 与子根 tool lease 不得同时成功（今天的测试空缺，评审已复现）。
- 队列状态：`queued | acquired | released | cancelled`。
- 失败的获锁尝试不得卡住后续；空队列删除；abort listener 在终态拆除。

**必须改写的旧测试**（今天断言重叠即 busy）：

| 文件 | 现状 | S1 改为 |
|------|------|---------|
| `workspace-write-gate.test.ts` overlapping / concurrent / symlink | 第二人 busy | 第二人等待；release 后成功。另测 `wait: false` 仍 busy |
| `host-filesystem-tools.test.ts` write_file busy | 持 Git lease 时 write 立刻失败 | 延迟 release，write 随后成功 |
| `git-commands.test.ts` git/stage busy | 同上 | 等待后成功；`git/status` 仍不取锁 |
| `subagent-integration-coordinator.test.ts` integrate busy | 持锁则不写父仓 | 等待后写入；abort 在获锁前 retain、不 apply |
| `turn-changes/coordinator.test.ts` tool 挡住 git/integration | busy | 等待；或改为 undo 的 fail-fast 用例 |

**新增测试**

- 父子根 exclusive 冲突；`/repo` 与 `/repo-other` 并发成功。
- 排队中 abort → `aborted`，持有者 release 后队列里下一项能跑。
- 获锁同时 abort：不执行用户回调（用 gate 测「获锁后调用方检查 signal」）。
- 重复 release 无害。
- `wait: false` 在已有排队写者时 busy，不插入队头。
- 三个并行 `tryAcquire` exclusive 同一根：全部成功、互斥、无 busy。

### 6.3 调用方接线

**允许改**

- `run-with-workspace-write-gate.ts`（新）+ `host-filesystem-tools.ts`：`execute(args, signal, context)` 把 `signal` 传入 helper；`kind: 'tool'`，`mode: 'exclusive'`，`wait: true`。bash 与 write 此阶段相同。
- `commands/git-commands.ts`：`withGitWriteGate` 设 `mode: 'exclusive', wait: true`，不传 signal。失败原因仅可能是理论上的 busy（若误标 wait:false）；等待路径应成功。
- `subagent-integration-coordinator.ts`：`tryAcquire` 传 `control.signal`，`wait: true`。获锁后、`onCommitPoint` 前若 `signal.aborted`：release，retain，`failed`/`aborted`，不调用 `integrateWorktree`。
- `commands/turn-change-commands.ts`：`runDirection` 在 `runTurnChangeOperation` 前对 `workspace.rootPath` 取 `kind: 'undo', mode: 'exclusive', wait: false`。busy 则 `fail(..., 'workspace-busy', { code: 'workspace-busy' })`。获锁后 **重读** attempt：
  - 无 attempt / workspace → 原错误
  - `captureState !== 'ready'` → `capture-incomplete`
  - `expectedRevision !== activeRevision` → `stale-revision`
  - undo 时 `disposition !== 'applied'`，redo 时 `disposition !== 'undone'` → `direction-unavailable`
  - 然后 `runTurnChangeOperation`（保留 hash 预检与幂等 replay）
  - `finally release`
- 权限仍在 Router 取锁前完成（现顺序：admit → revalidate → execute → gate）。排队发生在 executor 内。获锁后、写盘前检查 `signal.aborted`。Run 取消应 abort 该 signal（沿用 ledger attempt）。不把权限询问移到锁内。

**turn-change 测试**：现 `turn-change-commands.test.ts` 无 runtime 时整表 `unsupported-capability`。新增带 `turnChangeRuntime` 的用例（可参考 `host-launch-persistence.test.ts` 的打开 runtime 方式）：

- 持有 tool lease 时 undo → `workspace-busy`，release 后同 revision 再 undo 可进入 runner（或因 files-changed/无变更集失败，但不得是「第一次 busy 的延迟执行」）。
- 幂等：同一 `idempotencyKey` 两次 undo，第二次 `replayed`，不二次写盘。

### 6.4 S1 命令

```bash
pnpm --filter @piwin/host-runtime test -- \
  src/turn-changes/workspace-write-gate.test.ts \
  src/turn-changes/coordinator.test.ts \
  src/tools/host-filesystem-tools.test.ts \
  src/commands/git-commands.test.ts \
  src/subagent-integration-coordinator.test.ts \
  src/commands/turn-change-commands.test.ts
pnpm --filter @piwin/host-runtime typecheck
pnpm --filter @piwin/git typecheck
```

**完成**

- 并行 3 个 write_file 全部成功（此阶段可串行）。
- 模型侧不再因同批写文件得到 `workspace-busy`。
- 长 bash 会让后续写等待，但成功。
- 父子根互斥。
- undo 立刻 busy。

---

## 7. S2 — 精确文件写：S + 文件 X

与 S1 互斥关系不同，必须作为单独发布单元（或与完整调度同一 PR）。不得只改 write_file 不改 gate。

**允许改**

- gate / scheduler：实现 `mode: 'shared'` 与文件 X Map。
- `run-with-workspace-write-gate.ts`、`host-filesystem-tools.ts`：`write_file` / `delete_file` 在取锁前 `resolveFileLockKey(filePath)`；`mode: 'shared'`，`paths: [key]`。bash 仍 exclusive、无 paths。
- 获锁后再次 `resolveFileLockKey`；key 变化则 release，返回 `execution-failed`（路径身份变化），不写。
- `host-filesystem-tools.test.ts`、`workspace-write-gate.test.ts` 新用例。

**验收用例（必须自动化）**

1. 不同文件两个 `write_file` 真正重叠执行（用 barrier：两个 executor 在写盘前互相等待，超时则失败）。
2. 同文件 write/write、write/delete、delete 后再 create：串行；有 turnChange store 时 before/after 能拼接。
3. `real/new.ts` 与 `alias/new.ts` 串行。
4. bash（向某文件 echo）与对该文件的 `write_file` 互斥；bash 与 **另一工作区** 的写不互斥。
5. 持有 shared 文件写时，`git/stage` / integrate 等待；release 后进行。
6. 独立两个 temp 根（模拟 worktree）文件写并发成功。
7. 排队的 exclusive 在前时，后来的 shared 不插队（S1 算法在 S2 仍成立）。
8. `read_file` / `list_directory` / `git/status` 仍不取锁。

**命令**：同 S1 测试集 + path-policy。

**完成**：不同文件并行；shell/Git/integrate/undo 仍挡文件写；无 busy（除 undo）。

---

## 8. S3 — 文档

行为与测试稳定后再写。

**允许改**

- 新 ADR（建议 `docs/adr/0069-workspace-write-gate.md`，编号以当时目录为准）：记录两级锁、shell=X、undo 非等待、重叠根、文件身份。关联 0030。
- 更新 [ADR 0030](../adr/0030-safe-parallel-subagent-execution.md) 中「respects the workspace write gate」一句：integrate 等待 X，不再 fail-fast。
- 方案正文状态改为已落地，链到 ADR。
- 不把评审文记成已上线决策。

---

## 9. 全阶段测试矩阵

| # | 场景 | 阶段 |
|---|------|------|
| T1 | 三并行不同文件 write 均成功 | S1 串行可过；S2 须并行 |
| T2 | 同文件 write 串行 | S2 |
| T3 | 目录软链接新建文件同一 lock key | S0+S2 |
| T4 | 父子 workspace exclusive 冲突 | S1 |
| T5 | 无关前缀根不冲突 | S1 |
| T6 | 独立 worktree 根文件写并发 | S2 |
| T7 | bash 与精确写互斥 | S1 整仓已互斥；S2 仍须互斥 |
| T8 | Host `git/checkout` 与 bash `git checkout` 都走 X | S1/S2 |
| T9 | 等待中 abort、获锁同时 abort、失败不堵队列、重复 release | S1 |
| T10 | 权限在锁外；排队后 Run abort 不写盘 | S1 |
| T11 | undo 双向互斥、不插队、busy 不延迟执行、获锁后状态检查、幂等 replay | S1 |
| T12 | integrate：业务队列 → X；取消保留 worktree；commit point 后不伪报 | S1 |
| T13 | `git/status`、read 工具不加锁 | S1 |

SDK 与 RPC 共用 `buildHostFilesystemTools` / 同一 gate 实例，不为双后端各写一套。

---

## 10. 建议提交切分

1. `git`: 导出文件身份 API + 测试
2. `host-runtime`: 抽出 `runWithOptionalToolGate`（行为不变）
3. `host-runtime`: gate FIFO + 重叠根 + 测试改写
4. `host-runtime`: 工具 / Git / integrate 传 wait 与 signal
5. `host-runtime`: undo 接非等待 X + 获锁后状态检查
6. `host-runtime`: shared + 文件 X，切换 write/delete（**不可与 3–4 拆开上线** 若 6 单独出现会破坏互斥；6 必须包含调度与调用方）
7. 文档 / ADR

1–5 对应 S0+S1，可部署。6 对应 S2。7 对应 S3。

---

## 11. 验证命令（整包）

```bash
pnpm --filter @piwin/git test -- src/turn-changes/path-policy.test.ts
pnpm --filter @piwin/host-runtime test -- \
  src/turn-changes/workspace-write-gate.test.ts \
  src/turn-changes/coordinator.test.ts \
  src/tools/host-filesystem-tools.test.ts \
  src/commands/git-commands.test.ts \
  src/subagent-integration-coordinator.test.ts \
  src/commands/turn-change-commands.test.ts
pnpm --filter @piwin/git typecheck
pnpm --filter @piwin/host-runtime typecheck
```

S2 后若新增测试文件一并列入。合并前按仓库惯例跑触及包测试；不在本计划扩大到全仓无关包。
