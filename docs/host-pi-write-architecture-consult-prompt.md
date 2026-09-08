# 咨询提示词：piwin Host / Pi worker 写文件架构是否合理

把下面「给模型的提示词」整段复制给高级模型即可。
文前「我的判断」是给产品负责人看的，不必贴进提示词。

---

## 我的判断（给你，不是给外部模型）

**大框架合理。有问题的是写锁实现，不是「子进程不本地写盘」。**

合理的部分：

- 模型跑在独立子进程（崩溃隔离、并行子会话）
- 写盘、权限、撤销记录由 Host 主进程执行
- 子任务用 worktree 副本写，再由 Host 合入主项目

这和 Cursor / Codex / Claude Code 的主流方向一致：隔离执行面，权威写路径收敛到产品 Host。

不合理 / 过粗的部分：

- Host 对日常 `write_file` 使用「整项目一把锁 + 拿不到立刻失败」
- 导致模型一轮并行写多个不同文件时大量 `workspace-busy`
- Pi 内核本身已有「同文件排队、不同文件并行」；Host 换成自有 `write_file` 后没带上这套语义
- `bash` 也占同一把整项目写锁，会长时间挡住写文件

建议外部模型重点评估的不是「要不要让子进程写盘」，而是：

1. Host-owned write + worker proxy 是否应保留
2. 写锁粒度与失败策略怎么改
3. 要不要引入 batch patch 类工具（类似 Codex apply_patch）
4. undo / Git / integrate 的整项目互斥如何与日常写文件分层

---

## 给模型的提示词（整段复制）

```text
你是资深系统架构师，熟悉 AI coding agent（Claude Code、Cursor、Codex、Gemini CLI、OpenCode、Pi 等）的工具执行与进程隔离设计。请基于下面的事实做架构评审，给出明确建议。不要用比喻，不要空泛夸奖；要可执行结论。

# 背景产品

piwin 是一个私有 coding-agent shell，内核用 Pi（独立包），产品 Host 在 Node 里。

约束（硬性，不要建议违反，除非你论证必须改 ADR）：

1. UI / apps 不直接 import Pi。
2. 只有 packages/agent-host 可以依赖 Pi。
3. packages/host-runtime 是产品组合根：权限、会话、工具执行、Git、子代理编排等都在这里。
4. 生产路径使用 piwin 自有 worker 子进程跑 Pi session（不是 stock `pi --mode rpc`）。
5. worker 不在本地执行有副作用的 Host 能力：写文件、bash、MCP、Git 变更、密钥解析等；这些通过 JSONL tool-call 代理回 parent Host 执行。
6. 目标是 SDK 路径与 Worker 路径对模型暴露同一套工具名与同一条权限/执行管线。
7. 产品有「本轮撤销」：Host 需要记录受控写入的 before/after，才能撤销本轮文件改动。

# 当前写文件架构（事实）

## 进程分工

- Parent：Host（host-runtime）
- Child：Pi worker（一个 runtime generation 一个 worker；跑模型与 Pi session）

## 工具暴露

- Pi built-in 在 worker 里只开放只读类：`read` / `grep` / `ls`（部分策略还有 `find`）
- Pi built-in `write` / `edit` / `bash` / `execute` 被架构测试禁止进入 `piBuiltinToolNames`
- 模型写文件调用的是 Host 注册的 `write_file`（还有 `delete_file`、`bash` 等）
- worker 把这些 Host 工具登记为 proxy customTools：Pi 调用 → worker 发 tool-call 帧 → parent 的 SessionHostToolExecutionPort 执行 → 回 tool-result

## write_file 在 Host 上的实际顺序

1. 校验 session / runtimeGeneration / run 是否仍允许执行
2. 权限引擎（allow / ask / deny）
3. 尝试获取 workspace write gate（见下）
4. 通过 turn-change writer 写盘并记录 before/after（用于本轮撤销）
5. 释放 gate

## workspace write gate（当前实现）

文件：packages/host-runtime/src/turn-changes/workspace-write-gate.ts

语义：

- 按项目根目录 realpath 做进程内互斥锁
- 粒度：整个 workspace，不是文件路径
- 策略：tryAcquire；已被占用则立刻返回失败 reason=`workspace-busy`
- 不排队、不等待
- 使用方包括：`write_file`、`delete_file`、`bash`、`run_bash`、Git 写命令、子代理 integrate 到父仓库
- `runId` 传入但未用于同 Run 共享
- 类型里还有 `workspace-restoring` / `foreign-host-active`，当前实现基本只返回 `workspace-busy`

## 用户可见问题

模型在一轮中并行发起多个 `write_file`（不同文件）时，经常出现：

```
Tool error (execution-failed): workspace-busy
```

这很常见。若同批还有长时间 `bash`，或多个会话/Git UI/子代理合入占用同一把锁，可能出现多个 write 全部失败。

## 历史

- 更早：曾用 Pi `write`/`edit`，通过注入 local operations + gated-file-tools 做权限。
- 后来为了 worker 隔离与单一 Host 工具管线，改为 Host-owned `write_file`，并关掉 worker 内 Pi write/edit/bash。
- Pi 内核自己的 `write`/`edit` 内部有 `withFileMutationQueue`：同一文件串行排队，不同文件并行；失败不会因为“项目里有别的写”而立刻报给模型。
- Host 换成 `write_file` 后，没有把这套按文件排队语义搬到 Host。
- 产品自己的撤销实施方案曾写过：不同路径允许并发；undo 阶段才 workspace 独占。落地却变成日常 tool write 也整仓独占 + fail-fast。
- 子代理 integrate 另有队列（会等待）；tool write 却是 fail-fast。同锁两套语义。

## 已有相关能力

- 子代理并行写：用 git worktree 隔离；合入父仓库时走 Host 串行 integrate + workspace gate
- 合入父仓库写盘：`applyTreeDiffToWorkspace`（bounded writer），不是让子进程直接改父工作树
- Host 已有 `createPiFileToolDefinitions(operations)` 缝，可把 Pi write/edit 的 IO 换成注入实现，但生产未接线
- 包边界：host-runtime 不能 import Pi，因此不能直接调用 Pi 的 `withFileMutationQueue`；可以在 host-runtime 内实现同类算法

# 竞品对照（供你验证/纠正）

- Pi：工具默认可并行；同文件 mutation queue；不同文件并行
- Claude Code：只读并行；写工具有过整批串行/并行写失败的用户投诉；多会话靠 worktree 隔离
- Gemini CLI：只读并行；后来对同路径 mutator 串行，不同路径可并行
- Codex：常用 apply_patch 一次改多文件；多 agent 靠 worktree；并行 git 写撞 index.lock 被视为 bug
- OpenCode：按文件 semaphore/flock，等待而非整仓 fail-fast
- Cursor：多 agent 用 worktree；大规模共享锁协调曾因吞吐与泄漏问题放弃

请不要假设竞品细节绝对正确；若你有更准确知识请指出并据此修正建议。

# 需要你回答的问题

请按顺序回答：

## Q1. 总判断

「模型在 Pi worker；写盘/权限/撤销在 Host；worker 不本地执行 write/bash」这套大框架，对 piwin 这类产品是否合理？
给出：合理 / 基本合理但有前提 / 不合理。并写清前提或主要风险。

## Q2. 子进程能不能本地写？

在保留权限与本轮撤销的前提下，是否值得让 worker 重新获得本地 write（或 Pi native write + 注入 operations）？
请比较至少三种选项并选一个推荐：

A. 维持现状：worker 只 proxy，Host 执行 write_file
B. worker 内恢复 Pi write/edit，IO 注入并最终仍由 Host 落盘/记录
C. worker 本地直接写盘，Host 事后扫描/审计
D. 你提出的更好选项

对每个选项写：收益、代价、对撤销/权限/双后端一致性的影响。

## Q3. workspace-busy 根因与修法

当前整项目锁 + fail-fast 是否过设计或设计错位？
请给出你推荐的锁模型，必须具体到：

- 锁粒度（workspace / 文件路径 / 其他）
- 冲突策略（fail-fast / 排队等待 / 超时）
- 哪些操作仍需要整项目互斥（undo、Git、integrate、bash？）
- bash 是否应与 write_file 共享同一把锁
- 同 Run 并行 write 不同文件的期望行为

## Q4. 是否要引入 apply_patch 类工具？

为减少并行 write_file，是否应把模型主编辑面改成单次多文件 patch？
这是并发方案还是产品形态方案？对 piwin 当前多模型（不只有 Codex 风格）是否合适？

## Q5. 推荐落地路线

给出一个最小可行改动顺序（1–3 步），每步：

- 改什么模块
- 不改什么
- 如何验收（测试场景）
- 风险

## Q6. 明确不要做什么

列出你认为当前最不该做的 3 件事（例如重开 worker 本地写、整仓锁继续 fail-fast、上 OS sandbox 只为修 busy 等），并各用一句话说明原因。

# 输出格式

1. 先给 10 行以内的总结论
2. 再按 Q1–Q6 分节
3. 最后给一张「决策表」：选项 | 推荐? | 一句话理由
4. 不要比喻；术语第一次出现时用括号做简短定义
5. 如果你发现上述事实自相矛盾，先指出矛盾再给建议
```
