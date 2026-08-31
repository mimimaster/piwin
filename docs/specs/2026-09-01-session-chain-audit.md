# 会话窗口全链路审计：归属、可见性、发送与恢复

日期：2026-09-01。状态：诊断与方案，**未实施修复**。

对应修改方案：[分阶段修改与验收计划](../plans/2026-09-01-session-chain-remediation.md)。

文档存档提醒：仓库 `.gitignore` 第 74 行忽略 `docs/plans/`；计划已落到本机磁盘，但不会自动进入 Git。本次没有改忽略规则或暂存文件，执行/提交阶段需明确收录方式。

## 1. 结论与边界

不是单一侧栏刷新 bug。当前链路存在三组系统性问题：

1. **用户意图没有稳定身份**：项目新建参数被丢弃，草稿归属被 effect 重写，异步完成时再读取“当前”会话/项目。
2. **实体、列表和选中状态混在一起**：无标题会话连归属都不保存；三份列表各自可写；列表结果能反过来污染当前视图。
3. **快照、推送、发送确认没有一致的版本与投影协议**：过期请求盖新状态，远端推送归属与查询归属不同，部分字段无法清空。

最优先的是防止发错会话、覆盖未发草稿，其次才是行的显示时机。不能只补参数透传、加刷新或加延迟。

审计基于当前工作区，包含已有未提交修改，不等同于已安装应用构建。未改源码、现有测试、配置、ADR 或用户会话数据；未向真实模型发送请求。没有复现用户历史操作的完整现场 trace，因此下面区分“已证明代码路径存在”与“用户那一次必然由此导致”。

证据等级：

- **V**：隔离执行当前实际组件、hook、reducer 或协议函数，确认缺陷特征。
- **S**：静态追踪确认分支和调用关系，未在真实应用中端到端触发。
- 本报告不把运行时耗时、网络丢包频率或用户历史数据损坏当成已测量事实。

## 2. 已覆盖链路

```text
项目＋ / Conversations / 快捷新建 / 草稿恢复 / 多窗格入口
  → WorkbenchSidebar → session gestures → composer drafts
  → optimistic message → ensureSession → session/create
  → Host scope/projectId 解析 → runtime admission → SDK/worker backend → bind/index
  → session/prompt ACK → detached preparation → transcript → text naming → model run
  → index/name/run/transcript pushes → local/remote transport → Desktop mapping
  → reducer entities/lists → scope/query/sort → 五条预览 → 虚拟列表 → selected row
  → resume/foreground reconciliation / bootstrap / reconnect / draft snapshots
```

核对了 contracts、Host 索引存储/命名、SDK/RPC backend 选择与创建顺序、远端响应/推送投影和订阅过滤；没有把 Pi 内核错误当成未经验证的根因。Host 的显式 scope 解析正常：客户端错误地发送 General 意图，Host 就会正常创建 General，会进一步影响 cwd 和 Chat/Agent 分类。

## 3. 用户现象对应关系

| 观察 | 已找到的机制 | 判断 |
| --- | --- | --- |
| 项目中新建、尚未发送，草稿跑到 Conversations | A01：项目 scope 被包装回调丢掉；打开项目异步，草稿先绑定旧 scope；空白同步 effect 还能覆盖显式 scope | V，直接解释“有时候” |
| 发送后浅色草稿、正式会话都没有 | A03：先移除 draft，create 只激活不插行，等标题/ACK 才插行；A08：正式行被五条预览截断 | 前者 S、后者 V |
| 切换后过一阵才看到 | A06：过期/跨 scope hydrate 竞争，重新查询恢复；A05：远端推送归入 `[host-path]`，列表查询才给正确 projectId | V；是否命中该次现场需 trace |
| 看似分组显示问题，实际工作位置也可能错 | A02、A07：界面 scope 与发送 sessionId 分裂，迟到创建/失败回调影响新选择 | V，优先级高于视觉问题 |

## 4. 问题清单

### A01 · P1 · 项目＋不是一个完整的新建动作（V：E01/E02/E18）

证据：

- [project-session-sidebar.tsx](../../apps/desktop/src/project-session-sidebar.tsx)，628–631：先调用 `onOpenProject(path)`，不等待，紧接调用 `onNewSession({ scope })`。
- [workbench-sidebar.tsx](../../apps/desktop/src/workbench-sidebar.tsx)，162、168：打开项目被 `void` 包装，新建被包装成零参数回调，scope 丢失。
- [use-workbench-session-gestures.ts](../../apps/desktop/src/hooks/use-workbench-session-gestures.ts)，109–116：草稿先开始，再执行清空会话。
- [use-composer-drafts.ts](../../apps/desktop/src/hooks/use-composer-drafts.ts)，270–305、408–424：空白草稿会用当前 navigation scope 重写显式的 `currentDraftScopeRef`；已有内容又阻止后续纠正。
- [use-session-resume.ts](../../apps/desktop/src/hooks/use-session-resume.ts)，453–460：`handleNewSession(_options)` 不使用 options。

复现：当前在 General，点击项目 P 的＋，延迟 project/open 返回，在此期间输入。草稿绑定 General，P 返回后仍留在 General。E18 还证明只修参数透传不足：旧 session→空白 draft 过渡仍能改掉显式 P 归属。

建议：新建入口只有一个 `startDraftInScope` 命令，同步捕获 scope、draftId、paneId、navigation generation；项目激活仅确认可用性，不反向修改草稿身份。显式目标不能为空、不能回退到旧页面。

### A02 · P1 · 切项目后仍持有旧 sessionId，可能发错会话（V：E12/E17）

证据：

- [chat-reducer-session.ts](../../apps/desktop/src/chat-reducer-session.ts)，100–162：project/set、project/clear 清空 transcript，但保留 `activeSessionId` 和原 `foregroundAdmission`。
- [use-session-actions.ts](../../apps/desktop/src/hooks/use-session-actions.ts)，366–426：普通打开项目会 dispatch project/set，默认不选择项目内会话。
- [use-composer-send.ts](../../apps/desktop/src/hooks/use-composer-send.ts)，230–233：存在 activeSessionId 就直接发送给它，不检查与 scope 的一致性。
- [foreground-admission.ts](../../apps/desktop/src/foreground-admission.ts)：只看 id 是否为空和 admission 是否 ready。

E17：General 会话 A ready → project/set(P) → composer 输入 → 实际 session/prompt 的目标仍是 A。此验证执行真实 send hook；不是仅凭界面推测。

同时，重复打开当前项目也会清空当前 transcript，直到后续恢复动作。原先为保留 composer 快照而保留 activeSessionId 的局部修补，破坏了页面身份约束。

建议：分开导航 scope、selected session、composer owner。先按旧 owner 保存草稿，再原子提交新的导航状态；不允许 UI 展示 P、发送 owner 却是 General A 的可编辑状态。启动恢复指针也只能记录有效配对的 session+scope。

### A03 · P1 · 首次发送没有连续可见的会话行，标题成为存在条件（S；标题退化 V：E09）

证据：

- [use-composer-send.ts](../../apps/desktop/src/hooks/use-composer-send.ts)，390–414、633–669：发送前移除草稿；有附件时甚至在 session 创建与上传之前移除。
- [use-session-actions.ts](../../apps/desktop/src/hooks/use-session-actions.ts)，331–343：无显式名称的 create 成功只 session/set，不插列表。
- [use-composer-send.ts](../../apps/desktop/src/hooks/use-composer-send.ts)，747–778：所谓 optimistic title 实际在 prompt ACK **之后**执行。
- [session-index-projection.ts](../../packages/session/src/session-index-projection.ts) 和 Desktop reducer 都按标题过滤存在性。
- [derive-default-name.ts](../../packages/session/src/derive-default-name.ts)：URL、完整代码块可被剥离到空；空文本附件发送同样没有 text fallback。E09 确认 URL-only、code-only、empty 均返回空标题。
- Host `maybeTriggerAutoName` 对 firstUserMessage.text 为空直接返回，见 [host-runtime-session-index.ts](../../packages/host-runtime/src/host-runtime-session-index.ts)，220–224。

影响：慢 create、附件上传、失败回滚都能延长无行窗口。纯图片/文件首发不能依赖文本命名；URL-only/code-only 可能要等模型命名，命名失败则继续不可见。普通文字首发不应被描述成“必定等模型回答”，因为现有 ACK 后本地插行通常能提前恢复。

建议：一个稳定可见项从 draft→creating→sending→accepted/failed；正式身份接管时原位替换。标题是显示属性而不是实体入库/可见性的条件；明确附件和不可提炼文字的安全 fallback。

### A04 · P1 · 无标题创建推送丢失身份，后续名称推送按当前页面猜归属（V：E03）

- [use-host-bootstrap.ts](../../apps/desktop/src/hooks/use-host-bootstrap.ts)，446–490：index-updated 映射后交给 session/update；name-updated 只提供 id/name/本机当前时间。
- [chat-reducer-session-list.ts](../../apps/desktop/src/chat-reducer-session-list.ts)，124–235：非 listable 项从列表移除，未另存实体；后续查不到归属就退到 activeScope。
- 该段注释声称不从 activeScope 发明归属，但 189–200 附近仍有这条 fallback。

E03：带 P scope 的空标题 created → 不保留该 id → General 页面收到该 id 名称 → 插入 Conversations。

建议：实体仓库与列表投影分离，保存未命名实体的 scope/kind/revision。未知实体的部分 patch 不可入错组，必要时补查 metadata。命名推送应带权威归属或转换为完整 index 更新。

### A05 · P1 · 远端查询与推送不是同一种 Session 投影（V：E14）

- [remote-session-projection.ts](../../packages/host-server/src/remote-session-projection.ts)：查询输出 path-free `projectId`。
- [remote-projection.ts](../../packages/host-server/src/remote-projection.ts)，277–285、625–653：普通 push 走通用脱敏，`scope.projectPath` 变为 `[host-path]`，没有转换为项目 ID。
- [remote-session-hydrate.ts](../../apps/desktop/src/remote-session-hydrate.ts)，392–408：对象 scope 里的任意字符串 projectPath 被当成有效归属。
- reducer 随后会从旧项目删除 id，移入 `[host-path]` 项目。

E14 串联真实 Host projector→Desktop mapper→reducer，确认已存在的正常 projectId 行被移入不可见目录键。侧栏只枚举 recentProjects，当然没有 `[host-path]` 这个项目。再次 list 会重新给正确项目 ID。

建议：session/list、resume、index push 复用 typed remote session projection；脱敏字符串不得成为合法 ID。不要通过保留真实路径“修复”，必须继续保证 path-free 安全边界。

### A06 · P1 · 列表加载的竞态保护同时过宽、过窄（V：E04/E05/E16）

- [use-session-actions.ts](../../apps/desktop/src/hooks/use-session-actions.ts)，135–218：request generation 按 scope，但 mutation epoch 全局；不接受结果时没有重试或标记需重取。
- [chat-reducer-session.ts](../../apps/desktop/src/chat-reducer-session.ts)，461–514：`fillActiveList: true` 绕过当前 scope 检查，旧 P 请求可覆盖当前 Q 的 sessions。
- [chat-reducer-session-list.ts](../../apps/desktop/src/chat-reducer-session-list.ts)，新实体插入才提升 epoch；remove、已有行 rename/pin 等不提升。
- [use-workbench-session-lifecycle.ts](../../apps/desktop/src/hooks/use-workbench-session-lifecycle.ts)，157–186：请求成功之前记录 hydrated key，并逐项目串行加载。

三个独立复现：P 的迟到结果出现在 Q 活动列表；General 新插一行使 P 的合法查询整个被丢弃；删除后旧快照能将已删行“复活”。重命名、置顶也有过期快照倒退风险。

这还解释“切换一下才好”：主动切换重新请求，偶然刷新了已被丢弃或污染的状态。不能把切换视作正常恢复机制。

建议：canonical entities + 每 query 的 ids/meta/loading/error，Host revision 或有边界的 snapshot+delta 合并；跨 scope 不互相废弃；删除 tombstone/版本；禁止 force-fill 跨目标活动数组。过滤或截断无法精确维护时按对应 query invalidate/reload，而不是永久丢弃。

### A07 · P1 · create / ACK / rollback 不绑定原发送操作（V：E06/E07/E13）

- [use-session-actions.ts](../../apps/desktop/src/hooks/use-session-actions.ts)，320–344：创建回来无条件 session/set；没有 resume 那样的 selection ticket。
- [use-composer-send.ts](../../apps/desktop/src/hooks/use-composer-send.ts)，157–184：rollback 恢复到当前 composer，并把内容写进 `activeSessionIdRef.current` 对应快照。
- 同文件 106–114、752：ACK dispatch run/accepted 不携带 sessionId。
- [chat-reducer-run.ts](../../apps/desktop/src/chat-reducer-run.ts)，443–470：将 ACK 绑定到当前视图；仅检查 runId 冲突，不检查 owner session。
- 同文件 send 的 776 行读的是回包时可变 `currentDraftScopeRef.current`，不是发送时冻结的 scope。

E06：A 发消息→切 B→输入 B 草稿→A 失败，B 内容被 A 文本覆盖。E07：A ACK 可使空闲 B 显示 A 的运行。E13：创建 A 未返回时用户选 B，A 返回又抢回选择。

附件路径还在发送锁设置前 await 创建/保存（send 401/414 对比 667），快速重复提交的保护并未覆盖完整事务；该附件交错列为 S，未做故障上传实测。

建议：冻结 OperationContext（host identity、scope、draft/session owner、pane、clientMessageId、selection generation）；全部完成/失败路径按 owner 写入。用户已切走时只更新后台实体；错误恢复进入原草稿，不覆盖新草稿。发送锁在第一次 await 前获取，并按 draft/session 而不是全局阻塞所有会话。

### A08 · P2 · 五条预览、折叠与排序让活跃会话不可见（V：E08；其他分支 S）

- [sidebar-tree-rows.ts](../../apps/desktop/src/sidebar-tree-rows.ts)，27–28、112–117、169–196：项目默认五条；草稿优先，正式会话按 pin/时间或名称排序，再直接 slice。
- 输入模型没有 activeSessionId，无法保证当前会话在可见窗口内。
- [project-session-sidebar.tsx](../../apps/desktop/src/project-session-sidebar.tsx)，181–184、550–568：折叠、visible count 单独保留；＋未显式展开已折叠项目。自动 reveal 只在键盘导航中做 scrollToIndex。

E08：五条 pin + 一条最新首发，正式会话不出现在五条预览，草稿已删，用户看到“消失”。按名称排序、多个草稿、已有折叠也要覆盖。虚拟列表本身不是已证明根因；数据层在虚拟化前就过滤掉目标了。

建议：显式新建/选择应 reveal 目标：展开必要父级、扩容预览范围、scrollToIndex。可保留紧凑预览产品设计，不能靠取消虚拟化或无限扩容解决。

### A09 · P2 · 列表字段投影不可逆，归档/取消置顶/冷存储失真（V：E10；生命周期分支 S）

- [remote-session-hydrate.ts](../../apps/desktop/src/remote-session-hydrate.ts)，335–365：仅映射 true，false 被丢弃；storage、kind、presentation 等也未透传。此 mapper 不只用于 remote，也用于 local list/index push。
- mapper 后走 patch merge，旧 `isPinned:true`、`isArchived:true` 不会被省略值清除。E10 确认取消置顶推送依然置顶。
- Host 下发 storage，客户端丢失后无法正确展示 offloaded/missing 状态与预先恢复入口。
- index-updated 非 deleted 全部 session/update，不按当前 archived filter 或 main/subagent 可见性过滤。
- [use-session-list-query.ts](../../apps/desktop/src/hooks/use-session-list-query.ts)，90：显示归档时远端搜索只查 archived；普通 list includeArchived=true 则是 active+archived，二者语义不一致。

建议：区分完整 snapshot 与局部 patch，显式字段清空语义；本地/远端共用经过验证的归一化实体。生命周期、kind、search/order 在统一 selector/query 中处理。不要分别在每个菜单 click 补一套状态。

### A10 · P1 · 未订阅的新会话/后台名称变化不能持续更新远端侧栏（V：E11；端到端影响 S）

- [host-push-audience.ts](../../packages/host-transport/src/host-push-audience.ts)，18、55：index-updated 全局，name-updated 仅 session 订阅。
- [host-runtime-session-index.ts](../../packages/host-runtime/src/host-runtime-session-index.ts)，178–185；[session-product-commands.ts](../../packages/host-runtime/src/commands/session-product-commands.ts)，287–296：文本命名和用户 rename 仅发 name-updated。
- Desktop remote subscriptions 只包含当前/可见 panes，见 [use-conversation-pane-layout.ts](../../apps/desktop/src/use-conversation-pane-layout.ts)。

另一个客户端未订阅新会话时，虽然收到空标题 created，却收不到随后使其可见的 name；后台 rename 同理。E11 证明 audience filter 确实拒绝该消息，未运行带真实两端 UI 的新建复现。已有双客户端 rename 测试不能替代“只订阅其他会话”的场景。

建议：权威 session index metadata 作为低频全局推送；transcript/token 保持按订阅过滤。无需订阅所有会话消息来保住侧栏。

### A11 · P1 · 未发送内容被当作可淘汰缓存（V：E15；重启丢失 S）

- [use-composer-drafts.ts](../../apps/desktop/src/hooks/use-composer-drafts.ts)，29–35、178–210：八条上限限制的是整个 session composer snapshot，而不只是大附件；超额直接删除文本和引用，无提示。
- E15：依次在九个已有会话留文字草稿，再回第一个，其输入为空。
- 新 draft 列表、session/draft snapshot 均只在 useState/useRef/Map 中；没有重载持久化。附件释放在 media composition 和 drafts hook 都有 teardown，生命周期所有者重复。

建议：未发文字/引用不是可随时丢弃的缓存；与大附件资源预算分离。超限附件必须可恢复或提示，不可静默连文本一起删。重载恢复单独设计 device-local draft store；不为保存草稿提前创建 Host 会话。

### A12 · P2 · 初始化、恢复和查询错误缺少完整状态（S）

- [use-workbench-session-lifecycle.ts](../../apps/desktop/src/hooks/use-workbench-session-lifecycle.ts)，首次加载/项目 hydratedKey/last restore 标志均在成功前消耗。
- 同文件 157–186：所有项目顺序 await，一项慢查询推迟后续项目；失败 catch 没有记录该 scope 的可重试状态。
- 同文件 199–235：旧 session 自动恢复没有与用户后续导航共用意图 token；handleOpenProject 也无 selection guard。迟到的自动恢复/打开项目可能抢回页面。
- [use-session-list-query.ts](../../apps/desktop/src/hooks/use-session-list-query.ts)，94–96：search 失败被当成空结果，UI 无法区分没有匹配与读取失败。
- reconnect reset refs 不等于 effect 必定重跑；应验证 recentProjects 身份不变、其他 scope 离线变化和空 scope 的 catch-up。不能只测 ready false→true。

建议：每 query 明确 idle/loading/ready/error/stale；恢复只能在用户尚未导航时提交；失败可见且可重试；后台项目适度并发且隔离错误。不要以“曾发起请求”替代“成功同步”。

### A13 · P2 · 多窗格绕开主链路的归属和草稿约束（S）

- [workbench-app.tsx](../../apps/desktop/src/workbench-app.tsx)，390–408：副 pane 激活时，点击全局侧栏任意 session 直接 bind 到当前 scope layout，没有先验证目标 scope。
- [conversation-pane-session.tsx](../../apps/desktop/src/conversation-pane-session.tsx)，54–70、199：props 没有 expected scope；仅验证“是 project 或 general”，不验证属于当前项目。
- [workbench-app.tsx](../../apps/desktop/src/workbench-app.tsx)，308–337：副窗格另有 session/create 入口，点击新建即创建无名 Host session，不走主窗格的本地 draft 生命周期。
- 主/副 pane 的选中、标题、composer、resume、发送错误处理各有一套。即使本轮只补主侧栏，仍会留下不同入口的不一致。

建议：复用会话归属验证和 draft/send coordinator，pane 只持有视图与 owner binding；跨 scope 点击必须明确导航或拒绝，不能暗中绑定。单独补多 pane 集成测试，不能只验布局函数。

### A14 · P1（故障条件）· Host create 的可发现性晚于运行时创建，索引写入还是 best-effort（S）

- [session-live-commands.ts](../../packages/host-runtime/src/commands/session-live-commands.ts)，195–274：等待 createSession、bind 后再发 created/ACK。
- [host-runtime-session-index.ts](../../packages/host-runtime/src/host-runtime-session-index.ts)，createSession：先 residency admission，再 backend activate。
- [product-agent-host.ts](../../packages/host-runtime/src/product-agent-host.ts)，prepareSessionWithIdentity：工具/配置/blueprint/SDK 或 worker 创建都在此段前置工作中。
- [host-runtime-bind-session.ts](../../packages/host-runtime/src/host-runtime-bind-session.ts)，索引写入失败 catch 仅记 warn，不让 bind 明确失败；create 后读取索引的 catch 甚至静默。

因此创建耗时不只是 UI 一个更新 tick；而在索引权限/损坏等故障下，还存在“运行句柄已建立但没有可发现索引记录”的设计分支。未对真实磁盘注入故障，也未测其实际耗时，不断言用户现场索引已坏。

建议：先保证 durable session record 可提交且可发现，再发布成功和激活运行时；无法持久化不能假成功。沿用 Host residency/cold activation 能力评估最小改造，保持 SDK/RPC 同一契约，不在 Desktop 补写索引。不要把整条创建链路重试当成恢复索引的办法。

## 5. 为什么现有测试放过了这些问题

已运行现有测试：20 个文件，211 项全部通过。

| 范围 | 文件数 | 用例数 |
| --- | ---: | ---: |
| Desktop drafts/send/resume/reducer/sidebar/query/remote/lifecycle | 9 | 129 |
| Host runtime list/scope/naming/chat ops/summary | 5 | 26 |
| Session projection/visibility/display name | 3 | 18 |
| Transport audience | 1 | 10 |
| Host server remote projection/live subscriptions | 2 | 28 |

另外写在 `/private/tmp/piwin-session-audit.7a06uJ/` 的隔离诊断：18 项全部确认当前**错误行为**，不是“修复后测试通过”。它们直接 import 工作区代码，不修改业务代码；部分是函数级重现，部分挂载真实 hook，未冒充完整应用 E2E。临时目录可能被系统清理，下列场景和源码证据是持久报告。

| 诊断 | 证明内容 |
| --- | --- |
| E01 / E02 / E18 | 实际 Sidebar 丢参；延迟导航留下错组；仅透传仍被 blank effect 覆盖 |
| E03 | 空标题实体归属丢失，名称 patch 入当前组 |
| E04 / E05 / E16 | 旧项目 force-fill、全局 epoch 误伤、删除后快照复活 |
| E06 / E07 / E13 | 回滚覆写 B；无 owner ACK 污染 B；create 回包抢选择 |
| E08 / E09 | 五 pin 隐藏新会话；URL/代码/空正文无 text title |
| E10 / E11 / E14 | false/storage 丢失；未订阅名字不达；远端 `[host-path]` 隐藏行 |
| E12 / E17 | 切项目状态不一致；真实 send hook 向旧 General id 发出 prompt |
| E15 | 九个会话未发文字触发八条缓存淘汰 |

现有用例多在 component 或 hook 内直接传对 scope，绕过真正 WorkbenchSidebar 包装；列表测试分别验证加载和插行，缺少交错；remote 测试偏重“不泄漏路径”，没有验证脱敏后仍能正确分组；成功发送用例缺少“等待时用户已切到 B 并编辑”的序列。

未运行：全仓 typecheck/全测试、真实 Tauri 交互、真实 SDK/RPC provider 首发、双设备 UI E2E、故障磁盘/网络注入。这是只审计任务，不能写成完成修复或发布验收。

## 6. 应收敛和删除的结构，不是继续加补丁

- `sessions`、`generalSessions`、`projectSessionsByPath` 三套可变副本 → 单一 entities + query ids，活动列表是 selector。
- 无标题实体直接过滤掉 → 仅控制展示，保留身份；不再靠名字是否像 placeholder 判断会话是否存在。
- `fillActiveList` 特权、activeScope 猜归属、全局 mutation epoch → 有 owner/version 的查询合并。
- `skipDraftSaveRef`、`preserveComposerOnSessionActivationRef`、`holdLiveDraftOnEmptyRef`、previous scope/id 等交织开关 → 明确 draft/navigation/send 状态转换；新实现覆盖测试后删旧开关，不能先全删。
- 中途读取 current active state 的回滚/ACK → 带 owner 的 operation completion。
- 主/副 pane 重复 create/send/resume → 共享协调逻辑，保留各自视图。
- generic sanitizer 冒充 remote domain projector → 独立、可验的 typed projection。
- 重复 teardown → 一个明确的附件资源生命周期所有者。

规模核对：本次重点文件均未超过 1000 行，但 `use-session-actions.ts` 992、`use-host-bootstrap.ts` 921、`use-composer-send.ts` 816、`project-session-sidebar.tsx` 876；这些已跨多个责任，不能因未超硬上限就继续叠加。拆分应围绕导航/实体/查询/发送/资源责任，结构重构与行为修复分提交。

保留：Host 唯一 authority、原生图片输入、scope 安全边界、SDK/RPC 双模式、resume ticket 的已有保护、Host index 原子写/锁、bounded list 与虚拟化、transcript 分页和 run reconcile。未发现的部分不应借本任务大拆大删。
