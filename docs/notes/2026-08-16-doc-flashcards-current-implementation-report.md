# 知识库闪卡：现有实现情况报告

| 字段 | 值 |
|------|----|
| 日期 | 2026-08-16 |
| 性质 | 现状盘点（已实现），不是新设计 |
| 用途 | 精细化现有实现说明，并对照外部设计 Spec 做取舍 |
| 对照 Spec | `/Volumes/BigDisk/Downloads/rag_flashcard_pipeline_design_spec_v1.md`（RAG → Flashcard Pipeline v1.0） |
| 仓库权威设计 | [ADR 0018](../adr/0018-notes-flashcards-local-rag.md)、[doc-flashcards](../specs/doc-flashcards.md)、[notes-flashcards-rag](../specs/notes-flashcards-rag.md) |

> 本文只描述**仓库里已经落地的东西**。不提出新架构，也不假装现有实现已经接近那份双流水线 Spec。

---

## 1. 一句话

现有能力是：**用户指向一个本地文件夹 → Host 用自研切块 + sqlite 建可丢弃索引 → 按主题召回若干段落 → Desktop/CLI 拼成一段 prompt → 走普通 `session/prompt` → Agent 用 `flashcard_batch_create` 一次写出 front/back 卡片**。

它不是「文档入库流水线 + RAG 生成流水线」。建库和出卡缠在一起；出卡是 Agent 对话，不是独立 Generation Job。

---

## 2. 产品边界（已实现的三件事）

仓库里其实叠了三层，不要混：

| 层 | 做什么 | 状态 |
|----|--------|------|
| Notes RAG | `~/.piwin/notes/` 笔记库；FTS + 可选向量；Agent `note_*` 工具 | 已实现（ADR 0018 主体） |
| Flashcards 卡片库 | 卡片 markdown + FSRS 复习 + Anki 导出 + 聊天翻转卡 | 已实现 |
| Doc Cards | 任意本地文件夹 → 索引/召回 → 生成带文件夹来源的卡片 | 已实现（doc-flashcards v3） |

用户说的「知识库生成闪卡」，对应的是第三层 **Doc Cards**，复用第二层卡片库，检索模式抄第一层 Notes。

三种出卡来源（逻辑模型，存储仍是扁平可选字段）：

| 来源 | 怎么来 | 卡片上留下什么 |
|------|--------|----------------|
| Folder-sourced | Doc Cards 选文件夹 + retrieve | `sourceFolder` / `sourceFile` / `sourceLine` / `sourceExcerpt` |
| Note-sourced | chat 里 `note_search` | `sourceNoteId` / `sourceExcerpt` / `sourceHash` |
| Open | 无文件夹、无笔记，模型用通识（可选 web） | 无 source 字段 |

---

## 3. 已落地架构

```text
Desktop DocCardsPanel / CLI `piwin doccards`
        │
        │  HostCommand: doccards/scan|index|retrieve|list|rebind|forget|open-source
        ▼
┌─────────────────────────────────────────────────────────────┐
│ @piwin/host-runtime                                         │
│   knowledge-commands.ts  →  FolderRag + CardStore           │
│   flashcard-tools.ts     →  Agent tools（create/batch/list） │
└─────────────────────────────────────────────────────────────┘
        │                         │
        ▼                         ▼
 @piwin/doc-rag              @piwin/flashcards
  扫文件夹 / 自研 chunk         cards/*.md 真源
  sqlite FTS5 + 可选向量        review/*.json FSRS
  纯函数拼 generation prompt    trigram 去重
        │                         │
        └──────────┬──────────────┘
                   ▼
            session/prompt（knowledge tool profile）
                   ▼
            模型调用 flashcard_batch_create
                   ▼
            artifact HTML 翻转卡（可 rate / open-source）
```

设计原则（已写进 spec，也基本按这个做了）：

1. **卡片 markdown 是真源；sqlite 是可丢弃缓存。**
2. **Host 对生成回合是管道**：App 自己 index → retrieve → `buildFlashcardGenerationPrompt`，再发 `session/prompt`。Host 不拦截隐藏 generation 参数。
3. **结构化输出靠工具，不靠解析模型自由文本。**
4. **Chat = knowledge 工具面；Agent = coding 工具面。**

---

## 4. 包与文件地图

### 4.1 应用包

| 包 | 职责 | 关键文件 |
|----|------|----------|
| `@piwin/doc-rag` | 文件夹扫描、切块、索引、召回、prompt 拼装 | `folder-rag.ts`, `chunker.ts`, `doc-index.ts`, `prompt-builder.ts`, `quality-rules.ts`, `paths.ts`, `limits.ts`, `rrf.ts` |
| `@piwin/flashcards` | 卡片存储、编解码、去重、FSRS、Anki、artifact 模板 | `card-store.ts`, `card-codec.ts`, `dedup.ts`, `scheduler.ts`, `anki-export.ts`, `artifact-template.ts` |
| `@piwin/notes` | Doc RAG 复用：分词、embedding provider、cosine | 被 `doc-index.ts` import 的 public API |
| `@piwin/contracts` | `FlashcardRecord`、`DocChunk`、HostCommand | `flashcards.ts`, `doc-rag.ts`, `ipc.ts`, `notes.ts`（Embedding/Rerank 接口） |
| `@piwin/host-runtime` | IPC 与 Agent tools 组装 | `commands/knowledge-commands.ts`, `flashcard-tools.ts` |
| `@piwin/artifact` | 沙箱 action：`flashcard/rate`、`flashcard/open-source` | bridge / srcdoc |

### 4.2 App

| 位置 | 做什么 |
|------|--------|
| `apps/desktop/src/DocCardsPanel.tsx` | 选文件夹、勾选文件、Index、Generate、Forget |
| `apps/desktop/src/KnowledgeCenterPanel.tsx` | Knowledge Center 第四 tab「文档卡片」 |
| `apps/desktop/src/FlashcardsPanel.tsx` | 复习队列、评分 |
| `apps/desktop/src/flashcard-artifact.ts` | 聊天里识别/渲染翻转卡 |
| `apps/cli/src/index.ts` | `piwin doccards …` |
| `skills/generate-flashcards/SKILL.md` | 捆绑 skill（与 `FLASHCARD_QUALITY_RULES` 对齐） |

`doc-index.ts` 是 `@piwin/doc-rag` 里**唯一**允许 `import 'node:sqlite'` 的模块（与 notes 同一条规则）。

---

## 5. 磁盘上的数据

```text
~/.piwin/flashcards/
  cards/<card-id>.md      # 真源：frontmatter + Front/Back + 可选 source 快照
  review/<card-id>.json   # FSRS 状态（用户数据，不是缓存）
  decks.json

~/.piwin/doc-rag/
  <folder-key>/           # folder-key = sha256(canonicalAbsPath).slice(0, 16)
    .source-path          # 规范绝对路径（调试/清理）
    doc-index.sqlite3     # 可重建缓存；删了不丢卡片
```

没有独立的「文件夹注册表」。某文件夹有没有绑定卡片 = `list({ sourceFolder: canonicalize(F) })`。

没有 `documents` 表，没有 `ingestion_jobs`，没有 `knowledge_points`，没有 `flashcard_sequences`。

---

## 6. 卡片数据模型（已实现）

```ts
FlashcardRecord = {
  id, deck, front, back, createdAt,
  sourceNoteId?, sourceHash?, sourceExcerpt?,
  sourceFolder?,   // 规范绝对路径
  sourceFile?,     // 相对文件夹，禁止 ..
  sourceLine?,     // 1-based
  tags?,
}
```

没有这些字段（对照外部 Spec）：

- `sequence_id` / `position`
- `card_type` / `relation_from_previous`
- `knowledge_point_ids`
- `source_chunk_ids`
- `difficulty` / `importance`（卡片上）
- `generation_job_id` / prompt/model/config version

去重：

- 模型侧：先 `flashcard_list`，靠 prompt 避免重复
- 存储侧：front 规范化后的 **trigram Jaccard**，阈值 0.85
- `batchCreate` 是部分成功：一张重复不整批失败；上限默认 40

---

## 7. 建库实际怎么走

### 7.1 入口

不是「上传一个文档」。是「用户给一个本地文件夹绝对路径」。

```text
scan-folder
  → 递归 walk（深度 12，跳过 .git/node_modules 等，跳过隐藏文件和密钥文件名）
  → 只收 chunker.supportedExtensions
  → 返回文件列表 + 动态扩展名

index-folder
  → 可选 includeFiles（空数组报错；省略 = 全部已扫描支持文件）
  → 读 utf8 文本
  → 自研 chunker 切块
  → sqlite 全量重建该文件夹索引（先清空再写入）
```

限制常量（`packages/doc-rag/src/limits.ts`）：

| 限制 | 默认 | 超限 |
|------|------|------|
| 最大文件数 | 2000 | 部分索引 + warning |
| 单文件 | 512 KiB | skip |
| 总字节 | 32 MiB | 停止 + warning |
| 走访深度 | 12 | 更深层跳过 |

同一 folder-key 的 index 用 promise 锁串行。

### 7.2 支持的文件类型

Chunker 自己拥有扩展名列表，App 不写死。实际支持：

- Markdown：`.md` `.markdown` `.mdx`
- 纯文本：`.txt`
- 代码：`.ts/.js/.py/.rs/.go/…` 一长串
- 配置/数据：`.yaml/.json/.toml/.ini/…`

**明确没有：** `.pdf` `.doc` `.docx` `.html`，以及音视频。

没有 Parser 层。文件当 UTF-8 文本读；读失败就 skip。

### 7.3 自研 Chunker（这是「糙」的核心之一）

| 类型 | 策略 |
|------|------|
| Markdown | ATX 标题切开，保留 fenced code |
| Code | 顶层 `function/class/def/fn/…` 切开；单块超过约 200 行再切 |
| Plain / 配置 | 空行分段 |

每个 chunk：

```ts
{ filePath, content, startLine, endLine, language }
```

没有：`chunk_id` 稳定哈希、`heading_path`、`page_start/end`、`previous_chunk_id/next_chunk_id`、`content_hash`、parser/chunker version。

### 7.4 索引

sqlite 三张表：

- `chunk_meta`：路径、行号、语言、原文
- `chunk_fts`：FTS5，写入前用 notes 的 `Intl.Segmenter` 预分词（CJK）
- `chunk_vec`：可选 float32 BLOB + `emb_model` / `emb_dim`

向量检索是 **全表 brute-force cosine**，不是 ANN。没有 embedding 时 `degraded: true`，只走 FTS。

Embedding 复用 `config.notes.embedding`，没有独立 `config.docRag`。

没有 Ingestion 状态机。没有 `PENDING/PARSING/…/READY`。没有 file_hash / config_hash 增量。每次 index 对该文件夹是 **全量重建**。

---

## 8. 召回与出卡实际怎么走

### 8.1 Retrieve

```text
query
  → FTS5 MATCH（预分词）
  → 若有 embedding：embed query + 暴力向量
  → 自实现 RRF 融合
  → fileAllowlist 过滤
  → 按 maxTotalChars（默认 24_000）整块截断
```

默认 `limit = 10`。Desktop Generate 也写死 `limit: 10`。

没有：

- LanceDB native hybrid
- 独立 Semantic Reranker（notes 有可选 LLM rerank；**doc-rag 没用**）
- Neighbor Expansion
- Context Pack schema
- document_id 预过滤（根本没有 document 实体）

### 8.2 生成编排（规范路径，已实现）

Desktop `DocCardsPanel.generate()`：

1. **再次 `doccards/index-folder`**（即使用户刚 index 过）
2. `doccards/retrieve`（query = topic 或文件夹路径）
3. 0 个 chunk → 报错，不 prompt
4. `buildFlashcardGenerationPrompt(...)` 纯函数
5. `sendSessionPrompt(text, "文档卡片：<folder>")`
6. 模型在 knowledge profile 下调用 `flashcard_list` → `flashcard_batch_create`
7. 工具返回 `artifactHtml`，模型贴进 ` ```html ` fence

CLI `doccards generate` 只打印 prompt，不跑 Agent 循环。

### 8.3 Prompt 里有什么

- 源文件夹路径
- 可选 topic / difficulty / count 文案（Desktop 目前写死 `medium` + `standard`）
- 每个 passage：`filePath:startLine-endLine` + 原文
- `FLASHCARD_QUALITY_RULES`（原子问题、不泄答案、必须填 source*、一次 batch）

模型被要求**直接写卡片**。没有 Knowledge Point 中间层，没有第二轮规划/排序。

### 8.4 一个和外部 Spec 直接冲突的行为

外部 Spec：「建库完成不代表生成闪卡；生成闪卡不得重新解析或重建索引。」

当前 Desktop Generate **每次都会重新 index**。这是现状，不是笔误。

---

## 9. Host 面：IPC、工具、模式

### 9.1 HostCommand

卡片库：

```text
flashcards/create
flashcards/batch-create
flashcards/list
flashcards/delete
flashcards/decks
flashcards/queue
flashcards/rate
flashcards/export
```

Doc Cards：

```text
doccards/scan-folder
doccards/index-folder
doccards/retrieve
doccards/list-by-folder
doccards/rebind-folder
doccards/forget-folder
doccards/open-source
```

没有 `POST /documents`、`/ingestions`、`/flashcard-generations`。没有 document READY 查询。

### 9.2 Agent tools

```text
flashcard_create
flashcard_batch_create
flashcard_list
flashcard_delete
```

`open-source` 不是模型工具。沙箱按钮 → `flashcard/open-source` artifact action → Host 用 **卡片库里的** `sourceFolder+sourceFile` 解析路径（不信任 iframe 传来的路径）。

### 9.3 ExecutionMode 工具面

| 模式 | 工具面 |
|------|--------|
| `chat` | knowledge：flashcard_* + 只读 `note_search` + 可选 web |
| `agent` | coding：无 flashcard（除非以后加 escape hatch；contracts 里 `agentModeTools` 曾被讨论，当前 `FlashcardsConfig` 未见该字段） |
| `agent-debug` | coding ∪ flashcards |

---

## 10. UI / CLI 现状

### Desktop Doc Cards

已有：

- 手输文件夹路径（不是系统目录选择器）
- Scan / Index
- 文件勾选
- Topic 输入
- Generate（发到当前/新建 chat）
- 已绑定卡片列表
- Forget（确认框）

未做或很粗：

- Difficulty / Count 控件（prompt builder 支持，UI 写死）
- 源文件夹丢失 badge + Rebind 完整流程（store API 有 `rebindSourceFolder`，面板主路径偏 Forget）
- 建库进度 / 阶段状态
- 生成进度（只有「已向 Agent 发送」）
- 卡片学习顺序、KP 预览、来源链浏览

### CLI

```text
piwin doccards scan <folder>
piwin doccards index <folder> [--files a,b]
piwin doccards retrieve <folder> <query> [--limit n] [--files a,b]
piwin doccards list <folder>
piwin doccards generate <folder> [--topic] [--difficulty] [--count] [--files]
piwin doccards rebind <old> <new>
piwin doccards forget <folder> [--yes]
```

`generate` = 打印 prompt。要真正出卡，用户还得把 prompt 贴进 chat。

### 复习

FlashcardsPanel + 聊天翻转卡 + FSRS 四档评分 + Anki TSV。这一块相对完整，和「怎么从文档抽出卡」是分开的。

---

## 11. 配置

`FlashcardsConfig` 现有字段：

```ts
{
  enabled?: boolean;          // 默认 true
  newPerDay?: number;         // 默认 20
  maxReviewsPerDay?: number;  // 默认 200
  maxBatchSize?: number;      // 默认 40
}
```

Embedding / rerank 在 **notes** 配置上，不在 flashcards / doc-rag 上。

没有：MinerU、LanceDB URI、独立 reranker、knowledge_llm / flashcard_llm、chunk 参数、retrieval candidate_limit、KP 阈值、ingestion/generation 并发。

---

## 12. 现有实现为什么显得糙

按用户可感知的顺序：

1. **格式窄**：PDF / Word / HTML 进不来；知识库常见语料正好是这些。
2. **切块朴素**：标题/空行/函数签名启发式，没有 section 合并、oversized split、heading path、页码。
3. **索引即重建**：无增量、无 READY、无 config hash；Generate 还强制再 index 一次。
4. **召回浅**：默认 10 段；无 rerank、无邻居扩展、无 Context Pack。
5. **出卡是一轮聊天**：模型同时负责「找知识 / 写问题 / 排序 / 填来源」。失败形态是「对话里卡片质量飘」。
6. **没有知识对象**：无法检查「抽对了但卡写差了」，也无法复用同一批 KP 再生成。
7. **来源链停在文件:行号**：不能 Card → KP → Chunk → Document。
8. **没有学习顺序**：卡片是袋子，不是 sequence。
9. **任务模型是同步按钮 + 对话**：大文件夹 / 慢 embedding 会卡住 UI；CLI generate 甚至不出卡。
10. **自研了检索栈**：FTS + 暴力向量 + 手写 RRF。对个人文件夹能用，和「成熟工具建库」不是一条路。

这些「糙」大部分是 **v1 有意简化**（doc-flashcards 非目标就包括 PDF/Office、file watcher、抽 rag-core），不是半截工程事故。但和外部 Spec 的目标重叠度很低。

---

## 13. 对照外部 Spec：能留 vs 要对齐时重做

外部 Spec 的目标一句话：稳定建库 → Hybrid 召回 → 高质量 KP → 有来源、有顺序的闪卡。

### 13.1 建议当「已有产品壳」留下

改 Spec 时这些不必当绿场：

- 卡片库、FSRS、Anki、翻转 artifact、打开原文
- Knowledge Center / Doc Cards 面板 / CLI 命令壳
- Host IPC 模式、路径封闭、permission family
- `EmbeddingProvider` 接口形态（需从 `NoteSearchHit` 解耦才能给 doc 用 rerank）
- 「卡片文件是用户数据」——若 Spec 改成业务表，这是产品决策，不是技术细节

### 13.2 若按外部 Spec 落地，基本要新做

- 文档实体 + Ingestion Job + READY
- Unstructured / MinerU parser adapter
- `by_title` chunk + neighbor 指针
- LanceDB hybrid（替换 sqlite 向量/FTS 作为 RAG 主存储）
- 独立 Reranker + Context Pack
- LLM#1 KP + 程序后处理
- LLM#2 规划/排序/出卡 + 程序 QA
- `sequence_id + position` + relation
- Generation Job 状态机
- 配置面与版本追踪
- Golden / retrieval eval / E2E 来源回溯

### 13.3 和 ADR 0018 会打架的点（改 Spec 时先拍板）

| 现有不变量 | 外部 Spec |
|------------|-----------|
| 本地优先、零配置 FTS 必须能用 | 默认假设 Unstructured + LanceDB + Embedding + 两轮 LLM |
| TypeScript / 禁止乱加 native | Spec 示例是 Python + Pydantic + 那些库 |
| sqlite 可丢弃；卡片 markdown 真源 | 业务表 + LanceDB 为检索真源 |
| Host 是生成回合的管道 | 独立 Generation 服务/Job，不走 Agent tool |
| 文件夹是检索范围 | `document_ids` 是检索范围 |
| 生成可降级到 FTS-only | Hybrid + Reranker 是主路径 |

这五条不定，两份文档会互相否定。

---

## 14. 给后续精细化用的清单

### 精细化「已实现说明」时建议补的事实

- [ ] 手动点一次：Scan → Index → Generate → 卡片是否真写入 `~/.piwin/flashcards/cards/`
- [ ] 未配 embedding 时 Generate 的卡片质量（纯 FTS）
- [ ] 配了 notes embedding 时 doc-rag 是否真走向量（`degraded` 标志）
- [ ] 大文件夹（>512KiB 单文件 / >32MiB）的 warning 是否露在 UI
- [ ] Rebind 在 Desktop 是否有入口
- [ ] chat vs agent 下 flashcard 工具是否按 profile 出现
- [ ] CLI generate 是否应升级为真正出卡（当前只打印 prompt）

### 精细化外部 Spec 时建议先写死的决策

1. **语言与进程**：TS adapter 调外部服务，还是 Python sidecar？
2. **卡片真源**：继续 markdown 文件，还是业务 DB？FSRS 放哪？
3. **出卡编排**：继续 `session/prompt` + tools，还是独立 Job + structured output？
4. **检索范围**：继续文件夹，还是改 document 多选？两者是否并存？
5. **零配置**：没有 MinerU / embedding / LanceDB 时，产品是否仍允许「纯文本文件夹 → FTS → 出卡」？
6. **现有自研 chunk/RRF**：替换，还是降级 backend？
7. **Generate 禁止重建索引**：接受这条的话，Desktop 现有行为必须改，不能当兼容。

---

## 15. 权威源（改文档时以代码为准）

| 主题 | 路径 |
|------|------|
| 文件夹 RAG | `packages/doc-rag/src/folder-rag.ts` |
| 切块 | `packages/doc-rag/src/chunker.ts` |
| sqlite 索引/召回 | `packages/doc-rag/src/doc-index.ts` |
| 生成 prompt | `packages/doc-rag/src/prompt-builder.ts` |
| 质量规则 | `packages/doc-rag/src/quality-rules.ts` |
| 卡片存储 | `packages/flashcards/src/card-store.ts` |
| 去重 | `packages/flashcards/src/dedup.ts` |
| 卡片类型 | `packages/contracts/src/flashcards.ts` |
| Doc RAG 类型 | `packages/contracts/src/doc-rag.ts` |
| IPC | `packages/contracts/src/ipc.ts` |
| Host 命令 | `packages/host-runtime/src/commands/knowledge-commands.ts` |
| Agent tools | `packages/host-runtime/src/flashcard-tools.ts` |
| Desktop 面板 | `apps/desktop/src/DocCardsPanel.tsx` |
| 功能 spec | `docs/specs/doc-flashcards.md` |
| ADR | `docs/adr/0018-notes-flashcards-local-rag.md` |

---

## 16. 结论

已实现的是一套 **个人文件夹 → 粗召回 → Agent 写卡 → FSRS 复习** 的垂直切片。卡片库和复习是完整产品；建库/检索/出卡是能跑的 v1，质量上限被切块、召回深度和单轮对话卡住。

外部 Spec 描述的是另一条产品线：**文档级入库 + Hybrid RAG + 两阶段 grounded 出卡**。重叠的是「从资料生成可追溯闪卡」这个意图，不是实现形状。

精细化两份设计时，先拍第 13.3 / 14 节的决策，再改流水线细节，否则会一边补现有文件夹 RAG，一边画 LanceDB 双 Job，两边都做不干净。
