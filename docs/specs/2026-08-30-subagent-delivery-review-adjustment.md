# 子代理交付、Review 与本轮撤销 — 可执行调整 Spec

| 字段 | 内容 |
| --- | --- |
| 状态 | V1 / 待审；仅文档，未授权实现 |
| 日期 | 2026-08-30 |
| 产品目标 | 用户在主对话验收本轮整体成果，不必逐个进入子代理决定是否保留文件 |
| 基于 | 当前仓库实现、[竞品及代码调研](../plans/2026-08-30-subagent-review-ux-research.md) |
| 关联 | [本轮撤销 Spec](2026-08-30-file-checkpoint-restore.md)、[本轮撤销实施方案](../plans/2026-08-30-turn-change-undo-implementation-plan.md) |
| 不变项 | 仅本轮提示词撤销；不恢复整个目录，不撤整个会话，不删除聊天，不自动提交 Git |
| 实施顺序 | 本文 §12 工作包；全部状态为待实施 |

## 0. 执行摘要与固定决策

正常路径：用户发送提示词 → 主代理分派子任务 → Host 安全整合普通子任务结果 → 主代理检查、修正并验证 → 主回复展示本轮总改动 → 用户按需查看或撤销。

**自动整合只是写入当前工作区，不代表质量验收通过，更不代表提交、推送或发布。** 现有编排器在子任务返回父模型之前整合，本文保留这个顺序；不为每个子任务额外引入一次强制模型审批。主代理承担最终交付责任，Host 承担文件归属、权限、冲突与恢复保障。

| ID | 决策 |
| --- | --- |
| SD-D01 | 新版普通写入子任务默认交付给父任务；不让用户逐一点击保留、接受或应用。 |
| SD-D02 | 只读子任务返回报告，不产生代码采用动作；不因修改默认交付策略而升级其写权限。 |
| SD-D03 | 用户要求候选方案、先看后合时，成果保持隔离，由用户在主对话选择采用。 |
| SD-D04 | 子代理详情默认观察用途：任务状态、过程、摘要和准确差异；移除常驻的“应用 / 保留 / 丢弃”三按钮栏。 |
| SD-D05 | 主回复下每个 attempt 只有一条文件汇总；包含本轮主代理写入及实际合入的子任务变化。 |
| SD-D06 | “执行完成”“已合入”“验证结果”“副本是否仍在”分别表达，不用一个 completed 代替全部含义。 |
| SD-D07 | 冲突、失败、未合入结果在主对话有持久入口；默认保护成果，关面板不丢数据。 |
| SD-D08 | 清理独立副本是次级且危险的操作；不是代码撤销，也不与正常交付按钮并列。 |
| SD-D09 | 已交付父轮之后才采用旧成果，生成新的可撤销文件操作，不改写旧轮统计。 |
| SD-D10 | 同一 Host 命令与服务覆盖 Desktop、CLI、远程；UI 不算差异、不决定整合安全。 |
| SD-D11 | 旧的 retained / conflict / failed 成果不因升级而自动合入或删除。 |
| SD-D12 | 先完成准确记录和恢复保障再切换默认交付；禁止仅把所有 none 换成 auto。 |

### 0.1 本次不做

- 不做新的“子代理管理中心”、强制逐文件接受、PR 管理、分支管理或通用冲突编辑器。
- 不增加对子代理直接发消息的输入框；仍通过主代理协调。
- 不更改现有发送 / 暂停 / 继续主控，不增加第二个圆形按钮。
- 不取消权限门禁、dirty-base 提示、隔离与并发限制，不扩展 MCP 权限层。
- 不 fork Pi，不改变 Run 终态权威，不自动重新打开已终结的 Run。
- 不承诺撤销任意 shell、MCP、数据库、部署或网络副作用。

## 1. 当前实现事实与调整落点

以下为 2026-08-30 的静态代码核对，不声称已复现用户当时那一次屏幕状态。

| 当前代码 | 已有行为 | 本次调整 |
| --- | --- | --- |
| [subagent-run-tool.ts](../../packages/host-runtime/src/subagent-run-tool.ts) | 模型工具默认 applyPolicy=none，返回执行/整合状态；summary merge 与文件整合分离 | 新交付意图归一化；返回准确结果引用和父工作区影响，保留一个工具入口 |
| [subagent-lifecycle-service.ts](../../packages/host-runtime/src/subagent-lifecycle-service.ts) | spawn 默认 none | 与其他入口共用策略解析，不再各自决定默认值 |
| [plan-execution-coordinator.ts](../../packages/host-runtime/src/plan-execution-coordinator.ts) | Plan 子任务显式 auto；已有父代理验证指令 | 保留“整合后父验证”；与普通工具路径语义一致 |
| [subagent-orchestrator.ts](../../packages/host-runtime/src/subagent-orchestrator.ts) | 1209 行；auto 且未要求 retain 才整合，缺省还回退 auto | 先拆文件；执行已归一化策略，不再二次设默认；副本保留不阻止正常整合 |
| [subagent-integration-coordinator.ts](../../packages/host-runtime/src/subagent-integration-coordinator.ts) | 按仓库串行；整合成功后立即尝试删除副本 | 接统一文件事务和 workspace gate；持久差异成功后才清理 |
| [worktree-integration.ts](../../packages/git/src/worktree-integration.ts) | 临时 index 计算三方结果，再 apply 到父工作区；没有持久 prepare/apply 日志 | 分离准备与应用，保留 Git 计算能力，接日志化有限文件事务 |
| [subagent-run-store.ts](../../packages/session/src/subagent-run-store.ts) | manifest 保存任务/租约/结果/调用；任务 DTO 未完整保存交付策略 | 版本化保存意图、结果引用、来源和操作状态，支持重启重建 |
| [subagent-inline-session.tsx](../../apps/desktop/src/subagent-inline-session.tsx) | 停止运行且 retained/conflict/failed 时展示三按钮；不是每个子任务必经 | 观察详情 + 状态；危险清理移入更多菜单 |
| [use-workbench-subagent-inspector.ts](../../apps/desktop/src/hooks/use-workbench-subagent-inspector.ts) | 用 child.projectPath 给子转录查询当前 Git 统计 | 改用 Host 结果引用，不把父项目路径当成隔离副本差异来源 |
| [files-changed-bar.tsx](../../apps/desktop/src/files-changed-bar.tsx) | 工具路径匹配当前 Git 差异，缺失时有估算 | 新记录只用本轮变更服务；旧记录明确“历史记录不完整” |
| [host-runtime-subagent-tasks.ts](../../packages/host-runtime/src/host-runtime-subagent-tasks.ts) | apply / retain / discard 的真实执行与索引更新 | 拆出有版本、幂等和恢复日志的结果操作；既有入口做兼容适配 |

当前文件列表不是无条件展示全部仓库文件；其路径先来自消息工具记录。已确认的是差异统计数据源有混用风险，不能把“所有多余文件都来自这个问题”当成已证实事实。

## 2. 交付意图：一个统一的策略入口

### 2.1 新意图与默认值

新增 `SubagentDeliveryIntent = 'report' | 'integrate' | 'candidate'`，属于产品契约，不是 Pi 配置。

| 情况 | 意图 | 子任务结束后 | 用户是否要采用 |
| --- | --- | --- | --- |
| 只读探索 / 审查 | report | 返回摘要和证据 | 不需要 |
| 已授权实现任务中的普通写入委派 | integrate | 校验并整合到父任务目标工作区，再交回父代理检查 | 不需要 |
| 明确要求对比方案 / 先看后合 | candidate | 冻结候选差异并保留副本，主对话显示候选结果 | 需要，按方案整体采用 |

规则：

1. 新版模型工具、Plan、CLI、Host batch 入口共同调用 Host 的 `resolveSubagentDeliveryPolicy`，只解析一次并持久化；编排器必须收到完整的已解析字段。
2. 未提供意图：实际只读能力 → report；已准入的 worktree 写任务 → integrate。是否允许写入仍由 profile、Run 能力、项目信任和权限决定。
3. 不通过关键词或任务标题在 UI 中猜意图。模型应根据用户目标传 candidate；显式候选批次由 Host 固定为 candidate，模型后续不能将其升级为自动整合。
4. report 不接受写能力；candidate/integrate 与 readonly profile 矛盾时拒绝参数，不偷偷扩权。未知意图或新旧字段矛盾同样拒绝。
5. 不新增用户必须理解的全局默认设置；现有子代理开关、能力、模型、dirty-base 决策继续生效。
6. `retainWorktree` 仅表示整合后是否保留执行副本。新版不能再用它暗示“不要整合”；不整合必须是 candidate 或旧版人工处置策略。

### 2.2 旧字段兼容

- 新命令能力启用后，模型 schema 用 deliveryIntent 替代 applyPolicy；已编译 generation 不热改，按现有 runtime replacement 机制更新。
- 老客户端显式 auto：适配到 integrate；显式 none/explicit：保持不自动整合，标记 legacy-manual，不能改变其原意。
- 老记录没有意图或策略：保守保留原状态；不能靠当前新版默认值补成 integrate。
- legacy-manual 只是兼容来源标记，不新增第四个用户概念；界面显示“历史未合入修改”，不伪装成用户主动创建的候选方案。
- 老字段在边界适配后不继续传播为第二套权威。API 校验、manifest 和测试覆盖“不传、显式 none、显式 auto、冲突字段”四种情况。

## 3. 用户出入口与正常闭环

### 3.1 主对话：唯一常规验收位置

~~~text
助手：已完成登录功能，并通过相关检查。

本轮修改 8 个文件 · +240 −76             [查看变更] [撤销]
子任务 3 项：2 项已合入，1 项只读检查       [展开]
~~~

- 本轮汇总复用 FilesChangedBar 的位置，由 attempt 的最后一个助手消息或结束状态行挂载一次。不能按子消息和主消息各生成一个可独立撤销的相同物理写入入口。
- 子任务调用卡继续留在原工具调用锚点，不挪回输入框上方的常驻工作栏。汇总中的“展开”定位/展开这些既有卡片，不复制第二份转录。
- 普通完成时不显示“接受全部”“保留全部”。不点撤销即继续保留已写入工作区的修改。
- 零净变化显示“本轮未产生文件改动”；未知/不完整显示“已记录 N 个文件，记录不完整”，没有可靠数量则不填数字。
- 正常撤销一次点击，无强制预览或确认；成功原位显示“本轮已撤销”和“恢复改动”。完全沿用原撤销 Spec 的冲突保护。

### 3.2 子代理：按需观察，不是第二个验收台

点击既有子代理调用卡 → 原位展开；再点收起。内容顺序：

1. 任务名称与状态；role/model 为次级信息。
2. 一句话结果摘要及验证证据；仅有子代理自述时注明“子代理报告”，不能加“已验证通过”徽标。
3. 一条该子任务结果汇总：“该子任务产生 3 个文件修改 · 已合入本轮”或“候选修改，尚未合入”。
4. “查看子任务变更”“查看过程”；过程沿用当前转录渲染、按需展开工具明细。
5. “更多”中才有“打开完整记录”“清理副本”（满足 §7 条件时）。完整子记录仍无普通交互式 composer，也不提供本轮撤销的第二权威。

移除旧的常驻三按钮栏。不是把它们换个名字继续并排展示。

### 3.3 右侧 Review / Changes：三个明确上下文

| 入口 | 面板标题及数据 | 可用操作 | 返回出口 |
| --- | --- | --- | --- |
| 主轮“查看变更” | 本轮变更；changeSetId + revision | 查看文件、撤销本轮 / 恢复改动 | 关闭回原回答；查看工作区全部变更 |
| 子卡“查看子任务变更” | 子任务结果；resultId + revision | 只读查看；已合入时可定位本轮 | 返回主轮；关闭回子卡 |
| 用户原有 Git 入口 | 工作区全部变更；当前 Git 状态 | 原有暂存、提交等 | 保留当前原有导航 |

- 本轮/子任务上下文不显示 Git 暂存勾选框，不默认展开全部文件，不提供逐文件 Keep/Discard。
- 首屏显示任务、准确范围、状态和文件列表；点击文件才加载 diff。文件列表分页，长列表复用虚拟化能力。
- 历史 diff 冻结，不因随后编辑而变化；另显示“本轮已撤销”“当前工作区已有后续变化”等事实。
- 子副本已清理仍能看冻结差异。只有旧结果缺快照时显示“不再能查看历史差异”，不能拿当前 Git diff 顶替。
- 面板显示 Host 名称和目标工作区标签；远程设备不接收任意 Host 绝对路径作为操作目标。

### 3.4 未合入结果：在主对话集中处理

~~~text
有 1 个子任务尚未合入
登录校验：与当前修改冲突。结果已保存。
                         [让主代理处理] [查看未合入修改]
~~~

- 放在本轮汇总下方；即使没有最终助手正文，也挂在该轮结束状态行。不可只放到子代理详情或短暂 toast。
- 多个问题合成一个计数和列表，不弹出多个对话框；每项有名称、原因、是否影响主工作区。
- “让主代理处理”在主会话发起一条明确、可见的后续请求，附带受验证的结果引用；经过正常 prompt 准入、权限、Run 和预算流程。不是直连子代理，也不是无成本的后台重试。
- 按钮辅助说明“将发送后续请求，由主代理检查并处理”。保留当前输入草稿，不用固定文本覆盖它。
- 主代理正忙或暂停待续时，按钮说明当前状态并禁用自动启动；用户可用已有主输入框/继续入口处理，不偷偷排一个稍后生效的文件操作。
- 对已结束的旧轮发起处理属于新 attempt。父 Run 终态保持不可变，解决状态单独更新。
- 可收起问题列表，但“未合入 N 项”标记保留；用户回到任务即可找到。主会话更多菜单增加“未合入结果”，按时间分页列出本会话仍待处理的结果，不新建顶层管理页。

### 3.5 候选方案：在主对话采用，不逐文件拼装

候选卡展示方案名、一句话区别、文件数、验证情况及“查看变更 / 采用此方案”。详情可用同一“采用此方案”，不重复授权、不额外要求先点保留。

- 采用是明确的一次文件操作；不自动提交、推送，也不自动启动模型验证。
- 点击后 Host 检查期望结果版本和目标工作区，安全应用。成功生成一条主对话系统操作行：`已应用「方案 A」· N 个文件 [查看变更] [撤销此次应用]`；另有“让主代理验证”入口。
- 本操作有独立 changeSet，不把旧提示词已冻结的数字改大。用户选择发生在父轮仍活动时暂不接受，提示等本轮收尾；首版不将手动采用插进正在运行的轮次。
- 同一互斥方案组只能采用一个；其余标记“未采用”，不自动删除。采用另一个前须先安全撤销当前采用；若期间又有重叠修改则停止，不自动连撤。
- 不在互斥组内的独立候选可以分别采用，仍逐次校验；一次只采用一个完整结果，首版不提供多结果批量写入。

## 4. 状态、事实与显示优先级

保留现有 execution / summary / integration 三轴；新增交付意图、结果记录和副本状态，不新增第二个 Run 状态机。

| 实际事实 | 主/子界面文案 | 是否进入父轮文件统计 |
| --- | --- | --- |
| 排队 / 执行中 | 排队中 / 运行中 | 仅实际已结算父写入，不把子副本算入 |
| 子执行结束，普通整合排队/进行中 | 正在合入本轮 | 尚未验证完成的写入不报成功 |
| 子无净修改 | 已完成，未产生文件改动 | 0 |
| 子文件整合成功 | 已合入本轮；检查情况另列 | 是，以实际父写入为准 |
| report 完成 | 检查完成 / 已返回结果 | 不产生写入 |
| candidate 完成 | 候选结果，尚未采用 | 否 |
| 冲突 / 失败 / 旧版留存 | 未合入，结果已保存 + 原因 | 不加入尚未应用的部分 |
| 整合成功但副本清理失败 | 已合入本轮；副本清理未完成 | 是；不能改成“合入失败” |
| 父轮被撤销 | 历史已合入；所属本轮已撤销 | 保留历史统计，显示已撤销 |
| 操作中途失败，安全回退成功 | 应用未完成，已还原到操作前 | 不报本次应用成功 |
| 操作中途失败，回退不确定 | 需要修复文件 | 显示实际记录；阻止重叠新写入 |

显示优先级：需修复 > 操作进行中 > 未合入错误 > 等待用户选择 > 已合入/报告完成。验证状态附属显示，不压掉文件安全状态。应用、清理和撤销进度均以 Host 持久结果为准，响应 success 不能代替 operation succeeded。

父模型正常结束但有未合入项：仍展示其真实回答与 Run 终态，同时给出“部分成果尚未合入”。Host 不改写模型正文、不伪造失败事件，也不自动开启新的模型循环。

## 5. 主代理与编排器的执行规则

### 5.1 普通委派

1. 父 prompt 准入后取得 attemptId、changeSetId 和目标 workspaceId；委派时由 Host 传递，模型不得自报这些权威值。
2. profile/能力/dirty-base 校验通过后分配子 worktree；记录实际 baseCommit 与子结果基线。
3. 子任务执行，子工具记录留在子工作区；不得同时把这些物理写入登记为父工作区写入。
4. 子执行器、进程和写入真正停止后，冻结子结果及差异；执行失败也记录已产生的文件变化。
5. integrate + 执行成功 → Host 按 §8 安全整合；candidate → 保留；失败/取消 → 保留，不自动应用残缺结果。
6. 模型工具返回 execution、integration、结果引用、实际父变更、验证证据与未解决事项。摘要合并失败不能把已完成的文件整合隐去。
7. 主代理查看整合结果、做必要修正和整体检查，再正常答复。通用工具说明与 Plan 验证指令共同要求这一点，但不把提示词当安全边界。
8. 子工具/整合全部 settled 后，父 attempt 才能结算精确汇总和开放撤销。

### 5.2 验证证据不造假

- 复用现有工具/Job 的命令、退出状态和证据引用；不从“我已测试”文本推导通过。
- 验证必须绑定所检查的 workspace 和文件版本。子副本上的检查可展示，但不能等同于父工作区整合后的检查。
- 验证后又写文件，对应“最新版本已检查”状态失效；旧检查证据仍可查。
- 没有测试命令、运行环境缺失或权限拒绝：允许真实结束并说明未验证，不设置无限阻塞；禁止显示全部通过。
- 本次不建新的自动质量判定引擎。文件安全由 Host 强制，语义正确性由主代理与用户审阅。

### 5.3 依赖、失败与父轮取消

- dependsOn 写任务须“执行成功且所需成果已在目标工作区可用”才满足；不能只看到 execution=completed 就释放依赖。
- candidate 不得作为自动依赖输入，除非已由用户采用；冲突、失败、保留但未整合的依赖保持受阻。
- 当前子 worktree 基于 baseCommit，不天然包含父工作区未提交内容。首版不更改为自动提交或 stash：若下一子任务必须读取这些新依赖却无法获得一致基线，返回 `dependency-workspace-unavailable`，交主代理在父工作区顺序处理，不从旧 HEAD 继续制造错误结果。
- 父轮取消立即关闭整合准入。排队未首写的整合可取消；已首写则安全完成或回退并记录事实，Run 收尾等待实际 settlement。
- 父轮已结算、撤销或被新 attempt 替代后，迟到子成果只保存并显示未合入，不再自动写进旧轮。
- 保持现有“失败写子任务不自动复活”的规则。主代理根据错误明确发起新修复任务可以，但 Host 不做无限自动重试，也不回写旧 Run 终态。

### 5.4 “让主代理处理”必须具备真实的读取和收尾能力

仅把 resultId 塞进提示词是不完整的实现。新增两个受控 Host 工具，仍注册在现有 `buildSessionHostTools`，经过同一个 SDK/worker 工具端口：

- `piwin_subagent_result`：只读，按 resultId/revision 读取摘要、文件页或某个 fileId 的冻结 diff。复用 §6 结果服务，不要求模型猜 `~/.piwin` 路径或用 shell 翻内部状态。
- `piwin_subagent_resolution_report`：只登记处理报告，输入 resultRef、outcome=implemented/superseded/needs-user、简短说明和当前 Run 证据引用。Host 校验本 Run 获授权处理该结果、证据确属本 Run 和目标工作区；模型不能借它触发文件采用、清理或撤销。

解决冲突时主代理可用既有受控文件工具在父工作区实施修复，写入归属当前新 attempt；也可发起新的正常子任务，产生新 resultId。原冲突副本不自动改写或删除。

结果另外保存 resolution（pending / in-progress / reported-resolved / needs-user）和 resolutionRunId。implemented 必须有当前 Run 的实际文件变更引用；superseded 必须说明替代/不再需要的原因。Host 不把模型报告当作数学等价证明：界面写“主代理报告已处理”，提供新轮差异和验证入口，不将旧 integrationStatus 伪改为 applied。

只有成功文件采用，或有合法处理报告且处理 Run 正常结束，才能移出“未处理”计数；失败、取消、无报告时恢复待处理状态。后续撤销处理轮时撤回其解决有效性并重新显示待处理，历史报告保留。依赖调度仍依据实际交付事实，不凭 reported-resolved 直接放行。

这两个工具按既有 delegate 能力和上下文暴露；resolution report 仅在绑定的处理 Run 可用。它们不是自动回滚工具，也不对普通子任务再增加用户验收步骤。

## 6. Contracts、命令与持久化

本节命名为拟实施契约，必须先加到 `packages/contracts` 公共出口，并更新运行时命令校验和全部实现者；不是描述已经存在的 API。

### 6.1 结果记录与文件归属

~~~ts
type SubagentDeliveryIntent = 'report' | 'integrate' | 'candidate';
type SubagentResultRef = { resultId: string; revision: number };
type ChangeVersionRef = { changeSetId: string; revision: number };
type SubagentCopyState = 'present' | 'cleanup-pending' | 'removed' | 'missing';

type SubagentResultSummary = {
  resultId: string;
  revision: number;
  parentSessionId: string;
  childSessionId: string;
  taskId: string;
  batchRunId: string;
  sourceAttemptId: string | null;
  targetWorkspaceId: string;
  deliveryIntent: SubagentDeliveryIntent;
  legacyManual: boolean;
  candidateGroupId: string | null;
  executionStatus: SubagentExecutionStatus;
  summaryStatus: SubagentSummaryStatus;
  integrationStatus: SubagentIntegrationStatus;
  childChanges: ChangeVersionRef | null;
  appliedChanges: ChangeVersionRef | null;
  copyState: SubagentCopyState;
  latestOperationId: string | null;
  availability: SubagentResultAvailability;
};
~~~

- `SubagentResultAvailability` 为各动作 `{allowed, reason}` 的固定结构（view/apply/resolve/cleanup），由 Host 根据事实生成；UI 只负责展示，执行前 Host 重新核验。
- `SubagentTaskSpec`、spawn options、invocation、task result、manifest 和 session summary 同步携带交付意图/结果引用，摘要仅含必要字段，不复制完整 diff。
- `resultId` 绑定一次子任务执行结果；续做产生新 resultId，关联旧结果，不以同一个 childSessionId 猜最新结果。旧 revision 内容不可变。
- 处理状态 resolution、resolutionRunId、处理报告/证据以及应用 contributionId 另作有版本的事实记录；原 execution/integration 事实不可被报告覆盖。
- `revision` 表示冻结内容/可授权目标版本；状态进度用独立单调序号。cleanup、网络重连、进度通知不能篡改历史 diff。
- childChanges 是隔离工作区基线 → 子任务最终结果；appliedChanges 指向父工作区实际 before/after 贡献。两者可能不同，不能互换。
- 父子关联由 Host runtime/lease 生成，不接收模型自报 parentRunId、workspaceId 来越权绑定。
- `candidateGroupId` 只用于用户明确要求互斥选项的批次。组及成员由 Host 持久化；不从相似标题猜同组。
- 无父前台 Run 的显式 batch/Plan 执行，Host 在其准入时建立独立操作 attempt（userMessageId 可为 null），挂在对应主会话执行记录；不能借用“最近一个提示词”。

### 6.2 Host 命令

| 命令 | 输入 | 输出与约束 |
| --- | --- | --- |
| subagent/results | parentSessionId；可选 attemptId、pendingOnly、cursor、limit | 分页结果摘要；默认 50，上限 200；会话级“未合入结果”用此查询 |
| subagent/result | resultId | 结果摘要、关联原轮、操作可用性与原因 |
| subagent/result-files | resultId + revision + cursor + limit | 冻结文件清单；通过同一变更存储服务读取 |
| subagent/result-diff | resultId + revision + fileId | 按需 diff，binary/truncated 状态；不接受任意路径 |
| subagent/worktree-action（扩展现有） | apply/retain/discard + resultId + expectedRevision；discard 另需 cleanupToken | apply/discard 返回 operationId；retain 返回安全保留事实，不把 retained 误写成 applied |
| subagent/cleanup-plan | resultId + expectedRevision | 将删除的确切副本、影响、是否含未合入成果及短期确认 token；只读 |
| subagent/request-resolution | resultId + expectedRevision + purpose=resolve/verify | 正常主会话 prompt 准入结果、runId；附上用户可见的固定请求文字和受验证引用 |

具体语义：

- 同名 worktree-action 的旧 `childSessionId` 入参仅供兼容解析；对新版结果，apply/discard 缺少 resultId/expectedRevision 必须拒绝 `upgrade-required`。新 UI 不再发仅凭 child id 的写请求。
- apply 只允许完整、稳定、尚未应用的结果；冲突/执行失败的结果默认先 request-resolution，不开放“强行应用残缺结果”。旧手动结果先重新核实才能采用。
- request-resolution 通过已有主会话 prompt pipeline 发起新请求，不调用 `subagent/continue` 绕过主代理。verify 只对已应用且有记录的结果可用；resolve 对未合入结果可用。
- Host 内部解析 parentSessionId 和目标工作区，检查当前操作者访问权限、项目 trust、session 尚存在且可运行、没有活动/暂停中的前台执行。用户删除主会话后不自动重建；仍可在有权访问的工作区操作记录查看/清理副本。
- request-resolution 的固定可见文本示例：“请检查子任务「登录校验」尚未合入的结果，在保留当前修改的前提下处理冲突并验证；不要扩大原任务范围。”隐式附加内容只用可信结果引用和有界事实，不把子代理文本当 Host 指令。
- apply/discard/retain/request-resolution 使用现有请求 envelope 的 idempotencyKey；相同 principal+key+指纹返回相同结果，不在 body 再造幂等键。新 key 也必须受结果/方案组状态机约束，防重复采用。
- 操作查询、进度、首写前取消和故障恢复复用本轮撤销方案的 operation 服务，扩展 kind 为 subagent-apply / subagent-cleanup；不建第二套进度与恢复框架。
- 首写前请求可取消；进入写入阶段后安全完成或回退。关闭页面、取消只读监听不等于取消 Host 操作。

### 6.3 事件、多端与读写权限

- 复用 `subagent/invocation-updated` / `subagent/task-updated` 携带结果引用；增加 `subagent/result-updated` 表达采用/清理/解决状态。变化记录仍走 `turn-changes/updated`，文件实际变化走 `workspace-files-updated`。
- 所有消息为 HostPush，不制造 Pi AgentEvent。终态/需修复是不可丢控制事件，进度可以合并；断线重连从持久快照恢复。
- Host capability 声明 `subagentDeliveryV1`、`subagentResultReviewV1`、`turnChangeUndoV1` 的支持情况。新 UI 不凭版本字符串猜能力，老 Host 不出现虚假的新功能按钮。
- 远程命令 admission、read/write 分类、幂等、audience、path redaction、snapshot/replay 同步更新。只读用户可看被授权结果，不能申请采用/清理/启动主代理。
- 客户端收到 operationId 后只查询该操作。HTTP/IPC 超时显示“结果待确认”，不能当失败换一个 key 重新执行。
- 两个客户端同时采用相同结果或同组不同方案：只允许一个获准；另一个收到 `already-applied` 或 `candidate-group-selected` 及当前结果，不写第二次。
- 采用前在操作存储里对 resultId 和 candidateGroupId 原子登记 reservation，操作成功转 selected，写前拒绝或完整回退才释放；needs-repair 保持占用。重启从同一日志恢复，不能仅用页面禁用按钮或内存锁防止重复采用。

### 6.4 数据归属与崩溃恢复

- 复用 `~/.piwin/subagent-runs/` 的版本化 manifest 保存调度事实、交付意图、结果引用、方案组和处理状态；由 `packages/session` 公共 API 读写。
- 冻结文件对象、before/after、幂等表与文件事务日志复用本轮撤销方案的 `~/.piwin/turn-changes/` 服务（`packages/git`）；Host 组合两者，不让 session ↔ git 互相依赖。
- 权威分工：manifest 管调度与来源；文件事务日志管“是否实际写入”；结果 UI 是关联投影。不能仅靠 manifest 上的 applied 标志推断磁盘已完成。
- 先持久化结果内容，再写 result-ready 引用，再执行采用；采用先完成事务日志，再更新 manifest 和广播。跨存储失败由 operationId 幂等对账，不假装跨 JSON/SQLite 原子提交。
- 重启时先恢复文件事务并阻止重叠新写入，再重建子任务结果投影。若磁盘已应用但 manifest 未更新，补投影不重做写入。
- 结果引用与恢复数据不随聊天裁剪删除。副本清理不删除历史差异；归档不改变采用状态；已有保留策略/容量上限沿用本轮变更存储，不另造无限内容库。
- 新结果元数据版本向前兼容未知字段；遇到不支持的新存储版本时旧程序拒绝写入，不能按旧缺省值自动清理或应用。
- 未合入/需修复结果对必要对象持保护引用，不到期删除；预算达到上限拒绝新产出而非删除旧保护数据。已采用的普通历史按原保留期限清理；过期返回 data-expired，不能因为副本还在就伪造同一个历史版本。

### 6.5 稳定拒绝码与出口

| 原因码 | 用户可见下一步 |
| --- | --- |
| stale-revision / result-changed | 刷新差异后重新选择，不自动执行新版本 |
| workspace-busy / parent-busy / parent-paused | 查看活动任务或使用已有继续入口；不自动停任务 |
| integration-conflict / dependency-workspace-unavailable | 查看原因，交主代理处理 |
| result-incomplete / data-expired / copy-missing | 看已有摘要及缺失原因；无法安全采用时不显示可用采用按钮 |
| already-applied / candidate-group-selected | 定位已采用记录；需要切换时先安全撤销 |
| backup-failed / capacity-exceeded | 保留成果，查看存储诊断或主动清理，不先写一部分 |
| needs-repair | 进入原文件事务修复详情；阻止重叠新写入 |
| permission-denied / unsupported-workspace / parent-missing | 说明授权、目录或会话问题，不改变范围绕过 |
| cleanup-token-expired / cleanup-target-changed | 重新生成清理计划并确认 |
| upgrade-required / unsupported-capability | 只读降级；不回退到不带版本的危险写请求 |

## 7. 副本保留与清理

### 7.1 正常情况不需要用户点保留

- candidate、冲突、失败、取消且有文件产出的副本自动保留。关闭详情、切换任务、客户端离线均不改变保留事实。
- 无产出的子副本可自动清理；成功整合的副本在结果快照和父事务记录持久化后可自动清理。保留 worktree 的请求不阻止已授权普通整合。
- 清理失败独立显示 copyState=cleanup-pending；不得把已合入状态回退成 retained，也不得重复应用代码来“重试清理”。
- 未合入成果不因年龄或容量自动删除。容量不足时停止接纳需要额外副本/备份的新写子任务，说明原因；已有成果仍可查看。用户选择性清理，不默认全选。

### 7.2 用户主动清理闭环

入口：子任务详情 → 更多 → 清理副本。先取 cleanup-plan，再显示 ConfirmDialog：

- 已合入：“删除此子任务的执行副本。主工作区代码和历史差异保留。”
- 未合入：“删除此子任务尚未采用的执行副本及其中成果。不会修改主工作区；此操作不能用本轮撤销找回。”

对话框列出明确任务、目标副本和范围；默认焦点在取消，确认文字“清理副本”。取消无副作用；确认后展示进度与持久结果。

Host 重新核验 token、result revision、worktree 真实身份、无运行者/整合/恢复占用、未出现新文件变化，以及精确受管分支。token 建议 5 分钟有效；目标变化返回 stale-revision，必须刷新再确认。

清理不可递归到工作区外，不删除链接指向的外部目录，不删除仍被其他 worktree 使用或含新成果的分支。无法确认安全身份直接拒绝，不靠字符串路径前缀判断。若目录已移除但分支清理失败，记录 cleanup-pending，重试只处理剩余精确目标。

完成后当前详情保留摘要和可用历史 diff，显示“副本已清理”；如果未合入成果被清理，同时标记“不再采用”，从待处理列表移除但保留历史。清理不是可逆动作，不能显示误导性的恢复按钮。

## 8. 安全整合：在现有 Git 实现上补齐事务

### 8.1 为什么不能直接改默认值

现有 Git adapter 是一次性整合；coordinator 的注释已明确“持久 prepare/apply 日志尚未引入”。当前做了三方计算和 apply-check，但不等于拥有多文件原子事务、持久恢复与精确父轮归属。

扩大默认自动整合前，以下链路全部必须落地：

1. **冻结候选**：子执行 settled 后捕获基线 S0 → 结果 S1，存实际文件内容、存在性、类型、模式与有限路径清单。创建 worktree 时带入的已有内容属于 S0，不计作子贡献。
2. **准备整合**：复用临时 index 三方计算，返回 `PreparedWorktreeIntegration`（结果版本、目标 workspaceId、有限 write set、预期父 before/after、Git 身份、父 index 指纹），此阶段不写父文件、不清理副本。
3. **权限与范围**：在首写前检查完整 write set 的 allowedOutputPaths 和父工作区写策略；所有路径一起准入，拒绝一个即整次零写入。空 allowlist 拒绝全部；未知特殊文件/符号链接/越界路径/不可安全处理的过滤器按不支持拒绝。
4. **统一门禁**：获取真实 workspace 写入 gate，重验 Run/attempt、结果版本、父文件和 Git 身份。已有仓库串行队列保留顺序职责；固定锁顺序为 repo 队列 → workspace gate，不反向获取。正常整合允许所属父 Run 活动，但不能与其实际文件写入并发；人工采用要求工作区无活动写入。
5. **实际父基线**：before 必须是整合前父文件的真实内容，不是 child baseCommit，也不是 HEAD。相关路径存在暂存/冲突或父基线无法安全计算时拒绝；无关暂存保留，真实 index 字节不变。
6. **备份与日志**：准备所有 before 备份及逐路径写入日志；容量/权限失败零写入。结果快照缺失、不完整或有归属异常时不自动整合。
7. **有限写入**：将准备阶段得出的 after 交给共用文件事务执行器，逐项复核和写入。不得继续调用会重新扫描活副本、重新扩大范围的一次性 apply；不得使用目录 reset/clean/checkout 作为恢复机制。
8. **验证与登记**：核实实际 after 与 index 不变，登记本次 contributionId、结果版本、父 attempt、operationId；持久提交后广播，然后允许清理副本。

子 worktree 的冻结差异是“这个隔离结果包含什么”，不是对任意外部进程的作者证明。正常自动整合要求 Host 独占写任务租约且无已知外部改动/未结束写入；发现无法解释的变化转人工处理，不能默认为该子代理贡献。允许子任务用 shell 并不代表其所有外部副作用都可撤销；父工作区能撤的是 Host 此次实际应用的有限文件变化。

### 8.2 失败矩阵

| 失败位置 | 必须结果 |
| --- | --- |
| 捕获 / 准备 / 权限 / 冲突 / 备份 | 父工作区零写入；保留副本和原因 |
| 已写部分路径 | 用操作前备份安全回退；外部新改动不得强覆盖 |
| 回退成功 | 标记 rolled-back；显示应用未完成，不显示已合入 |
| 回退失败或状态不明 | needs-repair；阻止重叠新写入，沿用本轮事务修复入口 |
| 文件已完成、manifest / push 失败 | 以持久事务为准对账，不能重写文件 |
| 完成后清理失败 | applied 不变，仅报告副本待清理 |

重启必须覆盖首写前、写第 N 个文件后、写完未登记、登记未投影和清理中断五类故障注入。只通过正常 happy path 不算通过。

### 8.3 当前基线和范围限制

- 保留 dirty-base 原有提示和一次执行授权；这与完成后逐子任务验收是两回事。已存在用户修改不自动 commit/stash，也不通过授权允许覆盖。
- 不承诺任意冲突自动解决；同文件不同修改能否安全整合由准备算法判定，失败就返回真实冲突，不使用 force。
- 全工作区快照可以用来检查遗漏，但不是父写入或撤销清单。子产出经过明确 result/write set 进入父工作区才可登记。
- 单文件、总预算、二进制和模式位支持范围与原撤销方案一致。超限明确保留并阻止不受保障的自动整合；不显示假的 +1。

## 9. 本轮撤销如何包含子代理

### 9.1 只登记实际进入父工作区的贡献

父 attempt 的变更集由父工具写入和子结果 integration contribution 合成。子副本写入不直接加到父集合；同文件多次贡献按实际顺序检查内容连续性，再形成首个 before → 最终 after 的净 diff。

例：父先改 A，子合入 A/B，父又修 A。主汇总仍为 A/B 两个路径，撤销回到本轮第一次修改之前，不能先撤父再独立撤同一份子文件。

撤销成功后：

- 聊天、子任务过程、历史 diff 保留；子卡显示“所属本轮已撤销”。
- 不因为副本还存在就自动重新应用；父轮登记新的写入 epoch/处置版本，迟到结果不得使用旧授权。
- 不自动删除子 worktree，也不自动重新跑验证。再次“恢复改动”走原 redo，不是重新调用子代理。
- 外部/后续轮次修改同文件则保守拒绝；不会为满足“一键”而连带撤掉后来工作。

### 9.2 延迟采用与修复

- 用户在父轮结束后点采用：创建 kind=subagent-apply 的独立 changeSet/attempt，userMessageId 可为 null，通过系统操作行定位，不伪造助手回答。
- 用户点“让主代理处理”后产生的新写入属于新提示词 attempt；旧结果记录链接解决操作，新轮统计不能重复吸收旧轮已应用的变化。
- 暂停/继续同原 attempt；若暂停期间已撤销，继续必须通过原方案的 epoch/新生效变化规则，不恢复旧贡献。
- 同组方案被撤销后可重新选择，但每次都用新操作和当前文件校验；历史 applied 事件不删除，当前选中状态与撤销事实一致。

### 9.3 与原方案的依赖关系

本文复用原方案的 attempt、CAS 内容对象、不可变版本、文件合成、workspace gate、幂等操作、undo/redo 与故障修复。新增的是交付策略、子结果视图、整合贡献、人工采用系统操作及清理。

基础设施尚未完成时，可以先发布准确的只读结果页及文案纠正；**不得提前上线普通子任务新默认自动整合或可点击的虚假撤销**。上线承诺必须在 §12 全路径验收后兑现。

## 10. 旧记录、发布与安全降级

### 10.1 历史迁移

1. 扫描现有 manifest、session index 和实际受管 worktree，生成只读迁移报告；只处理属于本 Host 的已知结果，忽略人工工作区。
2. 为旧结果建立稳定 resultId 和 legacyManual 标记，保留原 execution/integration/summary 事实。不要因 manifest 未保存 applyPolicy 就默认合入。
3. 旧副本仍在且基线可信：在无活跃写入时生成“迁移时检查的未合入差异”，明确不是历史逐轮原始快照；用户刷新确认该版本后才允许采用。
4. 旧副本缺失/基线不明：只显示摘要、不可用原因；不调用当前父项目 diff 补出伪历史记录，不提供采用。
5. 旧 applied 但无父 before/after：继续显示“历史已合入，无本轮撤销数据”。不能事后反推父原始内容。
6. 迁移幂等，先备份元数据再版本化写入；中断可续，不删除旧备份、worktree 或分支。旧程序无法识别新版本时 fail closed。

### 10.2 分阶段上线

- **A：只读澄清。** 结果状态与真实差异就绪后，修正父/子来源和按钮文案；已有可用的人工处置入口迁移到主任务结果页，不能先隐藏再补后端。
- **B：安全整合底座。** 冻结结果、事务、门禁、持久幂等、恢复与原本轮撤销基础设施全部通过。此时可测试人工采用闭环。
- **C：新版默认与交互。** 仅新准入且声明能力的内部任务使用 integrate 默认，普通完成不再出现三按钮栏；旧任务保持原策略。Plan 与普通模型工具同时切换归一化服务。
- **D：全路径发布。** Desktop / CLI / SDK / RPC-worker / 远程 / 重启故障与真实 Tauri 冒烟通过后才宣布完成。

发布开关是 Host 受控能力，不新增面向用户的“自动合入”复杂设置。紧急关闭只停止新自动整合，已开始的文件事务继续安全完成/回退；旧结果、只读差异、撤销与修复入口保留。不通过删除记录实现回滚发布。

## 11. 模块设计与复用清单

### 11.1 责任划分

| 归属 | 复用/调整 | 新增的最小职责 |
| --- | --- | --- |
| contracts | subagent*.ts、ipc 公共 union、remote-idempotency、HostPush | subagent-delivery.ts、subagent-result.ts；意图、结果与动作协议 |
| session | subagent-run-store、session index 投影 | manifest 版本迁移和结果索引；不做 Git/文件事务 |
| git | worktree-integration、原 turn-changes 服务 | prepare-worktree-integration.ts；冻结子结果 diff 和有限应用计划 |
| host-runtime | 现有 orchestrator、lifecycle、integration coordinator、subagent commands | subagent-delivery-policy.ts、subagent-result-service.ts、subagent-result-actions.ts；组合端口与权限 |
| host-runtime 工具/Plan | piwin_subagent_run、Plan task builder/verification directive | 统一意图；向主模型返回结果引用、实际合入及失败事实；注册结果读取和处理报告工具 |
| agent-host | 现有 SDK/worker Host 工具端口 | 原则上无产品逻辑新增；只在公共输入映射确有需要时适配 |
| Desktop | FilesChangedBar、子卡/子详情、Review 容器、纯 DiffView | subagent-result-summary.tsx、subagent-result-detail.tsx、subagent-result-actions.tsx 和数据 hook |
| CLI | 现有 Host client、命令注册 | subagent result/list/review/apply/resolve/cleanup；复用 turn operation/undo |
| host-server/transport | admission、redact、push policy、replay、幂等 | 增加新协议映射与测试，不执行产品整合逻辑 |

名称是按职责的目标划分；实施时如已有等价公开模块，优先复用。禁止复制一份 FilesChangedBar、Git diff 或独立撤销算法。

### 11.2 必须先拆分的文件

- `packages/host-runtime/src/subagent-orchestrator.ts` 当前 1209 行：分离 task 执行、batch 收尾与 invocation 持久化；保留一个调度器，不另建并行调度。
- `packages/contracts/src/ipc.ts` 当前 1633 行：按领域拆出命令/响应/事件类型，聚合文件仅保留公共组合与兼容 re-export。
- `chat-message-row.tsx` 当前 827 行：本轮汇总挂载抽成独立组件，不继续内嵌结果/动作状态。
- `host-runtime-subagent-tasks.ts` 541 行、integration coordinator 491 行、run store 504 行、Changes panel 447 行：本次触及职责优先拆分，避免再混入迁移、事务和 UI 状态。
- 重构与行为调整分工作包/提交。所有新增源文件尽量小于 400 行，任何源文件不得超过 1000 行；文档行数不作为设计拆分借口。

### 11.3 CLI 固定交互

拟新增/扩展以下公开命令，参数均映射同一 Host 协议：

~~~text
piwin subagent results --session <id> --pending --json
piwin subagent result <resultId> --json
piwin subagent review <resultId> --revision <n>
piwin subagent apply <resultId> --revision <n> --idempotency-key <key>
piwin subagent resolve <resultId> --revision <n>
piwin subagent verify <resultId> --revision <n>
piwin subagent cleanup-plan <resultId> --revision <n>
piwin subagent cleanup <resultId> --revision <n> --token <token> --idempotency-key <key>
piwin turn operation <operationId> --json
~~~

- apply 是明确采用命令，不再问是否保留；cleanup 必须有计划 token，非交互调用不能跳过。
- 交互客户端可生成并缓存幂等键；自动化写请求显式指定或获取持久 request receipt。resolve/verify 同样去重，不因重连发送两个 prompt。
- 非 TTY 遇到额外权限需求明确拒绝/返回待处理状态，不能挂起或自动 allow。
- CLI 可只输出摘要与 diff，不要求复刻 Desktop 子转录；但不得丢失未合入项、采用结果、可撤销记录与错误原因。
- stdout 的 JSON 保持协议纯净；提示与人工确认走 stderr。结束只读等待不停止 Host 文件事务。

## 12. 可执行工作包

原本轮撤销方案的 WP1–WP6 是复用依赖，不重复建设。下表中的工作包均为待实施；依赖完成与否以代码/测试为准，不以旧文档的描述视为已完成。

| 包 | 依赖 | 具体交付 | 完成门槛 |
| --- | --- | --- | --- |
| SD-W0 结构与基线 | 无 | 记录现有关键测试；拆超大 orchestrator/ipc，抽出行内结果挂载；保留行为 | 原有 subagent/Plan/IPC 测试通过；公开出口不变 |
| SD-W1 契约与策略 | W0 | 新意图、结果 ref、命令/事件、capability、默认归一化；旧字段适配 | readonly 不扩权；工具/Plan/CLI 一致；unknown/conflicting 输入拒绝；全量 typecheck |
| SD-W2 结果与迁移 | W1；原变更对象/版本存储 | 冻结 S0/S1、持久结果、分页 diff、旧记录迁移、重启投影 | 子差异不读父 Git；清理后可看；旧记录不假造历史/自动应用 |
| SD-W3 安全整合事务 | W2；原 workspace gate/文件事务/恢复 | 准备和应用分离；逐路径权限；备份日志；贡献登记；延迟清理 | 故障矩阵通过；index 不变；冲突零写；落盘后断电可恢复 |
| SD-W4 主任务收口 | W3 | 模型工具与 Plan 接统一策略、真实返回、父验证；依赖完成条件；取消 fencing；按 attempt 汇总 | 普通任务无人工采用；未合入不报全部完成；新副本不能读旧依赖继续做 |
| SD-W5 采用/解决/清理 | W3–W4 | 扩展 worktree-action；request-resolution；结果读取/处理报告工具；互斥方案状态；cleanup-plan；幂等操作 | 双端只采用一次；解决走主 prompt 且可收尾；清理不影响父代码；旧 UI 写请求安全拒绝 |
| SD-W6 Desktop 交互 | W2、W4–W5；原本轮汇总/undo UI | 移除三按钮栏，父结果摘要/异常/候选卡，三个 Review 上下文，更多清理，返回与草稿保护 | §3 全闭环；一轮一汇总；无裸 Git 全量差异冒充本轮 |
| SD-W7 CLI/远程 | W1–W5 | CLI 命令、能力检测、admission/幂等/脱敏/replay、只读用户限制 | 本地/远程同一结果；超时查询原操作；旧 Host 诚实降级 |
| SD-W8 联调与发布 | W0–W7 | 自动化矩阵、Tauri 冒烟、文档/ADR 同步、能力切换与应急关闭演练 | §13 全通过，记录证据；未完成项不得标完成 |

每包应给出变更文件、通过/失败测试、人工观察结果与未解决风险。不能只交付 UI 截图就把文件安全标完成。

同步文档目标：ADR 0030（整合/保留策略和恢复）、ADR 0046（子结果投影）、architecture 的子代理/UI/存储段、dev-plan、子代理内嵌化计划、本轮撤销 Spec/实施方案。该同步在实现提交中反映已交付行为；本次文档不提前将当前 ADR 标记为已实施新设计。

## 13. 验收与测试

### 13.1 产品与工程验收用例

| ID | 场景 | 通过标准 |
| --- | --- | --- |
| SD-A01 | 主代理分派两个普通写子任务 | 安全整合后主回复一条总汇总；不要求分别保留/采用 |
| SD-A02 | 只读子任务 | 无采用/撤销/清理代码按钮；不扩大权限 |
| SD-A03 | 同一文件被父、子、父依次修改 | 主轮净差异准确；一次撤销回到该轮 before，不重复撤 |
| SD-A04 | 子任务反复改后完全还原 | 净变化为零；无虚假 +1 或可采用按钮 |
| SD-A05 | 用户原有 dirty 和无关暂存 | 原有内容与真实 index 保留；新工作区仍走 dirty-base 准入 |
| SD-A06 | 子差异与父同名文件各有改动 | 子页只展示子 S0/S1，父页只展示本轮实际整合量 |
| SD-A07 | 子执行完成但整合冲突 | 主对话未合入提示，副本在；不显示全部交付完成 |
| SD-A08 | 执行报错但已写子文件 | 保留真实部分成果，不能自动采用并报成功 |
| SD-A09 | 主任务结束，无最终助手正文 | 汇总和问题挂在结束行；历史可重新进入 |
| SD-A10 | 同一轮多个助手消息/暂停续跑 | 一条 attempt 汇总；切消息不改变撤销目标 |
| SD-A11 | 采用互斥 A/B 两套方案 | 未选前不进入父代码；采用一个后另一个不能直接叠加 |
| SD-A12 | 事后采用旧结果 | 新系统操作行和独立撤销；旧轮统计不变 |
| SD-A13 | 采用后主代码又变化 | 撤销/切方案拒绝覆盖，不自动级联 |
| SD-A14 | 点击让主代理处理/验证 | 主会话出现可见后续请求；可实际读结果并登记处理报告；保持草稿；不直发子代理 |
| SD-A15 | 主会话运行中/暂停中/已删除 | 不暗中启动第二个前台 Run、不自动重建会话，有明确出口 |
| SD-A16 | 子检查通过但父未检查 | 只显示子证据，不显示父最新版本验证通过 |
| SD-A17 | 父取消且子迟到、整合排队 | 首写前拒绝迟到整合；已有写入真实结算 |
| SD-A18 | 父轮已撤销后子结果到达 | 不重新写回；保留未合入结果 |
| SD-A19 | 验证后又改文件 | 最新检查状态失效，旧证据仍可看 |
| SD-A20 | 依赖任务未合入/新副本无依赖产物 | 不放行错误依赖；明确交主代理顺序处理 |
| SD-A21 | 两端同 key、不同 key 重复采用 | 一次物理写入；返回同一操作或 already-applied |
| SD-A22 | 两端采用同组不同方案 | 组级互斥；一个成功，另一零写入 |
| SD-A23 | 请求超时/客户端退出 | 重连查原 operation；不重复发 prompt/写文件 |
| SD-A24 | 空 allowlist、越界、符号链接、特殊文件 | 首写前拒绝；真实 index 和外部文件不变 |
| SD-A25 | 磁盘满/备份失败/记录超限 | 不受保障的自动整合零写入；已有子成果保留 |
| SD-A26 | 首写前/中途/写完未投影崩溃 | 按 §8 恢复，不重做；不确定时 needs-repair |
| SD-A27 | 回退期间外部修改 | 不覆盖外部新内容；保持修复阻塞和备份 |
| SD-A28 | 整合成功但清理失败 | applied 不回退，重复清理不重复应用 |
| SD-A29 | 清理未合入副本：取消/确认/过期 token | 取消零副作用；确认范围准确；过期或变化拒绝 |
| SD-A30 | 清理含指向外部目录的链接/受占用分支 | 不跟随删除、不误删分支；无法保证就拒绝 |
| SD-A31 | 清理后查看历史 | 冻结 diff 可读；不依赖已经删除的副本 |
| SD-A32 | 旧 retained / failed / missing / applied 迁移 | 不自动合入/删除；不补造旧 before/after |
| SD-A33 | 新客户端连旧 Host / 旧客户端写新版结果 | capability 降级；缺版本写入拒绝；不绕安全门禁 |
| SD-A34 | 只读远程身份 | 仅获授权结果可读，不能应用/清理/启动 Run，不泄漏 Host 路径 |
| SD-A35 | SDK、RPC-worker、CLI、Desktop | 同样意图、记录、门禁和终态，无仅 Desktop 的假闭环 |
| SD-A36 | 窄屏/键盘/深浅主题/读屏 | 主动作可发现，焦点稳定，结果不只靠颜色；危险确认不默认选中 |
| SD-A37 | 子详情/Review 返回/离开重连 | 回到原锚点和滚动位置，草稿不丢，Host 操作继续可查询 |
| SD-A38 | 批次/Plan 无父 prompt Run | 获得独立准确归属，不能计入最近无关提示词 |
| SD-A39 | 父 summary merge 失败但文件已整合 | 文件事实仍 applied，可看可撤，错误不抹去实际影响 |
| SD-A40 | 紧急关闭新默认 | 停止新自动整合；已开始事务安全收尾，历史/修复/撤销仍可用 |

### 13.2 测试落点

- 纯策略：新增 delivery-policy 测试；扩展 lifecycle/profile/run-tool/Plan builder，覆盖默认与旧字段矩阵。
- 存储：扩展 session/subagent-run-store 与 reconciliation 测试，覆盖版本迁移、重复执行和恢复来源。
- Git：worktree-integration 与新 prepare/transaction 故障测试使用临时仓库，逐字节比较父/子真实 index 和非目标文件。
- Host：现有 subagent-orchestrator、integration-coordinator、subagent-git-integration、commands 测试覆盖 admission、依赖、取消、双客户端和响应丢失。
- UI：扩展 subagent-inline-session、files-changed-bar、Review 与新结果组件测试；测试选择器绑定 resultId/changeSetId，禁止用第几个按钮定位。
- E2E：新增 `apps/desktop/e2e/subagent-delivery-review.spec.ts`，覆盖“普通交付→看变更→撤销→恢复”“候选→采用→撤销”“冲突→主代理处理”“清理确认”和历史重连。
- 真实 Tauri：至少一次真实子 worker 写入、父工作区整合、主对话检查及撤销回归；浏览器 mock 不能替代这份证据。

拟执行命令（实施后运行，本次未执行）：

~~~sh
pnpm typecheck
pnpm --filter @piwin/contracts test
pnpm --filter @piwin/git test
pnpm --filter @piwin/session test
pnpm --filter @piwin/host-runtime test
pnpm --filter @piwin/host-server test
pnpm --filter @piwin/desktop test
pnpm --filter @piwin/cli test
pnpm test:architecture
pnpm --filter @piwin/desktop e2e -- subagent-delivery-review.spec.ts
pnpm test
~~~

### 13.3 交互质量约束

复用 `@piwin/ui-kit` Button/Menu/Notice/ConfirmDialog、现有主题和纯 DiffView。子卡展开可键盘操作，采用/撤销不只在 hover 出现；不占用编辑器 Cmd/Ctrl+Z。加载立即反馈，网络失败原位可读，成功状态持久保留；单一读屏 status 区不抢焦点。长路径可完整查看，窄屏按钮换行，危险清理与主操作分离。

ui-ux-pro-max 搜索未命中本类问题，本文采用其内置渐进展开、恢复路径、状态与焦点准则，不把无关搜索结果作为依据。没有增加新的视觉设计系统；可逆的本轮撤销仍按用户决定一键执行，不套用清理副本的危险确认。

## 14. 审阅重点与完成定义

产品需要审阅的核心取舍只有三项：

1. 普通子任务默认整合，主代理随后检查整轮成果；用户无需逐子任务验收。
2. 候选方案和无法安全整合的结果保留，采用/处理集中在主对话；副本清理是次级操作。
3. 本轮撤销覆盖本轮实际合入的子任务，事后采用则单独记账，不扩展到整会话/目录恢复。

工程完成条件：SD-W0–W8 和 SD-A01–A40 全部验证；无虚假差异/完成状态；无未记录父写入；旧记录和客户端兼容；真实 worker/Tauri 证据；架构/typecheck/测试及源文件行数门禁通过；实现与文档同步。

本次只交付此 Spec 及相关文档交叉链接，没有修改产品代码、默认策略、用户文件、分支或运行数据，也未执行任何回滚操作。
