# Conversation Tree S2 执行方案 — 会话内分支与破坏性编辑链路的替换

| Field | Value |
|-------|-------|
| Status | Implemented (Stages 1–5, 2026-08-21) |
| Date | 2026-08-18 |
| Spec | `docs/specs/session-conversation-tree.md` §5（S2）+ §6 最小化（S3 warn-only） |
| Implementation | `docs/plans/2026-08-18-conversation-tree-s2-implementation.md` |
| Depends | S1 已落地（native_entry / replay seed，见 spec §4 实现注记） |
| Supersedes | Desktop 编辑重发 / Revert / 再生成的 `session/truncate-from` 破坏性链路（全部删除，见 §D 删除清单） |
| ADR | 新增 ADR 0055（会话内产品树）；修订 ADR 0009 的 truncate-from 后果条目与 D-M2-01b 残留描述 |
| Non-goals | 树的**图形化**可视化（Slice B 后置；分叉点清单面板已于 2026-08-21 落地，见 spec §5.4）、全树搜索/导出、旧分支自动 GC、Pi JSONL / `piSessionFile`、S3 worktree 升级按钮（随 SF-06）、mobile 切换器 UI |

## 0. 一句话

产品 store 内建消息树（`parent_message_id` + `active_leaf_message_id`），编辑重发 / 再生成 / Revert 从「物理删除后续」改为「就地分叉」，分叉点出现 `‹ n/m ›` 切换器；`session/truncate-from` 退位为显式"删除此处之后"（子树删除）。Pi 端零改动，树的权威永远在产品 store（维持 ADR 0009 边界）。

## 1. 现状锚点（探查结论，写方案时已核实）

### Store（`packages/session`）

- schema 无版本号列，靠 `PRAGMA table_info` + 条件 `ALTER` 惰性迁移（`transcript-store.ts` L487–510），本方案沿用同模式。
- 所有读全部按 `sequence`：`listTail` / `transcriptPage`（L355–443）/ `transcriptWindow` / `outlinePage` / `userMessageIndex` / `buildHistoryWindow` / `recentModel` / `searchMessage` / `hasLaterAssistant` / `iterateAll`。
- `truncateFrom`（`transcript-store-messages.ts` L306–348）= 删 `sequence >= cut` 全部行 + 级联 `native_entry`。
- revision 机制现成：`transcriptPage` 返回 `stale-cursor`；`iterateAll` 抛 `TranscriptIterationStaleError`；`userMessageIndex` 用独立 `user_message_revision`。
- legacy JSON 在 store 打开时导入并标记 `authority_state='v2'`（`session-transcript-store-registry.ts` L67–86），树只建在 store 权威上，无 JSON 双轨。
- 行数：`transcript-store.ts` 618 / `transcript-store-pages.ts` 514 / `transcript-store-messages.ts` 350 / `transcript-store-history.ts` 268 — 新逻辑必须进新文件。

### Host（`packages/host-runtime` 等）

- prompt 用户行落库：冷路径 `HostRuntime.recordUserPrompt`（L5533–5571）直接 `store.appendMessage`；warm 走 `store-transcript-recorder.recordUserPrompt`。
- `session/truncate-from` 处理器（`session-live-commands.ts` L265–361）：`disposeLiveSession` → `store.truncateFrom` → ledger 截断 → index 更新 → `listTail(50)` 响应。
- 冷激活 seed：`buildColdActivationSeedOptions`（`cold-activation-seed.ts` L19–36）= `listTail(100)` + `readNativeEntries` → `buildReplaySeedMessages`；无副本回落 `injectProductHistoryOnce` 文本注入（`prompt-preparation.ts` L524–554）。**读路径 path-scoped 后 seed 自动沿新路径，这是 S1 给 S2 铺好的关键。**
- fork（`session-product-commands.ts` L494–635）/ duplicate（L376–492）用 `iterateAll` 复制。
- host-server 远程命令白名单：`DEFAULT_ALLOWED_COMMANDS`（`host-server.ts` L119–164）。
- queued-turn / intervention / steer 的用户行都走 `appendMessage` / `createQueuedTurn` 插入，追加语义不变即可自动成链。
- 写类工具判定已有：`isWriteLikeTool`（`packages/agent-host/src/tool-presentation.ts` L611–616）+ `ToolPresentation.targetPaths/changedPaths`。

### Desktop（`apps/desktop`）

- `session/truncate-from` 仅两个调用点，全在 `use-session-actions.ts`：`handleEditAndResend`（L1360–1489）与 `handleRetryFromMessage`（L1491–1580）。
- 四个 UI 触发全部汇入这两处：用户气泡 Revert、右键 Retry、context-bar 失败重试（绕过确认）、最新助手「再生成」（`chat-thread.tsx` L429–432 → `onRetry(precedingUserMessageId)`）。
- 确认弹窗 `pendingRevertEdit`（`App.tsx` L3485–3551）+ 偏好 `dontAskRevertConfirm`（`ui-preferences.ts` L77/96/239/261）。
- reducer `session/truncate` action（`chat-reducer.ts` L499–504, L1756–1788）。
- mock：truncate L3678–3717 / fork L3484–3595 / duplicate L3402–3483（`host-client-mock.ts`）。
- CLI `commandSession` 走进程内 `HostRuntime.handleCommand`，加子命令即可。

## 2. 与 spec §5 的三处已决偏差（实现按本方案，spec 落地时同步修订）

| # | Spec 原文 | 本方案 | 原因 |
|---|-----------|--------|------|
| 1 | `PromptInput.branchFromMessageId =` 被编辑消息的 **parent** | 字段语义改为「本次 prompt 是对该 **user 消息**的替代」，Host 内部解析 parent（含 parent=NULL 的根分叉） | 客户端不持有树结构，分页窗口外拿不到 parent；树的解释权只能在 Host |
| 2 | S3 确认卡三选项（继续 / 转 worktree / 取消） | v1 两选项（继续 / 取消）；worktree 按钮随 SF-06 补 | fork `workspaceStrategy:'worktree'` Host 侧尚未实现，不给假按钮 |
| 3 | `branch_summary` 式被弃分支总结 | 只注入修改文件清单 + git 真相，不做 LLM 总结 | warn-only 最小闭环；LLM 总结是后续增强 |

## 3. 分阶段执行（每段独立可落地、测试独立绿）

---

### Stage 1 — Store：schema v3 + 路径读取核心（`@piwin/session`）

**新文件**：
- `transcript-store-path.ts` — 活跃路径 CTE 与 path-scoped 查询助手（防 pages/history/branches 循环依赖）
- `transcript-store-branches.ts` — 分支写操作 + 分叉点查询

**Schema（沿用惰性 ALTER 模式，`transcript-store.ts`）**：

```sql
ALTER TABLE transcript_message ADD COLUMN parent_message_id TEXT;
ALTER TABLE transcript_meta ADD COLUMN active_leaf_message_id TEXT;
CREATE INDEX IF NOT EXISTS idx_message_parent ON transcript_message(parent_message_id);
```

**一次性成链迁移**：仅当本次打开确实执行了 ALTER 才跑（同事务）：

```sql
UPDATE transcript_message SET parent_message_id =
  (SELECT t2.id FROM transcript_message t2
   WHERE t2.sequence < transcript_message.sequence
   ORDER BY t2.sequence DESC LIMIT 1);
UPDATE transcript_meta SET active_leaf_message_id =
  (SELECT id FROM transcript_message ORDER BY sequence DESC LIMIT 1)
 WHERE session_id = ?;
```

**不变量**：

1. `parent_message_id = NULL` ⇔ 根消息；允许多根（首条消息的兄弟分支）。
2. `appendMessage` 在同一事务内：`parent := active_leaf` → 插入 → `active_leaf := 新行`。provenance replay 命中时**不改链**（沿用 L54–86 的早退）。
3. `sequence` 保留为全局物理追加序：单条路径内 sequence 严格递增，因此 path-scoped 查询仍可用 `ORDER BY sequence` / `sequence < ?` 游标，**分页 SQL 形状不变，只多一个 path JOIN**。
4. 叶移动（rebase / switch / 子树删除）必须 `bumpRevision` 且同时 bump `user_message_revision` —— 可见用户消息集合变了，现有 stale-cursor / epoch 机制自动令所有客户端游标失效。

**路径 CTE（`transcript-store-path.ts`）**：

```sql
WITH RECURSIVE path(id) AS (
  SELECT active_leaf_message_id FROM transcript_meta WHERE session_id = ?
  UNION ALL
  SELECT m.parent_message_id FROM transcript_message m JOIN path p ON m.id = p.id
  WHERE m.parent_message_id IS NOT NULL
)
```

**读路径改造（全部 path-scoped，漏一个就是拼接分支事故）**：

| API | 文件 | 改法 |
|-----|------|------|
| `listTail` / `getMessage`(不变) / `firstMessageByRole` / `lastMessageByRole` / `searchMessage` / `hasLaterAssistant` / `count` | `transcript-store-messages.ts` | JOIN path；`count()` 语义改为路径长度（对外 messageCount 即会话长度） |
| `transcriptPage` / `userMessageIndex` / `transcriptWindow`（anchor 不在路径 → `not-found`） | `transcript-store-pages.ts` | JOIN path；`countRows*` 助手同步 |
| `buildHistoryWindow` / `recentModel` / `outlinePage` | `transcript-store-history.ts` | JOIN path |
| `iterateAll` → **重命名 `iterateActivePath`** | 同上 | 语义显式化；fork/duplicate/export/compaction 调用点编译期全部暴露，逐个确认 |
| `deleteMessage` | messages | 子女重挂到被删行的 parent；若被删行是 leaf，leaf 回退到 parent |
| `truncateFrom` | 移入 `transcript-store-branches.ts` | 改为**子树删除**：递归收集目标及全部后代 → 级联 `native_entry` → leaf := 目标的 parent；`removedCount` = 子树大小 |

**新增 API（`transcript-store-branches.ts`）**：

```ts
getActiveLeaf(): Promise<string | null>;
/** prompt branchFrom 用：leaf 精确移到目标（不找后代）。目标必须存在。 */
rebaseActiveLeaf(messageId: string | null): Promise<void>;
/** branch-switch 用：leaf 移到目标所在分支的最深叶（子树内无子且 sequence 最大者），返回新 leaf。 */
switchActiveBranch(targetMessageId: string): Promise<{ activeLeafMessageId: string }>;
/** 沿活跃路径列出分叉点（children > 1 的路径节点 + 多根），兄弟按 sequence 排序。 */
listBranchPoints(options: { previewChars: number }): Promise<TranscriptBranchPoint[]>;
```

**测试**（`transcript-store-branches.test.ts` + 现有套件扩展）：旧库成链迁移幂等；append 成链；分叉后两路径分页/大纲/搜索/seed 互不可见；子树删除级联 native；叶切换 bump 双 revision → 旧游标拿到 `stale-cursor`；`‹n/m›` 数据（anchor/siblings/activeIndex）正确；多根分叉。

**验收**：未分叉会话与现状为语义等价（path = 全部行）；`pnpm --filter @piwin/session test` 绿。

---

### Stage 2 — Contracts + Host 命令与 prompt 分支

**Contracts（新文件 `packages/contracts/src/session-branches.ts`，`ipc.ts` 挂命令）**：

```ts
export type TranscriptBranchPoint = {
  /** 分叉发生处（共同 parent）；null = 根部分叉。 */
  anchorMessageId: string | null;
  activeIndex: number;
  siblings: Array<{
    headMessageId: string;
    preview: string;          // 首条文本截断
    leafPreview: string;      // 该分支最深叶预览
    messageCount: number;     // 分支子树大小
    updatedAt: string;
  }>;
};

// HostCommand 新增
| { id?: string; type: 'session/branch-list'; sessionId: string }
| { id?: string; type: 'session/branch-switch'; sessionId: string;
    targetMessageId: string; confirm?: boolean;
    messageProjection?: SessionMessageProjection /* 默认 tail */ }

// 响应
export type SessionBranchListData = { sessionId: string; revision: string; branchPoints: TranscriptBranchPoint[] };
export type SessionBranchSwitchData =
  | { status: 'switched'; sessionId: string; activeLeafMessageId: string;
      session: SessionSummary; messages?: SessionTranscriptMessage[];
      transcriptPage?: SessionTranscriptPageInfo }
  | { status: 'needs-confirmation'; offPathWrites: { files: string[]; hasUnknownWrites: boolean } } // S3 前恒不返回
  | { status: 'run-active' };

// HostPush 新增
| { type: 'session/branch-updated'; sessionId: string; activeLeafMessageId: string; branchPointCount: number }

// PromptInput 新增（host.ts；偏差 #1）
/**
 * 本次 prompt 作为该 user 消息的替代分支：Host 将 active leaf 移到其 parent
 * 后再追加本轮。旧后续链完整保留为兄弟分支。要求目标为 user 行。
 */
branchFromMessageId?: string;
```

同时：`clientMessageId` 的注释（L134–138）从「给 Revert/Edit truncate 用」改写为分支语义；`SessionTruncateFromData` 文档注明子树删除语义。

**Host（新文件 `packages/host-runtime/src/commands/session-branch-commands.ts`**，挂进 `dispatchDomainCommands`；不塞 `session-live-commands.ts`（722 行）**）**：

- `session/branch-list`：store 直读。
- `session/branch-switch`：
  1. 前台 run 活跃（沿用 abort/foreground 同一判定面）→ `{ status: 'run-active' }`；
  2. （S3 起）off-path 写检查 → `needs-confirmation`；
  3. `disposeLiveSession(sessionId, 'branch-switch')`（与 truncate 同因：live Pi 上下文是旧路径的）→ `store.switchActiveBranch` → index 的 `messageCount/lastPreview/updatedAt` 按新路径重算 → 广播 `session/branch-updated` → 按 `messageProjection` 回 tail 页。
- **prompt 分支**（`session-prompt-command.ts`）：`branchFromMessageId` 存在时，在 `recordUserPrompt` 之前：校验目标是 user 行且会话无活跃 run（有 → 失败，不静默）→ `disposeLiveSession` → `store.rebaseActiveLeaf(parent(目标))` → 走既有冷 prompt 路径。冷激活 seed 因 Stage 1 的 path-scoped `listTail` 自动沿新路径原生重放，**此处零新增代码**。
- `session/truncate-from` 处理器：换用子树删除结果，响应形状不变；ledger 截断逻辑保持现状。
- fork / duplicate / export / compaction seed：`iterateActivePath` 重命名驱动的编译错误逐个确认（默认全部沿活跃路径，符合 spec §5.5）。
- host-server：`DEFAULT_ALLOWED_COMMANDS` 加两条命令；`session/branch-updated` 只含 id 与计数，egress 投影无需剥敏。
- mock 后端（Desktop `host-client-mock.ts`）在 Stage 3 一并对齐。

**测试**：branch prompt 落库形状（旧链保留 + 新兄弟）；busy 拒绝；switch 后 push + tail 页 + index 重算；fork/duplicate 只复制活跃路径；冷激活 seed 沿新路径的集成用例（mock 后端）；host-server allowlist。

**验收**：spec §8 S2 行「编辑重发后旧分支可切回且模型满血；双客户端 leaf 同步；busy 拒绝切换」的 Host 侧全部成立。

---

### Stage 3 — Desktop：链路替换（本阶段执行 §D 删除清单）

**新文件**：
- `hooks/use-branch-actions.ts` — `branchPoints` 状态（resume + `session/branch-updated` push + 分支发送后刷新）、`switchBranch`、`branchResend`
- `message-branch-switcher.tsx` — `‹ n/m ›` 控件（ui-kit 原语组合）

**统一替换函数**（旧的两条 truncate 链路收敛为一条）：

```ts
// use-branch-actions.ts
branchResend(messageId: string, text: string): Promise<void>
// = 可选乐观裁剪 → requestPromptWithForeground({ ..., branchFromMessageId: messageId })
// 失败：走既有 stale 重启路径整页刷回（服务端未动，无需精细回滚）
```

**四个触发点全部改接**：

| 触发点 | 新行为 |
|--------|--------|
| 编辑重发（`MessageEditCard` send） | `branchResend(编辑的消息 id, 新文本)`，直接发送 |
| Revert（用户气泡 / 右键 Retry） | 打开既有 `MessageEditCard`（`setEditingMessageId`），**点击时零服务端调用、零破坏**；发送即分支 |
| 再生成（最新助手） | `branchResend(precedingUserMessageId, 原文本)` 直接发送 |
| context-bar 失败重试 | 同上（不再绕确认——本来就无须确认了） |

**Reducer**：`'session/truncate'` action 更名 `'session/branch-switched'`，实现复用（换消息集 + `transcriptPage` + 清 `historyView` + bump epoch）；branch-switch 响应与 truncate-from（显式删除）都走它。

**切换器**：`branchPoints` 下发到 `ChatThread` → `ChatMessageRow`；`siblings[activeIndex].headMessageId === message.id` 的行渲染 `‹ n/m ›`，点击 → `switchBranch(相邻 sibling.headMessageId)`；streaming 期间禁用（Host 也会拒绝，双保险）。

**显式破坏性删除入口**：右键菜单新增「删除此处之后」（danger，走 `session/truncate-from` 子树删除 + 既有 ConfirmDialog 文案），使该命令在 Desktop 不成为死代码。

**mock 对齐**：mock 会话加 `parentMessageId/activeLeaf` 字段；truncate-from 改子树语义；实现 branch-list/branch-switch；`session/fork` mock 保持现状。

**测试**：reducer 更名回归；编辑重发携带 `branchFromMessageId`（不再发 truncate）；Revert 打开编辑卡且无网络调用；切换器渲染/点击/禁用；mock branch 命令。

---

### Stage 4 — CLI 对等 + 文档

- `apps/cli` `commandSession` 增：`piwin session branches <sessionId>`（缩进列表打印分叉点与兄弟）、`piwin session switch <sessionId> <messageId>`（打印 run-active / needs-confirmation 结果）；更新 help 文案。
- 文档落盘：**ADR 0055**（树在产品 store、破坏性链路退位、ADR 0009 truncate 后果条目修订、D-M2-01b/D-M2-02-full 残留由本设计取代）；spec §5 状态更新 + 记录 §2 三处偏差；`docs/todo-deferred.md` 增 S2 行；`docs/architecture.md` 转录节补 parent/leaf。

---

### Stage 5 — S3 最小写边界（warn-only）

- **写标记**：contracts 新增纯函数模块 `workspace-writes.ts`：`collectWorkspaceWrites(presentation: ToolPresentation): { files: string[]; hasUnknownWrites: boolean } | null`（写类判定基于 `presentation.kind/actionVerb`，与 agent-host `isWriteLikeTool` 口径对齐；bash 类写无路径 → `hasUnknownWrites`）。recorder 在 `tool/end` 时合并进 assistant 行 `metadata_json.workspaceWrites`。
- **切换检查**：`branch-switch` 计算「当前路径上、分叉点之后」的写集合；非空且未 `confirm` → `needs-confirmation`。
- **Desktop 确认卡**：继续 / 取消 两选项（偏差 #2），文案明说「磁盘不会跟随切换」。
- **校准注入**：切换后首个 prompt 一次性注入（复用 `injectProductHistoryOnce` 的 exactly-once 模式，新 `injectBranchCalibrationOnce`）：被弃分支修改文件清单 + `git status --porcelain` / `git diff --stat` 有界摘要（`@piwin/git` 现成）。默认开启，无设置项。
- **测试**：分类 golden cases（edit/write/str_replace/bash 写/只读）；off-path 计算；确认卡流；注入 exactly-once。

## D. 删除清单（Stage 3 内执行，不留兼容层）

| # | 删除物 | 位置 |
|---|--------|------|
| D1 | `handleEditAndResend` 的 truncate 调用与 `session/truncate` dispatch 段 | `use-session-actions.ts` L1388–1407 一带 |
| D2 | `handleRetryFromMessage` 整个函数（revert-截断-回填流程） | `use-session-actions.ts` L1491–1580 |
| D3 | `handleRetryMessage` 确认分流 + `pendingRevertEdit` 状态 + 确认弹窗 JSX + `dontAskAgainChecked` | `App.tsx` L1636–1652, L347–352, L3485–3551 |
| D4 | `dontAskRevertConfirm` 偏好（字段/键/读写）与 `revert-dont-ask-checkbox` 相关测试 | `ui-preferences.ts` L77/96/239/261 |
| D5 | reducer `'session/truncate'` 旧名（更名，不新增并存 action） | `chat-reducer.ts` L499–504, L1756–1788 |
| D6 | mock `session/truncate-from` 的「slice(0, cut)」线性实现 | `host-client-mock.ts` L3678–3717（重写为子树） |
| D7 | `PromptInput.clientMessageId` 注释中的 truncate 语义描述 | `contracts/host.ts` L133–138 |
| D8 | store `truncateFrom` 的 `sequence >=` 线性删除实现 | `transcript-store-messages.ts` L306–348（移入 branches 模块重写） |
| D9 | 「Restore conversation to this checkpoint…」通知文案与 revert 专用 CSS | Desktop 各处随 D2/D3 清理 |

保留但改语义：`session/truncate-from` 命令本身（显式"删除此处之后"，子树删除）；`IconRevert` 按钮（改为进入编辑卡）。

## R. 风险与护栏

1. **漏改读路径 = 拼接分支事故**。护栏：Stage 1 用 `iterateAll → iterateActivePath` 重命名逼出全部编译错误；grep `FROM transcript_message` 全量核对一遍（pause/intervention/queued-turn 表不涉及）。
2. **多客户端游标撕裂**。护栏：叶移动 bump 双 revision，走现有 `stale-cursor` / epoch / `TranscriptIterationStaleError` 三套既有机制，不新发明同步协议。
3. **ledger 与树的错位**：ledger 按 run 记账、不感知路径（spec §5.5 允许）；truncate-from 的 ledger 截断保持现状；分支切换不动 ledger。上下文占用估算在切换后首个 run 自然重算。
4. **超限文件**：`host-runtime.ts`(7521)/`App.tsx`(3644)/`chat-reducer.ts`(3820)/`use-session-actions.ts`(1772)/`host-client-mock.ts`(5032) 均为存量违规——本方案所有新逻辑进新文件，对这五个文件只做最小行数触碰（删多于加），不做顺手重构。
5. **queued-turn 在分支瞬间的竞态**：branch prompt 要求无活跃 run；排队轮由 Host 在 run 结束后按当时 leaf 追加，天然落在新路径——集成测试覆盖「切换后排队轮归属」。

## A. 验收（对齐 spec §8 S2 行 + S3 最小）

1. 编辑重发/再生成后：旧分支在 `‹ n/m ›` 可切回，切回后追问此前工具执行细节模型能答（S1 seed 生效）。
2. 双客户端（Desktop + mobile 远程）同会话：一端切叶，另一端收 `session/branch-updated` 后分页游标失效并刷新到同一路径。
3. run 活跃时切换被拒（Host `run-active` + UI 禁用）。
4. A 分支写过文件、切 B 时弹确认卡；B 上继续对话，模型收到磁盘校准块。
5. `pnpm typecheck` + touched 包测试绿；无新增 >1000 行文件；`docs/` 同步（ADR 0055、spec 状态、todo-deferred）。
