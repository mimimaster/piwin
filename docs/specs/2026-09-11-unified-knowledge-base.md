# 统一知识库（Knowledge Base）

> 状态：草案 · 2026-09-11
> 决策：产品负责人确定笔记库与文档文件夹 RAG 统一为单一「知识库」入口。
> 关联：ADR 0018（notes/flashcards local RAG，P0 落地后更新）、`docs/specs/notes-flashcards-rag.md`、`docs/superpowers/specs/2026-08-17-knowledge-center-loop-repair-design.md`

## 1. 背景

### 1.1 现状：两套「知识」

| | 笔记库 | 文档文件夹 RAG |
|---|---|---|
| 包 | `@piwin/notes` | `@piwin/doc-rag` |
| 源数据 | `~/.piwin/notes/<collection>/<id>.md`，可写，事实源 | 用户任意文件夹，只读 |
| 索引 | `node:sqlite` FTS5 + 向量，整篇为单位 | LanceDB ICU FTS + 向量，切片 + rerank + 邻接扩展，缓存在 `~/.piwin/doc-rag/<folderKey>/` |
| 登记 | 隐式单库 | **Host 无登记**；桌面 localStorage `piwin.doccards.recent_folders` |
| Agent 工具 | `note_search/list/read/write/update/delete` | **无** |
| 桌面入口 | 右栏 `NotesPanel` | 闪卡 →「出卡」；闪卡 →「Wiki」（纯检索页） |
| CLI | `piwin notes …` | `piwin doccards retrieve / generate` |

embedding provider 目前两边共用 `config.notes.embedding`（`host-runtime-services.ts`），同时 `KnowledgeConfig.embedding` 也存在。

### 1.2 问题

1. 入库的文件夹只能出闪卡，**不能问答**：对话里的 Agent 看不到它们。
2. 两个「知识」概念、两个检索入口；若都暴露为 Agent 工具，模型会混淆该用哪个。
3. 文件夹登记只存在桌面 localStorage，CLI / 远端 Host / 移动端看不到，违反 Host-first（AGENTS.md §1.12）。
4. 闪卡页的 Wiki 页不可用：`notes` 恒为 `[]`、未入库与无结果同一句文案、空状态可导出空文件（附录 A）。

## 2. 目标与非目标

**目标**

- 一个「知识库」概念、一个入口；笔记是一种知识库。
- Host 拥有知识库登记，所有客户端看到同一份。
- 对话中可基于知识库问答，回答带可点击、可定位的引用。
- 提问、查找、出卡都是知识库上的动作。

**非目标（本期）**

- 合并两套检索引擎（列为 P3 方向）。
- 云同步、多人共享知识库。
- 文件监听实时入库。
- 网页 / URL 等新知识源。

## 3. 产品模型

### 3.1 知识库类型

| kind | 数量 | 源 | 可写 | 入库 |
|---|---|---|---|---|
| `notes` | 内置唯一 | `~/.piwin/notes` | 是（Agent 写入需 ask） | 写入即 reconcile |
| `folder` | 多个 | 用户文件夹 | 否 | 用户勾选文件后经 doc-rag 入库 |

- 笔记的 collection 是库内分组，不单独成库。
- ID：`notes` 固定为 `notes`；文件夹为 `folder:<folderKey>`，复用 doc-rag 的 `folderKey`，与现有缓存目录一一对应——登记表丢失时可从缓存恢复。

### 3.2 状态

`folder` 知识库：

| 状态 | 条件 | 主动作 |
|---|---|---|
| `missing` | 路径不存在 | 重新定位（`doccards/rebind-folder`）/ 移除 |
| `not-indexed` | 已登记，无 READY 文档 | 选择文件并入库 |
| `indexing` | 有运行中的入库任务 | 查看进度 / 取消 |
| `ready` | 勾选的受支持文件均 READY | 提问 / 查找 / 出卡 |
| `partial` | 部分文件 FAILED | 查看失败文件 / 重试 |

`notes` 知识库：`empty` / `ready`。

正交标记 `degraded`：未配置向量模型，仅全文检索。所有展示检索结果的地方都要露出，并给「去配置」入口。

### 3.3 三个动作

| 动作 | 经过模型 | 入口 | 输出 |
|---|---|---|---|
| 提问 | 是 | 对话中挂载知识库 | 带引用的回答 |
| 查找 | 否 | 知识库详情页 | 原文片段，每条可：打开原文 / 带到对话 / 用这段出卡 |
| 出卡 | 是 | 知识库详情页；闪卡页「出卡」 | 闪卡 |

「查找」和「提问」是两种需求（找原文 vs 要答案），都保留。

## 4. 信息架构（桌面）

- **一级页面「知识库」**：复用路由 `{ kind: 'knowledge' }`，取消 deprecated，不再重定向到闪卡。
  - 列表：「笔记」置顶，其后文件夹知识库。卡片显示名称、文件数 / 笔记数、切片数、上次入库时间、状态、`degraded` 标记。页头「添加文件夹」。
  - 详情：概览（状态 + 当前主动作）/ 内容（文件勾选，或笔记列表与编辑）/ 查找。头部动作：在对话中使用、出闪卡、重新入库、移除。
  - 空状态按 §3.2 状态分别给文案和下一步，不出现「还没有检索结果」这类未搜先报空的文案。
- **闪卡页**：删除「Wiki」按钮；「出卡」第一步改为选择知识库（默认最近使用），不再自行维护文件夹列表。
- **右栏 `NotesPanel`**：笔记浏览与编辑并入「知识库 → 笔记」详情页，右栏移除 Notes tab。
- **对话**：输入框上方显示已挂载知识库标签；+ 菜单「使用知识库」；输入框 `@` 可提及知识库。
- **斜杠命令**：`/knowledge` 打开知识库页；`/wiki` 作为别名保留一个版本，同样打开知识库页。
- **设置**：「知识库」一节承载 embedding / parser / reranker / LLM，收敛 `notes.embedding` 与 `KnowledgeConfig.embedding` 两份配置（实现前核对设置页现状）。

## 5. 对话问答

### 5.1 挂载

- 会话级 `knowledgeBaseIds: string[]`，Host 持久化在会话元数据中，所有客户端可见。
- **已挂载**：host-runtime 为该会话追加一段系统提示——列出挂载的知识库名称；涉及这些库的问题先检索；结论必须引用；检索不到时明确说明「知识库中未找到」，不以模型常识冒充。
- **未挂载**：`knowledge_search` 仍可用，范围为全部 `ready` 知识库，由 Agent 判断是否调用。

### 5.2 Agent 工具

| 工具 | 权限 | 说明 |
|---|---|---|
| `knowledge_list` | allow | 列出知识库 id、名称、状态、是否挂载到当前会话 |
| `knowledge_search` | allow | `query`, `baseIds?`, `limit?` → 编号引用条目 |
| `knowledge_read` | allow | 按引用读取更大上下文：folder 为行 / 页范围（限定在库根内），notes 为整篇 |
| `note_write` / `note_update` / `note_delete` | 沿用（ask） | 只作用于 `notes` 知识库 |

- 注册 `knowledge_*` 时**不再注册** `note_search` / `note_list` / `note_read`，保证只有一个检索工具。
- 返回给模型的文本：每条带编号 `[1]`、知识库名、标题或路径、位置、片段；工具描述沿用 `note_search` 现有的 grounding 规则。
- 返回给 UI 的结构化部分：`KnowledgeCitation[]`（§6），UI 不解析文本。

### 5.3 引用渲染

- 助手回答中的 `[n]` 与同一回合 `knowledge_search` / `knowledge_read` 结果中的编号匹配，渲染为可点击角标；悬停显示片段与来源。
- 点击 → `knowledge/open-source`：folder 打开文件并定位到行 / 页；notes 打开知识库页中的该笔记。
- 匹配不到的 `[n]` 按原文显示，不伪造链接。

## 6. 契约（contracts first）

新文件 `packages/contracts/src/knowledge-base.ts`：

```ts
export type KnowledgeBaseKind = 'notes' | 'folder';

export type KnowledgeBaseState =
  | 'empty'
  | 'missing'
  | 'not-indexed'
  | 'indexing'
  | 'ready'
  | 'partial';

export type KnowledgeBaseSummary = {
  id: string;
  kind: KnowledgeBaseKind;
  name: string;
  folderPath?: string;
  state: KnowledgeBaseState;
  degraded: boolean;
  documentCount: number;
  chunkCount?: number;
  lastIndexedAt?: string;
  lastUsedAt?: string;
};

export type KnowledgeCitation = {
  baseId: string;
  kind: KnowledgeBaseKind;
  /** Note title, or the folder-relative path. */
  title: string;
  noteId?: string;
  relativePath?: string;
  headingPath?: string[];
  startLine?: number;
  endLine?: number;
  pageStart?: number;
  pageEnd?: number;
  text: string;
  score?: number;
};
```

HostCommand：

| 命令 | 参数 | 返回 |
|---|---|---|
| `knowledge/bases/list` | — | `KnowledgeBaseSummary[]` |
| `knowledge/bases/add` | `folderPath`, `name?` | `KnowledgeBaseSummary`（幂等） |
| `knowledge/bases/rename` | `baseId`, `name` | `KnowledgeBaseSummary` |
| `knowledge/bases/remove` | `baseId`, `deleteIndex` | — |
| `knowledge/search` | `query`, `baseIds?`, `limit?` | `{ citations, degradedBaseIds }` |
| `knowledge/open-source` | `citation` | 同 `doccards/open-source` |
| `sessions/knowledge/set` | `sessionId`, `baseIds` | — |

HostPush：`knowledge/bases-changed`（登记或状态变化时推送全量列表）。

现有 `doccards/*`、`notes/*` 保留；入库与出卡仍按 `folderPath`，P2 起可接受 `baseId`。

## 7. Host 实现要点

- **登记表**：`~/.piwin/knowledge/bases.json`，只存 `name`、`folderPath`、`createdAt`、`lastUsedAt`。状态不落盘，列表时由 doc-rag state-store 与入库任务实时计算。
- **检索分发**：host-runtime 新增 `knowledge-retriever`，按 kind 调 `searchNotes` 或 `rag.retrievePack`；多库时每库取 top-k 后 RRF 合并，再按总字数上限截断。纯合并逻辑独立成纯函数并单测。
- **工具**：`knowledge-tools.ts`，与 `notes-tools.ts` 同层注册；`knowledge_read` 的路径限制复用 doc-rag `isPathConfined`。
- **系统提示**：挂载说明由 host-runtime 拼装，经 host-runtime → agent-host 的现有提示扩展点注入；若没有合适端口，先在 contracts 定义，不在 apps 拼装。
- **恢复登记**：Host 启动时扫描 `~/.piwin/doc-rag/*/.source-path`，补登记未登记的文件夹（路径不存在则为 `missing`）。幂等。

## 8. 迁移与兼容

| 旧 | 新 |
|---|---|
| localStorage `piwin.doccards.recent_folders` | 桌面首启逐个调用 `knowledge/bases/add`（幂等），成功后删除该 key |
| 路由 `{ kind: 'flashcards', entry: 'wiki' }` | `{ kind: 'knowledge' }` |
| `/wiki`、`/knowledge` | 打开知识库页 |
| 右栏 Notes tab | 知识库 → 笔记 |
| `note_search` / `note_list` / `note_read` | `knowledge_search` / `knowledge_list` / `knowledge_read` |
| `KnowledgeWikiView` | 删除，查找并入知识库详情页 |
| `notes.embedding` + `knowledge.embedding` | 读取顺序 `knowledge.embedding` → `notes.embedding`；写入只写 `knowledge` |

远端旧 Host 不支持 `knowledge/*` 时，客户端沿用现有 `host-too-old` 处理，回退到闪卡与笔记的旧入口。

## 9. CLI（parity）

- `piwin kb list`
- `piwin kb add <folder> [--name n]`
- `piwin kb remove <id> [--delete-index]`
- `piwin kb search <query> [--kb id ...] [--limit n]`
- 会话挂载入口与现有 CLI 会话命令对齐，实现时确定。
- `piwin notes`、`piwin doccards` 保留。

## 10. 分期

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0 Host 基础** | contracts；登记表与恢复登记；`knowledge/bases/*`、`knowledge/search`；`knowledge_*` 工具；`piwin kb` | CLI 添加文件夹并入库后，桌面对话中 Agent 能检索该库并以编号引用作答 |
| **P1 对话体验** | 会话挂载 + 系统提示；输入框标签 / + 菜单 / `@`；引用角标与打开原文；隐藏闪卡页 Wiki 按钮 | 挂载 → 提问 → 点引用定位到原文行 |
| **P2 知识库页** | 列表 / 详情 / 分状态空态 / 查找（结果三动作）；出卡改为选知识库；`NotesPanel` 并入；路由与斜杠迁移；删除 `KnowledgeWikiView` | 从零添加文件夹到出卡、提问全程不经过闪卡页 |
| **P3 方向** | 过期检测（state-store 记录 mtime，列表时比对）；引擎收敛（笔记目录作为 folder 库经 doc-rag 入库，退役 notes 索引，召回评测迁到 doc-rag）；移动端挂载 | 单独立项 |

## 11. 测试

| 变更 | 测试 |
|---|---|
| contracts | 所有实现方 typecheck 通过 |
| 登记表、恢复登记、多库 RRF 合并 | 单元测试 |
| `knowledge_search` 文本格式与编号 | golden |
| `knowledge_read` 路径越界 | allow / block golden cases |
| 挂载 → 提问 → 点引用 | 桌面 e2e（关键路径） |

## 12. 待定

1. 未挂载时 Agent 是否检索全部知识库。本稿：是。
2. 笔记 collection 是否单独成库。本稿：否。
3. 右栏是否保留轻量「速记」入口。本稿：移除。

## 附录 A：现有 Wiki 页问题（P2 删除前记录）

- `FlashcardsWorkspaceView` 传 `notes={[]}`，文章分支永不执行，页面只有空态或检索结果。
- 未搜索时即显示「这个文件夹还没有检索结果」；不显示检索范围，名称回退「工作区」。
- `doccards/retrieve` 对未入库文件夹返回空列表，与「无匹配」同一文案；两个路径都为空时传 `''`，Host 报 `folderPath is required`。
- 空状态下复制无反应，导出下载仅含 `# 工作区 Wiki` 的文件。
- 占位符暴露「RAG 混合检索」且承诺「提问」，但只返回片段；`onSendToChat`、`onOpenSourceFile` 未接线。

## 附录 B：本期遗留（不阻塞主流程）

1. **右栏 `NotesPanel` 尚未并入知识库页。** 笔记浏览与编辑仍走右栏；知识库详情页的笔记 tab 还不是完整编辑器。P2 验收里的「`NotesPanel` 并入」下次单独做。
2. **新会话第一条消息的挂载时序。** Host `session/set-knowledge-bases` 已持久化；桌面在「新建会话后立刻发送」时，挂载写入可能晚于第一轮 prompt。后续消息会带上挂载。修好后再删这条。
