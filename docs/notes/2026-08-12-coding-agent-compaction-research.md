# Coding Agent 跨模型窗口与 Compaction 策略调研

| 字段 | 内容 |
|------|------|
| 日期 | 2026-08-12 |
| 范围 | Cursor、Windsurf / Cascade、Kiro，补充 Amazon Q Developer |
| 证据原则 | 只把官方文档、官方 changelog、官方技术报告写成事实；未公开实现明确标为推断 |

## 1. 结论摘要

主流 Coding Agent 都有上下文兼容层，但公开资料不能证明它们都对
“已用满 1M 会话后立刻切换到 200–272K 模型”采用同一种算法。

公开可确认的共同方向是：

1. 产品 transcript 与实际发送给模型的工作上下文分离；完整历史可以继续展示，
   模型只接收摘要、最近消息和按需检索内容。
2. 会话历史、代码库内容、长期规则/记忆、计划状态分别管理，而不是压成一条
   无限增长的 prompt。
3. 自动或手动 compaction 之外，还会压缩文件、限制固定上下文、使用检索或
   专用 subagent，降低主模型窗口压力。
4. 产品必须以目标模型的有效窗口做预算，而不能让一个已经超出目标窗口的小模型
   直接读取全部旧历史并负责第一次摘要。

对 piwin 当前场景，最稳妥的默认策略是：**先用仍能读取当前工作集的源模型或专用
compactor 生成目标窗口可容纳的 checkpoint，通过预算验证后，再原子切换到小模型。**
若没有任何单次可读取源工作集的模型，则使用分块分层摘要；仍失败时创建带 handoff
checkpoint 的新 session，而不是破坏原会话。

## 2. Cursor

### 2.1 官方明确披露

- Cursor 会在长对话接近窗口限制时自动摘要，也支持 `/summarize` 或 CLI
  `/compress` 手动释放空间。摘要保留在当前 chat 中，而非要求用户一定开新会话。
  [Cursor 1.6 changelog](https://cursor.com/changelog/1-6)、
  [Cursor Summarization](https://docs.cursor.com/en/agent/chat/summarization)
- Cursor 将消息摘要与文件/文件夹 condensation 分开处理。大文件会降为结构信息，
  更大时只保留文件名或明确标记未包含；模型随后可按需展开具体文件。
  [Cursor Summarization](https://docs.cursor.com/en/agent/chat/summarization)
- Cursor 当前模型表明确区分 `Default Context` 与 `Max Context`。大量原生 1M 模型
  默认只使用 200K 或 300K；Max Context 是单独能力。这是一层产品级规范化预算，
  不直接等同于供应商最大窗口。
  [Cursor Models](https://docs.cursor.com/models/)
- Cursor Composer 2 技术报告披露了模型原生 self-summarization：一次长轨迹可由多个
  generation 经 summary 串联；训练奖励同时作用于行为和 summary。报告称，相比独立
  prompt compaction，self-summary 在实验中错误更少、token 更省且可复用 KV cache。
  [Composer 2 Technical Report，第 4 页](https://cursor.com/resources/Composer2.pdf)
- Cursor 的长期上下文并不只靠 compaction：Memories 使用另一个 sidecar model
  观察对话并提取项目级记忆。
  [Cursor Memories](https://docs.cursor.com/en/context/memories)

### 2.2 对跨窗口切换的含义

Cursor 最重要的兼容手段不是某个神秘压缩 prompt，而是**多数模型先运行在统一的
200–300K 默认预算**。如果一个 1M 模型没有启用 Max Context，会话通常不会先增长到
1M，因此切换到 200–272K 模型的落差小很多。

官方没有公开说明：当一个已启用 Max Context 且工作集超过目标模型窗口的 chat
切换到小模型时，究竟由源模型、目标模型还是独立模型生成迁移摘要。因此不能把具体
downshift 算法写成已确认事实。

## 3. Windsurf / Cascade

### 3.1 官方明确披露

- Cascade 的长期计划由 specialized planning agent 在后台持续维护，所选主模型主要
  执行短期动作。这说明长期状态与当前 generation 已被拆开管理。
  [Cascade Overview](https://docs.windsurf.com/windsurf/cascade/cascade)
- Cascade 的 Memories 会在对话中自动生成，并在相关时按需取回；Rules、AGENTS.md、
  Workflows、Skills 则有各自的持久化和激活语义。
  [Windsurf Memories & Rules](https://docs.windsurf.com/windsurf/cascade/memories)
- 引用旧 conversation 时，Cascade 通常只检索 conversation summary、checkpoint 和
  与查询相关的片段，不会默认把整个旧对话重新放进窗口。
  [Cascade Overview](https://docs.windsurf.com/windsurf/cascade/cascade)
- Fast Context 是专用检索 subagent，用 SWE-grep 系列模型并行寻找相关代码，再把定向
  结果返回主模型；官方明确将其目标描述为减少 context pollution、保存主模型的
  context budget。
  [Windsurf Fast Context](https://docs.windsurf.com/context-awareness/fast-context)
- Windsurf 推荐 Adaptive 路由器按任务选择模型，也允许用户手动切换模型。
  [Windsurf Models](https://docs.windsurf.com/windsurf/models)

### 3.2 可确认边界

Windsurf 当前公开文档没有披露 Cascade 的具体 compaction prompt、切点算法、chunk
大小、摘要模型选择或 1M → 小窗口切换事务。因此这些细节不能从公开资料验证。

但其公开架构已经证明它没有把所有责任交给一次 compact：计划、长期记忆、旧会话
检索、代码检索和当前模型轨迹是不同的数据通道。即使摘要损失了一部分旧消息，计划、
checkpoint、memory 和可重新检索的代码仍能恢复关键状态。这是 piwin 值得借鉴的
“多层抗丢失”设计。

## 4. Kiro

### 4.1 官方明确披露

- Kiro IDE 按模型上下文窗口显示使用率，并在约 80% 时自动摘要 conversation，令上下文
  回到限制以下。
  [Kiro Summarization](https://kiro.dev/docs/chat/summarization/)
- Kiro 同一 conversation 可以切换模型，选择会应用于后续消息。其当前模型列表同时
  包含 1M、272K、256K、200K 和 128K 窗口，因而跨窗口切换是明确存在的产品场景。
  [Kiro Models](https://kiro.dev/docs/models/)
- Kiro CLI compaction 会摘要旧消息并保留最近消息。保留量同时受最少 message pair
  和目标 context window 百分比控制，取更保守的较大值。CLI compaction 创建新
  session，原 session 可恢复。
  [Kiro CLI Context Management](https://kiro.dev/docs/cli/chat/context/)
- Kiro 将固定 context files 限制在模型窗口的 75% 内，超限文件自动丢弃；大规模资料
  推荐进入 Knowledge Base，只有检索时才消耗窗口。
  [Kiro CLI Context Management](https://kiro.dev/docs/cli/chat/context/)
- Kiro subagent 有独立 context window，避免执行轨迹污染主 agent 上下文。
  [Kiro Subagents](https://kiro.dev/docs/chat/subagents/)

### 4.2 对跨窗口切换的含义

Kiro 是公开资料中最明确采用“**当前模型窗口感知**”的产品：窗口不同、meter 不同、
触发阈值与保留百分比也绑定窗口。CLI 通过新 session 保留原始轨迹，属于失败影响面
较小的事务边界。

不过官方仍未明确说明：IDE 从 1M 模型切到 128–272K 模型且已超过目标窗口时，是否
在 picker 确认阶段立即 compact，以及第一次摘要由哪个模型执行。因此“它一定完整
覆盖了这个精确 edge case”仍不能仅凭文档断言。

## 5. Amazon Q Developer 补充对照

Amazon Q 采用较保守的交互：约 80% 时提示用户 compact，而不是静默声称成功。
compact 后完整历史继续显示，但模型只使用摘要；同时提供 `/clear` 作为彻底重置方案。
[Amazon Q Chat History Compaction](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/ide-chat-history-compaction.html)

它证明了另一条成熟 UX 原则：**用户界面中的历史保留与模型上下文替换必须是两件事，
并且 compact 与 clear 要有不同语义。**

## 6. 横向比较

| 产品 | 会话摘要 | 产品级窗口策略 | 非会话上下文 | 风险隔离 |
|------|----------|----------------|--------------|----------|
| Cursor | 自动 + 手动 | 默认多为 200–300K，Max 单独启用 | 文件结构 condensation、检索、Memories | 默认预算降低跨模型落差 |
| Windsurf | 具体算法未公开 | Adaptive / 手选模型，窗口策略未公开 | planning sidecar、Memories、checkpoint、Fast Context | 多层状态可重建，不依赖单一摘要 |
| Kiro | IDE 约 80% 自动；CLI 手动/溢出自动 | 明确按当前模型窗口计量 | context files 上限、Knowledge Base、独立 subagent window | CLI 新 session，原 session 可恢复 |
| Amazon Q | 手动 + 约 80% nudge | 未公开跨模型细节 | 显式/自动 context、pinning | transcript 保留，另有 clear |

## 7. 对 piwin 的建议

### 7.1 第一原则：切换是一次迁移事务

不要把模型 picker 只当作“下一个 prompt 的 modelId”。当目标模型有效窗口小于当前
工作集时，应进入明确的 `prepare → compact → validate → commit` 流程：

1. 读取当前真实 model-facing context，而不是 UI transcript 总长度。
2. 计算目标模型预算：目标窗口减去 system/tools、输出预留、安全余量和本轮输入预留。
3. 若当前工作集已低于目标 soft limit，直接提交切换。
4. 若超出，先生成 target-sized checkpoint。
5. 对 checkpoint + recent tail + 固定上下文重新计量；只有验证可装入目标窗口后才提交
   模型切换。
6. 任一步失败或取消，保留源模型和源上下文，不产生半切换状态。

### 7.2 Compactor 选择顺序

1. **源模型优先**：源模型已经能读取当前工作集，先由它压缩到目标预算，再切换。
2. **专用大窗口 compactor**：若用户配置了 compactor model，且其输入窗口能容纳当前
   工作集，可独立执行，避免占用主模型。
3. **分块分层摘要**：没有任何模型能单次读取当前工作集时，按 turn/tool 边界分块，
   先生成 chunk summaries，再递归 merge；不能简单按字符截断。
4. **handoff 新 session**：仍无法保证目标预算时，创建带 checkpoint 的新 session，
   原 session 保持可恢复。

绝不能默认让已经装不下输入的目标小模型负责第一次全量摘要。

### 7.3 Checkpoint 不应只是自由文本

建议 checkpoint 至少包含可验证的结构字段：

- goals、constraints、decisions；
- current plan / todos 与状态；
- files read / modified、关键 symbols；
- commands/tests 及结果；
- unresolved errors、pending permissions、queued user intent；
- recent turn tail 的边界；
- source model、target model、tokens before/after、生成策略与 revision。

自由文本 summary 用于模型阅读；结构字段用于 Host 验证、UI 展示和后续检索。完整
transcript 永远保留在产品存储中。

### 7.4 上下文预算分层

借鉴 Cursor/Kiro/Windsurf，不应让 conversation summary 独占目标窗口。目标预算应至少
分为：

- 固定控制面：system、tools、rules；
- compact checkpoint；
- recent tail；
- 当前用户输入与输出 reserve；
- 按需检索的代码、旧 transcript 和知识内容。

具体比例应通过 fixture 和真实 provider 计量校准，不应把一个固定 `keepRecentTokens`
用于所有 128K、200K、272K 和 1M 模型。

### 7.5 推荐 UX

- 用户选择更小模型时，若需要迁移，显示“正在为 `<target>` 整理上下文”，而不是先
  完成 picker 切换再报 overflow。
- 展示 `当前工作集 → 目标预算`、所用 compactor 和可取消操作。
- 成功后显示 tokens before/after、保留最近多少轮以及 checkpoint 入口。
- 失败时给出真实原因，并提供“使用原模型压缩”“分层压缩”“以摘要开启新会话”三个
  恢复选项。

## 8. 推荐实施顺序

1. 先实现 Host-owned target budget calculator 与模型切换前置检查。
2. 扩展 compact contract，使其携带 target model / target budget，并显式记录实际
   compactor model；不能由 Desktop 私自决定。
3. 实现源模型 compact 后原子切换，这是当前问题的最小完整闭环。
4. 加入结构化 checkpoint 与 post-compact budget validation。
5. 再实现 hierarchical compaction 和 transcript retrieval，覆盖极端大历史与小模型。
6. 最后根据用户持有的完整 Windsurf 策略做字段、prompt、分块和重试策略的逐项对照，
   但不把第三方实现直接耦合进 UI 或 Pi boundary。
