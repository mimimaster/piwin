# 闪卡学习闭环重设计（产品提案）

| 字段 | 值 |
|------|----|
| 日期 | 2026-08-27 |
| 状态 | Proposal (减法改造版) / 待产品评审 |
| 范围 | Desktop-first 产品功能、信息架构、交互状态与分期需求 |
| 不在本轮 | 直接实现、替换 FSRS、推翻现有 CardStore、修改 Pi 边界 |
| 核心准则 | **极简做减法**：砍掉重度 `@piwin/study` 包与多层实体，砍掉 3 栏独立审核台与多级空间子页；**高杠杆做加法**：以学代审、卡片原子化约束、防复习过载节奏、翻面 Agent 伴学追问 |
| 现有权威 | [ADR 0018](../adr/0018-notes-flashcards-local-rag.md)、[ADR 0054](../adr/0054-flashcard-item-review-card.md)、[Doc Cards 产品口径](../notes/2026-08-16-doccards-v2-product-decisions.md) |

## 1. 结论先行

当前问题不是 RAG 流水线少了几个参数，而是产品把同一条学习旅程拆成了三个彼此弱关联的工具：

1. **知识中心**负责选文件夹、入库和生成；
2. **闪卡记忆中心**负责卡库和 FSRS 复习；
3. **聊天会话**负责展示刚生成的一批卡和继续提问。

每个局部都能工作，但用户没有一个长期稳定的对象来回答：

- 我正在学什么？
- 哪些资料已经可用，哪些没解析成功？
- AI 准备生成什么，结果是否可信？
- 哪些卡已经进入学习，哪些只是草稿？
- 今天应该继续做什么？
- 某张卡有问题时，怎样修正并回到学习？

~~推荐把产品重构为：~~
~~> **一个“学习空间”承载资料、生成批次、已发布闪卡和学习进度；文件夹只是资料来源，RAG 只是内部能力。**~~

**推荐重构方向（减法瘦身 + 高杠杆 Agent 赋能）：**

> **以「Deck（牌组）+ 资料归属」为极简载体，以「以学代审（Learn-as-Review）」实现零负担出卡，结合「翻面 Agent 伴学追问」与「卡片原子化压缩」，打造轻快本地闭环。**

~~原重度主闭环：~~
```text
~~创建学习空间~~
~~  → 添加/检查资料~~
~~  → 后台入库~~
~~  → 配置学习目标~~
~~  → 生成草稿~~
~~  → 审核/编辑/发布 (3栏独立草稿审批台)~~
~~  → 首次学习~~
~~  → FSRS 到期复习~~
~~  → 纠错、解释、再生成~~
~~  └──────────────────────→ 回到空间~~
```

**重构后极简主闭环（减法去官僚化，加法提效）：**

```text
选择资料/主题 (绑定 Deck 牌组)
  → 后台入库与两阶段原子化生成 (单批 6~10 张，防复习负债)
  → 「以学代审」首次翻卡 (翻面评分即入库，错卡随手改/弃，合并质检与首学)
  → FSRS 到期复习
  → 翻面 Agent 伴学追问 / 助记口诀
  └──────────────────────→ 回到「今日」或「卡片库」
```

产品入口收敛到全屏「闪卡」工作区；知识中心不再作为另一套独立造卡器。右栏保留为“今日快速复习”，聊天保留为“快速制卡/解释”，但二者都回到同一份 CardStore 和统一的 Deck 组织体系。

## 2. 当前实现盘点

### 2.1 用户可见入口

当前 Desktop 至少存在四类入口：

| 入口 | 当前去向 | 用户理解上的问题 |
|------|----------|------------------|
| 侧栏主区「闪卡」 | 全屏 `FlashcardsWorkspaceView` | 看似产品主入口，但 AI 生成并不在这里完成 |
| 侧栏底部「知识中心」 | `KnowledgeCenterPanel` overlay | 实际承担文件夹入库和 RAG 出卡，和闪卡入口竞争 |
| `/flashcards` / 右栏 Cards | `FlashcardsPanel` | 是另一套快速复习 UI |
| `/knowledge` / `/doccards` | 知识中心 | 命名面向内部能力，不面向学习任务 |

同一个侧栏同时展示「闪卡」和「知识中心」的代码事实见
[project-session-sidebar.tsx](../../apps/desktop/src/project-session-sidebar.tsx#L754-L875)。

全屏闪卡工作区的「AI 生成」目前会把
`/doccards generate "<topic>"` 填回聊天并关闭工作区，见
[FlashcardsWorkspaceView.tsx](../../apps/desktop/src/workspace-subpages/FlashcardsWorkspaceView.tsx#L176-L180)。
但 `/doccards` 在发送时只被解析成“打开知识中心”，参数会被丢弃，见
[slash-parse.ts](../../apps/desktop/src/slash/slash-parse.ts#L111-L118) 与
[use-composer-send.ts](../../apps/desktop/src/hooks/use-composer-send.ts#L470-L474)。

因此这个 CTA 的实际语义不是“生成闪卡”，而是“绕聊天跳到另一个入口”。这是当前最明确的断链。

### 2.2 当前 RAG 与出卡链路

现有后端已经不是早期的一轮 Agent prompt，而是较完整的双流水线：

```text
Pipeline A — Ingestion
scan → parser → structured chunk → optional embedding → LanceDB/FTS → READY

Pipeline B — Generation
READY check → retrieve → optional rerank → neighbor expansion → context pack
→ LLM#1 knowledge points → post-process → LLM#2 ordered cards → QA
→ CardStore.batchCreate → generation record → review pointer session
```

可复用的成熟能力：

- `DocumentManifest` 和异步 `IngestionJob`；
- Hybrid / FTS-only 降级检索；
- 两阶段 Knowledge Point → Card 生成；
- `basic` / `cloze` 两种卡片模型；
- 来源 chunk、document、文件/行号或页码字段；
- CardStore markdown 真源、去重、FSRS、Anki/Markdown 导出；
- 生成批次 sequence 和展示会话指针；
- 进度 push、取消、失败与 degraded 终态。

`GenerationJob` 已定义细粒度阶段，见
[doc-rag-v2.ts](../../packages/contracts/src/doc-rag-v2.ts#L121-L155)。
生成流程会在 QA 后直接写入 CardStore，再打开展示会话，见
[doccards-generation-jobs.ts](../../packages/host-runtime/src/commands/doccards-generation-jobs.ts#L181-L285)。

### 2.3 资料支持与“离线”承诺不一致

当前默认解析器支持 Markdown、纯文本、代码和配置。Word/HTML 依赖外部 Unstructured HTTP，PDF 依赖外部 MinerU HTTP，PPT/PPTX 不在扩展名表里，见
[extensions.ts](../../packages/doc-rag/src/parsers/extensions.ts#L3-L63)。

这和典型用户心智“文件夹里主要是 PDF、PPT、讲义”存在直接冲突：

- PDF 没配置 MinerU 时被标记为不支持；
- PPT/PPTX 即使配置现有解析器也不支持；
- “离线入库”实际可能要求用户另行部署本地 HTTP 服务；
- 用户只有选完文件夹后才知道核心资料不能用。

仓库里其实已有基于 `pdfjs-dist` 的本地 PDF 文本提取能力，见
[document-extractor.ts](../../packages/media/src/document-extractor.ts#L66-L107)。后续实现应优先通过 Host 注入端口复用，而不是在 `doc-rag` 再造 PDF 解析器；扫描版 PDF 再升级到可选 OCR/MinerU。

### 2.4 当前闭环缺口

| # | 缺口 | 用户后果 | 根因 |
|---|------|----------|------|
| 1 | 两个主入口、三套展示面 | 不知道该从哪里开始、生成后去哪里 | IA 按技术模块分，不按学习任务分 |
| 2 | 文件夹路径就是 Workspace | 改名、移动、加入第二来源、手动卡归属都别扭 | 缺少稳定的产品对象 |
| 3 | PDF/PPT 常见资料不默认可用 | 用户第一步即失败 | parser capability 与产品承诺错位 |
| 4 | 生成前只有 topic | 生成结果数量、难度、目标不可控 | Contracts 有 `difficulty` / `density`，Desktop/Host 主路径未闭环 |
| 5 | 生成结果直接落卡库 | AI 错卡立即进入长期复习 | 没有 draft / approval 状态 |
| 6 | 来源只作为卡片页脚 | 用户难以核验整批质量和覆盖范围 | provenance 是技术字段，不是审核体验 |
| 7 | 生成结果页和首次学习分离 | “生成成功”容易被误当成“已经学会” | 缺少 publish → learn now 的产品阶段 |
| 8 | 卡库主要能查看/删除，不能完整编辑 | 有歧义只能删掉重做 | 缺少卡片生命周期管理 |
| 9 | 评分只有记忆反馈 | “卡有错”和“我忘了”混为一谈 | 缺少内容质量反馈 |
| 10 | Generation Job 只在进程内 Map | Host 重启后进行中/结果页难恢复 | 缺少持久化批次产品对象 |
| 11 | “Mastered = 总卡数 - 到期数” | 未到期被误称为掌握 | 指标用调度状态冒充学习结果 |
| 12 | 生成和复习没有反向联系 | 不知道哪些主题一直错、该补什么卡 | 缺少学习数据驱动的再生成入口 |

## 3. 调研结论

### 3.1 竞品共同模式

| 产品 | 值得借鉴 | 不应照搬 / 警惕的陷阱 |
|------|----------|----------|
| NotebookLM | 来源是稳定 Notebook 对象；后台生成；生成前可选难度并写自然语言要求；**极速直达卡片练习，零官僚审批摩擦** | 不具备 piwin 的本地文件真源与长期 FSRS 优势 |
| RemNote | PDF/Word/PPT 来源、阅读器、页码引用、生成后可编辑；新 AI 卡不会立即混进到期队列 | **功能过重、概念层级极多（Portal/Rem/Doc），认知负荷过大，容易让用户疲于整理而非学习** |
| Quizlet | 上传 notes/slides/PDF 后先得到“可编辑的 first draft”；卡片之后进入多种学习模式；创建与学习在一个 set 下 | 云端与社交/共享导向不适合 piwin 的 private/local-first 定位 |
| Anki | FSRS 和每日队列是长期留存核心；调度参数与内容组织分离 | **配置与牌组管理极其繁琐，卡片维护负担重，新用户极易流失** |

事实来源：

- NotebookLM 支持来源选择、后台生成、难度/自定义 prompt、记住学习进度、只复习错卡和 CSV 下载：[NotebookLM Flashcards Help](https://support.google.com/notebooklm/answer/16958963?hl=en)。
- NotebookLM 支持 PDF、DOCX、PPTX、Markdown、网页、音频等来源，并允许在 notebook 中选择来源范围：[NotebookLM Sources Help](https://support.google.com/notebooklm/answer/16215270?co=GENIE.Platform%3DDesktop&hl=en-GB)。
- RemNote 将 PDF/Word/PPT 阅读、引用、AI 制卡、编辑和练习放在同一文档上下文：[RemNote Reader](https://help.remnote.com/en/articles/6690975-learning-from-pdfs-and-files-with-the-remnote-reader)。
- RemNote 明确提示 AI 生成卡通常仍需用户清理，而且生成卡不会立即进入到期卡：[Generating Flashcards with AI](https://help.remnote.com/en/articles/10102901-generating-flashcards-with-ai)。
- Quizlet 将上传资料生成的结果定位为“first draft”，支持编辑、保存后再进入学习活动：[Quizlet Smart Assist](https://quizlet.com/features/smart-assist/)、[AI Flashcard Generator](https://quizlet.com/features/ai-flashcard-generator)。
- Anki 的 FSRS 以真实复习历史和目标保持率调度，且把 “Again” 与 “Hard” 的语义严格区分：[Anki Deck Options / FSRS](https://docs.ankiweb.net/deck-options)。

### 3.2 学习科学对产品的约束

1. **产出卡片不是学习完成。** 检索练习相较重复阅读能提升长期保持，且重复检索是关键；因此产品成功指标必须落到“开始练习、完成练习、长期回忆”，不能停在 `created > 0`。参见 [Karpicke & Roediger, 2007](https://www.sciencedirect.com/science/article/pii/S0749596X06001367) 与 [Roediger & Karpicke, 2006](https://pubmed.ncbi.nlm.nih.gov/16507066/)。

2. **分散练习与练习测试应是默认路径。** 大综述把 practice testing 与 distributed practice 评为高效学习技术；因此 FSRS 应保留为长期主干，但不该在导入第一步暴露复杂参数。参见 [Dunlosky et al., 2013](https://acs.ist.psu.edu/ist521/dunloskyRMNW13.pdf)。

3. **用户参与卡片形成有独立价值。** 六项实验发现 user-generated 数字闪卡优于 premade 卡；这不等于禁止 AI，而是支持把“审核/改写 AI 草稿”设计成一次主动编码，而非无感批量灌入。参见 [Pan et al., 2023](https://sc-pan.github.io/pdf/PZIZQ_2022.pdf)。

4. **自动题目不能只靠“看起来通顺”。** QGEval 指出自动问题常有事实、清晰度、可回答性和答案一致性问题，且自动指标与人评不总一致；产品需要来源证据、程序 QA 和人类审核三层门槛。参见 [QGEval, EMNLP 2024](https://aclanthology.org/2024.emnlp-main.658/)。

5. **中间知识结构是有价值的。** 教材问题生成研究中，用摘要/中间表示而非直接对原始长文出题显著提升了专家接受率；这支持保留现有 Knowledge Point 两阶段流水线，并把 KP/覆盖范围适度产品化。参见 [Dugan et al., ACL 2022](https://aclanthology.org/2022.findings-acl.151/)。

6. **警惕「生成错觉 (Generation Illusion)」与「复习负债 (Review Debt)」[新增]**：
   - 生成 50 张卡片会给用户带来“我已经掌握”的虚假成就感；
   - 过量卡片会在第 3~7 天造成 FSRS 到期队列雪崩（到期卡片堆积到上百张），导致用户产生逃避心理并彻底放弃复习；
   - **约束**：单批卡片生成必须限制在 **6~10 张**，且当某牌组积压过多待复习卡时，主动提示“先复习再出新卡”。

7. **卡片「原子化原则 (Atomic Principle)」[新增]**：
   - SuperMemo 与 Anki 社区经过数十年验证的黄金法则：**一张卡片只包含一个不可分割的最小知识点**；
   - LLM 极易生成包含 3~4 点的长篇大论，导致复习回忆困难；
   - **约束**：Prompt 必须强约束单卡答案不超过 2 句话，优先使用 Cloze 填空，并提供一键浓缩/瘦身能力。

8. **「以学代审 (Learn-as-Review)」化解审核疲劳 [新增]**：
   - 独立的 3 栏草稿审批台让用户陷入“表格录入员”般的审查疲劳，极易退化为闭眼全选；
   - 在首次沉浸式翻卡过程中边回忆边确认（好卡直接评分入库，错卡随手丢弃/修改），比静态校对效率提升 3 倍。

## 4. 新产品定义

### 4.1 一句话

> piwin 闪卡是一个本地优先的 AI 学习工作区：把自己的资料转成可核验、可编辑的闪卡，并通过持续复习真正记住。

### 4.2 核心用户

首要用户：

- 有一组课程/考试/专业主题资料；
- 资料以文件夹组织，常见 PDF、PPTX、DOCX、Markdown；
- 希望节省制卡时间，但不愿盲信 AI；
- 愿意做短时审核和持续复习；
- 看重本地隐私、可导出与模型可配置。

非目标：

- 通用企业知识库；
- 云端多人协作题库；
- 以游戏化、排行榜驱动的社交学习；
- 自动替用户判断“资料修改后卡片全部过期”；
- 用闪卡替代对复杂概念的首次理解。

~~### 4.3 主产品对象：`StudySpace`~~
~~建议新增稳定的“学习空间”，不再把文件夹路径直接等同于产品身份。~~
```text
~~StudySpace（高速公路工程）~~
~~├── Sources~~
~~│   ├── folder: /资料/高速~~
~~│   ├── file: 规范补充.pdf（未来）~~
~~│   └── pasted note（未来）~~
~~├── Generation Batches~~
~~│   ├── batch A: 12 published / 3 rejected~~
~~│   └── batch B: 8 drafts~~
~~├── Cards~~
~~│   ├── published~~
~~│   ├── suspended~~
~~│   └── needs-fix~~
~~└── Learning~~
~~    ├── new / learning / review~~
~~    └── due today / weak concepts~~
```
~~R1 可以约束一个空间只绑定一个文件夹，先保持实现成本；但 ID 必须与路径解耦，为文件夹移动、rebind、多来源和手动卡归属留下正确边界。~~

### 4.3 极简产品对象：牌组 (`Deck`) 与资料归属 (`SourceAttribution`) [减法重构]

**不做独立的新包与重型实体**，复用 `@piwin/flashcards` 原生的轻量模型：

- **牌组 (`deck: string`)**：学习主题与卡片集合的唯一组织单元（如 `高速公路工程`），默认取自选中的文件夹名称或用户输入。
- **资料归属 (`FlashcardAttribution`)**：卡片 Markdown 文件中的 frontmatter 保留 `sourceFolder`、`sourceFile`、`sourceLine`、`sourceExcerpt`。
- **无需复杂的 Space / Source 关系数据库**：卡片即 Markdown，复习即 JSON，彻底保持 Local-first、轻量、可丢弃可重建的纯粹设计。

## 5. 信息架构

### 5.1 顶层入口

侧栏只保留一个面向用户的主入口：**闪卡**。

打开后进入全屏工作区：

~~```text~~
~~闪卡~~
~~├── 今日        # 到期复习、正在学习、待处理草稿~~
~~├── 学习空间    # 每个主题的资料、生成和进度~~
~~└── 卡片库      # 跨空间搜索、编辑、导出~~
~~```~~

**收敛后的极简 2 视图架构 [减法重构]：**

```text
闪卡
├── 今日 (Today)          # 核心主战场：今日到期复习、新生成卡片的「以学代审」、防过载提示
└── 卡片库 (Decks & Cards) # 按 Deck/主题平铺浏览、搜索、编辑、新建与 Anki/Markdown 导出
```

默认首页是「今日」：

- 有到期卡：主 CTA「开始今日复习 N 张」；
- 有新生成批次：次 CTA「开始首次练习 (以学代审) N 张」；
- 今日全部清空：显示清爽达成态；
- 顶部常驻操作：「从文件夹出卡」、「新建卡片」。

### 5.2 旧入口迁移

| 旧入口 | 新行为 |
|--------|--------|
| 侧栏「闪卡」 | 打开统一全屏工作区 |
| 侧栏「知识中心」 | 移除独立主入口；重定向到「闪卡」 |
| `/knowledge` / `/doccards` | 打开闪卡工作区并触发选择资料出卡流程 |
| `/flashcards` / `/cards` | 打开「今日」；若从右栏调用则仍是快速复习 |
| 聊天 `flashcard_create` | 生成卡片进入指定 Deck（默认 General） |
| 全屏「AI 生成」 | 不再经过聊天命令；直接呼出「选择资料/主题 → 生成卡片」弹窗 |

~~### 5.3 学习空间内页~~
~~空间页用任务优先的导航：~~
~~```text~~
~~[概览] [资料] [草稿] [卡片] [学习记录]~~
~~```~~
~~- 概览：下一步、资料状态、卡片数、今日到期、最近批次；~~
~~- 资料：文件清单、解析能力、索引状态、打开原文；~~
~~- 草稿：生成批次审核；~~
~~- 卡片：已发布卡、编辑、停用、来源；~~
~~- 学习记录：首次学习与 FSRS 结果，不做复杂统计大屏。~~

### 5.3 极简页面结构（扁平无多级子页）[减法重构]

**彻底砍掉空间内部 5 个嵌套子 Tab**：
- 桌面学习工具必须扁平。制卡是快捷动作（弹窗/抽屉完成选文件夹与生成），生成后直接全屏进入翻卡；
- 资料与解析状态直接在制卡弹窗中简要呈现；
- 卡片管理全部汇总在「卡片库」中按 Deck 筛选，不再为每个空间建一套复杂管理后台。

### 5.4 前端交互：极致便捷的入口与出口 (Entry & Exit) 体系 [新增核心设计]

要做到“极度便捷、随用随走”，闪卡功能不能成为把用户锁死的独立死胡同，必须在主工作流（Chat / Coding）中具备清晰顺畅的 **5 个快捷入口** 与 **4 个自然流转出口**：

#### A. 怎么进？（5 大便捷入口）

| 入口场景 | 触发方式 | 前端交互行为 | 核心优势 |
|:---|:---|:---|:---|
| **1. 全局工作区主入口** | 侧栏主区「⚡️ 闪卡」或 `⌘Shift+F` | 打开全屏工作区，默认落入「今日」主视图，展示到期卡与待练批次 | 仪式感强、专注批次回忆的主入口 |
| **2. 聊天划词快捷入口** | 在 Chat 对话/代码中划选文字后右键 | 右键菜单项 **`[⚡️ 存为闪卡]`**（避免悬浮气泡干扰划选复制）→ 弹出微弹窗选择 Deck → 回车即存 | **完全不离开当前对话**，2 秒完成单卡提炼 |
| **3. 对话末尾 Agent 推荐** | Agent 讲解完知识点后 | 回答下方附带轻量行动条：`[⚡️ 将本轮要点提炼为 5 张闪卡]` | 一键触发后台两阶段制卡 |
| **4. 文件夹/文件右键菜单** | 在左侧项目文件树/检查器中右键 | 右键菜单项 `[⚡️ 从此资料生成闪卡...]` | 直接唤起极简制卡弹窗，路径自动填好 |
| **5. 右栏抽屉快速复习** | 顶栏右上角「闪卡小托盘」图标（或复用现有 Cards 瓷砖） | 从右侧滑出 360px 迷你复习抽屉，刷 3~5 张到期卡后自动收起 | **利用碎片时间**，不打断正在进行的编码/聊天 |

#### B. 怎么出？（4 大顺畅出口）

| 出口场景 | 触发时机 | 目标去向与交互表现 |
|:---|:---|:---|
| **1. 「以学代审」首次翻卡完成** | 刚生成的卡片翻完且已评分/丢弃 | 弹出清爽完成态卡片（“🎉 本批卡片已就绪并排期复习！”），提供两个大按钮：<br>• **主出口**：`[ 🚀 回到之前的对话 / 继续干活 (Space/Enter) ]`（秒级切回之前的聊天，不丢失输入草稿）<br>• **次出口**：`[ 🗂️ 进入卡片库 ]` |
| **2. 每日到期复习清空完成** | 今日待复习卡片全部翻完 (0 Due) | 页面显示达成插画与统计，主 CTA **`[ ← 返回工作台 (Esc) ]`**，按 `Esc` 或 `Space` 直接回到上次活跃会话 |
| **3. 随时按 Esc 中断退出** | 任何翻卡或管理过程中 | 随时按 `Esc` 或点击左上角 `[← 返回会话]` 瞬间离开；**无感自动落盘暂存**：已评分的卡片已激活，未翻完的批次安静留在「今日」待练区，下次点开秒级恢复，绝不丢状态 |
| **4. 后台生成时最小化** | 点击“开始生成”后 | 弹窗右上角 `[ 最小化 / 后台生成 ]` 或点击蒙层，立刻退回聊天；生成完成在右上角发出轻 Toast：`“【高速】8 张闪卡已生成 [立即翻看]”` |

## 6. 端到端体验

### 6.1 新建空间与资料预检

用户点击「从资料出卡」：

1. 选择文件夹；
2. 确认 Deck 牌组名称（默认文件夹 basename）；
3. 立即展示极简文件预检：显示有效文件数与不支持项；
4. 默认勾选全部可用文件；
5. 主 CTA「开始生成」。

**开箱即用支持范围（零外部服务依赖）[减法重构]：**

| 能力层 | 格式 | 说明 |
|--------|------|------|
| **P1 开箱离线内置** | Markdown、Text、Code、文本型 PDF | PDF 通过 Host 端口注入复用 `@piwin/media` 的 `pdfjs-dist` 本地提取；加入文本密度启发式，扫描版 PDF 诚实提示跳过并告知原因 |
| **P2 计划支持** | PPTX / PPT 幻灯片 | 涉及纯 JS zip/OOXML 依赖与复杂版面抽取，排入 Phase 2 评估依赖包与提取质量后引入 |
| **不支持/跳过** | 扫描图片型 PDF、加密文件、纯多媒体 | 诚实提示跳过，不强求用户配置 MinerU/OCR 本地服务 |

### 6.2 入库

点击后进入后台任务：

- 显示阶段：解析 → 切分 → 向量化（可选）→ 建索引；
- 显示文件级进度与失败文件，不假装一个 30% 环；
- 可离开工作区继续使用 Chat；侧栏/任务区保留进度；
- 失败不阻断已成功文件；用户可“只用成功的文件继续”；
- Host 重启后能恢复/终止任务，不能永远卡 RUNNING。

### 6.3 生成配置与防过载控制

不要把 RAG 参数暴露给用户；让用户表达学习目标：

必填/默认：

- **资料范围**：全部已就绪 / 已选文件；
- **学习目标 preset**：
  - 快速记忆（definition/fact，偏 basic/cloze）；
  - 理解概念（mechanism/comparison/reason）；
  - 考试复习（混合难度，强调易错点）；
- **数量 [加法：严格防复习负债]**：
  - 选项严格收敛为：`少 (5张)` / `标准 (10张，默认)` / `深入 (15张)`；
  - **防过载提醒**：根据当前牌组今日待复习数判定，若 `dueCount > 20`，弹窗提醒：*“当前牌组尚有 22 张卡片待复习，建议先消化再生成，是否继续？”*
- **难度**：基础 / 标准 / 进阶；
- **主题**：选填自然语言。

**[加法：卡片原子化强约束 (Atomic Enforcement)]**：
- Prompt 注入强规则：每张卡片仅包含 1 个不可分割的最小知识点；
- 答案长度限制 ≤ 2 句话；优先生成填空（Cloze）题型。

### 6.4 后台生成

生成任务阶段面向用户翻译为：

1. 查找相关内容；
2. 提取原子知识点；
3. 编写卡片（Prompt + QA 按照选择的 5/10/15 做硬截断）；
4. 准备就绪 → 直接唤起「以学代审」首次翻卡流（原 `openReviewSession` 聊天指针会话保留为辅助查看出口，不再作为桌面生成强制出口）。

允许离开、取消、失败重试。`degraded` 解释为“仅关键词检索，结果可能不够全面”。

### 6.5 「以学代审（Learn-as-Review）」极速翻卡流与「落盘不落队」[核心突破]

**彻底放弃独立的 3 栏草稿审核台**。竞品与认知科学表明：强迫用户在列表里逐条审稿会引发严重审核疲劳（Reviewer's Fatigue），最终沦为闭眼全选。

**新设计：将「质检」与「首次主动回忆」合二为一，底层采用「落盘不落队」持久化机制**：

1. **生成即落盘（防重启丢失）**：
   - 生成完成的卡片立刻写入 Markdown 文件（`cards/<id>.md`），frontmatter 标记 `status: 'pending-first-review'`；
   - **此时不创建 `review/<id>.json`**。由于 `queue.ts` 的 `buildReviewQueue` 原生规则是 `if (!state) continue;`，未评分的新卡**天然不会进入日常复习队列**，彻底避免 AI 错卡污染 FSRS！
2. **首次翻卡栈（Swipe Stack）**：
   - 界面启动一轮交互式翻卡栈，用户进行主动回忆；
   - **按空格翻面**：
     - **答案准确**：按键盘 `1~4`（Again / Hard / Good / Easy）评分 → **创建 `review/<id>.json` 并将 status 更新为 `active`**，正式启动 FSRS 调度；
     - **答案有瑕疵**：点击 `[✏️ 编辑]` 微调；或点击 **`[🪄 浓缩]`** 让 Agent 一秒精简为极短答案/Cloze（调用 `CardStore.update`）；
     - **AI 幻觉或废卡**：点击 `[✕ 丢弃]`（或按 `Delete`）→ 直接 `rm` 该 Markdown 文件，彻底不入库；
     - **存疑想看原文**：点击 `[📄 来源: 规范.pdf p.12]` 展开引用片段。

> **收益**：既实现了 100% 本地落盘抗崩溃/抗重启（解决了 §2.4 #10 的内存丢失缺陷），又保证了 FSRS 队列的绝对纯净。用户在 3~5 分钟内一次性搞定质检与初次记忆编码。

### 6.6 长期复习与反馈

「今日 (Today)」界面清晰展示：
1. **今日到期复习**（主任务）；
2. **新生成待完成「以学代审」的批次**（次任务）；
3. **防过载提示**（若到期过多，先复习后出新卡）。

复习时把两类反馈严格分开：

| 反馈 | 含义 | 影响 |
|------|------|------|
| Again / Hard / Good / Easy | 我的回忆情况 | 驱动 FSRS 算法计算下一次复习时间 |
| 卡片有问题 | 内容质量 | 标记 needs-fix 或直接原地编辑/删除，不污染 FSRS 记忆信号 |

### 6.7 [加法] Agent 赋能高杠杆能力

#### 加法 1：翻面伴学追问（Socratic Chat in Review）
- 复习翻面后，如果用户感到不理解或记不住，卡片下方提供轻量快捷入口：
  - **`[🤖 为什么 / 深入解释]`**
  - **`[💡 举个生活例子]`**
  - **`[🧠 帮我编个助记口诀 / 记忆宫殿]`**
- 点击后就地展开 1~2 轮伴学微会话（携带该卡来源 excerpt 与上下文），解答完毕后收起，无缝继续下一张卡。

#### 加法 2：划词 / 单文件极速制卡（Instant Clip-to-Card）
- 在日常 Chat 交互或阅读单个 Markdown 文件时，划选任意文本 → 快捷菜单 `[生成闪卡]`；
- Agent 自动将其转换为原子化 Cloze 填空或单点问答，存入指定 Deck，无需每次都扫整个文件夹。

~~## 7. 状态模型~~
~~### 7.1 空间状态（派生，不持久化单一枚举）~~
~~EMPTY, SOURCES_BLOCKED, READY_TO_INDEX, INDEXING, READY_TO_GENERATE, GENERATING, DRAFT_REVIEW, READY_TO_LEARN, ACTIVE, NEEDS_ATTENTION~~
~~### 7.2 生成批次~~
~~PENDING → RETRIEVING → EXTRACTING → GENERATING → VALIDATING → DRAFT_READY → PUBLISHING → PUBLISHED~~

## 7. 极简状态模型与「落盘不落队」生命周期 [减法重构]

彻底摒弃多重状态机嵌套与不稳定的内存暂存，采用 **「落盘不落队 (Disk-persisted, Queue-deferred)」** 模型：

1. **瞬时 Generation Job 状态**（仅用于生成阶段进度指示与前端展示）：
   ```text
   PENDING → RETRIEVING → EXTRACTING → GENERATING → READY_TO_LEARN (完成，自动唤起以学代审)
                                                 ↘ FAILED / CANCELED
   ```

2. **卡片生命周期（以 Markdown 为真源，FSRS 调度按需创建）**：
   ```text
   生成完成落盘
   cards/<id>.md (status: 'pending-first-review') ──[无 review/<id>.json，FSRS队列天然忽略]──┐
       │                                                                                   │
       ├───[翻面评分 (1~4)]──→ 创建 review/<id>.json + 更新 status: 'active' ──→ 正常 FSRS 调度
       │                                                                                   │
       ├───[翻面编辑/浓缩]──→ 调用 CardStore.update，保留 pending 状态，继续评分           │
       │                                                                                   │
       ├───[翻面丢弃 (✕)]───→ 物理删除 cards/<id>.md ────────────────────────────→ 彻底丢弃
       │                                                                                   │
       └───[随时 Esc 退出]──→ 保持 pending 状态留在本地磁盘，显示在「今日」待练区 ────────┘
   ```

> **抗崩溃与防污染原理**：
> - `cards/<id>.md` 在生成后立即落盘，Host 崩溃或关闭时**零丢失**，下次启动自动从磁盘读出 `status: pending-first-review` 的卡片聚合为「待完成以学代审」批次；
> - `packages/flashcards/src/queue.ts` 的 `buildReviewQueue` 原生规则为 `if (!state) continue;`。因为未评分前没有 `review/<id>.json`，新卡**绝对不会提前混入日常到期队列**，彻底解耦了持久化与复习调度。

## 8. 功能需求

### 8.1 P0：先修明显断链与伪入口 (1 周)

1. **工作区直连出卡**：全屏闪卡「AI 生成」直接唤起内置文件夹/主题弹窗，不再拼 `/doccards generate` 假文本；
2. **入参四层贯通**：在 Contracts、Host、Prompt 和 QA 阶段完整支持 `count: 5 | 10 | 15`，QA 阶段硬截断由 40 改为入参 `count`；
3. **收敛入口**：侧栏移除独立「知识中心」入口，点击重定向至全屏闪卡工作区；
4. **防复习过载提醒**：以当前牌组今日待复习数 `dueCount > 20` 为判断口径，出卡前弹窗温和预警；
5. **纠正虚假指标**：“Mastered” 改为真实状态统计（`未到期卡 / 学习中 / 待以学代审`），并修复 item 数与 review-card 数（Cloze 一拆多）的统计口径。

### 8.2 P1：极简闭环与以学代审（正式发布门槛，2 周）

1. **落盘不落队与以学代审**：生成即写 `cards/<id>.md (pending-first-review)`，首次翻卡评分时写入 `review/<id>.json` 并激活，点丢弃直接删除；
2. **卡片更新契约（隐性前置）**：落地 `CardStore.update(id, partial)` 与 IPC `flashcards/update`，支持 `[✏️ 编辑]` 与 `[🪄 浓缩]`，严格遵守 ADR 0054 Cloze 序号稳定性；
3. **本地 PDF 开箱提取**：通过 Host 端口注入复用 `@piwin/media` 的 `pdfjs-dist` 本地文本提取能力，加入文本密度启发式，扫描版 PDF 给出诚实跳过提示；
4. **卡片原子化强约束**：Prompt 强限制单卡答案 ≤ 2 句话，优先 Cloze 填空；
5. **「今日」与「卡片库」双视图**：聚合今日到期复习与待练批次，支持按 Deck 浏览与 Markdown/Anki 导出。

### 8.3 P2：Agent 伴学与格式扩展 (2 周)

1. **翻面 Agent 伴学追问**：翻面提供 `[🤖 深入解释]`、`[💡 举例]`、`[🧠 助记口诀]` 就地单轮微对话（基于 `sourceExcerpt`）；
2. **划词 / 单文件极速制卡**：选区右键菜单 `[⚡️ 存为闪卡]` 快速提炼存入指定 Deck；
3. **PPTX / 幻灯片支持评估**：评估纯 JS zip/OOXML 依赖与复杂版面抽取质量，成熟后纳入离线支持；
4. **薄弱概念针对性补卡**：基于 `lapses` 频次对易错知识点定向触发再生成；
5. **Mobile 端到期复习体验**。

## 9. Contracts 与架构影响

所有跨 Desktop/Host 的新能力严格先落 `@piwin/contracts`。

**极简 Contracts 方案（复用现有包，不新增 `@piwin/study`）[减法重构]：**

- **不新建 `@piwin/study` 应用包**，所有卡片与牌组逻辑由 `@piwin/flashcards` 拥有，文件夹切块索引与 RAG 由 `@piwin/doc-rag` 拥有；
- **扩展卡片实体与更新契约**：
  ```ts
  export type FlashcardLifecycleStatus = 'pending-first-review' | 'active' | 'suspended' | 'needs-fix';

  export type FlashcardItem = FlashcardAttribution & {
    id: string;
    model: FlashcardModel; // 'basic' | 'cloze'
    deck: string;          // 牌组名（如 "高速公路工程"）
    front?: string;
    back?: string;
    text?: string;
    status?: FlashcardLifecycleStatus; // 默认 active；未首次学习为 pending-first-review
    createdAt: string;
    updatedAt?: string;
    // 来源溯源字段
    sourceFolder?: string;
    sourceFile?: string;
    sourceLine?: number;
    sourceExcerpt?: string;
  };

  export type FlashcardUpdateInput = {
    id: string;
    front?: string;
    back?: string;
    text?: string;
    deck?: string;
    status?: FlashcardLifecycleStatus;
  };
  ```
- **生成请求贯通数量参数**：
  ```ts
  export type FlashcardGenerationRequest = {
    folder: string;
    includeFiles?: string[];
    topic?: string;
    deck?: string;
    count?: 5 | 10 | 15; // 默认 10
    difficulty?: 'basic' | 'standard' | 'advanced';
  };
  ```
- **CardStore 接口新增 `update`**：
  ```ts
  export type CardStore = {
    // 现有方法...
    create: (input: FlashcardCreateInput) => Promise<FlashcardItem>;
    batchCreate: (input: FlashcardBatchCreateInput) => Promise<{ created: FlashcardItem[]; skipped: FlashcardBatchSkip[] }>;
    update: (id: string, partial: FlashcardUpdateInput) => Promise<FlashcardItem>;
    delete: (cardId: string) => Promise<{ deleted: true; id: string }>;
    // ...
  };
  ```

## 10. 关键页面草图

### 10.1 今日 (Today) 主工作区

```text
┌────────────────────────────────────────────────────────────────────────┐
│ ⚡️ 闪卡                                           [+ 从资料出卡] [+ 新增] │
├─────────────────────────┬──────────────────────────────────────────────┤
│ 📌 今日                 │  🔥 今日待复习 12 张                          │
│ 🗂️ 卡片库 (Decks)       │  [ 开始今日复习 (Space) ]                     │
│                         │                                              │
│                         │  ✨ 待完成以学代审 (落盘暂存，抗重启)           │
│                         │  · 高速公路工程：刚刚生成 8 张新卡  [开始练习] │
│                         │                                              │
│                         │  📚 我的牌组                                 │
│                         │  · 高速公路工程    36 卡 · 6 到期 · 资料正常  │
│                         │  · 操作系统原理    24 卡 · 0 到期 · 资料正常  │
└─────────────────────────┴──────────────────────────────────────────────┘
```

### 10.2 「以学代审」首次翻卡交互（代替 3 栏独立审核台）

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 高速公路工程 · 首次练习 (以学代审)                [3/8]   [✏️编辑] [✕丢弃] │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  Q: 高速公路收费系统的三级收费制包括哪些？                               │
│                                                                        │
│  ────────────────────────────────────────────────────────────          │
│  A: 包含国家/省级收费结算中心、路段收费分中心、各收费站三级。             │
│                                                                        │
│  [📄 来源: 收费系统规范.pdf p.12]    [🪄 浓缩为填空]                     │
│                                                                        │
├────────────────────────────────────────────────────────────────────────┤
│  [1 Again 重新学]   [2 Hard 较难]   [3 Good 掌握]   [4 Easy 太简单]    │
│  (点击评分即写入 review 状态激活 FSRS；点击丢弃则 rm 文件)                │
└────────────────────────────────────────────────────────────────────────┘
```

### 10.3 复习翻面后的 Agent 伴学追问（加法）

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 复习中 · 高速公路工程                             [5/12]  [标记问题]    │
├────────────────────────────────────────────────────────────────────────┤
│  Q: 什么是闭环收费系统？                                                │
│  A: 车辆进站领卡、出站交卡并按实际行驶里程缴费的系统。                     │
│                                                                        │
│  💡 [🤖 深入解释]  [💡 举个实际例子]  [🧠 帮我编个助记口诀]              │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ 🤖 Agent 伴学:                                                     │ │
│ │ 助记口诀：“进站拿卡算起点，出站交钱算路程，不领不交走不通，闭环管得紧”。 │ │
│ └────────────────────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────────────────┤
│  [1 Again 10分钟]    [2 Hard 1天]    [3 Good 3天]    [4 Easy 7天]      │
└────────────────────────────────────────────────────────────────────────┘
```

## 11. 可用性与无障碍要求

来自本地 UI/UX 规则的约束：

- 长任务必须显示阶段和进度，不能只有旋转图标；
- 翻卡界面全键盘支持：`Space` 翻面、`1–4` 评分、`Delete` 丢弃、`E` 原地编辑、`Esc` 退出；
- `Again`（记忆评分）与“卡片有问题/丢弃”必须是不同维度的明确动作；
- 对话框打开后管理焦点，关闭后返回触发按钮；
- 视觉延续 `@piwin/ui-kit` 与现有桌面端极简主题。

## 12. 指标与验收

### 12.1 极简漏斗

```text
选择资料出卡
→ 生成 5~15 张原子卡片（落盘 status: pending-first-review）
→ 「以学代审」首次翻卡（评分激活 FSRS，丢弃直接删除）
→ 进入 FSRS 长期复习队列
→ 7 天内完成到期复习
```

### 12.2 P1 验收场景

1. 新用户选一个含 Markdown、文本 PDF 的文件夹，第一屏清晰提示可用文件并生成卡片；
2. 生成过程单批限制在 5/10/15 张，内容遵循原子化原则；
3. 生成卡片立即落盘，此时不出现在 FSRS 队列中；Host 重启后卡片不丢失，在「今日」显示待练习批次；
4. 首次翻卡按 1~4 评分即激活并计划 FSRS，点丢弃直接删除 Markdown；
5. 翻卡时支持原地 `[✏️ 编辑]` 与 `[🪄 浓缩]`（调用 `CardStore.update`）；
6. 侧栏「知识中心」入口彻底下线，统一到全屏「闪卡」工作区。

## 13. 分期落地计划

### Phase 0 — 快速修复断链 (1 周)
1. 修复全屏「AI 生成」假命令断链，直达文件夹选择；
2. 侧栏移除「知识中心」主入口，统一重定向到全屏闪卡；
3. 修正 "Mastered" 假数据指标与 Cloze 单位错配；
4. 生成数量收敛为 5/10/15 张四层贯通；防过载提醒按 `dueCount > 20` 接入。

### Phase 1 — 极简闭环与以学代审 (2 周)
1. 实现「落盘不落队」生命周期与「以学代审」翻卡栈；
2. 落地 `CardStore.update` 与 IPC `flashcards/update` 契约；
3. 内置本地文本 PDF（Host 端口注入 `pdfjs-dist`），扫描版 PDF 文本密度启发式跳过；
4. 提示词注入「卡片原子化强约束」；
5. 完善「今日」与「卡片库」双视图。

### Phase 2 — Agent 伴学与格式扩展 (2 周)
1. 复习翻面 Agent 伴学追问（深入解释 / 举例 / 助记口诀）；
2. 选区右键 `[⚡️ 存为闪卡]` 划词制卡；
3. 评估纯 JS PPTX 提取依赖与质量；
4. 针对多次 Again 薄弱概念的定向再生成。

## 14. 关键决策结论

| 决策点 | 原提案 | **最新减法改造结论** | 理由 |
|--------|--------|----------------------|------|
| **持久化与生命周期** | 内存临时缓冲 (In-memory/Temp) | **落盘不落队 (status: pending-first-review)** | 彻底解决重启丢卡问题，且未评分前不建 review state 天然不污染 FSRS 队列 |
| **卡片更新契约** | 未定义 | **新增 `CardStore.update` 与 `flashcards/update`** | 作为 P1 基础前置，支撑翻卡中的编辑、浓缩与纠错 |
| **草稿审核机制** | 独立的 3 栏草稿审批台 | **「以学代审 (Learn-as-Review)」翻卡流** | 消除审核疲劳，将审查与主动回忆一步完成 |
| **架构与包划分** | 新建 `@piwin/study` 包与多层实体 | **不建新包**，复用 `@piwin/flashcards` 的 Deck 与来源属性 | 避免过度设计，保持 Markdown 纯粹性 |
| **页面层级** | 空间内设 5 级嵌套子 Tab | **扁平收敛为「今日」与「卡片库」2 视图** | 学习工具必须轻快直达，拒绝层级迷失 |
| **生成控制** | 自由批量出卡 | **单批 5/10/15 张四层贯通 + 原子化强约束 + dueCount>20 提醒** | 杜绝「生成错觉」与「复习负债」导致的弃用 |
| **Agent 赋能** | 仅作为后台生成流水线 | **复习翻面伴学追问 (解释/举例/助记) + 划词制卡** | 发挥 piwin Agent 核心差异化能力 |
| **资料格式** | 规划本地 OCR / PPTX 开箱 | **P1 保文本 PDF，PPTX 移入 P2 评估** | 保证零外部依赖与开箱稳定性 |

## 15. 推荐下一步

1. 确认上述落盘不落队与契约设计；
2. 优先实施 Phase 0 修复断链与接通 `count: 5|10|15`；
3. 在 `@piwin/flashcards` 中落地 `update` 契约与 `status` 过滤逻辑，打通「以学代审」翻卡原型。
