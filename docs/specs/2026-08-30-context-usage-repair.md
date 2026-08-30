# 上下文窗口环：修复设计与执行计划

日期：2026-08-30。状态：待实施；本次仅修改文档，以下任务均未完成。

问题来源：[全链路排查及复现证据](../plans/2026-08-30-context-usage-audit.md)。该报告的 01–13 编号在本文保持不变。本文是后续修复的执行入口，不将方案描述为已上线行为。

## 1. 目标、范围与非目标

目标：上下文环显示正确会话、正确上下文版本的占用；发送后尚无模型响应时不显示，响应中及时更新，完成后校准；压缩、切换、重启不会复活旧读数。

包含：contracts、SDK/RPC 采样、Host 状态与持久化、推送/恢复、Desktop 环与详情、CLI/mobile 协议消费、回归测试。保留原始计费历史，不改变 Pi 的模型执行权威。

不包含：修改 Pi core、引入新 tokenizer 依赖、价格估算、供应商缓存 TTL 猜测、重新设计整套用量统计页面、修复与此无关的 Plan 终态问题。

既有调查记录不是修复验收结果。实现前必须重跑基线；工作区同时存在其他修改，不能覆盖或顺手提交。

## 2. 产品行为：先明确什么时候能显示

### 2.1 响应证据

“模型已响应”指当前前台 Run 收到真实的非空文本、非空思考，或模型发起的有效 tool call。空 `message/start`、请求已接受、分配了消息 id、零 usage、Host 自己产生的工具状态都不算。

同一 Run 内完成一次响应后，后续工具循环等待不再次隐藏；下一次用户提交开启的新 Run 重新进入首响应等待。仅排队但尚未执行的消息，不改变当前 Run 的显示资格。

历史资格由 Host 根据当前有效上下文路径中的响应证据维护，不扫描客户端当前挂载的几十条消息；UI 虚拟化/分页不能改变环的可见性。

### 2.2 状态矩阵

| 场景 | 环 | 详情/处理 |
| --- | --- | --- |
| 新建草稿、空会话、只输入未发送 | 隐藏 | 不制造 0% |
| 已提交，当前 Run 尚无首次响应；包括已有历史的下一轮 | 隐藏 | 等待提示由既有 Run 状态负责；保留内部上一样本，不显示为本轮值 |
| 首个有效文本/思考/tool call 到达 | 显示可用占用 | 优先真实计量，否则显示“实时估算”；完全无法估算时不画假百分比 |
| 同一 Run 流式输出、工具循环、后续请求等待 | 持续显示 | 增量更新，允许真实校准纠正估算 |
| 完成且计量有效 | 显示 | “已确认”或“估算”；不能把最终估算改名实测 |
| 完成但无精确计量 | 显示可用估算 | “估算”；不写入真实计费统计 |
| 首轮无响应就失败/取消 | 隐藏 | 错误提示独立存在 |
| 有响应后失败/取消 | 有有效样本则显示 | 显示最后可用值及“不完整/上次确认”；无效零值不覆盖基线 |
| 历史会话闲置/恢复 | 匹配当前上下文才显示 | 标注“上次确认”或“估算”；不是缓存 TTL |
| 切会话、恢复失败、身份不匹配 | 隐藏 | 不把旧会话环当加载占位 |
| 压缩中 | 保留匹配的旧样本并标“压缩中” | 压缩成功后原子替换；失败保留旧有效状态 |
| 压缩成功但占用未知 | 隐藏数值环 | 状态区提示“上下文已压缩，用量待更新” |
| 切分支/删历史/重建运行时 | 旧值立即失效 | 校验或重新估算后显示；删空一定隐藏 |
| Host 断线 | 可保留同会话最后值 | 明确“离线，显示上次数据”；重连后按版本恢复 |

此次方案对“发送后尚无模型响应”采用严格解释：新 Run 的首响应前隐藏，即使会话已有历史。工具循环不是新用户轮，不重复闪隐。

### 2.3 展示统一规则

- 中文/英文覆盖标题、hover、分类、估算状态、上限、剩余、关闭、设置入口和 accessible label。
- 数量保持原始值；圆弧最多 100%，超过容量时文字显示实际百分比和“超过上下文上限”，不把 120% 写成 100%。
- 百分比和 token 分母必须取同一个上限。已知模型上限来自 Host 配置/模型事实；未知时不以默认 128K 冒充测量上限，允许仅显示 token 数和“上限未知”。
- 历史占用与新选择模型窗口混用时必须标“按所选模型窗口估算”；后续 Host 采样替换。客户端模型选择不改写样本的来源模型。
- 移除五分钟缓存倒计时和“费用会更高”提示；缓存读写 token 仅作为最后请求的计量字段保留。
- 移除固定百分比分摊。首版只展示总占用和有真实依据的请求计量；分类无可靠互斥口径则不显示整组分类，不以 `~` 掩盖编造。
- 使用 `@piwin/ui-kit` 的 trigger、Popover、IconButton 等现有原语。焦点稳定；不每个 token 触发屏幕阅读器播报，只播报关键状态变化；尊重 reduced-motion。

## 3. 数据设计：分离占用、请求计量与展示状态

### 3.1 三个对象及权威

| 对象（拟新增） | 内容 | 权威与用途 |
| --- | --- | --- |
| `ContextMeasurement` | 后端某一时刻的上下文占用、质量、覆盖、来源与因果边界 | agent-host 从 Pi 规范化；无产品状态、无账单副作用 |
| `SessionContextSnapshot` | 当前会话版本、展示资格、占用样本、状态、修订号 | Host 唯一权威；客户端只消费该投影 |
| `AssistantUsageMeasurement` | 单次模型请求的最终输入/输出/缓存计量及请求身份 | 最终账单入口；不能从环反推账单 |

实施位置：新增 `packages/contracts/src/context-telemetry.ts` 与 `assistant-usage.ts`，公共出口为 `index.ts`。已有 `usage.ts` 保留账单/rollup 兼容类型，逐步去除其上下文权威用途。类型采用可辨识联合，禁止“status=unknown 但夹带旧 tokensUsed”的无效状态。

### 3.2 `SessionContextSnapshot` 必备字段

| 字段 | 约束 |
| --- | --- |
| `sessionId` | 产品会话 id，不允许跨会话复用 |
| `revision` | 每会话持久化单调递增整数；完整投影包括隐藏/失效状态也占一个 revision |
| `contextVersion` | Host 管理的上下文重置代数；压缩成功、换分支、截断、模型/能力变更、冷激活重组时递增 |
| `contextBoundary` | 活动分支/leaf、压缩边界、模型、能力/seed 指纹；描述该计量对应的有效上下文，不以时间猜测 |
| `runId` / `runtimeGenerationId` | 有 live 来源时必须绑定；历史状态显式无 live owner |
| `responseEvidence` | 当前 Run 首响应状态 + 当前有效历史是否有可展示响应；证据 id 绑定规范化 messageId |
| `phase` | `empty`、`waiting-response`、`streaming`、`idle`、`compacting`、`invalidated` 等受控状态 |
| `occupancy` | `known` 时含非负有限 tokensUsed、可选 tokensLimit、`measured/estimated`、`complete/partial` coverage、basis、sampledAt；`unknown` 时只有 reason |
| `lastConfirmed` | 可选、带自身边界的历史测量，仅用于显式“上次确认”；不能自动当成本轮当前值 |

`updatedAt/sampledAt` 仅用于人类阅读，禁止用于跨进程先后裁决。`revision` 管总体先后，`contextVersion` 管基线是否还能复用；同一 contextVersion 内允许多轮输入、工具结果和输出递增。

快照还需绑定当前原生计量覆盖到的 message/request 边界；这是防止“基线包含的内容再次相加”的依据，不只依靠一个 sessionId。

### 3.3 后端计量及账单身份

- `ContextMeasurement` 包含 `runId`、`runtimeGenerationId`、规范化 `messageId`、该 generation 内递增的 `sampleSequence`、测量覆盖边界和质量；Host 验证所有权后再生成产品 revision。
- `AssistantUsageMeasurement` 包含稳定 `measurementId`、session/run/generation/message 身份、来源模型、最终计量、停止原因。建议幂等键由 `(sessionId, runtimeGenerationId, messageId)` 构成；同一消息在 message_end/agent_end 中重现时必须相同。
- 一次用户 Run 可能包含多次模型请求：每次请求独立计账，最后请求不是整轮费用合计；详情明确标“最后一次请求”。
- 无 usage 的最终消息不生成“实测为零”；确有供应商明确返回的零计量允许记账，但不构成有效上下文占用。
- 本轮错误/取消仍可能有真实账单；账单有效性与上下文基线有效性分别判断。

### 3.4 新事件、恢复与兼容

- 后端事实：新增规范化 `AgentEvent` 的 `context/measurement` 和 `usage/finalized`；只描述后端事实。扩展 generation id 规范化、Run stamping、correlator、SDK/worker RPC 序列化及解析测试。
- Host 产品推送：新增 `HostPush` 的 `session/context-updated`，携带完整 `SessionContextSnapshot`；不伪装 Pi 生命周期事件。
- `SessionResumeData` 增加 `contextSnapshot` 和独立的 `lastRequestUsage: AssistantUsageMeasurement | null`；v1 能力 Host 必须返回完整快照及请求明细状态，空/未知也显式返回，不能靠省略字段表达清空。请求明细绑定当前有效路径的消息，不能将另一个分支的最后账单选过来。
- 增加只读 `session/context-get`，为重连、恢复失败重试和 CLI 提供统一读取；不得为读取创建 Pi runtime。
- 在 Host capability 中增加可选 `contextTelemetryVersion: 1`。升级 decoder、host-client、host-server 远程投影/会话授权、快照 hydration、push 分类与本地 sidecar 消费；旧版本不认识的推送不得导致断连。
- `session/context-updated` 按 session 投影合并；压缩/分支/失效/Run 终态是刷新屏障，必须冲刷前面的采样或明确丢弃被取代的版本，不能让旧值越过屏障。
- 旧 Host 没有能力字段：新 UI 不从旧 usage 构造“实时环”，隐藏环并在详情入口说明“Host 不支持实时上下文”；已有用量统计继续工作。
- 旧客户端如仍需 `usage/update`，由 Host 兼容出口仅在最终计量时投影；不得回流入账单，不能同时作为新环权威。移除内置生产 mapper 对混合 `usage/update` 的生产。

## 4. 采样与计算算法

### 4.1 复用 Pi，但不依赖假想的自动事件

在 `agent-host` 新建共用 `pi-context-sampler.ts` 与纯计算模块 `context-occupancy-estimator.ts`，供 `backends/sdk-backend-session.ts` 和 `rpc/worker-pi-session-factory.ts` 共用。Pi 原始消息与 schema 不出 agent-host。

执行时先用本机安装 Pi 的实际 API fixture 核实：`getContextUsage()` 是否覆盖 streaming partial、system prompt、tool definitions，以及压缩后 unknown 的行为。此验证是 WP2 子任务，不是留给实现者凭印象选择的备选方案。

无论该方法是否包含 streaming partial，都必须从真实 message_update 跟踪当前文本/思考/tool-call 参数；不许把缺省零 usage 当首个精确样本。没有官方逐 token 计量时使用标注估算的补充量。

### 4.2 占用口径

1. 有当前请求可用计量：以该请求输入侧实际占用为基线，加当前输出；供应商/Pi 总量已经包含缓存时不能再加一遍缓存。统一为 Pi 的规范化口径后才计算。
2. 上个已完成请求的有效基线：包含其输入、输出、缓存；加该基线之后真正进入模型上下文的用户输入、工具结果、steer 等，以及当前流式输出估算。
3. 未有基线：基于后端实际上下文、系统提示与有效工具定义估算；附件/图片采用已有可用估算能力并记录覆盖缺口。不可按最后一条用户文本 + 回复代替整段上下文。
4. 无法观察的内容不编造分类或精确值。可计算部分显式 `coverage=partial`；连合理基线都没有则 `unknown`，不要显示假零。
5. 某段从 trailing 估算进入下一请求的实测输入后，移除该段估算；工具结果只统计实际进入模型的最终内容，不统计 UI 预览或重复 tool/update。
6. 最终有效计量到达时替换估算基线，不在旧值上再加 total。允许校准向下，不用“永不下降”掩盖估算误差。
7. error/aborted/all-zero usage 不替换有效占用。是否保留失败请求的 partial 必须以 Pi 后续上下文实际包含的内容为准；无法确定时保留独立 lastConfirmed，当前值标未知/不完整。
8. 模型更换、压缩和上下文重建使旧基线失效；不能因为旧值为 measured 就永久拒绝新版本的估算。

mock 仅在 mock 路径使用 `estimateMockUsage`；生产 Host 删除该函数作为上下文 fallback 的入口。估算不能进入新增最终账单记录。

### 4.3 实时性与资源预算

- Host 每活跃会话最多每 250ms 发布一次普通流式快照（4Hz），仅数值/状态变化时发布；来源事件连续到达时不能使用会无限延后的 trailing-only debounce。
- 首次有效响应、最终计量、压缩完成、失效、Stop/失败/切换边界立即冲刷或取消待发快照，不等下一个采样周期。
- 本地可见窗口目标：Host 接收到有效增量后，环在 500ms 内反映更新；最终计量收到后 500ms 内校准。远程网络耗时独立统计，不承诺突破网络延迟。
- 不逐 delta 遍历全部历史，不逐 delta 序列化整段上下文；使用已计量边界和增量计数。SDK/RPC 均只发送小型数字事实，禁止传原始 prompt、图片/base64、工具结果正文。
- 采样订阅和 timer 随 abort/drop/replacement/dispose 释放；inactive 会话不由每个客户端启动独立采样。快照积压最多保留每会话最新普通样本 + 有限生命周期屏障。
- 后端在捕获时分配 sampleSequence，而非发送时才分配；压缩/重置屏障冲刷或取消屏障前采样，并递增本地采样取消标记。异步计算完成时校验该标记，避免同一 generation 的压缩前结果在压缩后被当作新样本；Host 异步重估另外捕获 contextVersion 并以 CAS 提交。
- 存储由原有租约和串行写队列托管，4Hz 上限也约束落盘；不能每个 token 打开/关闭 SQLite。

## 5. Host 状态与持久化

### 5.1 存放位置及公共 API

复用每会话 `transcript.sqlite3`，由 `@piwin/session` 新增职责独立的 `session-context-state-store.ts` 操作表 `session_context_state`。不另建顶层目录或新数据库，也不把可变快照伪装成 Model Visibility Ledger 的消息正文。

表至少保存 sessionId、schemaVersion、revision、contextVersion、contextBoundary、snapshot JSON。新增迁移是加法；通过现有 store 公共 API 暴露 `readContextState`、`replaceContextState`、`invalidateContextState`，内部模块复用现有数据库连接/事务，不能 deep import 跨包内部文件。

最后请求明细独立存入同库 `assistant_usage_measurement`，以 measurementId 唯一、messageId/runId 建索引；用其与活动路径关联完成 resume 明细查询。该表是请求事实的会话索引，不是第二份收费汇总权威；全局统计仍读取幂等的 usage ledger。删除/切分支只影响当前路径可见性，不回写扣减账单。

`replaceContextState` 以预期 contextVersion/边界比较并交换；过时计算的晚写必须失败。revision 在同事务递增；每个发布给客户端的权威快照先提交持久化，不能进程重启后正常读取就版本倒退。

数据库写失败：记录脱敏的 session 级诊断，将该会话 telemetry 标为 unavailable（使用独立诊断状态，不伪造已持久化快照）；不让遥测错误终止模型 Run。恢复时重新校验最后成功持久化边界，不将过期记录冒充当前值。

### 5.2 上下文变化事务

- 分支切换/截断/删除消息：活动 leaf 与上下文失效记录在同一 transcript 事务提交；向 Host 返回新 revision。先使旧值失效，再异步重估，避免崩溃夹在两次提交间复活旧读数。
- 压缩：已有 Pi 压缩边界是内容事实，snapshot 记录相同边界。成功时递增 contextVersion、替换占用并清空旧 breakdown；估算保持 estimated。跨 Pi/产品存储没有单个事务，恢复时检测边界不一致并进入 unknown/rebuild，不回退到账单。
- 压缩若仅存在于旧内存 runtime，不能仅持久化 2,500 这个数字就声称重启后仍有同一压缩上下文。冷激活必须用实际 replay seed 校验/重算：匹配才保留样本，不匹配就重建 contextVersion。这项修复不许掩盖真实 replay 内容变化。
- 普通冷读取不创建 runtime。冷激活生成新 runtime 后，绑定实际 seed、能力与模型；即使旧读数存在也要校验/估算，不能沿用另一个 generation 的样本。
- 抽走/冷存储：checkpoint 冲刷后随现有 session pack 流程打包；恢复时验证 schema 与边界。
- fork/duplicate/side-chat：保留历史内容可以继承“有有效响应”的事实，但必须建立新 sessionId/version；不原样复制 live owner/revision。没有可验证计量时用估算或未知。
- 删除会话随会话数据库清理；历史计费记录不因分支删除或截断而扣减。

### 5.3 老数据迁移

不从全局计费 ledger 恢复当前占用。`loadSessionUsage` 的上下文职责迁移到新 coordinator；ledger 留给统计。

老会话没有表/快照时先建立显式 unknown；使用 Host 当前有效路径的持久证据校验显示资格。需要 Pi-native token 解释时，经 agent-host 公共纯函数/后端能力，不在 session 或 UI 解析 Pi payload。读取有界，不能为了选择一个会话全量扫描全局账单。

旧 ledger 的 host-estimate 历史记录保留，并保持“历史估算”来源。新真实请求不再追加这种 fallback 账单。不得静默重写既有账单。

## 6. 账单与 hook：禁止流式采样产生业务副作用

1. `context/measurement` 在现有统一客户端推送/子会话转发/hook 之前截断，仅进入 ContextCoordinator；不入账、不触发 turn_end、不伪造 session/ended，也不产生宠物/命名/完成通知。
2. `usage/finalized` 只处理单次请求最终计量。message_end 即可提交，agent_end 仅补发遗漏；相同 measurementId 去重。Host 校验后更新请求索引、幂等账单并向客户端转发最终规范化请求明细；UI 不从 contextSnapshot 拼装此对象。索引与 JSONL 间用待投递状态重试，崩溃后按 measurementId 对账，避免先写索引后失败导致账单永久遗漏。
3. `UsageRecord` 加可选 measurementId/runId/messageId 字段；新增记录由稳定请求身份写入。`@piwin/session` 在串行 append 队列内检查幂等，启动时可从已有 id 建索引；rollup 也按有 id 的记录防御性去重。旧无 id 行保留原语义，不猜测去重。
4. JSONL 的崩溃恢复/重放不能让同一次最终计量重复计费；用“写入成功但调用方未收到确认”的故障测试验证。不能再依赖两秒年龄窗口。
5. 从 `host-runtime-services.ts` 移除“每个 usage/update 就是 turn_end”。turn_end 对齐 Host 已确认的前台 Run 终态并按 runId 去重，含失败/取消；保持 hook 名称及其它 hook 语义，不引入新 Run 完成权威。
6. “最后一次请求明细”绑定具体消息，不拿会话最新占用贴到任意最新 assistant 上。若展示整轮合计，须显式聚合该 runId 的最终请求记录并另行命名；本次不新增整轮统计 UI。

## 7. Desktop 与其他客户端

- 新建、切会话、离开 scope、删除当前会话时递增本地 `selectionEpoch`；每次 resume 请求捕获 `(hostInstanceId, sessionId, selectionEpoch, requestId)`。任何晚回调在更新消息、模型选择、usage 等所有副作用前先验证；不只在 reducer 最后加一个 null 判断。
- 同一会话的多个恢复请求也必须有 request 序号；`session/load-messages` 不再能从空草稿自行激活旧会话。用户选择是激活权威，数据返回只能填充当前选择。
- 新增独立 `context-telemetry-reducer.ts` 处理快照。收到当前选择会话的快照时，即使 transcript 仍加载中也接收；hydrate/live/replay 统一以 revision 选择最新完整状态。
- 每次选择立即清空“当前显示投影”；warm cache 按 session 保存 snapshot，不跨会话复用。失败时显式 unavailable/unknown，不能靠字段省略保留旧值。
- 同一 HostInstance 下丢弃旧 revision；HostInstance 变化时清除传输 cursor/待处理回调，再读取持久状态，不能用本机 Date.now 排序。
- 环只吃 selector 产物：可见性、数值、质量、状态、模型上限。selector 验证 session/版本/首响应资格，React 组件不猜计量口径。
- 主 Workbench、Conversation 多窗格使用同一个 selector/reducer；快照仅当前已订阅/可见或有限 warm 集合持有，遵守原有有界缓存。
- `readContextOccupiedTokens` 的模型迁移预检改用同一 Host snapshot 语义，包含缓存和输出；未知不当 0，保留 provider 最终约束与现有保守预算。
- CLI 使用 `session/context-get` 输出“已确认/估算/未知”，不需要新做 TUI 环；mobile 无环时可只正确接收/忽略新遥测并继续聊天，不能继续从账单制造实时占用。

## 8. 可执行工作包（按顺序，小提交）

每个工作包只完成自身纵切片。新能力在 WP5 完成前不对用户宣称可用；不得只上线刷新 UI 或只开启后端高频 usage。

### WP0 — 基线与结构准备（无行为变化）

- [ ] 重跑报告中针对性测试，记录既有失败和用户并行改动；按原探针复现序列准备目标行为回归用例，随对应修复工作包落入测试。未实现的目标断言不能算作纯结构提交引入的未知回归。
- [ ] 先按职责拆分需修改的巨型文件：chat reducer 的 session selection/hydration 与 context slice；composer 的 footer/context controls；Host routing/usage、transcript schema/事务封装若超限也先拆分。
- [ ] 拆分使用已有领域函数/公共 API，不复制两个版本的逻辑；纯 refactor 单独提交。新模块以约 400 行为预警，所有触及源文件回到 1,000 行以内。

验收：既有行为测试结果与基线一致；结构提交不改变占用规则。此前 4,405 行 reducer、1,356 行 composer 的数字只是调查时值，实施以当前文件为准。

### WP1 — Contracts、decoder 与存储底座

- [ ] 新增 §3 三对象、事件、context-get/Resume/capability 字段；补 discriminated union、非法数值与未知状态测试。
- [ ] 新增 session_context_state 与请求明细索引表及公开 API、revision/CAS/失效事务；接入 schema 升级、session pack/fork/delete。
- [ ] 连接 HostPush 分类、远程授权/投影、replay/hydration 入口，但先返回显式 unknown；不声称已有 live 采样。

主要文件：`contracts/{context-telemetry,assistant-usage,host,ipc,remote-protocol,index}.ts`、`session/{session-context-state-store,transcript-store,session-pack,index}.ts`、`host-transport/host-push-policy.ts`、host-server 现有远程投影/授权模块。新文件用前述命名；既有文件拆分后以公共入口为准。

验收：迁移幂等、CAS 拒绝旧写、事务故障回滚、跨重启 revision 不倒退、契约所有实现者 typecheck 通过。

### WP2 — SDK/RPC 共用计量与最终账单

- [ ] 用 Pi fixture 验证实际采样能力；实现 §4 的基线/尾部/partial 估算和覆盖信息。
- [ ] 新增共用 sampler/estimator；修改 message/agent-end mapper，首次响应证据与最终 usage 的 id 稳定。
- [ ] 两后端使用相同逻辑；扩展 worker 协议、generation 规范化和 Run stamping；旧 generation 晚事件拒绝。
- [ ] 删除生产固定分类和 mock fallback；保留明确 mock fixture 支持。

主要文件：`agent-host/{pi-context-sampler,context-occupancy-estimator,agent-usage-map,message-event-map,event-map,usage-map,agent-event-run-id,generation-identity}.ts`、`backends/sdk-backend-session.ts`、`rpc/{worker-pi-session-factory,worker-session-runtime}.ts`、`rpc-sdk-worker-protocol.ts`。

验收：同一 fixture 在 SDK/RPC 下计量一致；80K 输入 + 10K 输出为 90K（无缓存例）；长工具循环逐步更新而不重复累计；零值失败不归零。

### WP3 — Host Coordinator、持久化与副作用隔离

- [ ] 新建 `host-runtime/session-context-coordinator.ts` 管版本、响应资格、采样合并、校准、持久化；计量公式复用后端/contract 公共逻辑。
- [ ] 接入 prompt admission、Run 终态、压缩、分支/截断、runtime replacement/cold activation，删除恢复当前占用对 ledger 的依赖。
- [ ] 实现 §6 的最终请求幂等账单；turn_end 转向明确 Run 终态；兼容 usage/update 仅最终出口。
- [ ] telemetry 存储失败、取消、并发切换均记录诊断且不破坏模型执行；检查新推送不进入 hook/pet/命名。

主要入口：`session-agent-event-router.ts`、`host-runtime-usage-ledger.ts`、`host-runtime-services.ts`、`commands/{session-live-commands,session-branch-commands,compaction-live,usage-commands}.ts`、`session-runtime-{lifecycle,dispose}.ts`、`cold-activation-seed.ts`、`session/usage-ledger-store.ts`。

验收：真实 Host 命令测试通过压缩/重启/删空/分支流程；100 个 streaming samples 不增加账单或 hook 次数；三次模型请求恰有三条最终计量、一个 Run 终态 hook。

### WP4 — 客户端状态与环展示

- [ ] selectionEpoch + request guard 覆盖所有 resume 副作用；新增快照 reducer/selector 和 warm cache 适配。
- [ ] 实现 §2 状态矩阵、实时/已确认/未知文案、两语言、超限显示；移除缓存 timer 和固定分类 UI。
- [ ] 拆开当前占用与最后请求详情；Conversation 多窗格与 Agent 共用 selector。
- [ ] 模型切换预算消费者迁移；CLI/mobile 更新协议消费和明确降级行为。

主要入口：Desktop `hooks/use-session-actions.ts`、`conversation-pane-session.tsx`、`session-warm-cache.ts`、`context-usage-ring.tsx`、`conversation-usage-{details,copy}`、`hooks/use-{composer-model,workbench-derived-view}.ts`、拆分后的 chat/composer slices；CLI/mobile 实际 HostPush 消费入口通过引用搜索全部覆盖。

验收：表中每行至少一个 reducer/组件测试；用户新建不能被旧 resume 复活；A→B→A、失败、分页、双窗格均不串数。

### WP5 — E2E、兼容与文档收口

- [ ] 同一 Host 两客户端 + SDK/RPC + 断线重连/重启，验证序列与最终一致性。
- [ ] 覆盖 §9 性能/故障验收；本地可控延迟 provider fixture 为必跑项，真实供应商冒烟需单独获得调用授权。
- [ ] 更新 ADR 0022（当前占用独立持久化、最终请求幂等、淘汰估算账单新增）、架构/PRD/dev-plan；涉及协议兼容及持久化决策时新增 ADR，编号实施时按当前空位分配，不抢占其他任务编号。
- [ ] 删除旧 `shouldAcceptContextUsage` 的上下文消费者、旧 ledger 恢复/缓存 timer/固定 breakdown 入口；保留必要旧账单 reader，不建立永久双权威。
- [ ] 最后开启 `contextTelemetryVersion: 1`；实施记录填实测命令、结果和残留限制，不能仅将本文 checkbox 批量勾满。

## 9. 验收测试矩阵

| ID | 测试输入/时序 | 必须断言 |
| --- | --- | --- |
| T01 | 空草稿、输入未发、发送后空 message_start | 环均隐藏 |
| T02 | 首轮首个 text/thinking/model tool call | 各自能开启资格；Host 工具噪声不行 |
| T03 | 旧 session resume → New → 旧 response | 仍为空草稿，消息/模型/占用均未复活 |
| T04 | A→B→A 连续选择，恢复失败 | 仅当前 epoch 返回有效；失败不留 B/A 错配 |
| T05 | hydrate rev10，实时 rev11 先到；重复 rev11 | 保留 rev11；重复无变化，加载中也接收 |
| T06 | 分页/虚拟化移走最早 assistant | 显示资格不丢失 |
| T07 | 长文本、长思考与工具循环的分片 | 每阶段数值有更新，不等 agent_end |
| T08 | input80K/output10K；另测缓存读写 | 90K；缓存不重复加，tool-loop 总输入不逐次累加 |
| T09 | usage 基线已包含工具结果，又收到快照 | 不双算；仅计实际入模结果 |
| T10 | 无实测、缺图片估算、零 partial | 正确 estimated/partial/unknown，不冒充精确 |
| T11 | 新版估算晚于旧版实测 | 按版本接受；过期旧 generation 拒绝 |
| T12 | error/aborted 全零；失败但有真实账单 | 有效占用不归零；真实计费不漏记 |
| T13 | message_end + agent_end 重复同 measurementId | 账单只计一次 |
| T14 | 一个 Run 三次模型请求、100 次 context samples | 三份最终请求计量；一次终态 hook；采样无完成副作用 |
| T15 | JSONL 写成功后模拟崩溃再重放 | 相同测量不重复入统计；旧无 id 历史不被误删 |
| T16 | 压缩80K→5K | 整体明细一致；tokensAfter 估算仍标估算 |
| T17 | 压缩缺 tokensAfter / 旧 snapshot=null | 显式 unknown / 能建立新样本，不沿用旧满值 |
| T18 | 压缩后重启，seed 同/不同边界 | 相同时恢复匹配样本；不同时失效重估；绝不读旧账单代替 |
| T19 | 切分支、删到首条之前、旧异步样本晚到 | 旧版本拒绝；删空隐藏 |
| T20 | 冷激活/replacement/fork/pack恢复 | 身份、seed边界正确；无旧 live owner 继承 |
| T21 | 旧数据库/旧 ledger，无遥测表 | 可迁移、unknown、不扫描账单虚构当前值 |
| T22 | 相同会话双客户端与双后端 | 最终 snapshot 内容与 revision 一致 |
| T23 | disconnect/replay-too-old/HostInstance变化 | 不恢复旧传输数据覆盖当前状态；显式离线/恢复状态 |
| T24 | 已选1M模型切到128K；未知上限；120%占用 | 分母一致、来源标注清楚、未知不伪造、超限文字不截断 |
| T25 | 任意更新时间/无cache/模拟超过5分钟 | 不出现倒计时、过期结论或费用猜测 |
| T26 | 无MCP/无skills、仅总usage | 不凭百分比生成分类 |
| T27 | 10秒连续200个delta/会话 | 普通快照≤40次（边界快照另计）；更新不饿死；无逐delta整段扫描 |
| T28 | 本地可控provider分片到达/最终usage | 更新与校准≤500ms；记录Host接收→UI两个时间点 |
| T29 | 中文/英文、键盘、reduced-motion、8窗格 | 无混合文案、焦点跳动、播报洪泛或泄漏计时器 |
| T30 | SQLite迁移/写入失败、边界事务中断 | 诊断可见、数据不伪成功、模型Run不因遥测失败终止 |
| T31 | 新客户端+旧Host；旧客户端+新Host | 明确降级；未知帧不崩溃；无双重账单 |
| T32 | 历史下一轮等待、队列尚未执行、工具循环等待 | 分别按§2隐藏/保持当前Run/保持，状态不混淆 |

测试放在所属包 colocated；mapper 用原始 Pi fixtures，Host 用临时数据根/mock 或本地 provider stub，不动用户真实 `~/.piwin`。新编写测试断言目标行为，不继续断言调查中的缺陷存在。

## 10. 执行命令与完成定义

每个工作包先跑新建测试文件，再跑所属包 tests/typecheck。最终至少执行：

```bash
pnpm typecheck
pnpm --filter @piwin/contracts test
pnpm --filter @piwin/agent-host test
pnpm --filter @piwin/session test
pnpm --filter @piwin/host-runtime test
pnpm --filter @piwin/host-transport test
pnpm --filter @piwin/host-server test
pnpm --filter @piwin/host-client test
pnpm --filter @piwin/desktop test
pnpm --filter @piwin/cli test
pnpm --filter @piwin/mobile test
pnpm test:architecture
pnpm --dir apps/desktop exec playwright test e2e/context-usage.spec.ts
pnpm test
git diff --check
```

WP4/5 新增 `apps/desktop/e2e/context-usage.spec.ts` 后才运行该命令。已核对当前 mobile 提供 Vitest `test` script；其 `--passWithNoTests` 不能替代新增协议兼容用例，验收必须记录实际运行的测试数量。另外用行数检查全部触及的源文件，不能只检查新文件。

Done 条件：WP0–WP5 全部完成；T01–T32 有对应证据；无新增依赖/越层导入/超限文件；没有虚假缓存与分类；最终计费和 hook 不因刷新增频；SDK/RPC 与多客户端一致；文档与实际行为同步。基线失败必须单列，未达成所需绿灯时不得声称完成全量验收。

## 11. 调查问题到修复覆盖

| 问题 | 修复工作包 | 核心验收 |
| --- | --- | --- |
| 01 首响应资格/晚恢复 | WP3–4 | T01–03、T32 |
| 02 跨会话用量 | WP4 | T04–06 |
| 03 流式不实时 | WP2–4 | T07、T27–28 |
| 04 输入冒充占用 | WP2–4 | T08–10、T24 |
| 05 失败零值清空 | WP2–3 | T12 |
| 06 压缩明细不一致 | WP1、WP3–4 | T16–17 |
| 07 压缩/恢复倒退 | WP1、WP3 | T18、T20–21 |
| 08 分支/删空旧值 | WP1、WP3–4 | T19–20 |
| 09 hydrate新鲜度 | WP1、WP3–4 | T05、T22–23 |
| 10 估算冻结/错误fallback | WP2–3 | T10–11、T21 |
| 11 固定分类 | WP2、WP4 | T26 |
| 12 假缓存TTL | WP4 | T25 |
| 13 文案/状态 | WP4–5 | T29、T31–32 |

额外防回归：T13–15 保护账单/hook；T30 保护持久化失败路径。所有项在本次文档交付时均为待实施/待验收。
