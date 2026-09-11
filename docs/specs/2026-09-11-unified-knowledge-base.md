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

- 云同步、多人共享知识库。
- 除笔记之外，文件监听实时入库（用户添加的文档文件夹仍是手动重新入库）。
- 网页 / URL 等新知识源。

引擎收敛（笔记并入 doc-rag，见 §5.4）**不再是非目标**——2026-09-11 拍板收敛，是本期主线的一部分，不再推迟到 P3。

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
| `knowledge_read` | allow | 按引用读取更大上下文：行 / 页范围，限定在库根内（notes 与 folder 走同一实现，见 §5.4） |
| `note_write` / `note_update` / `note_delete` | 沿用（ask） | 只作用于 `notes` 知识库 |

- 注册 `knowledge_*` 时**不再注册** `note_search` / `note_read`——检索、按引用读取都被 `knowledge_search` / `knowledge_read` 取代。**`note_list` 保留**：它是「枚举我有哪些笔记」（按 id/title/collection/tags 列全部，不排序），`knowledge_list` 是「列有哪些知识库」（一行一个库），两者不是同一件事，`knowledge_list` 顶替不了 `note_list`。
- 返回给模型的文本：每条带编号 `[1]`、知识库名、标题或路径、位置、片段；工具描述沿用 `note_search` 现有的 grounding 规则。
- 返回给 UI 的结构化部分：`KnowledgeCitation[]`（§6），UI 不解析文本。

### 5.3 引用渲染

- 助手回答中的 `[n]` 与同一回合 `knowledge_search` / `knowledge_read` 结果中的编号匹配，渲染为可点击角标；悬停显示片段与来源。
- 点击 → `knowledge/open-source`：底层都是「打开文件、定位到行」，folder 打开源文件；notes 走同一坐标但目的地是知识库页里的笔记编辑视图，不是裸文件——检索引擎统一不代表 UI 呈现统一，笔记该有的编辑体验不因为底层换了引擎而变成纯文本查看器。
- 匹配不到的 `[n]` 按原文显示，不伪造链接。

### 5.4 引擎收敛：笔记 = 内置的 doc-rag 文件夹（2026-09-11 拍板，本期主线）

**背景**：笔记（`@piwin/notes`）目前是第二套独立的检索引擎——`node:sqlite` 的 FTS5 + 向量，整篇笔记是一个检索单元，落盘是 `~/.piwin/notes/<collection>/<id>.md`。它和 doc-rag 除了都叫"知识库"之外没有共享任何代码，后果是：**笔记出不了闪卡**（`doccards/generate` 现在只认 `folderPath`，笔记没有），检索质量、切块粒度、citation 精度两套引擎各自为政，配置也是两份（`config.notes.embedding` vs `config.knowledge.embedding`）。这不是可以无限期推迟的技术债，是一个真实的产品能力缺口。

**目标模型**：笔记本来就是落盘的 markdown 文件，直接把 `~/.piwin/notes` 当成一个**内置、不可删除**的 doc-rag 文件夹，检索、出卡、对话 RAG 全部只有一条路径。写入还是走 `note_write` / `note_update` / `note_delete`，笔记编辑体验完全不变；变的只是索引这一层。

- **ID 与生命周期不变**：`NOTES_KNOWLEDGE_BASE_ID = 'notes'` 这个外部 ID 保持稳定（citation、会话挂载、UI 图标都在用），内部固定映射到 `folderPath: ~/.piwin/notes`。`removeKnowledgeBase` / `renameKnowledgeBase` 继续按 `kind === 'notes'` 拒绝，只是判断条件从"是 notes 分支"改成"folderPath 等于笔记根目录"。
- **出卡天然打通**：`doccards/generate` 不用改——笔记这时候就是个有 `folderPath` 的知识库，出卡页面的「出闪卡」按钮（现在的判断条件就是 `folderPath` 是否存在）不用改判断逻辑就会对笔记生效。

以下六点是 2026-09-11 方向评审后补的，实施前必须先定这些机制，不是留到写代码时随手决定。

#### 5.4.1 写入一致性与失败语义

现在 `ingestSelectedFiles`（`packages/doc-rag/src/indexing/ingestion-service.ts`）单文件处理顺序是：解析 → 切块 → **删除旧切片** → 生成 embedding → 写新切片 → 标记 READY。embedding 这一步失败会被内部 catch 住，标记 `status: FAILED` 返回，**不抛异常**；但旧切片在 embedding 之前就已经被删了，所以失败后这份文档在向量库里是空的——不是"还是旧内容"，是"什么都搜不到了"。这条链路上任何一个环节失败都不会传导成异常，光加一句 `await ingestFile()` 看不出问题。

这是 doc-rag 层的既有 bug，不是笔记专属，任何文件夹重新入库遇到 embedding 服务抖动都会中招，本期顺带修：

- **改顺序**：把"删旧切片 + 写新切片"挪到 embedding 成功之后，作为紧邻的最后一步再执行。解析/切块/embedding 任一环节失败，旧切片原样保留，`state` 仍标记 `FAILED`（哪怕物理内容还在，也不宣称成功，逼用户/系统重试，但不再重试失败前不删旧数据）。
- **失败语义**：`ingestFile(folderPath, relativePath)` 返回 `IngestFileResult`（`status: 'READY' | 'FAILED'`），调用方必须显式检查 `status`，`await` 本身不代表成功。
- **笔记写入的对外语义**：文件写入成功与索引成功分开汇报——`note_write` / `note_update` 只要文件落盘就返回成功（不能因为 embedding 服务抖动就让记笔记这个动作失败），但响应里带 `indexed: boolean`、失败时带 `indexError`。
- **安全重试免费拿**：`state-store` 的 SKIP 判断本来就要求 `status === 'READY'` 且 hash 匹配才跳过；`FAILED` 的文档在下一次扫描时天然会被重新尝试，不需要单独的重试队列——直接复用 §5.4.4 的漂移检测扫描当重试驱动。
- **并发协调**：`folder-rag.ts` 已有的 `indexLocks`（现在只在整文件夹 `indexFolder` job 里用）扩到 `ingestFile` / `forgetFile` 也走同一把按 canonical 路径的锁，避免后台整文件夹重扫和单文件同步入库互相踩。

#### 5.4.2 标签必须是检索前的候选过滤，不是结果后过滤

`knowledge-retriever.ts` 里 `baseIds` 的真实语义是**先圈定要查哪些库**（`searchKnowledgeBases` 的 `requested` 列表），再对圈定范围做检索、排序、按 `limit` 截断——不是"查完所有库、按 baseId 挑几条塞进结果"。标签要照抄这个语义，而不是原稿写的"和 baseIds 一样是结果后过滤"（这句话本身就说错了 baseIds 的实现）。如果真做成结果后过滤：RRF 排出前 10 条都不带目标标签、第 11 条带，结果就是错误地返回空，即使确实存在匹配。

正确做法：请求带 `tags` 时，先在目标文件夹的 `state.list()`（内存扫描，不查 LanceDB）里筛出 `metadata.tags` 命中的 `relativePath` 集合，作为 `fileAllowlist` 传进 `rag.retrievePack`——这个字段 `RetrieveOptions.fileAllowlist` 已经存在，不用新增检索层能力。排序、`limit` 截断都发生在这个候选集内部，标签本身不参与相关性打分，只圈定候选范围，这一点和原稿的出发点一致，错的只是"何时过滤"。

#### 5.4.3 检索复用、citation 塑形不复用：notes 需要一层适配

检索调用（`rag.retrievePack`）本身对 notes 和 folder 是同一条路径，这个不变。但 `mapContextPackSourceToCitation`（`knowledge-retriever.ts`）现在硬编码 `kind: 'folder'`、`title: source.relativePath`、不带 `noteId`——如果笔记检索结果不做任何处理直接塞出去，`knowledge/open-source` 里判断"这是不是笔记"要靠 `citation.noteId`，取不到会直接报错，UI 上笔记标题也会显示成 `default/01abc.md` 这种文件名而不是真实标题。这不是可以跳过的一步。

- 新增 `mapContextPackSourceToNotesCitation`，和 `mapContextPackSourceToCitation` 平级，在 `base.kind === 'notes'` 时用它：`kind` 设为 `'notes'`；`noteId` 直接从 `relativePath` 派生（笔记文件名就是 `${id}.md`，去掉扩展名、去掉 collection 前缀即是 id，不需要额外查笔记库）；`title` 取自 frontmatter 解出的 `metadata.title`，取不到时兜底用 `relativePath`（不崩，只是显示退化）。
- **行号偏移**：markdown 解析器剥离 frontmatter 块之后，切块算出的行号如果是"正文里第几行"，和原始文件的行号会差一个 frontmatter 的行数。约定：解析器剥离 frontmatter 用于 embedding，但计算 `startLine`/`endLine` 时加回 frontmatter 占用的行数，citation 里的行号**永远是原始文件里的行号**——这对所有带 frontmatter 的 markdown 都成立，不是笔记专属规则，folder 和 notes 的 citation 行号语义保持一致。笔记编辑器如果展示的是"去掉 frontmatter 的正文视图"，需要自己再减掉这个偏移量去定位——这是编辑器 UI 层的事，不进 citation 契约。

#### 5.4.4 旧笔记回填 + 外部改动漂移检测

现在 `searchNotes()`（`packages/notes/src/search-notes.ts`）每次检索前都会 `await index.reconcile()`，这是笔记"写完/改完/被外部编辑器改了都能搜到"的唯一机制。只接管 `note_write/update/delete` 三个工具，不管这层，会丢两件事：已经存在的旧笔记永远不会进新索引；用户拿文本编辑器直接改 `.md` 文件也不会被发现。

- **首次回填**：升级后 Host 第一次启动时，把 `~/.piwin/notes` 当成一个普通文件夹跑一次现有的 `indexFolder` 全量入库（复用已有机制，不是新代码），加个一次性版本标记避免重复跑。
- **持续漂移检测**：在 `knowledge_search` / `knowledge/search` 命中 notes 库之前，对笔记根目录跑一次 `scanFolder` + `ingestSelectedFiles`（覆盖当前全部文件列表）。`ingestSelectedFiles` 本来就会按 `fileHash`/`configHash` 跳过没变的文件，这一步开销和原来 FTS5 的 `reconcile()` 是同一量级，不是新增的重活。触发时机和旧机制完全对齐（检索前兜底一次），同时这一步也是 §5.4.1 里 FAILED 文档的天然重试点，两个问题一套机制解决。

#### 5.4.5 登记恢复要认"主动移除"和"这是笔记根目录"

`recoverKnowledgeBaseRegistry`（`knowledge-base-registry.ts`）现在纯粹是"磁盘上有 `.source-path` 但登记表里没有就补上"，完全不知道"这个曾经被用户主动移除过"，也不知道"这个路径是笔记根目录，不该被当成普通文件夹登记"。而且它在**每次** `listKnowledgeBaseSummaries` 调用时都会跑一遍——不是重启才触发。两个后果都是真的会出事，不是边界情况：

1. 用户"移除、保留索引"之后，紧接着下一次打开知识库页（触发一次 `list`）它就被摆回来了，UI 上的"移除"操作等于没做。
2. 笔记接入 doc-rag 之后也会在 `~/.piwin/doc-rag/<key>/` 下留 `.source-path`，恢复逻辑如果不认笔记根目录，会把笔记当成第二个、可删可改名的普通 folder 库注册进 `bases.json`——两个条目指向同一个物理目录、共享同一个 `folderKey`。这时候如果用户对着那个"误加的重复项"点了删索引，会连带删掉笔记自己在用的 LanceDB 缓存。这条必须在实施前堵死，不是可以后补的细节。

- **排除笔记根目录**：恢复扫描时，`folderKey(sidecar.folderPath) === folderKey(canonical(getNotesRoot()))` 的一律跳过，永远不登记成普通 folder。
- **墓碑记录主动移除**：注册表文档加一个 `removed: Array<{ folderKey, removedAt }>`（或独立的兄弟文件）。`removeKnowledgeBase(deleteIndex: false)` 除了从 `folders` 数组摘掉，还要写一条墓碑；恢复扫描时跳过任何墓碑里存在的 `folderKey`。`addFolderKnowledgeBase` 显式重新添加同一路径时，清掉对应墓碑——这样"移除、保留索引"之后用户手动重新添加，还是能找到旧索引，UI 上「移除，保留索引」这句承诺才是真的。

#### 5.4.6 写入编排收敛到一个入口

方案原先的写法是 `commands/knowledge-commands.ts` 的 `notes/write|update|delete` 命令处理器、和 `notes-tools.ts` 的 `note_write/update/delete` 工具执行器，各自拿着 `NoteStore` 和 `FolderRag` 两个依赖顺序调用——失败处理、加锁、失败通知这几件事要在两个地方各写一遍，不符合"先复用"（AGENTS.md §3.2）。新增 `packages/host-runtime/src/notes-write-service.ts`，暴露 `writeNoteAndReindex` / `updateNoteAndReindex` / `deleteNoteAndReindex` 三个函数，内部完成"写文件 → 调 `ingestFile`/`forgetFile` → 按 §5.4.1 的语义整理返回结果"这一整套；命令处理器和工具执行器都只调用这一个服务，不各自实现编排。

#### 其余不变的点

- **包边界**：`@piwin/notes` 不导入 `@piwin/doc-rag`（同级 application 包，谁都不依赖谁，AGENTS.md §2）。`note-store.ts` 保持纯文件读写；"写文件 → 触发入库"的编排在 host-runtime（见 5.4.6），不在 notes 包内。
- **doc-rag 只读用户文件夹这条不变量不破**：doc-rag 本身仍然不写入笔记文件夹，只写自己在 `~/.piwin/doc-rag/<key>/` 下的缓存。所有笔记文件的写入还是走 `note-store.ts`。
- **标签保留，不砍**：doc-rag 的 markdown 解析器目前完全不处理 frontmatter，会把 `---\ntags: [...]\n---` 原样当正文嵌入。本期加 frontmatter 识别，剥离出正文之外，作为 `metadata: Record<string, unknown>` 挂在 `DocumentManifest` / `ContextPackSource` 上（通用能力，任何带 frontmatter 的 markdown 都受益，不是笔记专属）。过滤语义见 §5.4.2。
- **collection 不用额外做**：笔记本来就按 `<collection>/<id>.md` 存成子目录，天然是 `relativePath` 前缀。
- **乐观并发冲突**：`note_update` 的 `expectedContentHash` 检查（`NoteRevisionConflictError`）留在 `note-store.ts`，比对文件内容 hash，跟 doc-rag 索引状态无关，不用动。
- **召回评测**：`piwin notes eval` 的 golden 问题集迁移到对 doc-rag 检索跑，退役 `recall-eval.ts` / `note-index.ts`（FTS5+向量）/ `search-notes.ts` / `hybrid-search.ts` 里 notes 专属部分——真删，不是标记废弃（AGENTS.md「不留临时方案变永久」）。
- **配置收敛**：`config.notes.embedding` 读取顺序「`config.knowledge.embedding` → 回退 `config.notes.embedding`」（见 §7），新写入只写 `config.knowledge.embedding`。

**涉及的包（供实现时对照，不是详细设计）**：

| 包 | 改动 |
|---|---|
| `@piwin/doc-rag` | `ingestion-service.ts` 改写入顺序（§5.4.1）；`folder-rag.ts` 新增 `ingestFile`/`forgetFile`（复用 `indexLocks`）；`state-store.ts` 加按 `documentId` 删单行；`markdown-parser.ts` 加 frontmatter 剥离 + 行号偏移（§5.4.3）+ 元数据；`doc-rag-v2.ts` 契约加 `metadata?`；`RetrieveOptions.fileAllowlist` 复用不改 |
| `@piwin/notes` | 不改 IO 逻辑本身；删除 `note-index.ts`、`search-notes.ts`、`recall-eval.ts`、`hybrid-search.ts` 里 notes 专属部分 |
| `@piwin/host-runtime` | 新增 `notes-write-service.ts`（§5.4.6）；`knowledge-base-service.ts` 删 `summarizeNotesBase`；`knowledge-retriever.ts` 删 `searchNotesBase`/`mapNoteHitToCitation`，加 `mapContextPackSourceToNotesCitation` 与 `tags` 预过滤；`knowledge-base-registry.ts` 加墓碑与笔记根目录排除（§5.4.5）；`knowledge-commands.ts`/`notes-tools.ts` 改走 `notes-write-service`；首次回填任务 |
| 桌面端 | 「出闪卡」按钮判断条件不用改；新会话首条消息挂载竞态需要单独修，见 §7 |

**验收**：对着笔记写一句话，Agent 下一句就能通过 `knowledge_search` 检索到（无论是否刚发生过一次 embedding 失败重试）；对笔记知识库点「出闪卡」能正常出卡；按 tag 过滤能返回真实命中，不因为排在候选靠后而丢；点笔记 citation 能跳进笔记编辑器且行号对；一个从来没被应用碰过的老笔记，升级后一样能被搜到；移除一个保留索引的文件夹，打开知识库页不会看到它复活；笔记不会在知识库列表里出现第二次；`note-index.ts` 等旧引擎代码从仓库里消失，不是被绕过。

## 6. 契约（contracts first）

`KnowledgeBaseKind` / `KnowledgeBaseState` / `KnowledgeBaseSummary` / `KnowledgeCitation`（含 `ref`）/ `KnowledgeSearchResult`（含 `skipped`）/ `KnowledgeBaseHostCommand`（`knowledge/bases/list|add|rename|remove`、`knowledge/search`、`knowledge/open-source`、`session/set-knowledge-bases`）/ `KnowledgeBasesChangedPush` 已随 P0 落地，见 `packages/contracts/src/knowledge-base.ts`，本节不再重复贴一份可能漂移的副本。以下是本轮新增的增量：

- `KnowledgeCitation` 加 `metadata?: Record<string, unknown>`（frontmatter 解出的原始字段，笔记至少含 `tags`/`title`；非 markdown 或无 frontmatter 的来源不带这个字段）。
- `KnowledgeBaseHostCommand` 里 `knowledge/search` 的载荷加 `tags?: string[]`，语义见 §5.4.2（检索前候选过滤，不是结果后过滤）。
- `packages/contracts/src/doc-rag-v2.ts` 的 `DocumentManifest` / `ContextPackSource` 加 `metadata?: Record<string, unknown>`（doc-rag 通用能力，见 §5.4.3）。
- `CreateSessionOptions`（`packages/contracts/src/session-seed.ts` 或其所在文件）加 `knowledgeBaseIds?: string[]`，随 `session/create` 一并落地，用来堵新会话首条消息挂载竞态——见 §7。
- `KnowledgeBaseRegistryDocument`（`packages/host-runtime/src/knowledge-base-registry.ts`，Host 内部结构，不出契约）加 `removed: Array<{ folderKey: string; removedAt: string }>` 墓碑，见 §5.4.5。

## 7. Host 实现要点

- **登记表**：`~/.piwin/knowledge/bases.json`，存 `name`、`folderPath`、`createdAt`、`lastUsedAt`，加 `removed` 墓碑（§5.4.5）。状态不落盘，列表时由 doc-rag state-store 与入库任务实时计算。
- **检索**：`knowledge-retriever.ts`，notes 和 folder 统一走 `rag.retrievePack`（不再有 `searchNotes` 分支），citation 塑形按 `base.kind` 分派（§5.4.3）；多库 top-k 后 RRF 合并，按总字数上限截断；`tags` 在合并前作为 `fileAllowlist` 预过滤（§5.4.2）。合并逻辑是纯函数，单测覆盖。
- **工具**：`knowledge-tools.ts`，与 `notes-tools.ts` 同层注册（`note_list` 保留，见 §5.2）；`knowledge_read` 的路径限制复用 doc-rag `isPathConfined`。
- **系统提示**：挂载说明由 host-runtime 拼装，经 host-runtime → agent-host 的现有提示扩展点注入；若没有合适端口，先在 contracts 定义，不在 apps 拼装。
- **恢复登记**：Host 启动、以及每次 `knowledge/bases/list` 调用时都会跑一次——不是只在重启时。扫描 `~/.piwin/doc-rag/*/.source-path`，跳过笔记根目录、跳过墓碑里的 `folderKey`，其余未登记的文件夹补登记（路径不存在则为 `missing`）。幂等。
- **笔记写入编排**：统一走 `notes-write-service.ts`（§5.4.6），不在命令处理器和工具执行器里各写一份。
- **新会话首条消息挂载竞态**：不再靠"先建会话、再发一条 `session/set-knowledge-bases`"这种时序修补。`session/create`（`CreateSessionOptions.knowledgeBaseIds`）直接带上挂载，跟首条 prompt 走同一次调用，从根上让第一轮编译系统提示时挂载已经落好，不存在"这一轮没生效、下一轮才生效"的窗口。桌面端草稿会话的挂载选择器直接把待挂载的 id 塞进建会话调用，不再单独发一次 `session/set-knowledge-bases`。已建会话中途改挂载，仍旧调 `session/set-knowledge-bases`。

## 8. 迁移与兼容

| 旧 | 新 |
|---|---|
| localStorage `piwin.doccards.recent_folders` | 桌面首启逐个调用 `knowledge/bases/add`（幂等），成功后删除该 key |
| 路由 `{ kind: 'flashcards', entry: 'wiki' }` | `{ kind: 'knowledge' }` |
| `/wiki`、`/knowledge` | 打开知识库页 |
| 右栏 Notes tab | 知识库 → 笔记 |
| `note_search` / `note_read` | `knowledge_search` / `knowledge_read`（`note_list` 保留不变，见 §5.2） |
| `KnowledgeWikiView` | 删除，查找并入知识库详情页 |
| `notes.embedding` + `knowledge.embedding` | 读取顺序 `knowledge.embedding` → `notes.embedding`；写入只写 `knowledge` |

远端旧 Host 不支持 `knowledge/*` 时，客户端沿用现有 `host-too-old` 处理，回退到闪卡与笔记的旧入口。

## 9. CLI（parity）

- `piwin kb list` / `add <folder> [--name n]` / `remove <id> [--delete-index]` / `search <query> [--kb id ...] [--limit n] [--tags t1,t2]` —— `search` 补上 `--tags`，语义同 §5.4.2。
- 会话挂载入口与现有 CLI 会话命令对齐，实现时确定；新建会话时支持一并传 `knowledgeBaseIds`（见 §7 的竞态修法，CLI 侧同样受益）。
- `piwin notes` 保留，逐项换底层实现，不是整体标"保留"就算数：
  - `add` / `list` / `show` / `delete` —— 落盘/读取逻辑不变（还是 `NoteStore`），`delete` 额外触发 `forgetFile`（走 `notes-write-service`）。
  - `search` —— 从直接调 `searchNotes()` 改成调 `knowledge/search`（`baseIds: ['notes']`），退化行为（无 embedding 时降级全文检索）不变。
  - `reindex` —— 从重建 `NoteIndex` 改成对笔记根目录跑一次 §5.4.4 的回填/漂移检测扫描。
  - `eval` —— 召回评测跑在 doc-rag 检索上，见 §5.4「召回评测」。
- `piwin doccards` 保留，不受影响。

## 10. 分期

| 阶段 | 内容 | 验收 | 状态 |
|---|---|---|---|
| **P0 Host 基础** | contracts；登记表与恢复登记；`knowledge/bases/*`、`knowledge/search`；`knowledge_*` 工具；`piwin kb` | CLI 添加文件夹并入库后，桌面对话中 Agent 能检索该库并以编号引用作答 | 已合并 main（`3a4cd874`） |
| **P1 对话体验** | 会话挂载 + 系统提示；输入框标签 / + 菜单 / `@`；引用角标与打开原文；隐藏闪卡页 Wiki 按钮 | 挂载 → 提问 → 点引用定位到原文行 | 已合并 main |
| **P2 知识库页** | 列表 / 详情 / 分状态空态 / 查找（结果三动作）；出卡改为选知识库；路由与斜杠迁移；删除 `KnowledgeWikiView` | 从零添加文件夹到出卡、提问全程不经过闪卡页 | 已合并 main（`NotesPanel` 并入未做，见附录 B） |
| **P2.5 引擎收敛** | 笔记并入 doc-rag：入库顺序修正 + 并发锁（§5.4.1）；tags 预过滤（§5.4.2）；notes citation 适配 + 行号偏移（§5.4.3）；回填 + 漂移检测（§5.4.4）；登记恢复墓碑 + 笔记根目录排除（§5.4.5）；写入编排收敛（§5.4.6）；新会话挂载竞态（§7）；退役 notes 自有索引 | 见 §5.4 验收 | 2026-09-11 方向评审通过，待实现（方向确认，落地设计见 §5.4.1–5.4.6，不是「以后再细化」） |
| **P3 方向** | 过期检测（state-store 记录 mtime，列表时比对）；移动端挂载 | 单独立项 | 未开始 |

## 11. 测试

| 变更 | 测试 |
|---|---|
| contracts | 所有实现方 typecheck 通过 |
| 登记表、恢复登记、多库 RRF 合并 | 单元测试 |
| `knowledge_search` 文本格式与编号 | golden |
| `knowledge_read` 路径越界 | allow / block golden cases |
| 挂载 → 提问 → 点引用 | 桌面 e2e（关键路径） |
| `ingestSelectedFiles` 在 embedding 失败时保留旧切片（§5.4.1） | 单元测试：mock embedding 抛错，断言旧 chunk 还在、状态 FAILED |
| `ingestFile`/`forgetFile` 与整文件夹 `indexFolder` 并发不互相踩（§5.4.1） | 并发单元测试，复用 `indexLocks` |
| tags 过滤命中排在候选靠后的文档也不丢（§5.4.2） | 单元测试：构造 top-k 之外才命中标签的场景，断言返回非空 |
| notes citation 的 `kind`/`noteId`/`title`/行号（§5.4.3） | 单元测试：对着已知 frontmatter 的笔记检索，断言字段与行号对原文件 |
| 首次回填、外部改动的笔记下一次检索前能被发现（§5.4.4） | 集成测试：绕过工具直接改文件，断言检索前扫描后能命中 |
| 移除并保留索引后不会在下次 `list` 复活；笔记根目录不会被当成普通文件夹登记（§5.4.5） | 单元测试 |
| 新会话首条消息即可用挂载检索（§7） | 桌面 e2e：新建会话直接带挂载发第一句，断言首轮系统提示已含挂载库名 |

## 12. 待定

1. 未挂载时 Agent 是否检索全部知识库。本稿：是。
2. 右栏是否保留轻量「速记」入口。本稿：移除。

以下三条 2026-09-11 已拍板，不再待定：

- 笔记 collection 是否单独成库——否，collection 是子目录，天然是 `relativePath` 前缀，见 §5.4。
- 笔记引擎是否收敛进 doc-rag——收敛，本期主线，见 §5.4。
- 笔记标签是否保留——保留，走 doc-rag frontmatter 元数据，见 §5.4。
- 笔记写入后索引一致性——同步等入库完成再返回，不接受最终一致，见 §5.4。

## 附录 A：现有 Wiki 页问题（P2 删除前记录）

- `FlashcardsWorkspaceView` 传 `notes={[]}`，文章分支永不执行，页面只有空态或检索结果。
- 未搜索时即显示「这个文件夹还没有检索结果」；不显示检索范围，名称回退「工作区」。
- `doccards/retrieve` 对未入库文件夹返回空列表，与「无匹配」同一文案；两个路径都为空时传 `''`，Host 报 `folderPath is required`。
- 空状态下复制无反应，导出下载仅含 `# 工作区 Wiki` 的文件。
- 占位符暴露「RAG 混合检索」且承诺「提问」，但只返回片段；`onSendToChat`、`onOpenSourceFile` 未接线。

## 附录 B：本期遗留（不阻塞主流程）

1. **右栏 `NotesPanel` 尚未并入知识库页。** 笔记浏览与编辑仍走右栏；知识库详情页的笔记 tab 还不是完整编辑器。P2 验收里的「`NotesPanel` 并入」下次单独做。

（原「新会话第一条消息挂载竞态」已移出本附录，收进 P2.5 范围，见 §7——它是核心路径问题，不适合标不阻塞。）
