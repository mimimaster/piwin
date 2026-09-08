# SessionPlan 文档完整性与失败可见性 — 评审修订执行计划

日期：2026-09-08
状态：**T1–T6 代码与针对性测试已落地（ADR 0070）；T7 跨进程锁未做；测试构建 smoke / 产品 Host 复测未做**。
配套规格：[SessionPlan 完整性规格](../specs/2026-09-08-session-plan-integrity.md)。

> 本次交付是方案评审与修订，不是下列任务已实施。旧版的“已落地，不要重做”不再是验收依据：保留已有正确实现，按下面的反例补缺口。工作树有大量其他会话改动，实施时以当时 diff 为准。

**结论：保留 JSON + 每路径锁内读改写 + atomic rename，以及 failed Run 自己的错误气泡。补上显式版本前置条件、执行身份校验和持久化终态收口。** 不需要迁移 plan 到 SQLite，也不需要新 Host 全局锁。

更合适的收口位置是现有 `finalizeRunTranscriptArtifacts` / Host 终态链路：在那里保证失败记录存在，让正常失败、准备失败和 worker crash 共用同一不变量。仅在 `persistHostRuntimeFailure` 的无 recorder 分支追加一行，会漏掉其他失败入口。

**交付分两层：** T1–T6 修复当前单 Host 事故链；T7 单独加固防御性跨进程锁。T7 完成前不得声称支持跨进程文档互斥；不能把有缺陷的 index 锁抽出来就算通过。

## 0. 问题描述（必须先读）

### 0.1 用户看到了什么

会话 `session-mtrd9yjq-ux6mcpgr`（Inkstone 主题计划执行中）。用户在上一轮模型已经给出「硬伤三件套完成汇报」之后，贴了一张截图问「这是你干的吗？」——**连发两次**。

现象：

1. 用户消息出现在 transcript 里（文字 + 粘贴的截图都落盘了）。
2. 没有新的 assistant 回复，没有思考，没有工具，没有红色错误卡。
3. Host 没有断连提示。侧栏也没有「失败」节点（因为失败被画到了上一轮成功回复上，主工作台不认）。
4. 看起来像整轮会话宕机。

这不是「模型卡住」或「网断了」。Host pid 53315 全程存活，`~/.piwin/.host/owner.lock` 心跳正常。

### 0.2 磁盘和时间线（UTC）

| 时刻 | 事实 |
|---|---|
| 09:06:35 | `plan.execution.status = failed`，error = `subagent runtime generation unavailable for parent session session-mtrd9yjq-ux6mcpgr`，runId `354eef75-9ef4-429d-acc7-5b281565d5cb` |
| 09:07–09:25 | 用户「先把硬伤问题解决一下」；模型在父会话 inline 干活，多次调用 `piwin_plan_set_step` |
| 09:25:20 | native toolResult：`piwin_plan_set_step` → `Tool error (execution-failed): Unexpected non-whitespace character after JSON` |
| 09:25:41 | 上一轮 assistant `piw-m-f975725a5600005bcaacd0f8` 以 `outcome: completed` **同时**带 `failure.message` 结束 |
| 09:27:13 / 09:27:58 | 用户两次「这是你干的吗？」+ 截图；`transcript_message.run_id` 空；没有新 assistant 行 |
| 磁盘 | `plan.json` 前 **5957** 字节是一份完整 JSON（`status: executing`，rev 3）；之后挂着旧 execution 块残渣，从 `4-429d-acc7-5b281565d5cb` 起。坏文件备份：`plan.json.bak-corrupt-20260908-094331`（8138 字节） |

原调查记录的残渣形态与重叠整文件写入一致，但仅凭坏文件不能唯一证明具体的 fd 交错顺序。本次评审未重新取证用户数据；以下时序是原调查推断，代码中的无保护写路径和当前竞态缺口需分别验证。

### 0.3 根因 A：`plan.json` 被同一 Host 进程撕开

事故发生时 `saveSessionPlan` 是裸 `fs.writeFile(path, json, 'utf8')`。Node 的 truncate 发生在 **open('w') 时，不是 write 时**。两个重叠的 writer 各自持有 fd：

```text
A open('w') → 文件长度打到 0 → 开始写一份较长 JSON（带完整 execution）
B open('w') → 再次 truncate → 写完一份较短的完整 JSON → close
A 还按自己原来的偏移继续 write → 短 JSON 后面接上 A 的尾巴
```

谁在并发写？同一 pid 53315 里：

- 模型工具 `piwin_plan_set_step`：load → 改 step → save 整份
- Host `runPlanExecution.markFailed` / `markRunning`：再 load 一次，改 `execution`，**整份写回**

`markFailed` 事故时的形状：

```ts
const current = await loadSessionPlan(planPath); // 队列外
const updated = recoverPlanAfterExecutionFailure(current, state);
await saveSessionPlan(planPath, updated);       // 只串行化写也不存在
```

### 0.4 根因 B：Host 有锁，但锁的不是这份文件

| 锁 | 路径 | 护什么 | 管不管 plan.json |
|---|---|---|---|
| Piwin root owner | `~/.piwin/.host/owner.lock` | 整个 `~/.piwin` 只能有一个 Host 进程 | 否。同 pid 内的并发写照样发生 |
| Session runtime lease | `runtime-leases/<sessionId>/` | 谁占着这个会话的 Pi runtime | 否。心跳，不是文档锁 |
| Session operation lock | `locks/session-operations/<sessionId>.lock` | 归档 / 删除 / 冷存储 | 否。plan 工具与 `plan/execute` 不走这条 |
| Session index lock | `sessions-index/index.json.lock` + 进程内队列 | **只有** session 列表的读改写 | 否。这是 plan **应该抄** 的范本，事故时没接上 |

`owner.lock` 解决的是「两台 Desktop / CLI 不要同时当 Host」。它保证 **单写者进程**，不保证 **进程内单写者文件**。

Session index 的分层思路可复用（`packages/session/src/session-index-store.ts`）：

1. 进程内 per-path Promise 队列
2. 同目录 `.lock` 文件（跨进程，link 原子占位）
3. `writeTextFileAtomic`（temp + fsync + rename）
4. mutator 的读改写在锁里；公开整份保存接口不因此获得 CAS。现有死锁回收还有竞争窗口，见修订任务 T7。

### 0.5 根因 C：失败被画到上一轮成功回复上，卡片按规定不显示

`docs/specs/2026-08-30-turn-error-run-outcome-gate.md` 规定：

> `TurnErrorCard` 只在 `runOutcome === 'failed'` 且是该 turn 最后一条 assistant 时绘制。

这是对的：Pi 重试期间不能把中间 error 画成终态。但它有一个隐含前提：**失败的 Run 必须有一条属于自己的 assistant 行**。

事故路径打破了这个前提：

1. `preparePromptInput` **先** `recordUserPrompt`（用户气泡出现）
2. 再 `loadSessionPlan` → 当时 `JSON.parse` 抛 `Unexpected non-whitespace character after JSON at position 5957`
3. `executeSessionTurn` catch → `persistHostRuntimeFailure`
4. 此时 runtime 还是上一轮的 recorder；`persistAssistantFailure` 用 `lastAssistantId` 回退到上一轮已 `completed` 的气泡
5. 给那条气泡盖上 `failure`，但 `runRecordsById[oldRun].outcome` 仍是 `completed`
6. 主工作台 **没有** `conversation-pane-error` 横幅（那条只在 conversation pane）
7. 下一次 `user/send` 还会把 `state.error` / `runTerminal` 清掉

用户看到：自己的话在、Host 连着、没有任何红错。

即使文件不再撕裂，若仍是 load（队列外）→ save（队列内），A 读 rev 3、B 读 rev 3、A 写出带 step=done 的 rev 4、B 再写出带 execution=failed 但 step 仍是旧值 —— **步骤更新丢失**。物理完整 ≠ 逻辑完整。

### 0.6 产品合同（根治必须同时满足）

1. **文档合同：** 对同一 `plan.json` 的变异走同一文档临界区（包括 clear、恢复和隔离），业务修改用 `updateSessionPlan`。临界区里读到的是前一个 writer 已经 rename 上去的整文件。`execution` 更新基于锁内当前值，并核对 planId + execution.runId；失败恢复允许按既有规则调整 plan.status，禁止拿入场快照整份写回。
2. **失败合同：** 每个终态 `failed` 的 `session-turn` Run，必须在 transcript 留下一条 `runId` 等于该 Run 的 assistant 行，带 `failure`。禁止写到任何其他 Run 的气泡上。
3. **Prompt 合同：** `plan.json` 损坏不得杀死 turn。计划是增强上下文，不是准入条件。

### 0.7 明确不做

- 不把 `plan.json` 迁进 SQLite。
- 不加跨会话的全局 plan mutex。
- 不把 plan 写塞进 `session-operations` 锁（那把锁等 10 分钟、给归档用）。
- 不放松 `TurnErrorCard` 的 run-outcome gate。
- 不为「计划上下文缺失」单独弹模态。
- 不借这次升级无关依赖、不顺手改 Inkstone / transcript CSS。

---

## 1. 本次评审证据与优先级

以下结论来自当前工作树，不把旧事故记录当作本次重新取证结果。

| 优先级 | 发现 | 证据与影响 |
|---|---|---|
| P1 | revision 单调不等于 CAS | `plan-store.ts:commitPlanRevision` 接受与 current 相等的 revision 并自动加一。A、B 都从 rev2 生成 rev3，A 提交后 B 仍成功，能覆盖 A 的 step。临时探针已复现。 |
| P1 | 入场校验仍有锁外窗口 | `commands/plan-commands.ts:handlePlanExecute` 在锁外检查 expectedRevision / approved；锁内只重查 id 和 execution 状态。`startPlanRun` 已发生后提交失败也没有对应收尾；传给 orchestration 的还是旧 `plan`。代码检查确认。 |
| P1 | 锁不能阻止旧执行回调写新执行 | `markRunning/Failed/Completed` 没有核对 execution.runId；子任务回写 childSessionIds 分支连 aborted 都不检查。取消后批次返回可覆盖终态；同一 plan 再执行后旧回调可覆盖新 Run。代码检查确认，需真实 handler 回归。 |
| P1 | 错误事件证据不代表已持久化 | RunRegistry 在接纳 error 事件时置位；`persistStructuredFailureIfNeeded` 因该标志直接 return。空 store + 标志 true 时没有合成行，探针已复现。 |
| P1 | recorder 存在但失效时没有存储兜底 | recorder.recordEvent/flush 抛错后只 warn；即使 store 健康也不补行，探针已复现。worker crash 还绕过该函数，只 settle 已有行。 |
| P1 | Desktop 的旧 Run 隔离不完整 | `markLatestAssistantFailure` 先对所有消息的 running tools 标 error；新 Run 失败会修改旧 Run 工具，探针已复现。event:error 的 streaming fallback 也未排除明确属于其他 Run 的 assistant。 |
| P2 | 损坏、缺失、I/O 失败混在一起 | `{}` / 空文件返回 null 而不隔离；前缀恢复直接覆盖且无诊断、无原始备份。`{}` 未隔离已复现；恢复写失败还会使 load 抛错，与旧规格冲突。 |
| P2 | index 自动回收不是可直接复用的保证 | 两个 waiter 都读到 dead PID 后，各自 rm(lockPath)；一个已经获得新锁时，另一个仍可能删除新锁。release 也是无条件 rm。不能用同进程 Promise.all 证明跨进程互斥。 |

已运行的现有测试：session 35、host-runtime 47、Desktop 42，**共 124 项通过**。这些是基线，不证明上表缺口已修。五个临时探针确认了当前错误行为；临时数据均在 `/private/tmp`，已清理，没有修改 `~/.piwin`。

CAS 反例的核心顺序（两个保存都成功，最终 step 退回 pending）：

```text
磁盘 rev2 / step=pending
A = 基于 rev2 的快照，revision=3 / step=done
B = 基于 rev2 的快照，revision=3 / step=pending / title=changed
save(A) → 磁盘 rev3
save(B) → 当前实现认为 revision 相等可以自增 → 磁盘 rev4 / step=pending
```

## 2. 实施约束与真实进度

- `@piwin/session` 拥有文档 I/O 和 transcript 存储操作；Host 编排在 `@piwin/host-runtime`；Desktop 只投影。跨壳协议变更先改 `@piwin/contracts` 并迁移全部客户端。
- TypeScript strict / ESM；无新依赖；不碰无关主题、字体、CSS、Pi 内核和用户历史文件。
- 已有 `updateSessionPlan`、atomic helper、recorder run 隔离、prompt catch 和 UI 合成气泡应复用，但必须通过新增反例测试。
- 本次读到的文件行数：plan-store 184、session-index-store 809、plan-commands 727、prompt-preparation 859、store-transcript-recorder 844。要扩展后面四个多职责文件时先按职责拆分；不再使用“只加 50 行就不用拆”的例外。
- 所有新增测试写进对应包；大测试文件也受 1000 行限制。已有 `host-runtime.test.ts` 超限，不继续往里面堆 plan 竞态测试。

| 任务 | 当前状态 | 完成依据 |
|---|---|---|
| T1 文档 mutation / CAS | 部分实现，有确定反例 | 同版本旧快照冲突；锁内更新不丢字段 |
| T2 损坏读取与恢复 | 部分实现 | 原字节保留、可诊断、prompt 继续 |
| T3 执行入场和回调 | 迁过 mutator，但身份/终态保护缺失 | handler 级交错测试 |
| T4 failed Run 持久化收口 | 无 recorder 分支存在，其他分支仍漏 | SQLite 重开后可见且幂等 |
| T5 Desktop 投影 | 基本气泡存在，隔离与乱序待补 | 旧 Run 不变、live retry 不误报 |
| T6 集成、文档、构建验收 | 未完成 | 全局检查 + 测试构建 smoke |
| T7 跨进程锁加固 | 未实现于 plan-store | 独立进程测试，不以 Promise.all 代替 |

## T1 — 钉死文档 mutation 和 CAS

**拥有：** session/plan-store、plan-store.test；如改变 Host 请求前置条件则先改 contracts。

1. 保留每路径 Promise 队列与 `writeTextFileAtomic`。load 中的修复、update、create、clear、隔离必须走同一临界区。内部读取函数不再调用公开加锁函数，避免同路径重入死锁。
2. 路径使用 Host 生成的规范绝对路径；至少统一相对路径和 `..`。限制别名路径，不宣称解决任意符号链接/网络文件系统协同写。队列在最后一个任务结束后按 Promise 身份删除；任务失败不能毒化队列。
3. `updateSessionPlan` 的 mutator 只使用锁内 current，不做异步工具调用、push、RunRegistry 操作或重入文档 API。`null` 明确表示 no-op，并返回当前文档；删除只能用 clear。调用方不得把“返回非 null”当作“刚才成功修改”。
4. **存储层负责提交版本**：同一文档每次实际提交为 current.revision + 1；创建使用确定的初始版本。不要用 next.revision 大小判断调用方有没有过期。迁移 `applyPlanStepUpdate` 等现有自增逻辑，防止双增；revision 限为非负安全整数。
5. 对外部整份快照使用独立前置条件，例如 `expected: { planId, revision }`，在锁内比较 **current**；`expected: null` 表示仅当不存在才创建。不要从已经加工的 next.revision 反推基准版本。新旧协议的缺省语义必须写清楚；已有文档的无条件整份覆盖不允许静默成功。
6. `saveSessionPlan` 若保留，只能在代码中强制 create-only（current 存在则报稳定错误）；测试夹具更新改用 mutator 或明确的 raw fixture writer。仅靠注释和 grep 不构成保护。`plan/set` 也必须使用前置条件，不能用 previous.revision + 1 给旧整份快照“洗成新版本”。
7. mutator 使用前验证读取结果，提交前验证输出。对象 id/sessionId/execution 归属按合同校验；复用现有领域函数，不创建通用 repository 框架。

**必要回归：**

- 两个相同基准版本、都提前 +1 的整份快照：第二个冲突，第一处变更保留。
- step 更新和 execution 更新从锁内 current 派生：二者均保留，提交版本逐次 +1。
- 连续提交不同长度的 20 个 mutator；并发读者只能读到完整旧版或新版。不要并发调用 20 个 create-only save 并要求全部成功。
- mutation 抛错后下一个任务成功；clear 与 update 串行，clear 后旧身份更新不能重建被删除的计划。
- create-only 并发创建恰好一个成功；no-op 不增加 revision；路径规范化后不出现第二把队列锁。

## T2 — 读取损坏文件：保留证据，普通 prompt 可降级

**拥有：** session 的文档解析/恢复模块；Host prompt 边界负责日志与降级。

| 情况 | 存储语义 | 普通 prompt |
|---|---|---|
| ENOENT | 正常缺失 | 不注入 plan，继续 |
| 合法且校验通过 | 返回计划 | 正常注入 |
| 完整有效对象 + 尾随垃圾 | 备份原字节，再恢复有效前缀并 atomic 写回；发恢复诊断 | 可使用校验后的前缀，继续 |
| 空文件 / JSON 语法坏 / schema 无效 | 保留原字节并隔离；返回可区分的损坏结果 | warn 后跳过，继续 |
| EACCES / EIO / 锁超时 | 保留原文件，返回或抛稳定 I/O 错误，不冒充不存在 | Host warn 后跳过，继续 |
| 备份或修复写失败 | 不破坏原字节；报告失败。已校验前缀仍可作为只读结果 | 继续；写命令不能据此报告成功 |

- 内部读取使用判别结果区分 missing / valid / recovered / corrupt；可保留现有简便 load 外观，但必须提供诊断出口。session 包不直接 push Host 事件。
- 不依赖 V8 SyntaxError 的英文 `at position` 文案提取切点。使用受大小上限约束的顶层对象扫描（正确处理字符串、转义、括号），再 JSON.parse + schema validate；不猜补截断 JSON。
- 原始备份使用唯一名字，避免同毫秒冲突；先成功保存原字节再发布修复。有效前缀只表示可恢复部分，不承诺旧尾巴里的 steps/execution 已找回。
- 只因文件不可读不能当作“首次创建”去覆盖；显式重新建计划前必须确认损坏证据已保留。
- `writing-plans` / plan mode 的完成时持久化要求仍存在；增强上下文可降级不等于这些请求可以假装已生成计划。

**测试：** 空字节、`{}`、缺必需字段、有效前缀 + 垃圾、截断字符串、转义引号、UTF-8 内容、超限文件；注入备份失败 / rename 失败 / EACCES，确认诊断和原字节不丢。prompt 集成必须断言实际调用到了 `liveSession.prompt`，不能只断言 prepare 没抛错。

## T3 — 执行入场、取消与旧回调隔离

**拥有：** Host plan commands / execution orchestration。先将 `runPlanExecution` 按职责从 727 行命令文件拆出，保留原行为的重构单独提交。

### T3.1 入场必须依据真正提交的计划

- 锁内重新检查 planId、expectedRevision、可执行 status、approveDraft 和 execution 非活动态；锁外预检只能用于尽早给反馈。
- `startPlanRun` 和磁盘提交不是一个事务：复用现有 Run 预留机制；若 Run 已创建而文档提交失败，立即通过 RunRegistry 收尾该 Run，不能遗留 queued/running。
- 不在文件锁里等待 prompt、runBatch 或任何其他长 I/O。提交完成后用 **executingPlan** 启动编排，不再传入最初 load 的 plan。
- 入场提交失败不发成功 `plan/updated` / execution push；释放预留并返回原始失败原因。

### T3.2 每个异步回调携带执行身份

统一校验锁内 `current.id === admittedPlanId` 且 `current.execution.runId === planRunId`；覆盖 markRunning / markFailed / markCompleted / childSessionIds 回写 / 取消后的 continuation。

- 身份不匹配或文档已清除：停止旧编排，收尾它自己的 Run；不得修改新计划、发新计划的错误、复活已 clear 的文档。
- execution 的 aborted/completed/failed 是该次执行的终态；迟到子批次不能改回 running。重试必须是新的 runId，并经过重新入场。
- execution 的字段更新基于锁内 current.execution；child ids 合并去重，保留别人已提交的字段。status 的合法转换继续复用领域函数。
- 完成判断（全部 steps 终态）与最终 status 写回在同一 mutator 检查；不能用锁外 latest.steps 判断后无条件完成。
- no-op 与 committed 必须在 Host 调用结果中可区分；不要在 mutator 里先改外部 state，再以此向 UI 宣布成功。
- 磁盘写失败时仍要结束对应 Run；外层 catch 再调用同一失败写路径、再只 log，不算收尾。保留首个错误与必要诊断。

**必须用真实 handler / orchestration seam + deferred barrier 测试：**

1. 入场预检后、拿到文档锁前，另一请求更新 revision 或撤销批准 → 入场被拒，未调用 prompt，没有悬挂 Run。
2. `runBatch` 挂起 → `plan/abort` 成功 → 批次返回 → 磁盘仍 aborted/abandoned，不启动 verification。
3. 旧 Run 被取消后同 plan 重执行（或 clear 后新建），旧成功/失败回调返回 → 新 execution 和 steps 不变。
4. 真正的 plan step 工具与执行失败交错 → step 保留，execution failed，合法 plan status 恢复。
5. 入场、markFailed、markCompleted 各自写盘失败 → Run 恰好一次进入相应终态，无后台悬挂。

用“等价 mutator”测存储层只能证明锁，不能替代以上 Host 回归。

## T4 — 在终态收口处保证 failed Run 有持久化消息

**优先复用：** `transcript-stream-settler.ts:finalizeRunTranscriptArtifacts`、`terminateHostRun`、worker crash 的 finalization。具体 transcript 查询/事务在 `@piwin/session`；Host 负责选择终态与推送，RunRegistry 仍是唯一终态权威。

1. 所有 failed 的 session-turn（模型失败、自发 abort、prepare 失败、worker crash）都进入同一“确保失败证据”的存储操作。先审计所有终态入口，不能只改 session-turn-outcome。
2. 存储操作在事务里找**该 Run 当前活动路径的最后一条 assistant**，存在则补终态 failure/outcome/endedAt；不存在则插入错误行。使用有界查询；不全量重载 transcript，也不跨 run 使用 lastAssistantId。
3. `hasRunAgentErrorEvidence` 仅用于事件发送去重，不能跳过持久化校验。已有中间 retry failure 时，最终失败原因必须是本次终态原因；completed/cancelled/paused 不合成失败气泡。
4. recorder 正常时等待其队列/flush；recorder 缺失、disposed、抛错或吞掉 identity collision 时都按实际存储结果兜底。不要用“recordEvent 被调用了”作为落盘证据。
5. 使用稳定的 run 级合成 id，并固定 provenance：Host 合成行不借用“当前 foreground run”可能已经变化的 runtime generation。已有同 Run 的 recorder 合成行优先复用，不因两套 id 格式插两条。
6. 相同 runId 重复终态、事件重放、recorder 与 Host 回退竞争，都只能得到一条失败目标行；保留已有文本/工具。重复 id 的 `appendMessage` 是 no-op，更新最终 failure 应显式 patch，不能期待重复 append 更新内容。
7. 终态持久化与 streaming settle 的顺序必须防止旧 recorder flush 覆盖 final metadata；用现有队列/barrier 与存储终态保护实现，写测试证明。
8. 在 store 可写的正常条件下，持久化成功后才发布 terminal。store 也不可写时，仍必须结束 Run 并发出带 failure 的 terminal，让连接中的壳可见；记录持久化失败诊断，不能声称重启后仍有气泡。此异常不能无限重试阻塞 Run。

**测试用真实临时 SQLite，关闭重开后再断言：** 无 recorder；只有上一轮 recorder；recorder 抛错但 store 正常；errorEvidence=true 但无行；已有本 Run assistant；先中间错误后另一终态错误；重复调用；worker crash 在首条 assistant 前；store 不可写仍 terminal。检查 runId、failure、outcome、endedAt、行数、旧回复内容与旧工具状态。

## T5 — Desktop 只做同 Run 投影与持久化结果合并

- 保留 `TurnErrorCard` 的 `runOutcome === failed` + 本 turn 最后一条 assistant gate。
- `event:error` 只是 live evidence；不得单凭它结算 Run，也不得在模型仍重试时显示终态错误卡。合成占位或 failure 缓存必须在后续正常 assistant 到来/Run completed 时合并或清理，不能留下空白错误行。
- `markLatestAssistantFailure` 仅处理目标 Run 的 assistant 和 tools；禁止先 map 所有 messages 改工具状态。streaming fallback 只允许在可证明属于本次 turn 且未带其他 runId 的占位行上使用；无法关联的 event 不猜测归属。
- `run/terminal failed` 缺本轮 assistant 时合成一条，保持稳定 run 关联。乱序 error / terminal、重复 terminal、断线恢复均不创建重复气泡。
- SQLite hydrate 的 Host 行是持久化依据。合并时按 run 与持久化消息身份消除 UI 占位，不把两个 id 当成两条真实回复；新旧 Run 都在窗口内时落在各自 user turn 下。
- 验证“重新发送/重试”取的是失败 Run 对应用户输入（含图片），不误用上一轮或已经发送的下一轮。

**测试：** 老 completed assistant 携带遗留 running tool；明确不同 runId 的 streaming assistant；中间 error → 新 assistant → completed；error/terminal 两种顺序；重复推送；冷启动 hydrate；实际 row/TurnErrorCard 只在新失败 turn 出现且可重试。纯 `resolveTurnErrorMessage` 测试不足以证明整条渲染链。

## T6 — 集成、邻近审计与交付

1. 搜索所有 `saveSessionPlan(` / `updateSessionPlan(` / `clearSessionPlan(` 调用和别名，清理真实残留 RMW；无用的大 import 块只在涉及文件中收口。
2. 保留 `saveSessionTranscript` 审计，记录每个 writer 的运行期所有权。fork/duplicate 一次性目标文件与活跃 recorder 写盘不是同一类路径。需要物理完整性时复用 `writeTextFileAtomic`，不要再增加第三个 atomic 实现；需要 RMW 时必须一并解决读改写串行，单换 rename 不算逻辑修复。该审计发现的独立行为变更单独提交。
3. 不为 subagent-runs/flashcards 加无意义注释，也不跨 application 包搬文件 helper。
4. 短 ADR 随实际实现提交，状态准确注明已实现/未验收，并引用本规格和 ADR 0025、0002、0040、turn-error gate。编号实施时查最大值。方案评审阶段不预先宣称已发布。
5. 在一次性测试 root 中进行 Host + Desktop smoke：上一轮 completed → 新 user（含图片）→ prepare 故障；损坏 plan → 正常 prompt；新 draft → inline 推进；abort → 子批次迟到；冷启动恢复失败气泡。
6. 构建验收记录源码 revision、未提交补丁标识、bundle 产物身份/哈希和实际 Host 进程。`processStartedAt` 只能证明重启，不能证明运行了新源码。测试构建通过后才在获授权的产品环境复测；不要默认重启用户正在工作的 Host，也不要在真实会话写坏 JSON。

**现有基线命令（本次全部通过）：**

```bash
pnpm --filter @piwin/session exec vitest run src/plan-store.test.ts src/session-index-store.test.ts
pnpm --filter @piwin/host-runtime exec vitest run src/plan-step-tool.test.ts src/plan-create-tool.test.ts src/store-transcript-recorder.test.ts src/commands/session-turn-outcome.test.ts
pnpm --filter @piwin/desktop exec vitest run src/run-failure-message.test.ts src/chat-reducer-events-late.test.ts src/turn-error-presentation.test.ts
```

实现完成还要运行：

```bash
pnpm typecheck
pnpm --filter @piwin/session test
pnpm --filter @piwin/host-runtime test
pnpm --filter @piwin/desktop test
pnpm test:architecture
```

如跨协议改了 contracts / 其他壳，追加这些包的测试；新增的针对性文件必须真正出现在测试结果中。区分本任务失败和工作树既有失败，不把已有 124 项绿当作最终验收。核对修改源文件行数与 public exports。

## T7 — 独立加固跨进程文档锁

**优先级 P2，依赖 T1；不阻塞 T1–T6 修复当前单 Host 事故。** 根配置仍只支持一个 Host authority；此项针对同机器上遵守锁协议的维护进程，不能支持多台机器共享 root。

- index 的 per-path queue + 同目录原子占位思路可复用；不要原样提取 `removeDeadIndexLock`。普通 `read owner → rm(lockPath)` 和 `stat/token 再检查 → rm` 都仍有检查到删除的窗口。
- 推荐第一版使用原子占位、持有者 token、有限等待、AbortSignal，**不自动抢占/删除陈旧锁**。异常退出留下的锁需要在确认相关 writer 全部停止后的显式维护流程清理；读取增强上下文超时仍按 T2 降级。这是明确的可用性取舍，不是假装已解决自动回收。
- 若必须自动回收，另行给出可证明不会删除新持有者锁的协议及平台依据，再实施。不能靠 sleep、PID 判断或二次 stat 充当证明。
- `.lock` 覆盖创建/更新/clear/恢复；临界区只做文档 I/O。释放操作只对仍属自己的锁执行；没有 writer/维护进程可以绕过同一协议删除别人的锁。
- 如最终抽 `document-file-lock.ts`，index 迁移以独立 commit 保持其错误信息、等待期限和持有者语义；不能把自动回收行为变化伪装成纯搬迁。共享 helper 不需要成为跨包公共 API。

**验收必须 spawn 独立 Node 进程，使用临时目录和通信 barrier：** 两 writer 的 RMW 不丢；存活持有者不可被抢；等待取消/超时不删对方锁；持有者退出后行为符合上述保守策略；维护清理后可再获取；clear/repair 与 writer 互斥。20 路同进程 Promise.all 仅验证队列，不验证此任务。

## 3. 顺序与提交边界

T1 → T2 → T3 → T4 → T5 → T6；T4 的契约/测试可先行设计。T7 是单独加固提交，不扩大当前故障修复的发布前置条件。

- 必要文件拆分单独 refactor commit。
- 文档/CAS、损坏恢复、execution 身份与收尾、Host 持久化、Desktop 投影各自提交，并带自己的测试。
- ADR/规格随实现同步；不混入主题或其他会话的改动。
- 当前 `docs/plans/` 被 `.gitignore` 忽略。本文虽已落盘，正常 git add 不会纳入；交付提交时只对本文路径有意 `git add -f`，不要修改全仓库忽略规则。

## 4. 完成定义

**单 Host 修复完成（T1–T6）：**

1. 文件不会撕裂；同一计划步骤与执行字段并发提交不丢；旧快照被明确拒绝。
2. 旧执行不能覆盖新执行，取消终态不被迟到批次复活；任何写盘失败都不留下悬挂 Plan Run。
3. 首条 assistant 前的 failed session-turn 在 store 可写时有本轮持久化气泡，重启可见；上一轮全文和工具不变。
4. 中间 error 不冒充终态；错误气泡去重、准确关联用户 turn，并可重试原输入。
5. 损坏 plan 保留证据且普通 prompt 继续；I/O 故障可诊断，不当作空文档覆盖。
6. 全局 typecheck、触及包测试、架构检查和测试构建 smoke 有记录；未执行的验证明确标出。

**跨进程加固完成（T7）：** 独立进程用例全部通过，持有/超时/异常退出/维护恢复合同均有证据。在此之前不使用“防御性跨进程已完成”的表述。
