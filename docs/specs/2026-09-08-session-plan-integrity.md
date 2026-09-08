# SessionPlan 文档完整性与失败可见性

日期：2026-09-08
状态：**单 Host 实现已落地（见 ADR 0070）；T7 跨进程锁与测试构建 smoke 尚未验收**。
执行与验证：[修订执行计划](../plans/2026-09-08-session-plan-integrity-execution.md)。

## 1. 问题和证据边界

原事故记录：会话 `session-mtrd9yjq-ux6mcpgr` 在上一轮回复后，用户两次发送“这是你干的吗？”及截图，用户气泡落盘，却没有本轮 assistant 或可见错误卡。Host 仍存活。原调查记录的 `plan.json.bak-corrupt-20260908-094331` 为 8138 字节，完整 JSON 前缀止于 5957，其后存在旧 execution 残留。

原代码存在未保护的整文件 `writeFile`，该文件形态与重叠写一致；具体 fd 时序是调查推断，不是仅凭文件即可唯一证明的事实。本次评审未重新读取或改写用户数据。完整原调查时间线保留在执行计划 §0。

故障链有两条必须同时修复：

1. 计划文件撕裂或旧快照覆盖更新，随后准备 prompt 时读取失败。
2. 本轮失败没有属于自己的持久化 assistant，failure 错挂上一轮 completed 气泡；TurnErrorCard 按 Run 终态过滤后，用户看不到错误。

锁内 RMW + atomic rename 解决文件问题；Host 终态收口保证每个 failed session-turn 有自己的失败证据；普通 prompt 将 plan 视为增强上下文。

## 2. 当前实现，不等同于完整修复

| 能力 | 2026-09-08 评审所见 |
|---|---|
| plan 文档 API | 已有每路径队列、锁内读取/mutator、atomic 写、尾部恢复、语法坏文件隔离；没有跨进程锁 |
| revision | 拒绝低版本，等版本自动 +1；这不是显式 expectedRevision CAS，相同基准的预增快照仍能覆盖 |
| 写调用方 | plan tools / commands 大部分已迁 mutator；plan/set 仍可能整份覆盖；execute 的 revision/status 前置条件仍在锁外 |
| execution | mark* 保留锁内 steps，但未统一校验 planId + execution.runId；子批次回写未保护取消终态 |
| Host failure | 无 recorder 时直接 append 已存在；事件证据 early return、recorder 失败不回退、worker crash 无行时的收口仍有缺口 |
| Desktop | run/terminal 和 event:error 已有合成气泡；跨 Run 工具变更、streaming fallback、重试成功清理和 hydrate 去重待验证/修补 |
| prompt | 已 catch plan load 的异常并 warn；load 返回 null 的损坏情况没有诊断，实际继续调用 prompt 缺回归 |

本次相关既有测试 **124 项通过**（session 35 / host-runtime 47 / Desktop 42）。临时探针复现：预增旧快照覆盖、schema 无效未隔离、事件标志跳过持久化、recorder 失败未走健康 store、新 Run 失败改旧 Run 工具。实现不能再标作“只缺测试”。

## 3. 必须保持的产品合同

### 3.1 文档完整性

所有同路径操作共用文档临界区：创建、更新、clear、恢复、隔离。业务变异从锁内 current 派生；写盘使用同目录 atomic replacement。读者只得到完整旧版或完整新版。

`updateSessionPlan` 的 null 返回表示 no-op，删除另用 clear；调用方明确区分 committed / unchanged / missing。内部读取不重入公开锁 API。mutator 不执行 prompt、工具、push 或 RunRegistry 副作用。

### 3.2 版本和外部快照

存储层统一产生提交 revision；调用方传入的 next.revision 不是冲突检测依据。

- 内部字段变更直接使用锁内 current。
- 外部整份快照必须带独立的预期 planId/revision，锁内严格比较。
- 仅创建操作要求当前不存在；保留 save 时在实现中强制 create-only。
- plan/set 不得用磁盘 current.revision + 1 为过期内容绕过前置条件。
- 新协议字段先定义在 contracts 并迁移 Desktop/CLI/远程调用方；缺省行为和兼容失败必须明确，不静默无条件覆盖已有计划。

### 3.3 执行身份与终态

Plan Run 入场在文档锁内重新验证版本、批准状态、planId 和 execution 活动状态，之后依据已提交计划启动编排。Run 预留与文档提交不是一个事务；提交失败必须结束已创建的 Run。

每个异步 execution 回调携带 admittedPlanId + planRunId，在锁内核对 current.id 和 current.execution.runId。旧身份、已 clear、已终态时不修改文档，不为新执行发错误或成功推送。

aborted/completed/failed 不得被迟到批次恢复成 running。重新执行使用新的 Run 身份。完成条件和写入 done 在同一临界区检查。失败恢复可按既有规则调整 plan.status，但不能覆盖 steps 或其他执行已提交字段。

### 3.4 failed session-turn 的持久化

当 transcript store 可写时，每个终态 failed 的 session-turn 必须有本 Run 活动路径上的 assistant failure，并记录 outcome/endedAt。已有本 Run 最后一条 assistant 则补其终态；没有才合成。保留其他 Run 的消息和工具。

优先在现有 Host `finalizeRunTranscriptArtifacts` / terminate 链路收口，存储事务由 session 包提供。模型 outcome、prepare failure、自发 abort、worker crash 必须覆盖；RunRegistry 仍是唯一 Run 终态权威。

- 收到 error 事件不代表已落盘。内存 evidence 标志只能去重事件，不能跳过存储校验。
- recorder 缺失、disposed、抛错或身份碰撞时，按真实存储状态补写。
- 合成 id/provenance 稳定；重复 terminal、重放和不同写路径不得产生双气泡。
- 终态原因覆盖本轮中间重试错误；不得靠重复 append 更新已存在记录。
- 正常时持久化先于 terminal push；store 也不可写时仍发布带 failure 的 terminal 并结束 Run，记录持久化失败，不承诺重启可恢复该行。

### 3.5 Desktop 可见性

`TurnErrorCard` 继续要求 Run failed 且本 turn 最后一条 assistant。live error 不自行终结 Run，也不打断模型重试的 UI 状态。

只改目标 Run 的消息及工具；未标 runId 的 streaming 占位只有归属明确时才可回退。终态缺行时的 UI 气泡是持久化行到达前的投影，hydrate 时按 Run/消息身份合并。正常回复或 completed 后清理中间空占位；重试准确使用对应 user 输入和附件。

## 4. 损坏读取与普通 prompt 降级

区分缺失、有效、可恢复、损坏和 I/O 错误：

| 情况 | 处理 |
|---|---|
| ENOENT | 正常无计划 |
| 有效计划 | 正常使用 |
| 完整有效对象 + 垃圾尾部 | 保存原字节，报告恢复，再 atomic 发布有效前缀 |
| 空文件 / 语法错误 / schema 无效 | 保留并隔离原字节，报告损坏 |
| EACCES / EIO / 锁超时 | 不当作缺失，不覆盖；报告失败 |
| 备份/修复失败 | 保留原文件和诊断；有效前缀可供只读上下文，写操作不得假成功 |

不依赖 V8 英文异常文本解析 JSON 切点；恢复扫描有大小界限，处理字符串和转义，不猜补截断对象。备份名唯一，不覆盖先前证据。恢复有效前缀不代表能找回旧尾部数据。

session 层提供结构化结果/诊断，Host 转成 warn。普通 prompt 跳过不可用 plan 后继续进入 `liveSession.prompt`。writing-plans / plan mode 的完成时持久化要求保留；这类请求不能在未生成计划时声称完成。

## 5. 锁的范围与两层交付

第一层（执行计划 T1–T6）：单 Host authority 下每路径队列、锁内 RMW、atomic 写、Run 身份与持久化。它足以针对当前事故修复，完成后只声明这层保证。

第二层（T7）：同机器合作进程的防御性文档锁，单独加固，不阻塞第一层。当前 index 自动回收存在多个 waiter 删除新锁的窗口，不能原样提取。推荐先实现原子占位、有限可取消等待、不自动抢占陈旧锁；确认 writer 全部停止后的显式维护恢复是其可用性代价。自动回收若要保留，必须另给可证明安全的协议。

使用不同 Node 进程和 barrier 验证持有、超时、取消、崩溃与维护恢复；同进程 20 个 Promise.all 不构成跨进程证据。不支持多台机器共享同一 root。

不新增全局 Host mutex，不借 session-operations 锁，不迁 plan 到 SQLite，不加新 npm 依赖。相邻 transcript JSON 写者只做有根据的独立审计；不扩展到主题、flashcards 或其他无关领域。

## 6. 验收与文档状态

具体交错步骤、包归属、测试矩阵、检查命令与提交边界见执行计划 T1–T7。

第一层至少证明：相同基准旧快照冲突；step/execution 并发不丢；abort 后迟到批次不复活；旧执行不能改新执行；写失败无悬挂 Run；五类失败路径落 store 后重开可见；Desktop retry/hydrate 不串 Run；损坏 plan 不杀普通 prompt且原字节保留。

实际构建 smoke 使用临时测试 root。记录源码/补丁与 bundle 身份；进程重启时间只能证明重启，不能证明加载了修改后的源码。用户样本会话只做获授权的非破坏复测，不默认重启正在运行的 Host。

ADR 0025（工具提交后 plan push）、0002（单配置 root）、0040（Host 运行时与 transcript 存储）以及 turn-error outcome gate 的边界保持。新 ADR 随真实实现提交；本次方案修订不等于架构已发布或产品故障已修复。

执行计划位于被忽略的 `docs/plans/`；提交时需要有意纳入该单一路径，避免规格链接在版本库内失效。
