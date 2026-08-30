# Spec: 会话内对话树（Conversation Tree）

| Field | Value |
|-------|-------|
| Status | S1 Implemented（2026-08-13）；S2 Stages 1–5 Implemented（2026-08-21，ADR 0055；含 warn-only 写边界）；S3 worktree 升级按钮仍随 SF-06 |
| Date | 2026-08-13 |
| Related | ADR 0009、ADR 0040、ADR 0032、ADR 0019、ADR 0038、**ADR 0055**（产品 store 内树） |
| Supersedes | ADR 0009 残留项 D-M2-01b / D-M2-02-full 的"真 Pi JSONL 多叶树 spike"（以产品 store 内树替代，不接 piSessionFile） |

## 1. 背景与动机

产品转录是线性 SQLite store（ADR 0040 §9）。三个后果：

1. **跨代模型失忆**：fork / 编辑重发 / 冷激活后，新 Pi 会话只拿到 role+text
   的有界文本注入（默认 40 条 / 24k 字符 / 每条 4000 字符），工具调用、工具
   输出、thinking 全部丢失。
2. **编辑重发是破坏性的**：Desktop 编辑消息重发走 `session/truncate-from`，
   物理删除后续所有行，旧的对话线无法找回。
3. **探索污染会话列表**：每试一个方向都要 `session/fork` 出一个新会话。

Pi 0.80.10 已验证的能力（本设计的技术前提）：

- `SessionManager` 原生就是树：entry 带 `parentId`，`branch(branchFromId)`
  移叶指针，旧分支保留；
- `SessionManager.inMemory()` 模式下上述 API 全部可用；
- `appendMessage` 接受完整 `Message` 联合类型
  （`UserMessage | AssistantMessage | ToolResultMessage`），即 thinking
  signature、ToolCall、工具输出都可以重放；
- 切叶时 Pi 有可选的 `branch_summary` 机制：LLM 总结被弃分支并追踪其
  `readFiles` / `modifiedFiles`，挂到导航目标位置。默认关闭，且只看对话内
  记录、不看磁盘真相。

结论：**Pi 端零改动**。树完全活在产品 store；每个 runtime generation 只需
沿"当前活跃路径"重放一条线性序列给 Pi。ADR 0009 担心的"resume Pi JSONL 导致
模型状态错乱"路径不被触碰。

## 2. 用户可见形态

三个交付分片，形态各自独立成立：

- **S1 原生上下文副本**：无新 UI。fork / 编辑重发 / 重启后继续会话，模型
  完整记得此前跑过的工具与输出（"接着刚才的思路"不再失忆）。
- **S2 会话内树**：编辑重发不再删除后续，而是就地分叉；发生过分叉的消息旁
  出现 `‹ n/m ›` 切换器，左右切换同一位置的不同后续；树面板可视化整个会话
  并跳转；会话列表不再因探索而膨胀。
- **S3 工作区写边界**：分叉的是对话、不是代码。当另一条分支改过文件时，
  切换弹确认卡（继续 / 转 worktree fork / 取消）；在"陈旧"分支继续对话时，
  Host 自动向模型注入被弃分支的修改文件清单 + 当前 git 状态摘要。

## 3. 术语与命名（防冲突，AGENTS.md §8）

| 名称 | 含义 | 不得混用 |
|------|------|----------|
| **Conversation Tree** / `TranscriptBranch*` | 本设计：单会话内产品转录树 | — |
| `SessionTreeView` | ADR 0009 保留：Pi 原生 JSONL 树投影（已废弃的 spike 方向） | 不复用该类型名 |
| `SessionOutlineNode[]` | 线性跳转导航 | 含义不变（S2 起 path-scoped） |
| subagent `parentSessionId` | 模型创建的任务子关系 | 与树无关 |
| `ProductSessionOrigin`（fork/duplicate） | 跨会话血统 | 语义不变 |

## 4. S1 — 原生上下文副本

### 4.1 契约（`@piwin/contracts`）

```ts
/** 对产品层不透明的 Pi 原生消息序列化副本；仅 agent-host 编解码。 */
export type NativeContextEntry = {
  format: 'pi-message-v1';
  /** JSON.stringify(Message)。UI/应用包不得解析其内部结构。 */
  payload: string;
  byteLength: number;
  /** payload 超过单条上限被丢弃时置位；重放时该段回落文本模式。 */
  truncated?: boolean;
};

export type SessionSeedMessage = {
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  /** 存在时后端优先按原生消息重放，text 仅作回落。 */
  native?: NativeContextEntry[];
};
```

`SessionSeedMessage` 为加法扩展，现有文本 seed 调用方不受影响。

### 4.2 存储（`@piwin/session`）

一条产品行（assistant 行折叠了 tool cards）对应多条原生消息
（assistant + toolResult 交错），故用独立表而非加列：

```sql
CREATE TABLE IF NOT EXISTS native_entry(
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,            -- transcript_message.id（产品 id）
  ordinal INTEGER NOT NULL,            -- 同一产品行内的原生消息顺序
  payload TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  truncated INTEGER NOT NULL DEFAULT 0,
  UNIQUE(message_id, ordinal)
);
```

- 单条 payload 上限 256 KiB：超限不存 payload，仅存 `truncated=1` 占位行。
- 删除产品行时级联清理（`deleteMessage` / `truncateFrom` 同事务 DELETE）。
- Store 新增 API：
  `appendNativeEntries(messageId, entries)`；
  `readNativeSeed(messageIds, tokenBudget)` — 沿给定消息序列从最新向旧取，
  预算内的段返回 native，预算外与 truncated 段返回 text 回落标记。

> **Implementation note（S1 已落地形态）**：store 层最终 API 为
> `appendNativeEntries(messageId, [{ ordinal, entry }])`（`INSERT OR IGNORE`
> 按 `(message_id, ordinal)` 幂等）+ `readNativeEntries(messageId)`（单行读取）。
> 预算装填与回落判定没有进 store，而是提为 `@piwin/session` 纯函数
> `buildReplaySeedMessages(rows, { maxChars })`（行原子性：任一条 truncated
> 即整行回落 text；预算外旧行丢弃），冷激活组装在 host-runtime
> `cold-activation-seed.ts` 的 `buildColdActivationSeedOptions`。

### 4.3 采集（`@piwin/agent-host` → `@piwin/host-runtime`）

- SDK 与 RPC 两模式在消息终态（assistant 完成、toolResult 完成）时序列化
  原生 `Message` 上行。RPC 走既有 worker→parent 事件通道的新增字段，按
  ADR 0038 约束只随终态事件发送、不随 delta 流发送。
- 事件携带的原生 payload 由 recorder（`store-transcript-recorder`）写入
  `native_entry`，与产品行同一 `(runtimeGenerationId, backendMessageId)`
  溯源键做幂等。

> **Implementation note（S1 已落地形态）**：采集通道实现为规范化内部事件
> `AgentEvent: message/native_context`（agent-host `event-map.ts` 在
> `message_end` 终态构造；SDK 与 RPC worker 共用同一 mapper，天然双模式
> 一致）。toolResult 条目经 `responseMessageId`（映射层的
> lastAssistantMessageId）归属到所属 assistant 产品行，ordinal 递增，幂等
> 落在 `(message_id, ordinal)` 唯一键。该事件在 host-runtime 推送管线内
> 交 recorder 后即截断，绝不进入客户端 egress / 父会话转发 / hook；
> `host-push-policy.ts` 仅保留防御性分类。mock 后端同样镜像发出该事件，
> 使 mock 模式可回归落库与过滤路径。

### 4.4 重放

统一收敛到一个 Host 侧函数 `buildSessionSeed(store, messageIds, budget)`：

- 冷激活首个 prompt：现行 `mergeProductHistoryIntoPrompt` 文本块注入改为
  **优先 native seed**（走 `CreateSessionOptions.seedMessages`，两模式已支
  持），无副本的旧会话自动回落现行文本注入，行为不回退。
- fork / duplicate：`iterateAll` 复制产品行时同步复制 `native_entry`。
- 编辑重发（S2 前仍为 truncate 语义）：重建 shell 后同样走 native seed。
- token 预算：默认取模型 contextWindow 的 50%，从最新向旧装填；预算外的
  旧段合并为一条文本摘要 seed（等价于 Pi compaction 的效果）。

> **Implementation note（S1 已落地形态）**：
> - 重放经 `CreateSessionOptions { seedMessages, seedMode: 'replay' }` 进入
>   `createSeededPiSessionManager`：seed 带 native 时逐条
>   `JSON.parse(payload)` → `appendMessage` 原生重放，任一条解析失败或
>   truncated 则该 seed 整体回落文本；`seedMode: 'replay'` 同时跳过
>   `createSeededPiSettingsManager` 的 `keepRecentTokens: 1` 压缩覆盖
>   （`'compaction'` 缺省值保持 compact 快照 / subagent 延续现行为）。
> - 预算为字符预算 `DEFAULT_REPLAY_SEED_MAX_CHARS = 400_000`（非
>   contextWindow 50% token），预算外旧行**直接丢弃**、不做文本摘要合并
>   （与现行文本注入的有界语义一致；摘要合并留待需要时再引入）。
> - 冷激活在 `doActivateSessionRuntime` 内完成 seed 组装，并以
>   `excludeSeedMessageId` 排除本次 prompt 已先行落库的用户行；
>   `nativeRowCount === 0` 时保持 `coldStartHistoryBySession` 文本注入
>   exactly-once 标记路径。
> - fork/duplicate 复制时 `cloneTranscriptMessage` 重生成行 id，副本按
>   源id→新id 映射复制（`copyNativeEntries`）。

### 4.5 测试

- round-trip fixture：采集→落库→`readNativeSeed`→`createSeededPiSessionManager`
  重放，断言 Pi 侧 context 与原始消息逐字段一致（含 toolResult、thinking
  signature）；
- 截断回落、预算装填边界、双模式 parity（worker 与 SDK 各一条集成用例）；
- fork 后副本随行复制的派生操作集成测试。

> **Implementation note（S1 测试覆盖实况）**：round-trip 以分层单测覆盖
> （mapper 采集 / store 落库级联 / `buildReplaySeedMessages` 预算与回落 /
> seeded manager 原生重放与逐 seed 回落），另有 mock 模式端到端用例覆盖
> "落库但绝不推给客户端"、冷激活重放 vs legacy 文本注入、fork/duplicate
> 副本随行复制。双模式 parity 依赖共享 mapper 与 seed 工厂（worker 侧字段
> 贯通已类型检查），真实 Pi 后端的 RPC 端到端用例与三场景手工冒烟仍待做。

## 5. S2 — 会话内树

### 5.1 数据模型（`transcript.sqlite3` v3）

```sql
ALTER TABLE transcript_message ADD COLUMN parent_message_id TEXT;  -- 自引用
-- transcript_meta 增列
ALTER TABLE transcript_meta ADD COLUMN active_leaf_message_id TEXT;
CREATE INDEX IF NOT EXISTS idx_message_parent
  ON transcript_message(parent_message_id);
```

- **迁移**：打开旧库时一次事务把现有行按 `sequence` 串成线性链，
  `active_leaf` 指向最后一行。与现有 `ALTER TABLE ... ADD COLUMN` 惰性迁移
  模式一致，legacy import 行同样成链。
- **路径 = 权威读取单位**：`WITH RECURSIVE` 自 active leaf 沿 parent 上溯，
  所有有界查询改为 path-scoped：`transcriptPage`、`outlinePage`、
  `userMessageIndex`、`transcriptWindow`、`buildHistoryWindow`、
  `searchMessage`（V1 仅活跃路径）、compaction seed、`readNativeSeed`。
  `sequence` 保留为全局物理追加序，仅用于幂等与树内排序，不再直接充当
  "对话顺序"。
- **revision**：叶切换 bump revision——现有 stale-cursor 机制自动令所有
  分页游标失效，多客户端不会拼接不同路径的窗口。

### 5.2 写语义

- 常规追加：新行 `parent = active_leaf`，随后 leaf 前移（与现状等价）。
- **改写后的编辑重发才分叉**：`PromptInput.branchFromMessageId` 命名被替代的
  **user 消息**（不是 parent）。Host 解析 parent（含根分叉 `NULL`）后 rebase
  再追加。内容未变的重发与失败重试走 `retryUserMessageId`（ADR 0064），
  不新建 user 行。Desktop 不再为日常重试调用 `session/truncate-from`。
  （与早期 §5 草稿的偏差见 ADR 0055 / 0064。）
- `session/truncate-from` 保留为显式破坏性操作（「回到此处」），实现改为
  删除以目标为根的**子树**（含各分支）并级联 `native_entry`。
- 助手「另生成一版」保留旧回答作 assistant 兄弟；失败重试先删掉失败尝试。

### 5.3 命令与推送（contracts / host-server / host-client）

```ts
// 活跃路径上每个分叉点的兄弟信息（有界，供 ‹n/m› 切换器渲染）
type SessionBranchListCommand = {
  type: 'session/branch-list'; sessionId: string;
};
type TranscriptBranchPoint = {
  /** 分叉发生处（共同 parent）的消息 id；null 表示根部分叉。 */
  anchorMessageId: string | null;
  activeIndex: number;
  siblings: Array<{
    headMessageId: string;      // 分支首条消息
    preview: string;            // 首条 user 文本截断
    leafPreview: string;        // 该分支最深叶预览
    messageCount: number;
    writesWorkspace: boolean;   // S3 写标记聚合（子树内是否存在 workspaceWrites）
    updatedAt: string;
  }>;
};

type SessionBranchSwitchCommand = {
  type: 'session/branch-switch';
  sessionId: string;
  /** 目标分支内任意消息 id；leaf 移到该分支最深叶。 */
  targetMessageId: string;
  /** S3：存在 off-path 写操作时必须显式确认。 */
  confirm?: boolean;
};
// 响应：{ status: 'switched', ...tail 页 }
//     | { status: 'needs-confirmation', offPathWrites }   (S3)
//     | { status: 'run-active' }
```

- 新增 `HostPush` 变体 `session/branch-updated { sessionId, activeLeafMessageId, branchPointCount }`
  用于多客户端同步（sibling 详情由客户端按需拉 branch-list）。
- **Run 交互**：会话 `resident-busy` 时拒绝切换（`run-active`）。切换成功即
  走 ADR 0040 suspension 释放当前 runtime generation；下个 prompt 冷激活沿
  新路径做 S1 native seed。不新增任何 runtime 状态机分支。
- pause checkpoint：active checkpoint 若其 `lastAssistantMessageId` 不在新
  活跃路径上，切换时标记 `cleared`。

### 5.4 UI

- **Desktop**：
  - 分叉点消息侧 `‹ n/m ›` 切换器（ui-kit 既有组件组合，不造新原语）；
    切换时走 branch-switch，`needs-confirmation` 弹确认卡（S3）。
  - 树面板（**已落地 2026-08-21，首版=分叉点清单**；**2026-08-27 升到顶栏会话树**）：
    顶栏「会话树」挂 `BranchPointsPanel`。按分叉点分组，每行 = 一条兄弟分支，
    显示首条预览 + 叶预览 + 消息数/时间 + 写标记（`writesWorkspace`），点击
    即走 branch-switch。可视化树仍后置。入口是顶栏「会话树」与消息侧 `‹ n/m ›`。
    - 写标记是**提示不是判据**：由 `listBranchPoints` 在兄弟子树上聚合
      `metadata_json.workspaceWrites` 是否存在；写边界上线前的旧行没有该
      metadata，一律显示为"无写"。切换时的 `needs-confirmation` 检查才是权威。
    - 该面板同时是分叉能力的**唯一前置入口**：`‹ n/m ›` 只在分叉发生后才出现，
      所以空态必须写明「改写某一轮的提问后发送，会在这里留下一个分叉」。
    同文重试与「另生成一版」不再计入 header 徽标（ADR 0064）。
- **CLI**（避免 AGENTS.md"仅 Desktop 实现"反模式）：
  `piwin session branches`（列分叉点与兄弟，写标记降级为行内 `(write)` 后缀）、
  `piwin session switch <messageId>`。树可视化 CLI 降级为缩进列表，记录于
  CLI 文档。

### 5.5 与既有域的关系

- `session/fork` / `session/duplicate`：默认沿**活跃路径**导出/复制（全树
  导出后置）。fork 语义不变，仍是跨会话血统。
- side-chat、subagent、plan、job：全部 correlate 到全局唯一消息 id，不感知
  树；子会话合并卡挂在其发起时所在分支的消息上，天然随路径显隐。
- usage ledger、walkthrough：按消息 id 记账，不受影响。

## 6. S3 — 工作区写边界

定位一句话：**树分叉的是对话时间线，不是工作副本**。边界目标是防止"模型
记忆与磁盘现实脱节"的静默破坏，而非禁止写。

### 6.1 写标记（记录）

- 产品行 metadata 增加
  `workspaceWrites?: { files: string[]; hasUnknownWrites: boolean }`。
- 来源：tool presentation 分类（`collectWorkspaceWrites`，contracts 纯函数）。
  Host 报的 `changedPaths` 优先；其次 filesystem edit 族取目标路径；写型 bash
  命令解析不出目标时置 `hasUnknownWrites`。在 recorder 落库时随 tool card
  终态一并写入，无新采集通道。
- **shell 必须白名单判定，不得"凡 shell 皆写"**：`ls` / `pnpm test` /
  `git status` 若也算写，几乎每轮都会弹确认卡，用户会习惯性点穿，警告随即
  失效。只认可识别的改写命令（`rm`/`mv`/`cp`/`mkdir`/`sed -i`/输出重定向/
  `git` 写子命令/包管理器安装等）。漏判的代价有限：校准注入里的 git 快照仍
  会暴露真实磁盘改动。

### 6.2 切换检查（警告）

- `branch-switch` 计算"分叉点之后、目标路径之外"的写集合（含
  `hasUnknownWrites` 聚合）。非空且未 `confirm` → 返回
  `needs-confirmation + offPathWrites { files, hasUnknownWrites, branchPreview }`。
- 读取有界（§7）：`store.listAbandonedAssistantRows(target)` 用一条 SQL 只取
  "分叉点之后的 active-path assistant 行"，不加载整条路径；目标不存在时返回
  `undefined`，交给 `switchActiveBranch` 抛原本的错误，而不是误报确认卡。
- 客户端确认卡 v1 两选项：**继续切换** / **取消**（偏差 #2；worktree 按钮
  随 SF-06）。文案必须说明磁盘不会跟随切换。

### 6.3 继续时校准（注入）

- 切换后首个 prompt，Host 一次性注入"工作区状态块"（复用 cold-start
  history 注入的同型一次性标记机制）：
  - 被弃分支的 `modifiedFiles` 清单（对齐 Pi `branch_summary` 语义）；
  - 当前 `git status --porcelain` + `git diff --stat` 有界摘要（磁盘真相，
    这是超出 Pi 原生能力的部分）。
- 默认开启，warn-only，不加设置项。若日后确需硬策略再引入
  `session.branch.writePolicy`（YAGNI）。

## 7. 性能与安全

- 原生副本与工具输出同级敏感度，已属产品数据面，不新增泄露面；payload 不
  过 UI 通道，仅 Host 内部读写。
- RPC 上行只随终态事件批量携带（ADR 0038 流控不破坏）；`native_entry` 读取
  全部按预算有界。
- 树深度不设限，但一切读取沿路径有界；切换成本 O(path 长度) 的递归 CTE。
- `transcript.sqlite3` 体积增长约 1.5–3×（工具输出为主），可接受；后续如
  需可加按代淘汰策略（不在本设计范围）。

## 8. 交付分片与验收

| 分片 | 内容 | 验收 |
|------|------|------|
| S1 | 契约扩展、native_entry 表、双模式采集、seed 重放、派生操作复制 | fork/编辑重发/重启后询问此前工具执行细节，模型准确回答；旧会话无副本时行为与现状一致 |
| S2 | schema v3 迁移、path-scoped 读、branch-list/switch 命令与推送、编辑重发改分支、Desktop 切换器、CLI 命令 | 编辑重发后旧分支可切回且模型满血；双客户端 leaf 同步；busy 拒绝切换 |
| S3 | 写标记、切换确认、校准注入、worktree 升级通道 | A 分支写文件后切 B 弹确认卡；B 继续时模型明确知晓磁盘变更 |

每片独立满足 AGENTS.md §3.10（typecheck、touched 包测试、公开导出审查、
文档同步）。S2 落地时新增 ADR 记录树决策并修订 ADR 0009 残留项状态。

## 9. 已做默认决策（可推翻）

1. 改写后的编辑重发才建提问分叉；同文重试不建分支。破坏性删除保留为显式
   「回到此处」（ADR 0064 修订了原先的 daily-branch 默认）。
2. 不做旧分支自动 GC；用户显式删除子树。
3. 会话内搜索 V1 仅活跃路径；全树搜索后置。
4. 全树导出后置；导出/fork/duplicate 默认活跃路径。
5. 不接 `piSessionFile`；树的权威永远在产品 store（维持 ADR 0009 的边界
   结论，但以本设计取代其"Pi JSONL 树 spike"残留项）。
