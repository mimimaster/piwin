# Spec — 文档源 & 开放式闪卡生成

| 字段 | 值 |
|------|-----|
| 状态 | **草案待评审 (v3)** |
| 日期 | 2026-07-28 |
| 依赖 | [ADR 0018](../adr/0018-notes-flashcards-local-rag.md)、[ADR 0008](../adr/0008-skills-mcp-pi-wiring.md)、artifact 沙箱（[ADR 0005](../adr/0005-artifact-and-media.md)）、ExecutionMode（`chat` / `agent` / `agent-debug`） |
| 涉及包 | `contracts`、`@piwin/flashcards`、**`@piwin/doc-rag`（新增）**、`@piwin/agent-host`、`@piwin/artifact`、`@piwin/skills`（内置）、desktop、cli |
| 取代 | 同路径 v2 草案 |

> 本文件是 `doc-flashcards.md` 的中文备份，与英文版具有同等约束力。**若两版冲突以英文版为准。**
>
> **v3 变更（相对 v2）：** (1) 用显式 **ExecutionMode 工具配置文件（tool profile）** 取代「只翻一个 boolean」——chat 不再是 `hostTools = []`。(2) 生成编排改为 **客户端组装 prompt**（`index → retrieve → 纯函数拼 prompt → session/prompt`），host 不做隐形参数拦截。(3) `fileSelection` 全链路打通。(4) `batchCreate` 定义部分成功契约。(5) 补齐 open-source 的 IPC 与 artifact 判别联合类型。(6) 任意文件夹的安全策略。(7) 既有 agent 模式闪卡用户的迁移路径。

---

## 1. 意图

piwin 已有 notes + flashcards（ADR 0018）。本功能把个人知识层扩展为：

1. 指向本地**任意文档/代码文件夹**。
2. 得到与该文件夹**持久绑定、可再次打开**的闪卡集合。
3. 在**知识对话（chat）**中生成，而不是污染 coding session。
4. 保留**可追溯来源**（文件 + 行号 + 摘录），但默认不打扰。

设计目标不是「再做一个 RAG 产品」，而是：**把 notes 的 RAG 模式复用到文件夹作用域，卡片仍以纯文本为真相，生成落在小而清晰的模式化工具面上。**

---

## 2. 设计原则

| # | 原则 | 含义 |
|---|------|------|
| P1 | **纯文本是真相；索引是缓存** | 卡片在 `~/.piwin/flashcards/` 的 markdown；doc-rag 的 sqlite 可删可重建。 |
| P2 | **知识面与编程面分离** | Chat = 知识工具；Agent = 编程工具；互不污染。 |
| P3 | **Host 对生成 turn 保持笨管道** | App（desktop/CLI）负责 index + retrieve + 拼 prompt；host 只跑 `session/prompt` 与工具。 |
| P4 | **模型结构化 I/O 走工具** | 模型通过 `flashcard_batch_create` 出卡，不靠应用解析自由文本。 |
| P5 | **能力动态，不硬编码列表** | 支持的文件类型由 chunker 运行时 `supportedExtensions` 决定。 |
| P6 | **破坏性 / 外向动作需用户意图** | 忘记文件夹要确认；打开源文件只信 host 侧卡片字段。 |
| P7 | **可降级** | 无 embedding → 仅 FTS；空选择 / 空检索 → 明确报错，不静默造垃圾卡。 |
| P8 | **Contracts 优先** | 类型与 IPC 进 `@piwin/contracts`；包实现；应用只吃公开 API。 |

---

## 3. 架构

### 3.1 分层

```text
┌──────────────────────────────────────────────────────────────────┐
│ 呈现层                                                            │
│  Desktop DocCardsPanel · CLI `piwin doccards …`                   │
├──────────────────────────────────────────────────────────────────┤
│ 编排（应用拥有：纯函数 + IPC）                                      │
│  index-folder → retrieve → buildFlashcardGenerationPrompt →       │
│  session/prompt（knowledge 工具配置）                               │
├──────────────────────────────────────────────────────────────────┤
│ 应用包                                                            │
│  @piwin/doc-rag     扫描 / 切片 / FTS+向量索引                      │
│  @piwin/flashcards  卡片存储、编解码、artifact 模板、去重            │
│  @piwin/notes       复用：分词、fuseHybridHits、embedding           │
│  @piwin/artifact    action 白名单 + bridge 校验                      │
├──────────────────────────────────────────────────────────────────┤
│ Agent host                                                        │
│  按 ExecutionMode 的 tool profile · 闪卡工具 · doccards IPC         │
│  SDK / RPC 双适配器共用同一装配路径                                 │
├──────────────────────────────────────────────────────────────────┤
│ Contracts                                                         │
│  字段 · BatchResult · HostCommand · ArtifactAction 判别联合        │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 包依赖

```text
@piwin/doc-rag
  → @piwin/contracts
  → @piwin/notes   （仅公开导出：tokenize*、fuseHybridHits、
                    createEmbeddingProvider 等）

apps/* → 只走 host IPC
agent-host → 接线 doc-rag / flashcards / artifact
```

**Embedding 配置（v1）：** 复用 `config.notes.embedding`。UI 说明「notes 的 embedding 同时驱动 doc-rag」。独立 `config.docRag` 延后。

**sqlite 规则：** `@piwin/doc-rag` 内仅 `doc-index.ts` 可 import `node:sqlite`（与 notes 同「每包单模块」规则）。

### 3.3 两种生成形态

| 形态 | 时机 | RAG | 来源字段 | 工具 |
|------|------|-----|----------|------|
| **文件夹源** | 用户选文件夹（Doc Cards / CLI） | 有 — doc-rag | `sourceFolder` 等 | flashcard batch（+ list 去重） |
| **开放式** | chat 中无文件夹上下文 | 无 | 无 | flashcard batch；可选 web_* |

**笔记源**（`sourceNoteId`）属 ADR 0018 既有能力。本功能 v1 通过 knowledge 配置中的**只读 `note_search`** 保持可用；notes 的写删仍在 agent 侧。

---

## 4. 范围

### 4.1 目标

1. 文件夹 → 索引 → 按主题检索 → batch 出卡并带文件/行归因。
2. 文件夹绑定：列出 / 重绑 / 忘记；来源缺失 ≠ 丢卡。
3. 无文件夹的开放式生成。
4. 来源 UX：指示符 + 点击弹出；打开文件走 host 校验路径。
5. Chat 承载知识工具；agent 保持 coding 专注。
6. Doc Cards 生成路径**始终**注入质量规则（skill 为辅）。

### 4.2 非目标（v1）

- 监听文件夹变更并自动再生。
- PDF / Office / 二进制切片。
- `FlashcardSource` 判别联合重构（字段保持增量）。
- 云同步 / 共享牌组。
- 可配置卡片视觉主题。
- 从 notes 拆 `@piwin/rag-core`（无环依赖前 YAGNI）。
- 把 chat 做成第二套完整 agent（knowledge 配置 v1 无 bash/process/MCP）。

### 4.3 需求索引

细则见后文；本表为验收索引。

| ID | 需求 | 详见 |
|----|------|------|
| A1–A8 | 扫描、动态扩展名、切片、FTS/向量/hybrid、可重建索引、主题检索 + 文件白名单 | §7、§8、§9 |
| B1–B7 | batch 工具、双形态生成、参数、去重部分成功、流式、合并 artifact | §9、§12 |
| C1–C5 | sourceFolder 绑定与 rebind/forget | §5、§11 |
| D1–D5 | 来源指示 / popover / open-source | §12 |
| E1–E3 | tool profile + skill | §10、§9.4 |
| F1–F6 | Desktop Doc Cards | §13 |
| G1–G6 | CLI 对等 | §14 |
| H1 | v1 硬编码样式 | §12 |

---

## 5. 领域模型

### 5.1 逻辑上来源种类

```text
FlashcardOrigin =
  | { kind: 'folder'; folder: AbsPath; file: RelPath; line: number; excerpt: string }
  | { kind: 'note';   noteId: string; excerpt: string }
  | { kind: 'open' }
```

v1 **落盘**仍用扁平可选字段（不做 union 重构）。上表供实现者与 skill 语义使用。

### 5.2 卡片字段增量

```ts
sourceFolder?: string;  // 绝对路径，经规范化（§7.2）
sourceFile?: string;    // 相对 sourceFolder，禁止 '..'
sourceLine?: number;    // 1-based 摘录起始行
// sourceExcerpt 已存在
```

### 5.3 文件夹绑定语义

- **注册表 = 卡片本身。** 无独立 folder registry。「文件夹 F 的卡」≡ `list({ sourceFolder: canonicalize(F) })`。
- **匹配键**为创建时写入的**规范化绝对路径**（§7.2）。rebind 批量改写该字符串。
- **来源缺失：** `fs.access` 失败 → UI 徽标；卡仍在。
- **忘记：** 删除匹配 `sourceFolder` 的卡片与 review JSON；**不**删用户文档；doc-rag 缓存可另清或懒清理。

### 5.4 存储布局

```text
~/.piwin/flashcards/
  cards/<card-id>.md
  review/<card-id>.json
  decks.json

~/.piwin/doc-rag/
  <folder-key>/           # sha256(canonicalAbsPath).slice(0, 16)
    .source-path
    doc-index.sqlite3
```

---

## 6. 不变量（约束性）

1. 卡片与 review JSON 是用户数据；`doc-rag/**/*.sqlite3` 均可丢弃重建。
2. `sourceFolder` 是规范化绝对路径字符串，不是裸 hash。
3. 来源缺失 ≠ 数据丢失；恢复动词是 rebind / forget。
4. 支持的扩展名**仅**来自当前 `DocChunker.supportedExtensions`。
5. 路径约束：扫描/索引/打开的文件 realpath 必须落在用户所选文件夹内（§7）。
6. Artifact action 保持白名单；CSP/sandbox 不变。
7. 生成 turn 使用 **knowledge** 工具配置（chat），不是 coding 工具。
8. Batch 创建 **部分成功**：单张重复不中断整批。
9. 打开源文件**只**由 host 根据卡片存储字段解析；不信任 artifact 载荷中的绝对路径。

---

## 7. 安全策略

任意文件夹索引是对 `~/.piwin/notes/` 沙箱的**有意越界**。原则：**用户授权，host 强制。**

### 7.1 约束

| 规则 | 行为 |
|------|------|
| 文件夹根 | OS 目录选择器或 CLI 参数给出的绝对路径 |
| Realpath | resolve 后 realpath 根目录；不存在则拒绝 |
| 子路径 | 每个文件 realpath 必须在根下；拒绝 symlink 逃逸 |
| 相对 `sourceFile` | 禁止绝对路径与 `..` |
| 打开文件 | host 按 `cardId` 读卡 → `join(sourceFolder, sourceFile)` → 再校验 → 打开 |

### 7.2 路径规范化

```ts
function canonicalizeFolderPath(input: string): string {
  // resolve → realpath → 去掉尾部分隔符（根目录除外）
}
```

所有接收 `folderPath` / `oldPath` / `newPath` 的 IPC 先规范化；list/rebind 按规范化字符串匹配。

### 7.3 扫描 / 索引上限（v1 常量）

| 限制 | 默认 | 越界 |
|------|------|------|
| 最大索引文件数 | 2_000 | 部分完成 + warning |
| 单文件最大 | 512 KiB | 跳过该文件 |
| 总字节 | 32 MiB | 部分完成 + warning |
| 最大深度 | 12 | 跳过更深层 |
| 跳过目录名 | `node_modules`、`.git`、`dist`、`build`、`.svn`、`__pycache__` | 始终 |
| 跳过文件名 | `.env`、`.env.*`、`*.pem`、`*.key`、`id_rsa*`、`credentials.json` | 始终 |
| 隐藏项 | 跳过以 `.` 开头的名字 | 始终 |

index/retrieve 接受 `AbortSignal`。同一 `folder-key` 的并发 index：**共享 Promise 串行**（v1）。

### 7.4 模型爆炸半径

- `flashcard_batch_create`：默认最多 40 张。
- `forget-folder`：桌面确认；CLI 需 `--yes`。
- knowledge 配置：**无** bash / process / MCP 写工具。

---

## 8. 包设计 — `@piwin/doc-rag`

### 8.1 公开面

```ts
export type DocChunk = {
  filePath: string;
  content: string;
  startLine: number;    // 1-based
  endLine: number;
  language: string;
};

export type DocChunker = {
  readonly supportedExtensions: readonly string[];
  chunk(filePath: string, content: string): DocChunk[];
};

export type ScannedDocFile = {
  relativePath: string;
  sizeBytes: number;
  language: string;
};

export type RetrieveOptions = {
  limit?: number;                 // 默认 10
  fileAllowlist?: string[];       // 相对路径；空数组 ⇒ 错误
  maxTotalChars?: number;         // 默认 24_000（上下文预算代理）
  embeddingProvider?: EmbeddingProvider;
  signal?: AbortSignal;
};

export type RetrievedChunk = DocChunk & {
  score: number;
  snippet: string;
};

export type IndexFolderOptions = {
  includeFiles?: string[];
  signal?: AbortSignal;
};

export type FolderRag = {
  scanFolder(folderPath: string): Promise<{
    files: ScannedDocFile[];
    supportedExtensions: string[];
  }>;
  indexFolder(
    folderPath: string,
    options?: IndexFolderOptions,
  ): Promise<{
    indexed: number;
    chunks: number;
    degraded: boolean;
    skipped: number;
    warnings: string[];
  }>;
  retrieve(
    folderPath: string,
    query: string,
    options?: RetrieveOptions,
  ): Promise<RetrievedChunk[]>;
  isIndexed(folderPath: string): Promise<boolean>;
  close(): void;
};

export function createFolderRag(options: {
  chunker?: DocChunker;
  embeddingProvider?: EmbeddingProvider;
  piwinRoot?: string;
}): FolderRag;

export function buildFlashcardGenerationPrompt(input: {
  folderPath: string;
  chunks: RetrievedChunk[];
  topic?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  count?: 'fewer' | 'standard' | 'more';
  qualityRules: string;
}): string;
```

### 8.2 Chunker v1

| 类型 | 策略 |
|------|------|
| Markdown | 标题 / 段落 / 代码围栏 |
| 代码 | 函数/类优先，fallback ~200 行 |
| 纯文本 | 双换行段落 |
| 不支持扩展名 | 扫描时跳过 |

### 8.3 索引器

- 仅 `doc-index.ts` 使用 `node:sqlite`。
- FTS5 + 可选向量 + `fuseHybridHits`；无 provider → 仅 FTS。
- `retrieve` 应用 `fileAllowlist`，并按 `maxTotalChars` 截断（整 chunk 为单位）。

---

## 9. 生成流水线

### 9.1 编排协议（规范性）

**不存在 host 侧「拦截 PromptInput 里隐形的 FlashcardGenerationParams」。**  
`PromptInput` 保持 `{ text, attachments?, model?, … }`。

```text
Doc Cards 生成（文件夹源）
────────────────────────
1. 确保 chat session（当前非 chat 则新建，标题 "Doc cards: <name>"）
2. IPC doccards/index-folder { folderPath, includeFiles? }
3. IPC doccards/retrieve     { folderPath, query, fileAllowlist?, … }
4. chunks 为空 → 报错，不 prompt
5. text = buildFlashcardGenerationPrompt({ …, qualityRules })
6. session/prompt({ text })   // knowledge 配置
7. 模型：flashcard_list → flashcard_batch_create
8. 工具事件流式返回；UI 渲染 artifactHtml
```

```text
开放式生成（无文件夹）
────────────────────
1. 已有/新建 chat session 中的用户消息
2. 可选：质量规则由 skill / 习惯注入（非 Doc Cards 硬路径）
3. session/prompt({ text })
4. 模型用通用知识（web_* 仅当 profile 提供）
5. flashcard_batch_create 且不填 source*
```

CLI `doccards generate` 执行相同 2–7 步；`--files a,b` 映射到 `includeFiles` / `fileAllowlist`。

### 9.2 为何采用此形态

| 备选 | 否决原因 |
|------|----------|
| Host 拦截隐形生成元数据 | `PromptInput` 无字段；双适配器易分叉；难测 |
| 单一 `doccards/generate` 包办整轮 agent | 与 UI 生命周期耦合；难当正常 chat 流；IPC 过重 |
| 模型用工具自己读文件 | 多轮 thrash； grounding 差；安全面大 |

### 9.3 Batch 工具与 store 契约

```ts
export type FlashcardBatchCreateResult = {
  created: FlashcardRecord[];
  skipped: Array<{
    front: string;
    reason: 'duplicate' | 'validation';
    detail?: string;
  }>;
  artifactHtml: string; // 仅含 created；每张卡保留独立 cardId
};
```

`CardStore.batchCreate`：空批或超 `MAX_BATCH`(40) 拒绝；逐张 try create；`DuplicateCardError` / 校验失败记入 `skipped` 并继续。

分层：

```ts
// store
batchCreate(cards) → { created, skipped }

// flashcard-tools
→ store.batchCreate + buildCombinedArtifactHtml(created)
→ FlashcardBatchCreateResult
```

单张 `flashcard_create` 保留给临时建卡。

### 9.4 质量规则注入

- 内置 skill：仓库 `skills/generate-flashcards/SKILL.md`，从产品树加载，不拷进 `~/.piwin/skills/`。
- **Doc Cards 生成不得只依赖 skill 发现。** `FLASHCARD_QUALITY_RULES` 为与 prompt builder 同仓的字符串常量，步骤 5 **始终嵌入**。
- Skill 正文与常量主题保持 snapshot 对齐，对自由 chat 仅为 best-effort。

Skill 大纲：文件夹源只基于给定段落并填 source\*；开放式不填；笔记源填 `sourceNoteId`+excerpt；原子正面、不泄答案、简短背面、难度映射、一次 batch、先 list 去重。

---

## 10. ExecutionMode 工具配置

### 10.1 为何「反转 boolean」不够

现状：`chatMode ? [] : [全部 host 工具]`。只改 `flashcardsEnabled` 仍得到空工具表。v3 重写装配。

### 10.2 配置文件（规范性）

| Profile | 模式 | Host 工具（概念） |
|---------|------|-------------------|
| **knowledge** | `chat` | 全部 `flashcard_*`；notes 启用时的**只读** `note_search`；tools-web 启用时可选 `web_search`/`web_fetch` |
| **coding** | `agent` | 现有集合**去掉** flashcard 工具 |
| **debug** | `agent-debug` | knowledge ∪ coding |

```ts
const hostTools =
  executionMode === 'chat' ? knowledgeTools :
  executionMode === 'agent-debug' ? [...codingTools, ...flashcardTools] :
  codingTools;
```

Contracts 中「chat strips tools」类注释改为「chat 使用 knowledge 工具配置」。

### 10.3 迁移

| 对象 | 行为 |
|------|------|
| 在 **agent** 模式生成卡片的老用户 | 默认 **破坏性**：agent 不再有闪卡工具 |
| 逃生舱 | `config.flashcards.agentModeTools?: boolean`（默认 `false`）；为 true 时 coding 配置也挂闪卡工具 |
| 文案 | 「在 agent 生成」→「在 chat / Doc Cards 生成」 |
| ADR 0018 §7 | 修订：生成以 knowledge-chat 为主；agent 经配置 opt-in |

### 10.4 双适配器

`PiSdkAdapter` 与 `PiRpcAdapter` 共用 `buildHostToolsForMode(...)`，禁止 SDK 独有行为。

---

## 11. IPC 面

### 11.1 命令

```ts
| { type: 'doccards/scan-folder'; folderPath: string }
| { type: 'doccards/index-folder'; folderPath: string; includeFiles?: string[] }
| { type: 'doccards/retrieve'; folderPath: string; query: string;
    fileAllowlist?: string[]; limit?: number; maxTotalChars?: number }
| { type: 'doccards/list-by-folder'; folderPath: string }
| { type: 'doccards/rebind-folder'; oldPath: string; newPath: string }
| { type: 'doccards/forget-folder'; folderPath: string }
| { type: 'doccards/open-source'; cardId: string; openFile?: boolean }
```

### 11.2 成功载荷

| 命令 | data |
|------|------|
| `scan-folder` | `{ files; supportedExtensions }` |
| `index-folder` | `{ indexed; chunks; degraded; skipped; warnings }` |
| `retrieve` | `{ chunks; degraded }` |
| `list-by-folder` | `{ records; folderExists; canonicalPath }` |
| `rebind-folder` | `{ updated }` |
| `forget-folder` | `{ deleted }` |
| `open-source` | `{ opened; path? }` — path 仅 host 解析后返回 |

### 11.3 `fileSelection` 全链路

| 阶段 | 字段 |
|------|------|
| UI 勾选 | `scan-folder` 的相对路径 |
| Index | `includeFiles`（空数组 ⇒ 错误） |
| Retrieve | `fileAllowlist`（空数组 ⇒ 错误） |
| Prompt | 仅出现检索到的 chunks |

全选：省略两字段（= 全部支持的文件）。部分取消：勾选集合同时传给 index 与 retrieve。

### 11.4 flashcards store API

- `list({ sourceFolder?; deck?; sourceNoteId? })`
- `batchCreate → { created, skipped }`
- `deleteBySourceFolder` / `rebindSourceFolder`
- codec 新字段 round-trip

---

## 12. Artifact 来源 UX 与 bridge

### 12.1 模板

| 卡类型 | 背面 | Popover | 打开文件 |
|--------|------|---------|----------|
| 文件夹/笔记源 | 仅低调指示符 | 摘录 + 路径 + 行（iframe 内） | → `flashcard/open-source` |
| 开放式 | 无指示符 | — | — |

v1 样式硬编码。多卡 artifact 中每张卡独立 `cardId`。

### 12.2 Artifact 判别联合

```ts
export type ArtifactActionName = 'flashcard/rate' | 'flashcard/open-source';

export type ArtifactActionMessage =
  | { action: 'flashcard/rate'; payload: FlashcardRateActionPayload; … }
  | { action: 'flashcard/open-source'; payload: FlashcardOpenSourceActionPayload; … };

// open-source payload: cardId 必填；sourceFile/sourceLine 仅为 UI 提示，
// host 解析路径时必须忽略，只信 card store。
```

校验：`cardId` 合法；`sourceLine` 若有则 **≥ 1**；`sourceFile` 若有则相对且无 `..`。

Desktop 只发 `doccards/open-source { cardId, openFile: true }`。

---

## 13. Desktop UI

`KnowledgeCenterPanel` 增加第四 tab `docs`（「文档卡片」）。`wiki`/`cards`/`memory` 不动。

DocCardsPanel：选文件夹 → 扫描列表（勾选）→ 主题/难度/数量 → 生成；来源缺失显示重绑；忘记需确认。流程遵循 §9.1。

---

## 14. CLI

```text
piwin doccards scan <folder>
piwin doccards index <folder> [--files a,b]
piwin doccards retrieve <folder> <query> [--files a,b] [--limit N]
piwin doccards list <folder>
piwin doccards generate <folder> [--topic …] [--difficulty …] [--count …] [--files a,b]
piwin doccards rebind <old> <new>
piwin doccards forget <folder> --yes
```

---

## 15. 配置

```ts
export type FlashcardsConfig = {
  enabled?: boolean;
  /** true 时 coding(agent) 配置也挂闪卡工具。默认 false。 */
  agentModeTools?: boolean;
  maxBatchSize?: number; // 默认 40
};
```

Embedding：复用 `config.notes.embedding`。

---

## 16. 测试与验收

### 16.1 矩阵

chunker / doc-index / folder-rag（含 allowlist、symlink、上限、并发）/ prompt builder / codec / store partial batch / bridge 双 action / template 多卡 cardId / tool profile 三模式 / tools 返回形状 / skill 与质量规则主题 snapshot。

### 16.2 Done

1. 相关包 `pnpm typecheck` 通过。  
2. 上表测试通过。  
3. 手测：选夹 → 生成 → 绑定 → 再开 → 移动路径 → 缺失 → 重绑 → 忘记。  
4. 手测：默认 agent 无闪卡工具；chat 有。  
5. ADR 0018 附录与桌面文案已更新。  
6. 无 app→Pi 依赖；doc-rag 不依赖 agent-host。

---

## 17. ADR 更新（追加 ADR 0018）

- 文件夹源字段与绑定语义。  
- `@piwin/doc-rag` 块级索引。  
- knowledge / coding 工具配置（chat 非空工具）。  
- `flashcard_batch_create` 与部分成功。  
- artifact 增加 `flashcard/open-source`。  
- 编排：应用 retrieve + 纯 prompt builder。  
- `flashcards.agentModeTools` 迁移舱。

---

## 18. 开放问题（不阻塞实现）

1. 切片大小 / overlap — 先段落 / ~200 行，后用 recall-eval。  
2. 索引陈旧 — v1 仅手动重建。  
3. top-k 与 maxTotalChars — 默认 10 / 24k。  
4. 多卡 artifact 布局 — 堆叠 vs 轮播。  
5. knowledge 是否日后再放 notes 写工具 — v1 仅 search。

---

## 附录 A — 时序（文件夹生成）

```text
User → Desktop → Host → doc-rag/store → Model
  选夹 → scan-folder
  生成 → index-folder → retrieve
       → buildPrompt（纯函数）
       → session/prompt(text)
       → flashcard_list / flashcard_batch_create
       → 事件 + artifactHtml 回 UI
```

## 附录 B — v2 → v3 问题闭环

| v2 缺陷 | v3 解决 |
|---------|---------|
| `hostTools=[]` 使反转无效 | §10 tool profile |
| 生成参数无上线通道 | §9.1 + `doccards/retrieve` |
| `fileSelection` 未消费 | §11.3 |
| batch throw 与 skip 矛盾 | §9.3 部分成功 |
| open-source IPC/类型缺失 | §11.1、§12.2 |
| 笔记源与 chat-only 闪卡冲突 | §10 含 note_search |
| 安全过薄 | §7 |
| 静默破坏 agent 闪卡 | §10.3 `agentModeTools` |
| 仅依赖 skill 发现 | §9.4 恒嵌入质量规则 |
| 上下文膨胀无界 | `maxTotalChars` 默认 24_000 |
