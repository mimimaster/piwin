# 闪卡复习台：桌面 / 移动端执行规格

日期：2026-08-30  
状态：**产品方向由 owner 明确；本文是供后续实施的完整方案，本轮只写文档，不实施功能。**  
执行清单：[复习台实施计划](../plans/2026-08-30-flashcard-review-workbench-execution-plan.md)。

## 0. 必须遵守的边界

1. **保留现在的卡片 UI。** 现有卡面、正反面呈现、排版、主题、Markdown、标签和来源视觉是实现基线。不得采用上一版原型的卡面，不改为问答上下平铺，不重新设计颜色、字体、边框、圆角或卡片皮肤。
2. **成套卡必须保留逐张撕开的效果。** 一张离开、下一张从下方露出；不是普通分页、轮播滑动、直接换文字，也不是删除卡片。桌面与移动端同样适用。
3. 新增的是卡片之外的复习承载空间：入口、退出、续学、进度、操作状态、结束反馈；具体布局使用两端现有壳与 `@piwin/ui-kit`，由实施者参考当前实现适配。本文不提供新的视觉稿。
4. Desktop 与 Mobile 在第一版都必须有可用学习闭环，不把 Mobile 仅写成“未来支持”。移动端不能只剩聊天里的 Q/A 文本。
5. 同一 Host、同一 CardStore、同一进度权威。不得新增第二卡库、手机本地调度器、独立学习账号或 Pi 依赖。
6. 本文取代上一份复习台提案中的视觉、并排问答、模拟插队和“移动端可只降级”的实现建议。旧原型及其测试不作为实施依据。

## 1. 本轮解决什么

用户从现有闪卡库进入一个稳定的复习页：学习单张或整套卡、翻面、逐张撕开、随时离开、回来继续；也能从同一空间处理现有间隔复习队列。桌面学到一半，可以在连接同一 Host 的手机上继续。

第一版包括：两端入口、顺序复习、待复习队列、撕卡、持久进度、暂停 / 返回、最近一步撤销、多端接续、断线保护、空态 / 小结。

第一版不包括：重做卡片视觉、打卡 / 排行榜、统计仪表盘、学习计划、离线批量评分、完整离线卡库、重写 FSRS、增加卡片模型、移动端整套出卡 / 卡库管理、新的 AI 伴学能力。

## 2. 当前代码基线与缺口

以下是源码核查，不代表已验证用户正在运行的打包版本。

| 基线 | 实施意义 |
|---|---|
| Desktop `FlashcardsWorkspaceView` 已是卡库 + 出卡页，点卡打开 `TearDeck` | 卡库与出卡保留；点卡后的临时浏览承载改接复习台 |
| `TearDeck` 已有翻面、下一张、关闭、完成态；index / revealed 是本地状态 | 复用卡面与动作语义，迁出队列权威，增加可恢复轮次 |
| 当前 `fcws-tear-off` 为 200ms、向右移动并旋转 / 淡出 | 撕卡动效的直接实现参考；需保证下一张预先在下层承接 |
| `groupFlashcardTiles` 按 `sequenceId` 聚套、`position` 排序 | 沿用套身份；补相同 / 缺失位置的稳定排序，移至所属公共领域模块供 Host 使用 |
| Host `flashcards/queue` / `flashcards/rate` 与 `CardStore` 已有 | 复用排程与数据；现在没有完整轮次、持久幂等撤销和跨端进度 |
| `runSerializedCardRate` 只对旧命令按 cardId 排队 | 不等于完整事务，也不覆盖新旧入口的统一并发控制 |
| `HostRequestAttempt` 已有冻结请求及相同幂等键重试 | 直接复用，不发明另一套请求重试标识 |
| Mobile 为 React + Tauri + HostClient + ui-kit；闪卡目前是纯文本降级 | 增加 Mobile 卡库入口 / 复习页；共享纯卡面，不复制 Desktop 应用 |
| Mobile 导航主要是 overlay hash，无闪卡页面 | 增加语义明确的页面路由与退栈，不用多个弹层假装复习台 |

基础约束仍遵守 ADR 0018（卡 / 复习数据持久化）、0054（Item 与 ReviewCard）、0037（移动壳是 Host 客户端）。原有“没有复习台”描述不能否定 owner 本次新增需求。

## 3. 两种学习目的，共用一个复习台

### 3.1 顺序复习：默认用于单张 / 一整套

- 卡库点单张或一套，进入复习台的 `sequence` 模式；替代该入口原来的临时浏览弹层。卡面不变。
- 一套包含**所有已生成的成员**，按套内顺序逐张撕开，不按到期情况删减、打散或随机洗牌。
- 一张就是长度为 1 的轮次；最后一张不伪造下一张。
- 保留现有「提问 / 解答」「下一张」「结束浏览」语义。可以未揭晓就下一张，记录“已浏览”，不等于答对。
- 可在卡片外「标记需再看」；第一版只保存在该轮次中，不变更卡面、CardStore 标签或 FSRS。
- 下一张提交的是浏览进度，不是评分。顺序复习**不修改到期日期 / reps / lapses**，也不自动给 cloze 各空打分。
- 完成显示已浏览数量与需再看数量；若要再看标记卡，显式发起新轮次，保持原相对顺序，显示“巩固子集”，不称完整一套。

### 3.2 待复习：按现有调度处理一批题

- 卡库保留单一新入口「待复习」；可带卡组筛选。不把图库首页改成学习仪表盘。
- 使用 `buildReviewQueue` 取一批 ReviewCard：已到期的在前，再按当前配置加入新卡。入口数量区分“到期题 / 新题”，不把新题全部叫到期。
- 先揭晓再按现有四档 `again / hard / good / easy` 评分；沿用现有评分控件样式与文案，不采用旧原型的新评分皮肤。
- 评分成功后自动撕开下一题，不再让用户额外点一次下一张；失败留在当前答案面。
- **每轮固定一批，每题最多提交一次有效评分。** Again 写真实 FSRS 结果，但不在前端硬塞到“隔两张以后”；到期后由下一轮获取。第一版不承诺轮内实时重学倒计时。
- 一批处理完显示“本轮已复习 X 题”，包括 Again；这表示处理数量，不是掌握率。新一轮由用户显式发起，重新查询当前到期状态。
- 现有配置中的每日限额目前是队列构建参数，不在本项目中把它宣传为已实现的全天累计配额。

### 3.3 套顺序与 cloze 的硬边界

| 概念 | 顺序复习 | 待复习 |
|---|---|---|
| 学习单位 | 物理 Item | 独立 ReviewCard |
| 成套身份 | 同 `sequenceId`；一套连续出现 | 可来自多套；只称本轮队列，不冒充完整卡套 |
| 顺序 | `position` 升序；相同 / 缺失时稳定排序 | 沿用现有到期排序，不为视觉成套改写算法 |
| cloze | Host 用 `itemToDisplayCard`；一次展示物理卡，不拆成多张套成员 | Host 用 `expandItemToReviewCards`；c1 / c2 各自评分 |
| 下一张 | 下一物理卡从叠卡下方露出 | 下一复习题从叠卡下方露出；同 Item 不同空标明“同卡第 N 题” |
| 数量 | 用“张”，套进度基于 Item | 用“题”，另有需要才说明来自几张卡 |

UI 不解析 cloze 字符串；不把多个空当作多个原始卡片。两种目的通过入口确定，进入后不在半轮中切换模式。

## 4. 入口与跨端返回

| 场景 | 进入 | 退出 |
|---|---|---|
| Desktop 卡库点单张 / 一套 | 默认顺序复习，匹配未完成轮次则继续 | 回卡库，保留筛选、搜索、滚动、触发焦点 |
| Desktop 卡库「待复习」 | 按当前范围创建 / 继续 scheduled 轮次 | 回原卡库上下文 |
| Mobile「闪卡」入口 | 同一 Host 的卡套 / 单张列表、待复习、未完成轮次 | 返回手机自己的前一页，不跳到 Desktop 会话 |
| 聊天闪卡显式「进入复习台」 | Host 校验 itemId / sequenceId 后打开；不创建新聊天 | 回原聊天；默认不额外插入卡库中间层 |
| 直接恢复已保存轮次 | 无本机来源页面时从卡库打开 | 返回本机卡库 |

移动端第一版列表只做读取、打开、继续和范围选择；不要求移植 Desktop 全部生成 / 管理界面。聊天原有文本展示可保留，但必须有真实可用的打开入口，不能把文字降级当作移动复习台完成。

导航来源是**设备本地的展示状态**，不是 Host 学习真值。Host 负责 roundId / 当前卡 / 学习状态；A 设备的聊天位置不能强加给 B 设备。

## 5. 必须实现的撕卡行为

### 5.1 视觉契约（不可替换为普通换页）

- 正常动效设置下：当前卡保持原样，下方已放好下一张的卡背 / 空白壳；当前卡按现有撕离轨迹离开，下一张自然露出并成为顶张。
- 直接参考现有 `TearDeck` 与 `fcws-tear-off`。轨迹 / 时长沿用当前实现，不在本项目重新设计动效语言。
- 下层不能提前显示可读的下一张题面 / 答案；待转场承接时才露出内容。整个舞台最多保留当前、下一张壳及出场快照，不渲染整套长 DOM。
- 单张轮次只翻面 / 结束，不假装有整叠；多张轮次最后一张沿用原完成过渡，不制作空白下一张。
- 撕卡永远只是推进；不删磁盘卡片，不改变套内 `position`，不从卡库移除已复习卡。
- 正面 / 背面切换仍是当前卡翻面，不触发撕离；收起提示、返回、暂停、撤销也不冒充撕卡。

### 5.2 数据与动效的时序

```text
一次用户操作
  → 冻结幂等请求，锁定推进 / 评分
  → Host 持久提交评分或浏览进度，返回新 revision 与下一题
  → Shell 保留上一张出场快照，播放现有撕卡
  → 动效结束：丢弃快照，下一张可操作
```

- **Host 提交在前，动画在后。** 未确认的请求不撕；不能“动画已走、数据没写”。
- `animationend` 只结束视觉转场，不发评分 / next 请求。数据正确性不得依赖动画事件。
- `transitionId = roundId + committedRevision`：同一响应 / Push 重播不再次撕、不重复计数。
- 连点、按键长按、评分 + 下一张竞争，都至多提交一次；受控阶段不接受第二次推进。
- 动画期间允许退出；销毁视觉快照，不回滚已提交进度。重进直接显示 Host 当前卡，不重放旧动画。
- 动画事件丢失：以当前时长 + 容错截止回到可操作状态；计时器在 shell/controller 注入，并在卸载时清理。不能留下透明卡或永久 disabled。
- 系统“减少动态效果”开启：用零位移 / 立即承接完成同一状态切换，不等待不存在的动画事件。这是可访问性例外，不是普通模式省略撕卡的理由。

### 5.3 触控与内容选择

第一版**不新增拖拽 / 左右滑动评分**。点「下一张」或评分按钮就有撕卡效果，手机不需要真的用手把卡撕走。

卡面拖选、长按复制、纵向滚动、代码块横向滚动、iOS 边缘返回，不触发 next / rate。原有可选择文本与伴学能力保留；新增进度壳不能覆盖其命中区。

## 6. 退出、暂停、恢复和撤销

### 6.1 正常离开

- 明确可见的返回动作，Desktop Esc / Mobile 系统返回也走同一导航语义。已保存状态下一次操作即离开，不弹确认。
- 不依赖 hover、遮罩外点击、滚到卡片底部或学习完成才能退出。
- 有顶层辅助浮层时先关闭该层；没有时退出复习。一次事件只退一层，不能多个全局监听器各退一次。
- 返回等于暂停保留当前轮次；不是结束、不清空历史、不删除卡片。显式「结束本轮」才进入提前结束小结。
- 暂停时遮住题面 / 答案；继续恢复同一卡面。暂不新增学习计时功能。

### 6.2 自动持久化

- Host 保存当前 entryId、question / answer、浏览 / 评分计数、需再看标记、模式、范围和固定队列。
- 翻面即时本地响应，再串行 checkpoint；下一步评分使用 checkpoint 返回的新 revision。保存状态区分“保存中 / 已保存 / 待确认”。
- 不只在页面卸载时保存；Mobile 杀进程 / 锁屏可能没有可靠退出回调。
- 已确认状态能在重启 / 另一端恢复。未确认的翻面或评分按待确认操作核对，不能假称已保存。
- 再次进入同一模式与范围，优先恢复最新未完成轮次；显式“新一轮”才新建，不默默覆盖旧进度。

### 6.3 撤销

- 第一版支持**撤销本轮最近一次有效推进**：顺序模式撤销最近 next；scheduled 撤销最近 rate；不做任意历史回滚。
- 恢复之前的队列游标 / 卡面 / 计数。scheduled 同时恢复该评分之前的 ReviewState；不是补交反向评分。
- 翻面、暂停、接管不清除可撤销目标；下一次推进将目标替换。完成后仍可撤销末题，回到进行中。
- 撤销只反转该次学习变更；保留当前 controllerIdentity / controlEpoch、后续独立“需再看”标记，生成新的单调递增轮次 revision。恢复旧 ReviewState 的业务字段时也生成新 revision，不能退回旧版本号造成 ABA 冲突。
- 若该 ReviewCard 已被其他轮次 / 旧评分入口修改，撤销明确失败并刷新，不能覆盖新状态。需再看标记不计入“最近推进”。
- 撤销后直接回到原卡或使用现有轻过渡，不重新设计“反向撕卡”。

### 6.4 卡片或卡套变化

- 开始时固定成员 ID 与顺序；生成过程中进入只包括此刻已经落盘的成员，明确“本轮 N 张”。后来新增的留到下一轮。
- 有效 position 按升序；相同位置用 createdAt、itemId 打破平局；缺失 / 非法 position 排到有效位置之后并稳定排序，不改写源文件。
- 当前卡内容变更：Host 返回新投影 / 新 contentVersion、回正面，要求重新回忆后再评分。不能给没看过的新答案写旧评分。
- 删除 / cloze ordinal 移除：标记 entry invalidated，跳过失效项并说明；不恢复被删除内容、不生成幽灵卡。
- 已处理 / 失效 / 剩余分开计算；不能删掉一题就把它计成答对。全失效时有明确空态与返回。
- 仅未处理项参与失效剔除；已经处理过的项保留学习历史与计数。该卡后来删除时撤销需拒绝，不能因撤销复活卡片。
- 计数固定为 total（本轮初始条数）、processed、invalidated、remaining；`remaining = total - processed - invalidated`。remaining 为 0 即可结束，失效数单独说明，不为了满格把 invalidated 加到 processed。
- scheduled 未处理项的 ReviewState 被别的入口修改时：已不待复习的标记失效（原因“已在别处复习”）；仍待复习的刷新 state revision 并回正面。提交必须携带看到题目时的预期 ReviewState revision，不能悄悄对最新状态再评分。

## 7. 桌面与移动端适配要求（不是视觉重设计）

| 项目 | Desktop | Mobile |
|---|---|---|
| 卡片 | 现有卡面作为视觉基线 | 同一卡面组件及主题规则，仅允许可读性所需的宽度 / 换行适配 |
| 返回 | 现有壳的返回控件；Esc 分层退栈 | 显式返回 + Android 返回 / iOS 返回手势，均不误提交评分 |
| 主操作 | 鼠标 + 键盘 | 可单手点按；保持常用操作可达，不要求精确拖拽 |
| 长内容 | 阅读区可滚，返回和主要学习动作不被正文推出视野 | 兼容安全区、横竖屏、软键盘；只保留一个主要纵向阅读滚动区 |
| 评分 | 原四档控件；1–4 仅答案面有效 | 相同语义，空间不足可换行；不靠颜色或手势表达评分 |
| 切后台 | 不推进、不清零 | 隐藏 / 失焦中断未结束视觉动画；恢复先核对 Host，不假设 WebSocket 常在线 |
| 来源 | 复用已有安全来源打开能力 | 第一版展示 Host 提供的安全标题和摘录；不把 Host 路径当手机路径打开 |
| 伴学 | 复用已有能力 | 能接现有能力则同契约；否则明确不可用，不阻断翻面、撕卡、复习 |

Mobile 完整来源文件打开若现有协议不支持，明确“可查看摘录；完整来源需在电脑查看”；不得调用会在 Host 机器打开编辑器的 `doccards/open-source` 后声称已在手机打开。向 Mobile 返回的投影移除 Host 绝对路径。

快捷键：复习台有焦点且非输入 / 可编辑区时，Space 沿用翻面；scheduled 的 1–4 评分；sequence 的 Enter / 右箭头沿用原揭晓 / 下一张规则。原生按钮上的 Space / Enter 仍是按钮激活，禁止同一按键被原生行为和全局快捷键处理两次；忽略 repeat / IME，保留系统与辅助技术快捷键。

## 8. Host 契约（拟新增，实现必须先行）

### 8.1 数据模型

| 类型 | 最小字段 / 约束 |
|---|---|
| `FlashcardStudyMode` | `sequence` 或 `scheduled` |
| `FlashcardStudyScope` | 判别联合：`item {itemId}`、`sequence {sequenceId}`、`selection {parentRoundId, itemIds}`、`all`、`deck {deck}`；sequence 只允许前三种，scheduled 只允许后二种；selection 必须是父轮次成员子集，保留其相对顺序 |
| `FlashcardStudyRound` | roundId、schemaVersion、mode、scope、status、revision、controlEpoch、controllerIdentity、createdAt、updatedAt、entries、currentEntryId、face、lastAdvanceOperationId；status 为 active / paused / completed / ended |
| `FlashcardStudyEntry` | entryId、itemId、scheduled 才有 cardId / ordinal / reviewStateRevision、contentVersion、capturedPosition、state（pending / processed / invalidated）、needsReview；不复制一套 CardStore 原文作为第二真值 |
| `FlashcardStudySnapshot` | 轮次摘要、当前内容投影、下一张壳所需元数据、计数、canUndo、nextDueAt（适用时）、访问 / 控制状态；不推送整套答案正文 |
| `FlashcardStudyOperation` | 幂等键、稳定 payload 摘要、Host timestamp、前 / 后 revision、结果；推进类含撤销所需 before / after image 与 ReviewState 版本 |
| `FlashcardStudyCatalogPage` | 同一 CardStore 的 tile 摘要（single / set、数量、稳定 ID、预览）、到期题 / 新题计数、未完成轮次摘要、分页游标；不拉全库答案给手机 |

`contentVersion` 由 Host 对卡模型、正反投影和 ordinal 等相关内容计算；与外部资料的 sourceHash 区分。ReviewState 增加向后兼容的 revision 字段（旧文件缺省为 0），每个写入口统一递增，用于防覆盖与撤销校验。

### 8.2 命令表

统一命名空间建议 `flashcards/study/*`。新增能力必须接入现有 HostCommand / response 校验、远程命令分类与 HostPush，不只增加 TS 类型。

| 命令 | 输入 | 返回 / 行为 |
|---|---|---|
| `catalog` | scopeFilter、query、cursor、limit（Host 限制） | catalog page；服务端过滤与稳定分页 |
| `start` | mode、scope、resumeExisting（默认 true） | 创建或返回最新未结束轮次 snapshot；同幂等键不创建两轮 |
| `get` | roundId | 当前 snapshot；读取先 reconcile 卡片变化 |
| `claim` | roundId、expectedRevision、expectedControlEpoch | 显式“在本设备继续”；分配新 epoch，原端转只读 |
| `checkpoint` | roundId、expectedRevision、controlEpoch、entryId、contentVersion、face、needsReview（可选） | 保存非推进状态；只接受当前 entry |
| `next` | roundId、expectedRevision、controlEpoch、entryId、contentVersion | 仅 sequence；持久推进一次，返回下一快照 |
| `rate` | 上述公共字段 + rating、expectedReviewStateRevision | 仅 scheduled，答案面才接受；原子校验 / 写 ReviewState 与轮次推进 |
| `undo` | roundId、expectedRevision、controlEpoch、targetOperationId | 校验最近推进与 ReviewState 版本后恢复 |
| `pause` / `resume` | roundId、expectedRevision、controlEpoch | 保存 / 恢复状态，不改变当前卡；resume 不隐式抢占另一端 |
| `end` | roundId、expectedRevision、controlEpoch | 显式提前结束，保留已提交记录，未学项不计完成 |
| `operation` | 幂等键 | 确认 success / rejected / not-found；返回原结果或错误，不隐式重试写入 |

所有变更命令使用现有 Host 请求信封中的 idempotencyKey（复用 `createHostRequestAttempt`）；不再平行发明 operationId 随重试变化的字段。表中 targetOperationId 指最近推进的同一个稳定键。

Push：`flashcards/study/changed {roundId, revision, reason}` 与可恢复快照。先持久化再广播；客户端忽略旧 revision，发现断档 get。全局通知仅发必要摘要，不将题目、答案或来源广播到无关客户端。

错误名稳定：StudyRoundNotFoundError、StudyRevisionConflictError、StudyControlLostError、StudyContentChangedError、StudyUndoConflictError、StudyOperationConflictError、StudyStorageError。边界映射简短用户文案；不输出内部堆栈。

### 8.3 多设备写入规则

- 每个轮次只有一个当前控制端，其他端可看进度；点击“在本设备继续”才接管。不自动抢占，也不因为进入后台就让另一个端自动续学。
- 控制身份来自已认证 Host 连接上下文，不接受客户端请求体自报 deviceId 作为权限依据。控制仅防误操作，不新增授权范围。
- 同一设备恢复连接可恢复其控制身份；另一设备必须显式 claim。无租约超时依赖：原端离线也能通过用户接管继续。
- Claim 提升 controlEpoch；旧端提交被拒绝并转“已在另一设备继续”。新旧轮次对同一 ReviewCard 的写入仍用 ReviewState revision 防冲突。
- 先完成连接认证与操作读取权限校验，再做幂等查账，最后校验 epoch / revision：已提交操作重试返回原结果；未提交的旧 epoch 操作禁止执行。不能把“原请求成功但 ACK 丢失”误判为可以再记一次，也不能凭知道幂等键读取其他主体的操作结果。
- 模式 / 范围不同可有多个暂停轮次；catalog 展示最近未完成项。`resumeExisting` 在同 scope+mode 中稳定选择最新未结束轮次，不把旧数据覆盖成新一轮。

## 9. 持久化、失败与离线边界

### 9.1 文件与事务

卡片仍在 `~/.piwin/flashcards/cards/`，ReviewState 仍在 `review/`。新增 `study/rounds/<roundId>.json`、`study/operations/<sequence>-<keyHash>.json`；均属用户数据，不是可删除缓存。keyHash 为幂等键的稳定摘要，原键只存于记录内；目录用既有路径安全约束，ID / 游标需校验。

一次 next / rate / undo 不能靠先后写两个 JSON 冒充原子事务。建议最小持久日志方案：

1. 在 `@piwin/flashcards` 内以 flashcardsRoot 为范围串行处理变更；旧命令 / 工具也进同一服务，不能仅锁新复习台。
2. 校验当前身份、revision、内容版本；计算 before / after image，幂等键固定 Host 评分时间。
3. 原子写入完整 operation 记录并可靠落盘，定义为提交点；内容包括轮次与 ReviewState 的目标状态，不在重放时重新计算 FSRS 时间。
4. 用临时文件 + rename 写目标状态，再写 applied 标记；只有投影完整才能 ACK / 发 Push。
5. 提交点之后崩溃，启动按日志顺序幂等补完，再开放闪卡读写；提交前崩溃无有效操作。日志损坏隔离并报告，不能清零进度继续假成功。
6. `operation` 核对和重试返回相同结果；相同键但不同 payload 返回 conflict。V1 不自动裁剪尚影响恢复 / 撤销的日志。

须复用已有原子写入 / 请求工具；若跨包没有公开且层级合法的日志原语，在 flashcards 内按职责实现，不深引 host-runtime 的私有存储模块。不把这些 I/O 放入 ui-kit / host-client。

旧 `flashcards/rate`、聊天评分与工具评分统一调用领域写服务；旧调用可以没有新轮次，但必须递增 ReviewState revision，不能绕过撤销冲突与事务锁。创建 / 删除 / 初始化 ReviewState 也要与恢复、评分的同根写锁协调。

### 9.2 离线策略：第一版在线学习，保护单次待确认操作

- 无 Host 连接时不启动新轮次、不进行批量评分，不在 Mobile 创建另一套可离线写的学习库。
- 请求发出前，在设备现有持久状态机制保存最小待确认请求（hostIdentity、roundId、key、payload、revision、epoch）；不存 API 密钥、整库原文或自行推算的 FSRS 状态。
- 每个活动轮次串行提交，一次推进至多一个待确认项。翻面 checkpoint 可以合并未发送的最新值，但已经发送的请求不得换键或改 payload。
- 超时不等于失败：当前卡保持，显示“结果待确认”；重连先查 operation。success 接受 Host 当前快照；not-found 才允许原请求重试；conflict 刷新并请用户重新操作。
- 返回仍允许；提示待确认状态并保留本机请求。不能为正常离开增加层层确认，也不能声称“离开就丢失已确认进度”。
- 换设备时只有 Host 已提交内容是已保存；旧设备未发送的选择不会凭空出现在新设备。接管后旧 pending 核对但不自动写入新 epoch。
- 手机锁屏 / 杀进程 / 网络切换测试必做。系统回调只是加速保存，不能作为唯一保存时机。

## 10. 实现职责与复用

| 所属 | 工作 |
|---|---|
| contracts | 上述模型、命令、响应、Push、错误码与远程命令分类；叶子包，不引应用包 |
| flashcards | 套排序 / catalog 投影、轮次状态机、队列构建复用、日志 / 恢复 / 撤销、统一 ReviewState 变更服务 |
| host-runtime | 组合领域服务与连接身份，路由命令，注入广播 / 调度；不将服务塞进 agent-host |
| host-client | 复用请求 attempt，新增可移植学习控制器：单次提交、revision、pending / reconnect / animation-id 状态；存储 / 时钟通过端口注入 |
| ui-kit | 从当前实现提取纯 `FlashcardFace` 与 `TearDeckSurface`、原卡面 / 动画样式；内容用 ReactNode 插槽，onFlip / onTransitionEnd 等回调；无 FS、Host、全局 DOM 控制或队列权威 |
| Desktop | 原卡库接入路由，复用原 Markdown / 伴学上下文，独立复习页、导航与本机恢复指针；不修改聊天卡片外观 |
| Mobile | 补侧栏入口、catalog 阅读页、复习页、导航 / 生命周期适配；通过公共包共享卡面，不从 apps/desktop 深引 |
| CLI | 相同 study 命令 catalog/start/get/claim/checkpoint/next/rate/undo/pause/resume/end/operation 的最小文本接口；用 checkpoint 显式揭晓后才可 rate；明确无动画 / 无触控，进度与两端一致 |

提取 UI 的第一笔改动必须是**无视觉变化重构**：先拍现有基线，再原样迁移选择器与内容插槽。原样迁移后 Desktop 浏览、聊天、生成结果都不得回归。共享卡面不包含 Desktop 专属 MarkdownView；由两端现有安全 Markdown 渲染器传入。

当前 `ipc.ts` 已超过 1000 行；禁止继续堆新联合成员。先按领域拆分到新契约模块再接线。`card-store.ts` 413 行、knowledge commands 526 行、Mobile App 391 行也不得继续堆职责；用独立 study 模块。不得借本需求升级无关依赖或做全库重构。

## 11. 完成定义

必须同时满足实施计划中的自动化与真机验收：保留卡面、普通模式确有逐张撕卡、两端完整进入 / 退出 / 续学、跨端不重记分、失效卡不阻塞、断线不假成功。

若未通过桌面原视觉回归或移动撕卡 / 返回真机测试，只能报告“实现未完成 / 验证受阻”，不能以 CSS 缩放或浏览器模拟冒充双端交付。签名 / 设备条件缺失如实记录，不能省掉移动端验收。

本规格没有新视觉稿。实施者应参考现有组件与主题；UI/UX 检查仅用于返回可预测、触控冲突、可访问性和动效生命周期，不授权重新设计卡片。
