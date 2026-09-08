# Workspace 写锁：问题与方案

日期：2026-09-08。状态：已落地（[ADR 0069](../adr/0069-workspace-write-gate.md)）。执行：[执行计划](./2026-09-08-workspace-write-gate-execution.md)。评审：[评审](./2026-09-08-workspace-write-gate-review.md)。
相关：[ADR 0012](../adr/0012-rpc-worker-isolation.md)、[ADR 0030](../adr/0030-safe-parallel-subagent-execution.md)、[撤销实施方案](./2026-08-30-turn-change-undo-implementation-plan.md) §4.1 / §5.3 / §6.1。

这是参与门禁的 Host 操作之间的协调。锁状态留在 `@piwin/host-runtime`；文件身份从 `@piwin/git` 的 path-policy 提炼为公共 API。不恢复 worker 本地写盘。

---

## 1. 问题

模型在一轮里并行调用多个 `write_file`（不同文件，这是正常行为），经常得到：

```
Tool error (execution-failed): workspace-busy
```

同批若还有长时间 `bash`，或 Git 写 / 子代理合入父仓占着同一把锁，其余写操作全部立刻失败。

根因在锁，不在进程分工。

Worker 只开放只读内置工具；`write_file` / `delete_file` / `bash` / Git 变更 / 子代理 integrate 都由 Host 主进程执行。这一框架是刻意设计（ADR 0012），应当保留。

不合理的是 `packages/host-runtime/src/turn-changes/workspace-write-gate.ts`：

| 项 | 现状 |
|----|------|
| 粒度 | 整个 workspace 根目录的 realpath，一把独占锁 |
| 策略 | `tryAcquire` 失败立刻返回 `workspace-busy`，不排队 |
| 持锁方 | `write_file`、`delete_file`、`bash`、`run_bash`、Git 写命令、子代理 integrate |
| 未接线 | 类型含 `kind: 'undo'`，`turn-changes/undo`/`redo` 实际不取锁 |
| 根路径 | 仅精确相等。`/repo` 的 Git 与 `/repo/packages/foo` 的 tool 可同时持锁 |
| 未使用 | `runId`；`workspace-restoring` / `foreign-host-active` 从未返回 |

撤销方案原文：日常写「不同路径允许并发」，undo 才 workspace 独占。落地变成日常 tool write 也整仓独占 + fail-fast。

子代理写任务在各自 git worktree 落盘，只在合入父仓时碰父锁。`subagents.maxConcurrency` 与 worker 池是另一套配额，不产生 `workspace-busy`。

Pi 的 `withFileMutationQueue` 提供同文件串行、不同文件并行、等待而非失败。可参考调度语义，不要逐字复制：它没有 AbortSignal 摘队，缺失文件经目录软链接的别名也不会合并到同一把锁。host-runtime 不能 import Pi。

---

## 2. 方案

进程内两级锁。S 表示参与工作区共享门禁（用来挡住整仓操作），不是「文件只读」。X 表示独占。文件写另用规范化目标路径上的文件 X 互斥。

| 操作 | 锁 | 冲突时 |
|------|----|--------|
| `write_file` / `delete_file` | workspace **S** + 规范化目标文件 **X** | 可取消 FIFO 等待。不同文件并行 |
| `bash` / `run_bash` | 所属 workspace **X** | 可取消 FIFO 等待 |
| Git 写、父仓 integrate | workspace **X** | 等待。integrate 保留现有 per-repo 业务队列，再等 X |
| `turn-changes/undo` / `redo` | workspace **X** | **立刻** `workspace-busy`，不登记等待。用户再点一次 |
| 结构化读取 | 不加锁 | 可读到操作过程中的状态，不承诺多文件一致快照 |

任意 shell 默认拿 X。工具接收的是任意 command，可重定向、格式化、codegen、`git checkout`。经 Host Git 命令的 checkout 拿 X，经 bash 的同一操作若只拿 S，等于第二条绕过入口。`fileEffect: uncontained` 只把本 run 的 attempt 标 incomplete，挡不住与并发 `writeTurnChangeFile` 交错。长测试与编辑并行属于后续能力：放到独立 worktree / 快照上跑，并标明测的是哪个版本；不把 `pnpm test` 当作只读证明。

`workspace-busy` 只用于 undo 撞锁，以及日后 `workspace-restoring` / `foreign-host-active`。其余进程内争用改为等待。

### 2.1 文件身份

文件锁按 Host 内规范化的绝对目标路径统一索引，不按 session / workspaceId 分队列。独立 worktree 的文件仍并发；不因共享 Git common-dir 把它们重新合成一把大锁。

缺失目标的 key：**最近已存在祖先的 `realpath` + 缺失后缀**。登记入队顺序必须稳定。不要用「文件不存在则 `resolve(file)`」——内部目录软链接会把 `real/new.ts` 与 `alias/new.ts` 拆成两把锁，实际写同一文件。创建后 `realpath` 还可能换 key。

在 `@piwin/git` 把 `canonicalizeForContainment`（`path-policy.ts`）提成公共 API，host-runtime 通过公开导出使用。不要深层相对导入，也不要复制第二份。

等待结束、首写之前复查路径身份和有效授权。路径已变不能拿着旧 key 静默写入，持锁期间不升级、不反向取锁。叶子软链接仍按现有 writer 拒绝跟随写入。ENOENT 可用于构造缺失后缀；ENOTDIR 是无效写目标；EACCES / ELOOP 不得静默改成另一个 key。大小写语义按平台测，不一律 lowercase。

### 2.2 工作区重叠

workspace 锁在规范化路径相等，**或存在祖先 / 后代关系**，且任一方为 X 时冲突。按目录边界判断：`/repo` 与 `/repo/packages/foo` 冲突；`/repo` 与 `/repo-other` 不冲突。这是同 Host 内部问题，列入本方案，不是跨 Host 范围外项。

### 2.3 队列与取消

公平 FIFO：按到达顺序。已有 X 在等待时，新的 S 排在其后。后来的 X 不得插到更早已排队的请求前面。

`tryAcquire` 接受 `AbortSignal`。队列条目显式 `queued` / `acquired` / `released` / `cancelled`。取消只摘尚未获锁的等待者。获锁与取消同时发生时，首写前再检查 signal。获锁后执行未结束，不得因客户端超时或 signal 提前 `release`。失败不阻断后续；重复 `release` 无害；空队列与监听器必须清理。

权限询问在取锁前完成。长时间排队后再检查 Run / generation 与授权是否仍有效。现有 Router 检查发生在进入 executor 之前；若排队放进 executor，该检查不能覆盖整个等待窗口。

第一版给等待者接上所属 Run 或 Host 生命周期的取消。文件工具要把 execute 的 signal 传到门禁，不能继续丢成 `_signal`。integrate 已有 signal，传到第二级 X，并在获锁后、commit point 前再检查。Git 命令路径当前没有每条请求的取消 signal；未补命令生命周期之前，不宣称客户端可主动取消 Git 排队。

不为工具写另设通用等待超时。shell 自身 timeout 从启动命令时才起算，不是排队超时。

### 2.4 undo

立即 busy、不排队，避免早先点击在环境变化后突然执行。

- tryAcquire 不得越过已经排队的写者；busy 后不留下可执行回调。下一次点击是新请求。
- 获得 X 后：重读并验证 `activeRevision`、`captureState`、`disposition`，再固定计划、校验文件、执行和落库，最后释放。幂等重放返回原结果，不重复写入。
- `runTurnChangeOperation` 的内容 hash 预检保留。接上 X 不等于完整撤销事务或崩溃恢复已经实现；本方案不重写撤销域。

---

## 3. 不变量

1. **不升级**：持有文件锁的操作不请求 workspace X；拿 workspace X 的操作不拿文件锁。
2. **取锁顺序**：先 workspace S/X，再文件锁。一次改多文件时按路径排序取文件锁。
3. **公平 FIFO + AbortSignal 摘队**。不为工具写另设超时。
4. **Host 受管入口是唯一产品写盘权威**。不恢复 worker 本地 `write` / `edit` / `bash`。外部编辑器、MCP、未纳入门禁的 Job、逃出所属工作区的 shell、脱离管理的子进程不因这把锁被隔离。后台进程不以启动命令返回作为写入结束的证据。

---

## 4. 落地

每个可发布版本必须保留同一套互斥关系。提交可按责任拆分；有依赖的中间提交不能单独上线或单独回滚。也可以一次 PR 交付完整两级锁。

**第一步 — 独占改为可取消排队，补上路径与 undo**

- 现有写操作（文件、bash、Git、integrate）仍整仓互斥，但 fail-fast 改为可取消 FIFO。
- workspace 锁覆盖祖先 / 后代根路径。
- 接通 undo / redo 的非等待独占，busy 后不延迟执行。
- 验收：一轮并行 3 个 `write_file` 全部成功（可串行，无 busy）；父子根不能同时持 X；undo 在写持锁时 busy，再点一次才执行。

**第二步 — 精确文件写切换到 S + 文件 X**

- 完成文件规范路径、S/X 调度和文件 X 后，**一次性**切换所有 `write_file` / `delete_file`。不得发布「只有文件锁、没有 workspace S」的状态。
- bash / Git / integrate / undo 继续拿 workspace X。
- 验收：不同文件同时在执行；同文件 write/write、write/delete、delete/create 串行，before/after 能连成正确动作序列；目录软链接别名、创建前后身份变化、无关前缀目录、独立 worktree；shell 写与精确文件写互斥；Host checkout 与经 shell 的 checkout 都走独占。

**第三步 — 性能（独立，非修 busy 所需）**

- 评估独立 worktree / 快照上跑测试。任意 shell 默认仍为 X。

落地后补短 ADR，关联 0030。现有「重叠即 busy」的测试改为等待后成功；undo 路径保留 busy。评审建议在实施并确认架构与用户可见行为之前，不记成已采纳 ADR。

---

## 5. 验收（实施时）

除各步所列外：

- 写者排队后新 S 不插队；等待者取消、获锁同时取消、执行失败、重复 release、队列清理。
- 权限等待不持锁；排队后 Run / generation 失效不执行。
- integrate 先等业务队列再等 workspace X；任一等待阶段取消均保留子 worktree；commit point 后不伪报未执行。
- SDK / RPC 使用同一套 Host 注册与门禁。
- 按仓库规则：typecheck、相关包测试、架构边界检查。

基线（评审时，未改产品代码）：`workspace-write-gate`、`host-filesystem-tools`、`git-commands`、`subagent-integration-coordinator`、`turn-change-commands` 共 39 项测试通过。

---

## 6. 范围

本方案协调 **Host 受管入口** 在项目工作区上的写入。跨 Host 进程锁、按内容 hash 检测外部编辑器、把模型主编辑面改成一次多文件 patch，另案处理。
