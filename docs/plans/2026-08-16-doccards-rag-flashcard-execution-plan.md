# Doc Cards RAG → Flashcard 执行计划（口径锁定版）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 本文件取代同日较早那一稿。以产品口径为准；v2 Spec 里的 STALE / 文件过期 / 出卡后锁死 Generate 全部作废。

**Goal：** 用户选本地文件夹 → 异步入库到检索索引 → 入完才能出卡 → 两轮 LLM 只写现有卡片库一份 → 新开 chat 按顺序翻卡，并可换模型继续问（不再出第二份卡）。

**Architecture：** Pipeline A（建库）和 Pipeline B（出卡）彻底分开。Generate 绝不调用 Index。卡片真源仍是 `~/.piwin/flashcards/cards/*.md`。LanceDB 只做可重建检索索引。两轮 LLM 走 Host 任务型 structured completion（扩 Walkthrough completion），不走 `session/prompt` + Agent tool。展示会话只写 card id 指针，翻卡现读 CardStore。

**Tech Stack：** TypeScript / 现有 Host IPC / `@piwin/doc-rag` / `@piwin/flashcards` / LanceDB embedded（P0 spike 拍板）/ Unstructured HTTP（可选）/ MinerU（PDF 唯一）/ 现有 EmbeddingProvider / Walkthrough 风格 structured completion。

**权威口径（按优先级）：**

1. [产品口径](../notes/2026-08-16-doccards-v2-product-decisions.md)（含 2026-08-16 补锁定）
2. 本计划
3. [v2 Spec](/Volumes/BigDisk/Downloads/piwin_doccards_rag_flashcard_design_spec_v2.md)（与口径冲突时丢 Spec）
4. [现状盘点](../notes/2026-08-16-doc-flashcards-current-implementation-report.md)

---

## Global Constraints

1. RAG 一次性 = 不做 STALE / 文件过期 / 改文件自动灭按钮。不是只能 Generate 一次。
2. 必须先选本地文件夹。文件夹 basename = `workspaceName`。
3. 可以不勾文件（= 当前支持的全部），也可以勾一部分。
4. 只解析当前环境支持的类型。PDF 没配 MinerU = 不支持，不当成功，不静默 fallback。
5. 生成按钮看**当前勾选的 supported 文件是否都 READY**，不看上次 Job 叫 FAILED 还是 CANCELED。同一 `folderKey` 禁止边入边生成。
6. 同一文件夹可以再 Generate：每次新 `generationId` + 新 `sequenceId` + 新 chat。0 张新卡不开会话。
7. Topic 选填；空则检索 query = `workspaceName`。禁止用绝对路径当 query。
8. 卡片只写 `CardStore` 一份。会话只存 `{ sequenceId, cardIds, generationId, workspaceName }`。翻卡器按 `sequenceId` 现查，缺卡跳过。
9. `sequenceId` + `position` 只给上一张/下一张。不改 FSRS 调度。Rate 仍写同一份 review JSON。
10. 展示会话关掉 `flashcards-write`；保留 `flashcards-read` 与 rate / open-source。翻卡动作不写 transcript（方案 A）。
11. 聊天直接出卡是另一条路径。本计划不改 `flashcard_create` / `flashcard_batch_create` 语义。
12. 不造轮子：不自研 PDF/DOC parser、BM25、RRF、通用 recursive splitter、手写 JSON 抠取、自研任务队列。
13. 不把 API key 写入 generation record / 日志。
14. 不把 LanceDB 当卡片真源。
15. Generate 内部禁止调用 index / rebuild。
16. 文件硬顶 1000 行；到 400 行先拆。
17. UI 不 import Pi；doc-rag 不 import agent-host；doc-rag 不创建 session。
18. `node:sqlite` 每个包只准一个模块碰（状态库走这个口）。
19. 旧卡片无新字段仍能复习、导出、open-source。
20. 没勾的文件不从索引里删。磁盘文件后来改没改都不管。
21. Index SKIP 仅当 `file_hash` 与 parser/chunker/embedding 配置 hash 都相同。换 embedding 必须重嵌入。
22. 0 个有效 chunk → 该文件 FAILED。只勾不支持的文件 → Index 拒绝。
23. Host 启动把遗留 RUNNING 标 FAILED（`HOST_RESTARTED`）。开会话失败时卡片保留，Job `COMPLETED_DEGRADED`。
24. deck 默认 = `workspaceName`；RAG 卡去重范围是同一 `sourceFolder`。

---

## 0. 本计划覆盖 Spec 的地方

| v2 Spec 仍写着 | 本计划 |
|---|---|
| Document `STALE`、Generate 返回 `INDEX_STALE`、UI stale badge | **不做。** 状态机没有 STALE |
| 没勾的文件从索引删除 | **不删。** 没勾 = 这次不处理 |
| file/config hash 变化 → 产品上的过期 | 产品不做 STALE；再点 Index 时用 file+config hash 加速，配置变了必须重入 |
| 出卡走「一次就结束」的暗示 | 可反复 Generate；0 张新卡不开会话 |
| 空 topic 未写死 | query = `workspaceName` |
| 展示会话未设计 | transcript 指针 + 关 write 工具；翻卡不写 transcript |

---

## 1. 用户主流程

```text
1. 选本地文件夹（必选）
   workspaceName = basename(canonicalPath)

2. Scan
   列出文件：supported / unsupported + reason
   默认勾选所有 supported
   用户可取消部分勾选

3. 点 Index
   当前勾选没有任何 supported 文件 → 拒绝（NO_SUPPORTED_FILES）
   生成按钮保持灭
   后台异步入库
   前端进度：Parsing 2/8 → Chunking → Embedding → Indexing
   完成：通知 + COMPLETED / COMPLETED_DEGRADED
   失败：通知 + 失败文件原因；失败文件不当已入库
   0 chunk 的文件 = FAILED

4. 仅当当前勾选的 supported 文件全部 READY
   且本 folderKey 没有 RUNNING 的 ingestion / generation
   → 生成按钮亮
   上次 Job FAILED / CANCELED 不钉死按钮

5. 用户可填 topic（可选 difficulty / density）→ 点 Generate
   禁止再跑 Index
   query = topic.trim() || workspaceName
   后台 Generation Job
   前端进度：Retrieving → Extracting → Generating → Saving → Opening session

6. CardStore.batchCreate
   每张卡：sequenceId + position + 来源字段
   deck 默认 = workspaceName
   去重范围 = 同一 sourceFolder
   只写磁盘卡片库一份
   created=0 → 不开会话，提示可能都是重复

7. created>0 时 Host 创建一条新 general chat
   标题：`Doc cards: <workspaceName>`
   写入一条产品消息（指针，无卡面）
   Desktop 切到这个会话，按 sequenceId 现查、按 position 翻卡
   点上一张/下一张不写 transcript
   用户可换模型、继续打字；要对某张卡说话就自己提
   再点 Generate = 新 generation + 新会话，旧会话原样保留
```

---

## 2. 两条流水线

### 2.1 Pipeline A — 建库

```text
scan-folder（现有安全扫描；扩展名改由 ParserRegistry）
    ↓
用户勾选 includeFiles（省略 = 全部 supported）
    ↓
doccards/index-folder  → 启动 Ingestion Job（立刻返回 jobId）
    ↓
当前勾选没有任何 supported → 拒绝 NO_SUPPORTED_FILES
    ↓
对每个选中的 supported 文件：
  file_hash + parser/chunker/embedding config hash 都相同且 chunks 已在
    → SKIP（加速，不是过期产品）
  否则：若已有旧 chunk → deleteByDocumentId 再写入
  DISCOVERED → parse → normalize → chunk → validate
  0 个有效 chunk → FAILED
  → 可选 embed → 索引 upsert → READY
    ↓
选中 supported 全部 READY → Job COMPLETED 或 COMPLETED_DEGRADED
任一 supported 失败 → Job FAILED（不阻止之后缩小勾选再 Generate）
```

A 不知道闪卡。A 不知道 session。

### 2.2 Pipeline B — 出卡

```text
doccards/generate
    ↓
当前勾选的 supported 文件是否全部 READY？否 → INDEX_NOT_READY
本 folderKey 是否有 RUNNING ingestion / generation？是 → 拒绝
    ↓
LanceDB Hybrid（无 embedding 则 FTS-only，标 degraded）
    ↓
可选 Reranker（无则跳过，标 degraded）
    ↓
Neighbor ±1（同 document，prev/next）
    ↓
Context Pack（不改写原文，按 token 预算裁）
    ↓
LLM#1 只出 Knowledge Points
    ↓
校验 / 规范化 / 去重 / importance 过滤
    ↓
LLM#2 一次出有序 cards（position 从 1 连续）
    ↓
程序 QA + CardStore.batchCreate
    ↓
created=0 → COMPLETED，不开会话
created>0 → Host 开会话 + 写指针消息（doc-rag 不参与这一步）
开会话失败 → 卡片保留，Job COMPLETED_DEGRADED
```

B 禁止 parse / chunk / embed / LanceDB 重建。

---

## 3. 展示会话（已锁定，P6 按这个做）

沿用 `SessionTranscriptMessage.subagentActivity` 的模式，加可选字段，不新造第二份卡。

```ts
// packages/contracts/src/session-transcript.ts
export type DocCardSequenceView = {
  sequenceId: string
  generationId: string
  workspaceName: string
  cardIds: string[]          // 已按 position 1..N 排好
}

// SessionTranscriptMessage 新增：
docCardSequence?: DocCardSequenceView
```

```ts
// packages/contracts/src/host.ts  CreateSessionInput 新增：
presentation?: {
  kind: 'doccard-sequence'
  sequenceId: string
  generationId: string
  workspaceName: string
  cardIds: string[]
}
```

Host 在 Generation Job 的 `OPENING_SESSION`（仅 `created.length > 0`）：

1. `session/create`：`scope: { kind: 'general' }`，`sessionName: "Doc cards: <workspaceName>"`，带 `presentation`。
2. 往 transcript 追加一条 `role: 'assistant'`、`status: 'done'` 的消息：
   - `text`：短摘要，例如 `Generated 12 cards from Notes on “间隔重复”。Use prev/next to review.`
   - `docCardSequence`：只含 id，不含 front/back
3. 该会话编译工具策略时：`flashcards-write` 关闭，`flashcards-read` 开。
4. `doccards/generation-terminal` 与 `generation-status` 都带 `sessionId` + `cardIds` + `created` / `skipped`（断线对账用）。
5. Desktop 切到该会话；看到 `docCardSequence` 就渲染 `DocCardSequenceView`。
6. 翻卡器按 `sequenceId` 向 CardStore 现查，按 `position` 排。指针里的 `cardIds` 只是创建快照。缺卡跳过；一张不剩显示空态。
7. 点上一张/下一张 **不** 写 transcript，也 **不** 把当前卡打进隐式模型上下文（方案 A）。用户要对某张说话，自己提编号或问题；模型可用 `flashcard_list`。
8. Rate / open-source 走现有 artifact action，写同一份 FSRS / 打开同一份源文件。
9. 开会话失败：卡片已在库里，Job = `COMPLETED_DEGRADED`，push 仍带 `cardIds`；Desktop 可补开或去卡片库。

`created=0`：Job `COMPLETED`，`sessionId` 省略，UI 提示没有新卡片。

CLI generate 也走同一 Host 路径。有新卡才创建会话。CLI 打印 `created/skipped/sessionId`，自己不渲染翻卡器。

---

## 4. 数据怎么放

```text
~/.piwin/doc-rag/<folder-key>/
  .source-path
  state.sqlite3          # documents + jobs，可删了重入
  lancedb/               # chunks / vector / FTS，可删了重入

~/.piwin/flashcards/
  cards/<id>.md          # 唯一卡片真源
  review/<id>.json       # FSRS，不动
  decks.json
  generations/<generation-id>.json   # 调试/来源记录，不是第二份卡
```

- `folder-key` = `sha256(canonicalAbsPath).slice(0, 16)`（沿用现有）
- `document_id` = `sha256(folder_key + "\0" + relative_path)`
- `chunk_id` = `sha256(document_id + "\0" + content_hash + "\0" + source_anchor)`
- `sequenceId` = `seq_<generationId>`
- `rebind-folder` 只改卡片 `sourceFolder` 字符串，不改向量库
- `forget-folder` 只删该文件夹的卡片（现有行为）。不删向量库，这样 Forget 后不必重入就能再 Generate

旧 `doc-index.sqlite3` 不迁移。用户再点 Index 建 V2。旧 index 是可丢弃缓存。

---

## 5. 状态机（无 STALE）

### 5.1 Document

```text
DISCOVERED → PARSING → CHUNKING → EMBEDDING → INDEXING → READY
                                                       → FAILED
                                                       → UNSUPPORTED
```

没有 STALE。用户再点 Index = 对选中文件再跑一遍。  
SKIP 仅当 `file_hash` **以及** parser / chunker / embedding 配置 hash 都相同。配置变了必须重解析或重嵌入。  
内容变了：先 `deleteByDocumentId` 再写入，避免旧 chunk 残留。  
0 个有效 chunk → `FAILED`，不当 READY。

Host 启动：把本进程留下的 `RUNNING` ingestion / generation 标成 `FAILED`，`last_error_code = HOST_RESTARTED`。

### 5.2 Ingestion Job

```text
PENDING → RUNNING → COMPLETED | COMPLETED_DEGRADED | FAILED | CANCELED
```

```ts
type IngestionJob = {
  id: string
  folderKey: string
  workspaceName: string
  folderPath: string
  includeFiles: string[]
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_DEGRADED' | 'FAILED' | 'CANCELED'
  totalFiles: number
  completedFiles: number
  failedFiles: number
  skippedUnsupported: number
  stageCounts: { parsing: number; chunking: number; embedding: number; indexing: number }
  warnings: Array<{ file: string; code: string; message: string }>
  startedAt?: string
  completedAt?: string
}
```

- `COMPLETED`：选中的 **supported** 文件全部 READY，且有 embedding
- `COMPLETED_DEGRADED`：全部 READY，但 FTS-only 或仅有 warning
- `FAILED`：有 supported 文件失败。这是 Job 终态，**不**单独决定生成按钮
- `CANCELED`：用户取消。已 READY 的文件保留

### 5.3 生成按钮

```text
亮：当前勾选的每个 supported 文件都 READY
    且当前没有 RUNNING 的 Ingestion Job（本 folderKey）
    且当前没有 RUNNING 的 Generation Job（本 folderKey）

灭：未选文件夹 / 未选中任何 supported 文件
    / 选中文件尚未全部 READY / 入库中 / 出卡中
```

不做「文件改了就灭」。  
换勾选：新勾上的文件若还没 READY，按钮灭；去掉已失败文件后，剩下的若都 READY，按钮可以亮。  
上次 Job 叫 `FAILED` / `CANCELED` 不钉死按钮。P1 临时用「最近一次 Index 完成」做门闩，P4 起必须改成这一条。

### 5.4 Generation Job

```text
PENDING
CHECKING_INDEX
RETRIEVING
RERANKING
ASSEMBLING_CONTEXT
EXTRACTING_KNOWLEDGE
PROCESSING_KNOWLEDGE
GENERATING_CARDS
VALIDATING
PERSISTING
OPENING_SESSION
COMPLETED | COMPLETED_DEGRADED | FAILED | CANCELED
```

同一 `folderKey`：Ingestion RUNNING 时拒绝 Generate；Generation RUNNING 时拒绝 Index 和第二次 Generate。不同 folderKey 互不影响。

Generation 终态补全：

- `created>0` 且会话开成 → `COMPLETED`（检索 degraded 则为 `COMPLETED_DEGRADED`）
- `created=0`（全是重复或 QA 全丢但模型没崩）→ `COMPLETED`，不开会话
- 模型/schema 失败 → `FAILED`（`NO_VALID_FLASHCARDS` 等），不开会话
- 卡片已落盘、开会话失败 → `COMPLETED_DEGRADED`，`cardIds` 仍在 push 里

---

## 6. 关键类型

```ts
type ScannedFileV2 = {
  relativePath: string
  extension: string
  sizeBytes: number
  support: 'supported' | 'unsupported'
  unsupportedReason?: 'MINERU_NOT_CONFIGURED' | 'UNSTRUCTURED_NOT_CONFIGURED' | 'UNSUPPORTED_FILE_TYPE'
}

type FlashcardGenerationRequest = {
  folder: string
  includeFiles?: string[]
  topic?: string
  difficulty?: 'easy' | 'medium' | 'hard'
  density?: 'concise' | 'standard' | 'detailed'
  deck?: string
}

type KnowledgePoint = {
  id: string                    // kp_<generationId>_<n>
  concept: string
  statement: string
  type: 'definition' | 'fact' | 'property' | 'structure' | 'mechanism' | 'reason'
    | 'relationship' | 'comparison' | 'procedure' | 'application' | 'example'
    | 'exception' | 'formula'
  importance: number            // 0..1
  sourceChunkIds: string[]
  sourceOrder: number
}

type GeneratedFlashcard = {
  position: number              // 从 1 连续
  front: string
  back: string
  cardType: string
  relationFromPrevious?: string
  knowledgePointIds: string[]
  sourceChunkIds: string[]
}

// FlashcardRecord / FlashcardCreateInput 新增可选字段
sequenceId?: string
position?: number
cardType?: string
relationFromPrevious?: string
knowledgePointIds?: string[]
sourceChunkIds?: string[]
generationId?: string
sourceDocumentIds?: string[]
```

Card source 硬规则：

```text
card.sourceChunkIds ⊆ union(引用 KP 的 sourceChunkIds)
card.sourceChunkIds ⊆ 本次 Context Pack
```

Legacy 字段仍写：`sourceFolder` / `sourceFile` / `sourceLine` / `sourceExcerpt`。  
多 chunk 时取 sourceOrder 最小的那个填 legacy，保证 `open-source` 不用立刻改。

---

## 7. IPC

### 7.1 命令

保留并改语义：

```text
doccards/scan-folder           # P2 起返回 ScannedFileV2
doccards/index-folder          # P1 起：启动异步入库，立刻返回 { jobId, status }
doccards/retrieve              # debug；P3 起内部走 V2
doccards/list-by-folder
doccards/rebind-folder         # 只改卡片 sourceFolder
doccards/forget-folder         # 只删卡片
doccards/open-source
```

新增：

```text
doccards/index-status          # { folder } → 最新 job + per-file status
doccards/cancel-index
doccards/generate              # 启动 Pipeline B，立刻返回 { generationId, status }
doccards/generation-status
doccards/cancel-generation
```

`index-folder` **不再**同步返回 `{ indexed, chunks }`。Desktop / CLI 听 push 或 poll status。P1 必须连 App 一起改，禁止只改 contracts。

`generate` 禁止再发 `session/prompt` 出卡。

### 7.2 HostPush

不要用 `@piwin/process` 的 JobRegistry（那是 shell/job 领域，不是知识库任务）。

```ts
| { type: 'doccards/index-progress'; job: IngestionJob }
| { type: 'doccards/index-terminal'; job: IngestionJob }
| { type: 'doccards/generation-progress'; job: GenerationJob }
| { type: 'doccards/generation-terminal'; job: GenerationJob; sessionId?: string; cardIds?: string[] }
```

Desktop 用 push 更新进度；断线后用 status 对账。

并发：引入成熟 `p-queue`。只写状态机，不写自研 worker loop。

---

## 8. 模型怎么调（RAG 出卡）

不要新造 SDK。不要 `session/prompt`。

扩 `packages/host-runtime/src/walkthrough-completion.ts`，抽：

```ts
type StructuredCompletionRequest = {
  provider: ModelProviderConfig
  modelId: string
  systemPrompt: string
  userPrompt: string
  jsonSchema: Record<string, unknown>
  temperature: number
  maxOutputTokens: number
  signal: AbortSignal
}

completeStructured<T>(req): Promise<T>
```

规则：

- Provider 原生 structured output / tool schema 优先。
- Schema 失败允许 **同 stage 再修 1 次**。再失败 Job = FAILED。
- `knowledge.extraction_llm.model_ref` / `knowledge.flashcard_llm.model_ref` 解析到现有 providers。
- 没配则回退 `defaultProviderId + defaultModelId`。再没有 → `GENERATION_MODEL_NOT_CONFIGURED`。
- 展示会话里用户换的模型，只影响之后聊天，不回头重跑 Pipeline B。

doc-rag 只依赖注入的 `StructuredGenerationProvider`。doc-rag 不碰网络、不碰 secret、不创建 session。

---

## 9. Tokenizer / Context 裁剪

- 成熟 tokenizer。优先 `tiktoken` `cl100k_base`。禁止自研。
- Chunk：min 800 / target max 1200 / hard 1500 / merge below 200 / overlap 120。
- Context Pack `max_tokens` 默认 16000。
- 超预算：先丢 `retrievedBy=neighbor`，再按 rerank 分从低到高丢 anchor。禁止从 chunk 中间截断。

---

## 10. LanceDB / native（P0 必须先做）

ADR 0018：不想加 native。LanceDB Node SDK（`@lancedb/lancedb`）带 native。

P0 spike 三选一，写进 ADR 0018 附录后才能进 P3：

| 选项 | 何时用 |
|------|--------|
| A. 接受 LanceDB native，补 sidecar 打包 | spike 证明 desktop sidecar 能装、能检索、CJK FTS 可接受或可预分词 |
| B. LanceDB 独立子进程 / HTTP | native 进不了 sidecar 包 |
| C. 主路径先 sqlite FTS + 成熟库，向量后置 | A/B 都失败 |

默认冲 A。A 失败才降 B/C。没有书面结论禁止把 LanceDB 合进 main。

Spike 必须测：

1. 在与 desktop sidecar 相同的 Node 版本建表、插 3 条、FTS、vector、hybrid。
2. 是否要 per-platform `.node`、三平台有没有预编译。
3. **CJK**：对中文短 query（「间隔重复」「遗忘」）FTS 是否可用。若 LanceDB unicode tokenizer 把 CJK 当单 token，必须能走 `Intl.Segmenter` 预分词（与 notes 同一套路），否则记为 A 失败条件。

---

## 11. 文件与模块地图

### 11.1 新建

```text
packages/contracts/src/knowledge.ts
packages/contracts/src/doc-rag-v2.ts

packages/doc-rag/src/scanner.ts
packages/doc-rag/src/parsers/registry.ts
packages/doc-rag/src/parsers/text-parser.ts
packages/doc-rag/src/parsers/markdown-parser.ts
packages/doc-rag/src/parsers/unstructured-adapter.ts
packages/doc-rag/src/parsers/mineru-adapter.ts
packages/doc-rag/src/chunking/chunk-service.ts
packages/doc-rag/src/chunking/markdown-chunker.ts
packages/doc-rag/src/chunking/generic-chunker.ts
packages/doc-rag/src/chunking/legacy-code-chunker.ts
packages/doc-rag/src/indexing/state-store.ts
packages/doc-rag/src/indexing/lancedb-index.ts
packages/doc-rag/src/indexing/ingestion-service.ts
packages/doc-rag/src/retrieval/retrieval-service.ts
packages/doc-rag/src/retrieval/reranker-adapter.ts
packages/doc-rag/src/retrieval/neighbor-expander.ts
packages/doc-rag/src/retrieval/context-pack.ts
packages/doc-rag/src/generation/kp-schema.ts
packages/doc-rag/src/generation/kp-prompt.ts
packages/doc-rag/src/generation/kp-postprocess.ts
packages/doc-rag/src/generation/flashcard-schema.ts
packages/doc-rag/src/generation/flashcard-prompt.ts
packages/doc-rag/src/generation/generation-service.ts
packages/doc-rag/src/generation/generation-record.ts
packages/doc-rag/src/jobs/ingestion-job.ts
packages/doc-rag/src/jobs/generation-job.ts

packages/host-runtime/src/structured-completion.ts
packages/host-runtime/src/commands/doccards-job-commands.ts

apps/desktop/src/DocCardSequenceView.tsx
apps/desktop/src/DocCardSequenceView.test.tsx
```

### 11.2 修改

```text
packages/contracts/src/flashcards.ts
packages/contracts/src/doc-rag.ts
packages/contracts/src/ipc.ts
packages/contracts/src/config.ts
packages/contracts/src/host.ts
packages/contracts/src/session-transcript.ts
packages/contracts/src/index.ts

packages/flashcards/src/card-codec.ts
packages/flashcards/src/card-store.ts
packages/flashcards/src/artifact-template.ts   # 翻卡样式可复用，不在会话里另存

packages/host-runtime/src/commands/knowledge-commands.ts
packages/host-runtime/src/config-store.ts
packages/host-runtime/src/host-runtime.ts
packages/host-runtime/src/walkthrough-completion.ts
packages/host-runtime/src/blueprint-compiler.ts
packages/host-runtime/src/capabilities/tool-policy-resolver.ts

apps/desktop/src/DocCardsPanel.tsx
apps/desktop/src/App.tsx
apps/desktop/src/host-client.ts
apps/desktop/src/host-client-mock.ts
apps/cli/src/index.ts

packages/doc-rag/src/folder-rag.ts
packages/doc-rag/src/index.ts
docs/adr/0018-notes-flashcards-local-rag.md   # P0 附录
```

### 11.3 迁移期保留、主路径禁止再加逻辑

```text
packages/doc-rag/src/chunker.ts
packages/doc-rag/src/doc-index.ts
packages/doc-rag/src/rrf.ts
packages/doc-rag/src/prompt-builder.ts       # 只留给 --legacy-print-prompt
```

P7 再删主路径调用。聊天出卡的 Agent tools **原样保留**。

---

## 12. 分阶段任务

每阶段独立可测、独立可提交。阶段内按编号顺序做。TDD：先写失败测试，再写实现。

---

### Phase 0 — 锁现状 + 拍 native

**目的：** 后面改检索/出卡时，别把扫描安全和卡片库打坏。没有 spike 结论不准做 P3。

#### Task P0-1: 冻结扫描安全与旧 retrieve

**Files:**
- Test: `packages/doc-rag/src/folder-rag.test.ts`
- Test: `packages/doc-rag/src/paths.test.ts`（已有 canonicalize，补穿越）

**Produces:** 旧 `scanFolder` / `indexFolder` / `retrieve` 行为锁死，后续重构必须绿。

- [ ] **Step 1: 补失败测试（先跑红，再确认哪些已绿）**

现有 `folder-rag.test.ts` 已覆盖：scan 相对路径、跳过 `node_modules`/`.git`/hidden、FTS retrieve、`fileAllowlist`、allowlist `../escape` 拒绝。还缺：

```ts
it('skips secret-like filenames', async () => {
  await writeFile(join(sourceFolder, '.env'), 'SECRET=1');
  await writeFile(join(sourceFolder, 'id_rsa'), '-----BEGIN');
  await writeFile(join(sourceFolder, 'ok.md'), '# Ok');
  const rag = createFolderRag({ piwinRoot });
  const result = await rag.scanFolder(sourceFolder);
  expect(result.files.map((f) => f.relativePath)).toEqual(['ok.md']);
  rag.close();
});

it('does not walk past depth limit', async () => {
  // 建 13 层嵌套 md；只期望深度 ≤12 的文件出现
});

it('scan omits unsupported pdf rather than treating it as success', async () => {
  await writeFile(join(sourceFolder, 'a.pdf'), 'binary');
  await writeFile(join(sourceFolder, 'a.md'), '# A');
  const rag = createFolderRag({ piwinRoot });
  const result = await rag.scanFolder(sourceFolder);
  expect(result.files.map((f) => f.relativePath)).toEqual(['a.md']);
  rag.close();
});
```

- [ ] **Step 2: 跑测试**

```bash
pnpm --filter @piwin/doc-rag test
```

Expected: 已有用例绿；新用例按当前实现补到绿（本阶段不改产品行为，只锁）。

- [ ] **Step 3: Commit**

```bash
git add packages/doc-rag/src/folder-rag.test.ts
git commit -m "test(doc-rag): freeze scan safety and retrieve allowlist"
```

#### Task P0-2: 冻结卡片库 / FSRS / open-source / artifact

**Files:**
- Test: `packages/flashcards/src/card-store.test.ts`（已有 sourceFolder round-trip、rebind、rate）
- Test: `packages/flashcards/src/scheduler.test.ts`
- Test: `packages/flashcards/src/artifact-template.test.ts`
- Test: `packages/host-runtime/src/commands/knowledge-commands.test.ts`
- Test: `apps/desktop/src/flashcard-artifact.test.ts`

**Produces:** 旧卡读写、FSRS、open-source 路径封闭锁死。

- [ ] **Step 1: 给 knowledge-commands 补 open-source 用例**

```ts
it('open-source resolves path from store fields only', async () => {
  const card = {
    id: 'c1',
    sourceFolder: folder,
    sourceFile: 'a.md',
    sourceLine: 1,
  };
  const ctx = createContextWithCardStore({
    read: async (id) => (id === 'c1' ? card : null),
  });
  const response = await handleKnowledgeCommand(
    { type: 'doccards/open-source', cardId: 'c1' },
    'r1',
    ctx,
  );
  expect(response.success).toBe(true);
  expect((response as { data: { path: string } }).data.path.endsWith('a.md')).toBe(true);
});

it('open-source rejects sourceFile with ..', async () => {
  // store 里即使被污染成 ../etc/passwd，命令也必须失败
});
```

- [ ] **Step 2: 确认 FSRS rate 与 artifact 测试仍绿**

```bash
pnpm --filter @piwin/flashcards test
pnpm --filter @piwin/host-runtime exec vitest run src/commands/knowledge-commands.test.ts
pnpm --filter @piwin/desktop exec vitest run src/flashcard-artifact.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add packages/host-runtime/src/commands/knowledge-commands.test.ts
git commit -m "test(host-runtime): freeze doccards open-source path confinement"
```

#### Task P0-3: 冻结 CLI generate 当前行为

**Files:**
- Test: `apps/cli/src/doccards-generate.test.ts`（新建，只锁「默认打印 prompt、不写 CardStore」）

本阶段 **不改** CLI 默认行为。P4 再把默认改成真出卡。

- [ ] **Step 1: 写测试** — mock FolderRag，断言 stdout 含 `## Front` 质量规则或 prompt 标记，且 `CardStore.create` 未被调用。
- [ ] **Step 2: 跑到绿**
- [ ] **Step 3: Commit** `test(cli): freeze doccards generate prompt-only default`

#### Task P0-4: LanceDB desktop sidecar spike

**Files:**
- Create: `docs/notes/2026-08-16-lancedb-sidecar-spike.md`（过程记录）
- Modify: `docs/adr/0018-notes-flashcards-local-rag.md`（只加附录，不改原决策正文，直到选 A）

**Produces:** 书面结论 `A | B | C`。选 C 则 P3 改成 `DocIndexStore` + sqlite 实现，LanceDB adapter 后置。

- [ ] **Step 1: 在隔离目录装 `@lancedb/lancedb`，不要往仓库 package.json 写**（没结论之前禁止合依赖）。
- [ ] **Step 2: 写 30 行脚本：建表、插 3 条中英 chunk、FTS（含「间隔重复」）、vector、hybrid。**
- [ ] **Step 3: 用 desktop sidecar 同类 Node 版本跑通。记录是否要 native binary、darwin-arm64 / darwin-x64 / linux-x64 / win-x64 预编译情况。**
- [ ] **Step 4: 把结论写入 ADR 0018 附录，格式固定：**

```markdown
## Appendix: LanceDB for Doc Cards V2 (2026-08-16)

**Decision:** A / B / C
**Sidecar Node:** <version>
**Native required:** yes/no
**Platform prebuilds:** …
**CJK FTS:** pass / fail+mitigation
**Packaging impact on ADR 0018 §3:** accepted / deferred
```

- [ ] **Step 5: Commit 附录 + spike 笔记（不要 commit node_modules / 隔离目录）。**

#### Task P0-5: knowledge 配置类型草稿，不接线

**Files:**
- Create: `packages/contracts/src/knowledge.ts`
- Modify: `packages/contracts/src/index.ts`（导出，不改 `PiwinConfig` 运行时）

按 Spec §39 做成 TS 类型：`parser` / `chunking` / `embedding` / `retrieval` / `reranker` / `context` / `extraction_llm` / `flashcard_llm` / `jobs`。secret 字段类型用现有 `SecretRef`，不要 `string` 存 key。

本阶段 **不要** 改 `config-store`，不要改默认行为。

- [ ] **Step 1: 加类型 + 一个 compile-only 测试或 type fixture。**
- [ ] **Step 2: `pnpm --filter @piwin/contracts typecheck`**
- [ ] **Step 3: Commit** `feat(contracts): add KnowledgeConfig types (unwired)`

**P0 验收：** 旧测试绿；ADR 0018 附录有 A/B/C；配置类型已进 contracts。

---

### Phase 1 — Contracts + 异步 Index 壳 + 按钮门闩

**目的：** 类型和配置先稳。检索仍走旧 sqlite。Generate 本阶段仍可走旧 prompt，但按钮门闩先装上。**本阶段还不砍「Generate 再 index」。**

#### Task P1-1: FlashcardRecord 可选字段

**Files:**
- Modify: `packages/contracts/src/flashcards.ts`
- Modify: `packages/flashcards/src/card-codec.ts`
- Test: `packages/flashcards/src/card-codec.test.ts`（若无则新建）
- Test: `packages/flashcards/src/card-store.test.ts`

**Produces:** 旧 markdown 能 decode；新字段 round-trip；缺字段的旧卡 `list` / `rate` 仍成功。  
`CardStore.list` 增加可选 `sequenceId` 过滤（P6 翻卡器用）。有 `sourceFolder` 的卡，trigram 去重只跟同一 `sourceFolder` 比。

```ts
// encode：有则写进 frontmatter；无则不写
// decode：缺字段不是错误
```

- [ ] **Step 1: 写 codec 测试（旧卡、新卡、缺字段）。**
- [ ] **Step 2: 跑红。**
- [ ] **Step 3: 实现字段编解码。**
- [ ] **Step 4: 跑绿。**
- [ ] **Step 5: Commit** `feat(flashcards): optional sequence and lineage fields`

#### Task P1-2: Document / Job / Generation 类型

**Files:**
- Create: `packages/contracts/src/doc-rag-v2.ts`
- Modify: `packages/contracts/src/index.ts`

写入：`ScannedFileV2`、`DocumentManifest`、`IngestionJob`、`GenerationJob`、`ContextPack`、`RawKnowledgePoint`、`KnowledgePoint`、`GeneratedFlashcard`、`FlashcardGenerationRequest`、`DocCardSequenceView`（若放 transcript 则在 `session-transcript.ts`）、错误码联合类型。

**不要**在本任务把 `scan-folder` 返回类型改成 V2（那是 P2）。

- [ ] Commit `feat(contracts): doc-rag v2 job and generation types`

#### Task P1-3: HostCommand / HostPush / CreateSessionInput.presentation

**Files:**
- Modify: `packages/contracts/src/ipc.ts`
- Modify: `packages/contracts/src/host.ts`
- Modify: `packages/contracts/src/session-transcript.ts`
- Modify: `packages/contracts/src/ipc.test.ts`

加 §7 命令和 push。`doccards/index-folder` 的成功 data 改为 `{ jobId, status }`。这是 breaking：P1-5 必须同 PR 改 Desktop/CLI。

`CreateSessionInput.presentation` 按 §3 加好，P6 再接线。

- [ ] Commit `feat(contracts): async doccards jobs and sequence presentation`

#### Task P1-4: knowledge 配置接入

**Files:**
- Modify: `packages/contracts/src/config.ts` — `PiwinConfig.knowledge?: KnowledgeConfig`
- Modify: `packages/host-runtime/src/config-store.ts` + 测试

- 未配 `knowledge.embedding` 时映射 `notes.embedding`
- secret 只走现有 SecretRef / env
- 测试：旧 config 不含 knowledge 仍能 load

- [ ] Commit `feat(host-runtime): load optional knowledge config`

#### Task P1-5: index-folder 异步壳，内部仍调旧实现

**Files:**
- Create: `packages/host-runtime/src/commands/doccards-job-commands.ts`
- Create: `packages/host-runtime/src/commands/doccards-job-commands.test.ts`
- Modify: `packages/host-runtime/src/commands/knowledge-commands.ts`
- Modify: `packages/host-runtime/src/host-runtime.ts`
- Modify: `apps/desktop/src/DocCardsPanel.tsx`
- Modify: `apps/desktop/src/host-client.ts` / `host-client-mock.ts`
- Modify: `apps/cli/src/index.ts`

**Produces:**

```text
index-folder → 立刻 { jobId, status: 'PENDING'|'RUNNING' }
后台跑现有 FolderRag.indexFolder
发 doccards/index-progress / index-terminal
Desktop 听 push 画文件计数进度
完成后才允许点 Generate（Generate 本阶段仍可走旧 prompt）
RUNNING 时再点 Index → INDEX_RUNNING
```

测试：

```ts
it('index-folder returns jobId without waiting for indexFolder to finish', …)
it('rejects a second index-folder while RUNNING', …)
it('index-status after terminal reports COMPLETED', …)
```

Desktop 门闩（**仅 P1 过渡**，P4 必须换成 §5.3 的 per-file READY）：

```ts
const indexDone =
  lastIndexJob?.status === 'COMPLETED' ||
  lastIndexJob?.status === 'COMPLETED_DEGRADED'
const canGenerate =
  Boolean(folderPath) &&
  indexDone &&
  lastIndexJob?.status !== 'RUNNING' &&
  !generationRunning
```

本阶段 **保留** `generate()` 里那次 `index-folder` 调用，但在注释标 `P4-2 删除`。门闩先按「最近一次 Index 已完成」工作，避免 UI 完全没进度。终态禁止继续用 Job 名字当按钮。

- [ ] Commit `feat(doccards): async index job shell with progress push`

**P1 验收：** 新字段不炸旧卡；异步 Index 有进度；没完成 Generate 按钮灭；配置能读。

---

### Phase 2 — Parser / Chunk V2

**目的：** 统一 ParsedBlock + 成熟切块。结果可先仍写入旧 sqlite，用 golden 验证。Scan 开始展示 unsupported reason。

#### Task P2-1: Parser 接口 + Registry

**Files:** `packages/doc-rag/src/parsers/*`

```ts
interface DocumentParser {
  readonly id: string
  readonly version: string
  supports(input: { relativePath: string; extension: string }): boolean
  parse(input: ParserInput, signal?: AbortSignal): Promise<ParsedDocument>
}
```

Registry：

- 始终注册 text / markdown / 现有代码扩展
- Unstructured enabled 才宣称 html/doc/docx
- MinerU enabled 才宣称 pdf
- `getSupportedExtensions()` / `classify(file)` 给 Scan 用

测试：没配 MinerU 时 `.pdf` → `unsupported` + `MINERU_NOT_CONFIGURED`。没配 Unstructured 时 `.docx` 同理。

- [ ] Commit `feat(doc-rag): parser registry with capability-aware scan`

#### Task P2-2: Markdown / TXT parser

- Markdown：`unified` + `remark-parse`（或仓库已有等价物）。保留 fence、headingPath、startLine/endLine。
- TXT：UTF-8 / BOM / 换行，按段落出 block。
- 禁止再加 ATX 正则当主路径。

Golden：`nested_headings.md`、带 fence 的 md、带 BOM 的 txt。

- [ ] Commit `feat(doc-rag): markdown and text parsers`

#### Task P2-3: Code 切块

现有语言列表保留。优先成熟 language-aware splitter；没有的语言走 `legacy-code-chunker`，`chunker_id = legacy-code-v1`。禁止上 Tree-sitter 全家桶。

- [ ] Commit `feat(doc-rag): code chunking with legacy fallback`

#### Task P2-4: Unstructured adapter

HTTP Provider。映射成 `ParsedBlock[]`。没配 → html/doc/docx unsupported。禁止自研 DOC binary。

CI：fixture JSON snapshot，不打真实 Unstructured。

本阶段适配器可以先合；没有配置时产品行为 = 这些类型不可选。不阻塞后续阶段。

- [ ] Commit `feat(doc-rag): unstructured http adapter`

#### Task P2-5: MinerU adapter

`mode: http | local-command`。只吃结构化 JSON/content list，映射 page + order + text。没配 → PDF unsupported。禁止 PyPDF 静默 fallback。

CI：MinerU fixture snapshot，不跑 GPU。

- [ ] Commit `feat(doc-rag): mineru adapter without silent fallback`

#### Task P2-6: Normalize + Chunk service

Normalize：Unicode、换行、BOM、空 block。禁止 LLM。

Chunk：structure first + 成熟 recursive splitter（`@langchain/textsplitters` 或已证等价）。写出 V2 `DocChunk`（stable id、headingPath、prev/next、contentHash）。

Golden：

- 不跨 heading 乱合并
- hard max 必拆
- 小段可合并
- prev/next 成链
- 同文件同配置两次 `chunk_id` 相同

- [ ] Commit `feat(doc-rag): structure-first chunk service`

#### Task P2-7: Scan 改走 Registry

**Files:** `folder-rag.ts` 或抽出的 `scanner.ts`；`DocCardsPanel` 显示 unsupported reason。

保留现有安全规则（canonicalize、depth 12、`.git/node_modules`、hidden、密钥文件名、体积上限）。只换「谁决定 supported」。

- [ ] Commit `feat(doccards): scan reports unsupported reasons`

**P2 验收：** Scan 能解释「为什么这 PDF 不能选」；md/txt golden 绿。

---

### Phase 3 — 检索后端（等 P0-4 结论）

**前置：** P0-4 为 A 或 B。若为 C：本阶段实现 `DocIndexStore` 的 sqlite 版，LanceDB 文件改为后续 adapter，接口不变。

#### Task P3-1: DocIndexStore 接口

```ts
interface DocIndexStore {
  upsertChunks(chunks: IndexedChunk[]): Promise<void>
  deleteByDocumentId(documentId: string): Promise<void>
  hybridSearch(query: HybridQuery): Promise<RetrievalHit[]>
  ftsSearch(query: FtsQuery): Promise<RetrievalHit[]>
  getChunksByIds(ids: string[]): Promise<IndexedChunk[]>
}
```

业务只打这个口。`state-store.ts` 是包内唯一 `node:sqlite` 入口。

- [ ] Commit `feat(doc-rag): DocIndexStore port`

#### Task P3-2: LanceDB adapter（或 C 的 sqlite adapter）

表 `doc_chunks_v2`。FTS + 可选 vector + metadata filter（`folder_key` + `document_id IN (...)`）。

- Hybrid / RRF 用 LanceDB 自带。禁止调用 `rrf.ts`。
- 无 embedding：只建 FTS，`retrievalMode=fts_only`。
- CJK：按 spike 结论做预分词或不做。

选 A 才把 `@lancedb/lancedb` 写入 workspace 依赖，并补 desktop sidecar 打包说明。

- [ ] Commit `feat(doc-rag): lancedb index adapter`（或 sqlite）

#### Task P3-3: Embedding 通用化

把 `EmbeddingProvider` 从 notes 专属解耦到 `knowledge.ts`。实现仍复用 `packages/notes/src/embedding/*`，host-runtime 注入给 doc-rag。doc-rag **不要** import notes 的 sqlite。

未配置 embedding：照常 READY，`COMPLETED_DEGRADED` + `fts_only`。

- [ ] Commit `feat(contracts): decouple EmbeddingProvider from notes hits`

#### Task P3-4: Reranker adapter

可关。失败默认 `fallback`，标 `degraded`。接口吃 `{ id, text }[]`，不要 `NoteSearchHit`。

- [ ] Commit `feat(doc-rag): reranker adapter`

#### Task P3-5: Neighbor + Context Pack

同 document，`prev/next`，去重，按 sourceOrder 排。邻居 `retrievedBy=neighbor`，不继承高分。按 §9 裁预算。

测试：跨文档邻居必须为空；超预算先丢 neighbor。

- [ ] Commit `feat(doc-rag): neighbor expansion and context pack`

#### Task P3-6: `doccards/retrieve` 换 V2

对外命令保留。内部走 retrieval-service。CLI retrieve 继续能打。

Retrieval 小集：至少对比 FTS vs Hybrid（有 embedding 时）。硬过滤：只命中选中 document。

- [ ] Commit `feat(doc-rag): retrieve uses v2 retrieval service`

**P3 验收：** 选一个文件 retrieve，另一个文件的 chunk 不准出现；无 embedding 仍可 FTS。

---

### Phase 4 — 拆开 Index / Generate（架构转折点）

**目的：** 一次性门闩落地。Generate 再也不能偷跑 Index。

#### Task P4-1: Ingestion service 真异步 + hash 加速

对选中文件：

```text
file_hash 且 parser/chunker/embedding config hash 都相同，且 chunks 已在
  → SKIP（加速）
新文件 / file_hash 变 / 配置 hash 变
  → deleteByDocumentId（若已有）→ 重解析入库
0 个有效 chunk → 该文件 FAILED
当前勾选没有任何 supported → 拒绝 NO_SUPPORTED_FILES
```

**不**因为「这次没勾」删除上次已入库文件。磁盘文件没了：这次选中列表里没有就不管。

同一 folderKey 互斥：已有 RUNNING ingestion / generation → 拒绝新的。  
Host 启动回收遗留 RUNNING。

`list` 过滤需支持 `sequenceId`（P6 翻卡器要用）。去重：有 `sourceFolder` 的卡只跟同一 `sourceFolder` 比 front。

- [x] Commit `feat(doc-rag): ingestion service with hash skip`

#### Task P4-2: 砍掉 Generate 里的 index

**Files:** `apps/desktop/src/DocCardsPanel.tsx`

删除：

```text
generate → doccards/index-folder → retrieve → session/prompt
```

改成：

```text
generate → 检查 index-status：当前勾选 supported 全部 READY
         → doccards/generate
```

未完成 → 按钮灭；点了也返回 `INDEX_NOT_READY`。

测试（必须）：

```ts
it('generate path never calls indexFolder', async () => {
  const indexFolder = vi.fn();
  // …trigger generate…
  expect(indexFolder).toHaveBeenCalledTimes(0);
});
```

- [x] Commit `fix(desktop): stop reindexing inside doccards generate`

#### Task P4-3: Generation Job 壳 + 写入 CardStore

本阶段 Job 先跑：retrieve V2 → Context Pack → **一轮** structured completion 出卡（标 `pipelineVersion: 'v2-single-llm-legacy'`）。两轮放到 P5。

但本阶段必须做到：

- 门闩、进度 push
- 写入 CardStore（带 sequenceId + position）
- 禁止 `session/prompt` 出卡
- 还不开展示会话也行（P6 做），但不要把卡写进 transcript

- [x] Commit `feat(doccards): generation job writes CardStore only`

#### Task P4-4: CLI generate 改为真出卡

默认写入 CardStore，打印 created/skipped。  
`--dry-run` / `--show-context` / `--show-kp`。  
旧打印 prompt 仅 `--legacy-print-prompt`。

改 P0-3 的冻结测试：默认不再是 prompt-only。

- [x] Commit `feat(cli): doccards generate writes cards`

**P4 验收：** Generate 测试里 `indexFolder` 调用次数 = 0；没入完按钮灭；可再点 Generate 出第二批（不同 sequenceId）。

---

### Phase 5 — 两轮 LLM 出卡

#### Task P5-1: Structured completion

**Files:**
- Create: `packages/host-runtime/src/structured-completion.ts`
- Create: `packages/host-runtime/src/structured-completion.test.ts`
- Modify: `packages/host-runtime/src/walkthrough-completion.ts`（改调公共层）
- Test: 现有 `walkthrough-completion.test.ts` 必须绿

从 walkthrough-completion 抽出公共 HTTP/鉴权。Walkthrough 行为不变。

- [x] Commit `refactor(host-runtime): extract structured completion from walkthrough`

#### Task P5-2: LLM#1 KP

Prompt：只抽知识点，不写 front/back。Structured output = Raw KP schema。伪造的 `sourceChunkIds` 直接 reject。`quality-rules.ts` 不进这一轮。

测试：假 source id 被丢；空 concept 被丢；importance 越界被丢。

- [x] Commit `feat(doc-rag): knowledge point extraction stage`

#### Task P5-3: KP 后处理

顺序：schema → source ∈ Context Pack → normalize → exact dedup → 可选 embedding 相似去重（阈值 0.90）→ `importance >= 0.50`。默认不第三轮 LLM。Canonical id：`kp_<generationId>_<n>`。

- [x] Commit `feat(doc-rag): knowledge point postprocess`

#### Task P5-4: LLM#2 有序出卡

输入：topic（或 workspaceName）、options、Canonical KPs、被引用 chunk 原文、`FLASHCARD_QUALITY_RULES`、已有卡片 front 摘要（默认最多 50 条 front）。  
一次输出 ordered array。`position` 从 1 连续。`relationFromPrevious` 在 position=1 必须空。

- [x] Commit `feat(doc-rag): ordered flashcard generation stage`

#### Task P5-5: QA + 落库 + GenerationRecord

程序 QA：§6 硬规则 + trigram 去重 + `maxBatchSize`。  
通过后 `CardStore.batchCreate`。写 legacy source* + 新 lineage 字段。  
写 `~/.piwin/flashcards/generations/<id>.json`（KP + chunk ids + config hash，无 key）。

失败：schema/引用坏 → 同 stage repair 1 次 → 仍坏则 FAILED。  
重复卡：代码 dedup，不重跑模型。

- [x] Commit `feat(doc-rag): flashcard QA persist and generation record`

#### Task P5-6: 旧 Agent 出卡路径不动

`flashcard_batch_create` 仍给「聊天直接出卡」用。回归测试：knowledge profile 下工具仍在；Doc Cards RAG **不再**走这条工具。

Skill `generate-flashcards` 里 folder 段落改成「走 doccards/generate」，open/notes 段落保持独立。

- [x] Commit `docs(skills): separate rag generate from chat flashcards`

**P5 验收：** 一张卡能追到 KP → chunk → 文件；position 1..N；聊天出卡工具仍可用。

---

### Phase 6 — 展示会话 + UI/CLI 完整化

#### Task P6-1: 出卡完成后开会话

**Files:**
- Modify: `packages/host-runtime/src/commands/doccards-job-commands.ts`
- Modify: `packages/host-runtime/src/blueprint-compiler.ts` / `tool-policy-resolver.ts`
- Modify: session create 路径（presentation 生效）
- Test: host-runtime 集成测试

```text
CardStore 写入成功
  → session/create { scope: general, name, presentation }
  → transcript 追加指针消息（短 text + docCardSequence）
  → 该会话 flashcards-write = off
  → generation-terminal 带 sessionId + cardIds
```

测试：

```ts
it('opens a general session with docCardSequence ids only', …)
it('session tool policy excludes flashcards-write', …)
it('does not persist card front/back in the transcript', …)
it('does not append transcript rows when flipping prev/next', …)
it('second generate opens a second session with a new sequenceId', …)
it('created=0 does not create a session', …)
it('session-create failure keeps cards and marks COMPLETED_DEGRADED', …)
it('generation-status includes sessionId after terminal', …)
it('host restart marks leftover RUNNING jobs FAILED', …)
```

- [ ] Commit `feat(host-runtime): open doccard review session after generate`

#### Task P6-2: DocCardSequenceView

**Files:**
- Create: `apps/desktop/src/DocCardSequenceView.tsx`
- Create: `apps/desktop/src/DocCardSequenceView.test.tsx`
- Modify: 会话消息渲染（识别 `message.docCardSequence`）

- 输入：`sequenceId`（优先）+ 创建时的 `cardIds` 快照
- 向 CardStore `list({ sequenceId })` 现查，按 `position` 排；快照里已删的卡跳过
- 一张不剩：空态，不崩
- 显示当前卡 front/back（复用现有翻转样式；可 rate / open-source）
- 上一张 / 下一张（到头按钮灭）；**不**写 transcript，**不**更新模型上下文
- 不写任何新文件

- [ ] Commit `feat(desktop): sequential doc card viewer from card ids`

#### Task P6-3: DocCardsPanel

- Scan：支持/不支持/原因
- Index：异步进度 + 完成通知
- Generate：仅当前勾选 supported 全部 READY 可点
- 入库中 / 出卡中：互斥 disable
- 不做 STALE badge
- Workspace 名显示文件夹 basename
- Topic 空不禁用 Generate
- 出卡完成后：`created>0` 切到新会话；`created=0` 留在面板并提示
- 去掉失败文件后按钮可重新亮

- [ ] Commit `feat(desktop): doccards panel ready-gate and progress`

#### Task P6-4: Settings 能力灯

MinerU / Embedding / Reranker / 两套 LLM 的 configured / unavailable。不在业务代码写死模型名。

- [ ] Commit `feat(desktop): knowledge capability indicators`

#### Task P6-5: CLI 与 Desktop 同语义

进度打到 stderr，结果 JSON 可 `--json`。generate 打印 sessionId。

- [ ] Commit `feat(cli): doccards generate reports session id`

**P6 验收：** 新会话能翻到第 2 张；`card.id` 和卡片库是同一个；再 Generate 会开第二个会话；`created=0` 不开会话；Forget 一张后重开旧会话能跳过死链；提问不会调用 `flashcard_batch_create`；翻卡不增加 transcript 行。

---

### Phase 7 — 拆轮子

Golden / E2E 绿之后才能删主路径：

- `doc-index.ts` 暴力向量检索
- `rrf.ts` 主路径调用
- `chunker.ts` 当默认 chunker
- `prompt-builder.ts` 当默认出卡
- Desktop `sendSessionPrompt` 出卡

保留：scanner 安全、CardStore、open-source、flashcard Agent tools（聊天出卡）、FSRS、Anki。

- [ ] Commit `refactor(doc-rag): remove legacy retrieve and prompt generation path`

**P7 验收：** 主路径不再 import `rrf.ts` / 旧 prompt-builder。

---

## 13. 阶段依赖

```text
P0 ─┬─ P1 ─ P2 ─┬─ P3 ─ P4 ─ P5 ─ P6 ─ P7
    │           │
    └─ spike ───┘  P3 必须等 spike
```

- P4 可以在 P3 后立刻做（门闩 + Job）。
- P5 依赖 P4 的 Job 壳和 P3 的 Context Pack。
- P6 依赖 P5 的 cardIds + sequence。
- P1-5 的异步壳可以提前给 UI 进度，但 Generate 偷跑必须在 P4 砍死。

---

## 14. 测试矩阵

| 类 | 测什么 | 阶段 |
|----|--------|------|
| 安全扫描 | 路径穿越、隐藏、密钥、深度 | P0 / P2 |
| Parser golden | md / txt / html fixture / docx fixture / mineru json | P2 |
| Chunk golden | heading、hard max、prev/next、stable id | P2 |
| 按钮门闩 | 未完成灭、完成后亮、RUNNING 互斥、换勾选未 READY 则灭 | P1 / P4 |
| Generate 不 index | spy：generate 路径零次 indexFolder | P4 |
| 可再生成 | 两次 generate 两个 sequenceId、两批卡、两个会话 | P4 / P6 |
| 0 张新卡 | created=0 不开会话，Job COMPLETED | P4 / P6 |
| 空 topic | retrieve query === workspaceName，绝不是绝对路径 | P4 |
| 去重范围 | 两个同名文件夹互不误伤；同 sourceFolder 仍去重 | P4 / P5 |
| 死链 | Forget/删卡后按 sequenceId 现查，跳过缺失 | P6 |
| 崩溃回收 | 启动后遗留 RUNNING → FAILED HOST_RESTARTED | P4 |
| 只选不支持 | Index 拒绝 NO_SUPPORTED_FILES | P2 / P4 |
| 0 chunk | 该文件 FAILED，不当 READY | P2 / P4 |
| Retrieval | 只命中选中 document；fts_only 可跑 | P3 |
| Neighbor | 不跨文档；去重 | P3 |
| KP contract | 无 front/back；假 source 丢 | P5 |
| Card QA | position 连续；source ⊆ KP ∪ pack | P5 |
| Codec | 旧卡能读；新字段 round-trip | P1 |
| FSRS | rate / queue 不受新字段影响 | P1 / P5 |
| 一份存储 | generation 后只多 cards/*.md + 一条 generation json；transcript 无 front/back | P6 |
| 展示会话 | 有指针；无 write 工具；翻到第 2 张读同一 id | P6 |
| E2E | 选夹 → 入 md → 出卡 → 会话翻到第 2 张 → 卡片库能看到同一 id | P6 |
| 聊天出卡回归 | Agent `flashcard_batch_create` 仍能用，且不走 ingestion | 全程 |

PDF 真 MinerU 只在本地/可选 profile 跑，CI 用 fixture。

---

## 15. 错误码

```text
UNSUPPORTED_FILE_TYPE
MINERU_NOT_CONFIGURED
UNSTRUCTURED_NOT_CONFIGURED
PARSER_FAILED
INDEX_NOT_READY
INDEX_FAILED
INDEX_RUNNING
NO_SUPPORTED_FILES
HOST_RESTARTED
GENERATION_RUNNING
NO_RETRIEVAL_RESULTS
RERANKER_FAILED          # 仅 failure_mode=fail
KNOWLEDGE_EXTRACTION_FAILED
NO_VALID_KNOWLEDGE_POINTS
FLASHCARD_GENERATION_FAILED
NO_VALID_FLASHCARDS
GENERATION_MODEL_NOT_CONFIGURED
```

没有 `INDEX_STALE`。

降级（不是错误）：`fts_only`、`reranker_skipped`。生成按钮仍可亮。

---

## 16. 每阶段验收（对人）

**P0：** 旧测试绿；LanceDB 有 A/B/C 书面结论。  
**P1：** 新字段不炸旧卡；异步 Index 有进度；配置能读。  
**P2：** Scan 能解释「为什么这 PDF 不能选」；md/txt golden 绿。  
**P3：** 选一个文件 retrieve，另一个文件的 chunk 不准出现。  
**P4：** Generate 的测试里 `indexFolder` 调用次数 = 0；没入完按钮灭；可再 Generate。  
**P5：** 一张卡能追到 KP → chunk → 文件；position 1..N。  
**P6：** 新会话能翻下一张；`card.id` 和卡片库是同一个；`created=0` 不开会话；翻卡不加 transcript；聊天提问不再长出第二份卡。  
**P7：** 主路径不再 import `rrf.ts` / 旧 prompt-builder。

---

## 17. 明确不做

- 文件过期 / STALE / 改文件自动灭按钮
- 边入库边出卡
- 会话里再存一套卡片（含 front/back）
- 把聊天直接出卡并进本流水线
- 出完一次锁死 Generate
- 用绝对路径当空 topic 的 query
- 把翻卡位置写进 transcript / 隐式同步给模型
- 音视频、GraphRAG、全局 watcher、新卡片 DB、换 FSRS
- 为 RAG 新造一套模型 SDK
- PDF 静默走非 MinerU
- 自研 BM25 / RRF / 通用 recursive chunk
- Spec 里默认关闭的 card_verifier（本轮不做）
- 把没勾的已入库文件从向量库删掉

---

## 18. 建议提交切片

```text
docs: 本计划 + 口径补锁定 + ADR 0018 附录（spike 结论）
test: freeze scan / card store / open-source / CLI prompt-only
feat(contracts): knowledge + flashcard optional lineage + job types
feat(doccards): async index shell
feat(doc-rag): parsers + chunk v2
feat(doc-rag): DocIndexStore + adapter
fix(desktop): generate never indexes
feat(doccards): two-stage generation + CardStore persist
feat(desktop): sequence session viewer
refactor(doc-rag): delete legacy retrieve/prompt path
```

---

## 19. 下一会话从哪开

读：

1. [产品口径](../notes/2026-08-16-doccards-v2-product-decisions.md)
2. 本计划
3. [现状盘点](../notes/2026-08-16-doc-flashcards-current-implementation-report.md)

从 **P0-1** 开始。P0-4 spike 可与 P0-1…P0-3 并行，但没有附录结论不准开 P3。
