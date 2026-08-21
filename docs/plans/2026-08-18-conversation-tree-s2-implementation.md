# Conversation Tree S2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> (或 subagent-driven-development) 按任务执行。步骤用 `- [ ]` 勾选跟踪。
> 未获用户批准前不要写产品代码。本文件是可执行计划，不是设计讨论。

**Goal:** 会话内非破坏分叉：编辑重发 / 再生成 / Revert 改为就地建分支；分叉点
出现 `‹ n/m ›` 切换器；切回旧分支后模型经 S1 native seed 满血记得工具上下文。
`session/truncate-from` 退位为显式「删除此处之后」（子树删除）。

**Architecture:** 树的权威在每会话 `transcript.sqlite3`（`parent_message_id` +
`active_leaf_message_id`）。所有读沿活跃路径 CTE。Pi 只吃当前路径的线性
replay（S1 已落地）。客户端不持有树：切换器数据来自 `session/branch-list`，
`SessionTranscriptMessage` **不**加 parent 字段。

**Tech Stack:** TypeScript strict / ESM / `node:sqlite` / vitest；contracts →
session → host-runtime → host-server → Desktop / CLI。

**Spec:** `docs/specs/session-conversation-tree.md` §5 + §6 最小。
**Design:** `docs/plans/2026-08-18-conversation-tree-s2-execution.md`。

**Plan size:** long（10 sequential tasks；无 `independentSteps`，文件互相卡住）。

---

## Design corrections (相对 design doc，实现按这里)

1. **成链必须进 `insertMessageRow`，不能只改 `appendMessage`。**
   现有四个写入点：`appendMessage`、queued-turn（L165）、intervention（L112）、
   legacy import 循环（L215）。后三个绕过 `appendMessage`。`insertMessageRow`
   在同一调用里读当前 leaf 作为 parent、插入、把 leaf 指到新行。replay 早退
   仍在 `appendMessage`，不进 `insertMessageRow`，不改链。
2. **branch 命令走 live 链路，不进 `dispatchDomainCommands`。**
   `session/branch-switch` 和 branch prompt 都要 `disposeLiveSession`，该能力
   只在 `SessionLiveContext`。模式对齐 `session-prompt-command.ts`：
   `handleSessionLiveCommand` 里多一次 delegate。
3. **`countRows` / `countRowsBeforeSequence` 保持全局。** 它们被 legacy import
   校验使用。路径计数放 `transcript-store-path.ts` 新助手，分页改用它们。
4. **S3 worktree 按钮不做**（design 偏差 #2）。`branchFromMessageId` 语义是
   「替代哪条 user 消息」（偏差 #1）。

---

## Global Constraints

- 不接 `piSessionFile`；UI/apps 不 import Pi；`native_entry.payload` 仍不透明。
- 新逻辑进新文件。禁止往 `host-runtime.ts` / `App.tsx` / `chat-reducer.ts` /
  `use-session-actions.ts` / `host-client-mock.ts` 做净增（只允许删多于加）。
- 任何新/改源文件不得超过 1000 行。
- `iterateAll` 必须在 Task 4 重命名为 `iterateActivePath`，用编译错误逼出全部
  调用点。禁止留别名。
- 叶移动（rebase / switch / 子树删除）必须 `bumpRevision` **且**
  `user_message_revision`（可见用户消息集合变了）。
- 提交按任务分；未获用户明确授权不 commit。不碰无关脏文件。
- 无 `any`、无未检查的 `!`；相对导入带 `.js`。

## Non-goals

树面板可视化、全树搜索/导出、旧分支 GC、Pi JSONL、S3 worktree 升级、mobile
切换器 UI、顺手拆 `host-runtime.ts`。

---

## File map

| File | Role |
|------|------|
| `packages/session/src/transcript-store.ts` | ALTER + 一次性成链；`insertMessageRow` 写 parent/leaf；store 类型新方法 |
| `packages/session/src/transcript-store-path.ts` | **新建** 活跃路径 CTE + path-scoped 计数助手 |
| `packages/session/src/transcript-store-branches.ts` | **新建** rebase / switch / listBranchPoints / 子树 truncateFrom |
| `packages/session/src/transcript-store-messages.ts` | 读 JOIN path；删掉线性 `truncateFrom` |
| `packages/session/src/transcript-store-pages.ts` | page / window / user-index JOIN path |
| `packages/session/src/transcript-store-history.ts` | history / outline / `iterateActivePath` |
| `packages/contracts/src/session-branches.ts` | **新建** 分支类型 |
| `packages/contracts/src/host.ts` | `PromptInput.branchFromMessageId` |
| `packages/contracts/src/ipc.ts` | 命令 + `session/branch-updated` push |
| `packages/host-runtime/src/commands/session-branch-commands.ts` | **新建** list/switch |
| `packages/host-runtime/src/commands/session-prompt-command.ts` | branchFrom 在 recordUserPrompt 之前 rebase |
| `packages/host-runtime/src/commands/session-live-commands.ts` | TYPES + delegate；truncate-from 用子树结果 |
| `packages/host-server/src/host-server.ts` | allowlist 加两条命令 |
| `apps/desktop/src/hooks/use-branch-actions.ts` | **新建** |
| `apps/desktop/src/message-branch-switcher.tsx` | **新建** |
| `apps/desktop/src/host-client-mock.ts` | mock 树语义（重写 truncate 段，不净增） |
| `apps/cli/src/index.ts` | `session branches` / `session switch` |
| `docs/adr/0055-in-session-conversation-tree.md` | **新建** |

---

### Task 1: Schema v3 + `insertMessageRow` 成链

**Files:**
- Modify: `packages/session/src/transcript-store.ts`
- Modify: `packages/session/src/transcript-store-messages.ts`（仅 append 早退保持不改链；不改读 SQL）
- Test: `packages/session/src/transcript-store.test.ts`（追加，不重写全文件）

**Schema（`openSessionTranscriptStore`，沿用 `PRAGMA table_info` 惰性 ALTER）:**

```sql
ALTER TABLE transcript_message ADD COLUMN parent_message_id TEXT;
ALTER TABLE transcript_meta ADD COLUMN active_leaf_message_id TEXT;
CREATE INDEX IF NOT EXISTS idx_message_parent ON transcript_message(parent_message_id);
```

**一次性成链：** 仅当本次打开**确实执行了** `parent_message_id` 的 ALTER
（列原先不存在）才跑。列已存在则禁止回填 NULL（那些是真根分叉）。

```sql
UPDATE transcript_message SET parent_message_id =
  (SELECT t2.id FROM transcript_message t2
   WHERE t2.sequence < transcript_message.sequence
   ORDER BY t2.sequence DESC LIMIT 1);
UPDATE transcript_meta SET active_leaf_message_id =
  (SELECT id FROM transcript_message ORDER BY sequence DESC LIMIT 1)
 WHERE session_id = ?;
```

空库：leaf 保持 NULL。

**`insertMessageRow`（同一函数、调用方已有事务）:**

1. `SELECT active_leaf_message_id FROM transcript_meta WHERE session_id = ?`
2. INSERT 含 `parent_message_id`（leaf 或 NULL）
3. `UPDATE transcript_meta SET active_leaf_message_id = ? WHERE session_id = ?`

**不变量：**
- `parent_message_id IS NULL` ⇔ 根。允许多根。
- provenance replay 早退不调用 `insertMessageRow`。
- queued-turn / intervention / legacy import 自动成链，无需各改一遍。

- [ ] **Step 1: 失败测试**（新库 append 3 条：第二条 parent=第一条 id，leaf=第三条；replay 同 provenance 不改 leaf）
- [ ] **Step 2: 跑 `pnpm --filter @piwin/session test` 确认失败**
- [ ] **Step 3: 实现 ALTER + insertMessageRow**
- [ ] **Step 4: 迁移用例** — 手工建无新列的旧库文件、打开 store、断言成链且二次打开不改已有 NULL 根（可用「先打开一次成链，再手动 INSERT 一个 parent NULL 的根，再 reopen，该根仍为 NULL」）
- [ ] **Step 5: 现有 `transcript-store.test.ts` 全绿**（线性会话行为不变）

**Verify:** `pnpm --filter @piwin/session test`

**Acceptance:** 未分叉会话 leaf 指向最后一行；所有 insert 路径成链；旧库一次打开即可用。

---

### Task 2: 活跃路径 CTE + 全部读改 path-scoped

**Files:**
- Create: `packages/session/src/transcript-store-path.ts`
- Create: `packages/session/src/transcript-store-path.test.ts`
- Modify: `transcript-store-messages.ts`（`listTail` / `first|lastMessageByRole` / `searchMessage` / `hasLaterAssistant` / `count`）
- Modify: `transcript-store-pages.ts`（`transcriptPage` / `userMessageIndex` / `transcriptWindow`）
- Modify: `transcript-store-history.ts`（`buildHistoryWindow` / `recentModel` / `outlinePage` / `iterateAll` 的 SQL，**先不改名**）
- Modify: `deleteMessage`：子女 `parent` 重挂到被删行的 parent；若被删行是 leaf，leaf 回退到其 parent

**路径 CTE（seed 过滤 NULL leaf）:**

```sql
WITH RECURSIVE active_path(id) AS (
  SELECT active_leaf_message_id FROM transcript_meta
   WHERE session_id = ? AND active_leaf_message_id IS NOT NULL
  UNION ALL
  SELECT m.parent_message_id FROM transcript_message m
  JOIN active_path p ON m.id = p.id
  WHERE m.parent_message_id IS NOT NULL
)
```

读查询 `INNER JOIN active_path`。分页仍 `ORDER BY sequence` / `sequence < ?`
（单路径内 sequence 严格递增）。

**计数：** `countPathRows` / `countPathRowsBeforeSequence` /
`countPathIndexedUserMessages` 放 path 模块。`store.count()` 改为路径长度。
**不要改** `transcript-store-rows.ts` 的全局 `countRows*`。

`transcriptWindow`：anchor 不在活跃路径 → 已有 `'not-found'`。

- [ ] **Step 1: path 模块单测** — 线性 5 条：path ids = 全部 ids；手工 SQL 把 leaf 挪到中间节点后 `listTail` 看不到其后兄弟（可在 Task 2 用 raw SQL 插一条 parent=中间节点 的旁路，再把 leaf 设回中间节点）
- [ ] **Step 2: 把所有上表读 SQL 改 JOIN**
- [ ] **Step 3: 现有分页/大纲/history/search 测试仍绿**（线性 ≡ 全表）
- [ ] **Step 4: grep `FROM transcript_message` 于 `packages/session/src`** — 每一处标注 path-scoped 或「全局有意」（pause/intervention/queued-turn 表、legacy `countRows`、native_entry）。漏网必须改或注释 why

**Verify:** `pnpm --filter @piwin/session test`

**Acceptance:** 线性会话与 Task 1 前字节级语义等价（page revision 算法不变）；旁路消息对活跃读不可见。

---

### Task 3: 分支写 API + 子树 `truncateFrom`

**Files:**
- Create: `packages/session/src/transcript-store-branches.ts`
- Create: `packages/session/src/transcript-store-branches.test.ts`
- Modify: `transcript-store.ts` — 把方法挂到 store；`truncateFrom` 从 messages ops 的 Pick 里拿掉
- Modify: `transcript-store-messages.ts` — **删除** L306–348 线性 `truncateFrom`（design §D8）
- Modify: `packages/session/src/index.ts` 如需导出新类型

**API:**

```ts
getActiveLeaf(): Promise<string | null>;
/** Prompt branchFrom：leaf 精确设为 messageId（null = 空会话根）。目标必须存在（null 除外）。 */
rebaseActiveLeaf(messageId: string | null): Promise<void>;
/** 叶移到 target 子树中「无子女且 sequence 最大」的节点。 */
switchActiveBranch(targetMessageId: string): Promise<{ activeLeafMessageId: string }>;
listBranchPoints(options: { previewChars: number }): Promise<TranscriptBranchPoint[]>;
// truncateFrom 换实现：子树删除（含目标）
```

`TranscriptBranchPoint` 先在 session 包用本地类型定义，Task 5 再换成
contracts 并让 session 依赖它（或 Task 5 提前把类型放到 contracts — **若 Task 3
需要 contracts 类型，改为 Task 3 依赖 Task 5 不可行**）。本任务用 session 内部
类型；Task 5 抽到 contracts 后 session import contracts 类型替换，shapes 必须一致。

**`listBranchPoints`：** 沿活跃路径从根到叶。对路径上每个节点 H，找
`parent_message_id` 与 H 相同的全部行（H 为根时找所有 `parent IS NULL`）。
`siblings.length > 1` 才发射一个 point：`anchorMessageId = H.parent`，
`activeIndex` = H 在按 sequence 排序的 siblings 中的下标，`headMessageId` =
各 sibling id。`messageCount` = 以该 head 为根的子树大小。

**`truncateFrom` 新语义（含目标）：**
1. 目标不存在 → 与今天一样 `{ found:false, removedCount:0, remainingCount }`
2. 递归收集目标及全部后代
3. 同事务删 `native_entry` + 那些 `transcript_message`
4. 若目标在活跃路径上：`leaf := 目标的 parent`（根被删则 NULL）
5. 若目标不在活跃路径：leaf 不变（删的是旁路子树）
6. `bumpRevision(removedCount, removedIndexedUsers)`；`remainingCount` =
   `countPathRows()`（路径长度，不是全表）

- [ ] **Step 1: 失败测试** — 线性 U1-A1-U2-A2；rebase 到 A1 再 append U2'；listTail 为 U1-A1-U2'；原 U2-A2 仍 `getMessage` 得到；`listBranchPoints` 在 U2'/U2 给出 ‹1/2› 数据；`switchActiveBranch(U2)` 后 listTail 回到 U1-A1-U2-A2；旧 transcriptPage cursor 得 `stale-cursor`
- [ ] **Step 2: 子树删除测试** — 切到 U2' 分支后 `truncateFrom(U2)`（旁路）不改当前 leaf；`truncateFrom(U2')`（路径上）leaf=A1 且 U2' 消失
- [ ] **Step 3: 实现**
- [ ] **Step 4: 更新现有 truncateFrom 测试**（`transcript-store.test.ts` / `session-transcript-derived-ops.integration.test.ts`）到子树语义；线性未分叉时「删 cut 及 sequence 更大的行」与旧行为重合，那些用例应仍过

**Verify:** `pnpm --filter @piwin/session test`

**Acceptance:** 分叉后两路径互不可见；切换 bump 双 revision；线性 truncate 回归绿。

---

### Task 4: `iterateAll` → `iterateActivePath`

**Files:**
- Modify: `transcript-store.ts` 类型
- Modify: `transcript-store-history.ts` 实现
- Modify: `transcript-store.test.ts`
- Modify: `packages/host-runtime/src/commands/session-product-commands.ts`（fork/duplicate 的 `iterateAll(100)`）
- Modify: `packages/host-runtime/src/commands/session-live-commands.ts`（truncate-from ledger 扫描 + export `streamTranscriptExport`）

禁止兼容别名。fork/duplicate/export 沿活跃路径复制/导出（spec §5.5）。
truncate-from 的 ledger 边界扫描改为 `iterateActivePath`（切点在当前路径上；
旁路删除不碰 ledger，与 design §R3 一致）。

- [ ] **Step 1: 重命名，修编译**
- [ ] **Step 2: `pnpm --filter @piwin/session --filter @piwin/host-runtime test` 相关套件绿**
- [ ] **Step 3: repo grep `iterateAll` 必须为零**（测试字符串除外）

**Verify:** grep 为零 + 上列 test

**Acceptance:** 编译期保证没有全表遍历漏网。

---

### Task 5: Contracts

**Files:**
- Create: `packages/contracts/src/session-branches.ts`
- Create: `packages/contracts/src/session-branches.test.ts`
- Modify: `packages/contracts/src/index.ts` — `export * from './session-branches.js'`
- Modify: `packages/contracts/src/host.ts` — `PromptInput.branchFromMessageId?`；重写
  `clientMessageId` 注释（去掉 truncate，写清「乐观气泡 id / 分支替代键」）
- Modify: `packages/contracts/src/ipc.ts` — 命令 + push
- Modify: `packages/contracts/src/session-ops.ts` — `SessionTruncateFromInput` 注释改为子树删除
- Modify: `packages/contracts/src/ipc.test.ts`

```ts
export type TranscriptBranchSibling = {
  headMessageId: string;
  preview: string;
  leafPreview: string;
  messageCount: number;
  updatedAt: string;
};
export type TranscriptBranchPoint = {
  anchorMessageId: string | null;
  activeIndex: number;
  siblings: TranscriptBranchSibling[];
};
export type SessionBranchListData = {
  sessionId: string;
  revision: string;
  branchPoints: TranscriptBranchPoint[];
};
export type SessionBranchSwitchData =
  | {
      status: 'switched';
      sessionId: string;
      activeLeafMessageId: string;
      session: import('./session-index.js').SessionSummary;
      messages?: import('./session-transcript.js').SessionTranscriptMessage[];
      transcriptPage?: import('./session-transcript-page.js').SessionTranscriptPageInfo;
    }
  | {
      status: 'needs-confirmation';
      offPathWrites: { files: string[]; hasUnknownWrites: boolean };
    }
  | { status: 'run-active' };
```

HostCommand:

```ts
| { id?: string; type: 'session/branch-list'; sessionId: string }
| {
    id?: string;
    type: 'session/branch-switch';
    sessionId: string;
    targetMessageId: string;
    confirm?: boolean;
    messageProjection?: SessionMessageProjection; // 默认 tail
  }
```

HostPushVariant:

```ts
| {
    type: 'session/branch-updated';
    sessionId: string;
    activeLeafMessageId: string;
    branchPointCount: number;
  }
```

PromptInput:

```ts
/**
 * This prompt replaces the given user message as a sibling branch.
 * Host moves the active leaf to that message's parent, then appends.
 * Target must be a user row. Clients must not send the parent id.
 */
branchFromMessageId?: string;
```

Task 3 的内部类型改为 import contracts（若 shapes 已对齐则只换 import）。

S3 前 `needs-confirmation` 必须出现在联合类型里，Host **暂不返回**该变体。

- [ ] **Step 1: ipc.test.ts 追加** list/switch/push/PromptInput 形状用例（先失败）
- [ ] **Step 2: 实现类型并 `pnpm --filter @piwin/contracts test` 绿**
- [ ] **Step 3: `pnpm typecheck`** — 实现者（host-runtime mock 等）会红到 Task 6/7；contracts 包本身必须绿。记录已知失败面，不要在本任务修 Desktop。

**Verify:** `pnpm --filter @piwin/contracts test`

**Acceptance:** 命令/push/PromptInput 可编译；truncate 注释已改；clientMessageId 不再提 truncate。

---

### Task 6: Host — branch 命令、prompt 分叉、truncate 处理器

**Files:**
- Create: `packages/host-runtime/src/commands/session-branch-commands.ts`
- Create: `packages/host-runtime/src/commands/session-branch-commands.test.ts`
- Modify: `session-live-commands.ts` — `TYPES` 加 `session/branch-list` |
  `session/branch-switch`；在现有 delegate 链加入
  `handleSessionBranchCommand`（与 prompt 并列）；truncate-from 已走新 store
- Modify: `session-prompt-command.ts` — `branchFromMessageId` 处理
- Modify: `host-runtime.ts` — `TRANSCRIPT_STORE_LEASED_COMMANDS` 加两条（只加这两行）
- Modify: `packages/host-server/src/host-server.ts` — `DEFAULT_ALLOWED_COMMANDS` 加两条
- Test: 扩 `session-live-commands.test.ts` / `session-prompt` 相关测试；host-server allowlist 测试若有则加

**`session/branch-list`:** store `listBranchPoints`；revision 用现有
`revisionToken` 同源（与 transcriptPage 同一套 token 函数；可从 pages 模块导出
或 store `getRevision` 后再 hash——选一处，禁止两套算法）。

**`session/branch-switch`:**
1. 未知 session → fail
2. 前台 run 活跃（与 abort/prompt 同一判定：`activeRunId` / streaming 等价物，
   **不要发明新忙信号**）→ `{ status: 'run-active' }` success
3. Task 10 之前跳过 off-path 写检查
4. `disposeLiveSession(sessionId, 'branch-switch')`（truncate-from 今日用
   `'manual'`；新增 reason 字符串即可，不要为它改 residency 状态机）
5. `store.switchActiveBranch`
6. index：`messageCount = store.count()`，`lastPreview` 从路径 last user/assistant
   重算，`updatedAt = now`
7. `push({ type: 'session/branch-updated', ... })`
8. `createSessionMessageResponse(..., messageProjection ?? 'tail')` 填 messages/page

**prompt `branchFromMessageId`（在 `recordUserPrompt` 之前）:**
1. 无该字段 → 现路径
2. 目标缺失或非 user → fail，不静默
3. 有活跃 run → fail（不排队、不改叶）
4. `disposeLiveSession` → `getMessage` 取 parent → `rebaseActiveLeaf(parent ?? null)`
5. 既有冷 prompt。seed 因 Task 2 的 path-scoped `listTail` 自动沿新路径

**host-server:** `isSafeRemoteCommand` default 已是 `true`，只需 allowlist。
push 只有 id/计数，不必剥路径。

- [ ] **Step 1: 失败测试** — mock/store 上 branch prompt：旧 U2 仍 getMessage；新用户行 parent=A1；branch-switch 回旧叶；busy 时 switch 返回 run-active
- [ ] **Step 2: 实现命令 + prompt 钩子**
- [ ] **Step 3: allowlist + leased set**
- [ ] **Step 4: `pnpm --filter @piwin/host-runtime --filter @piwin/host-server test`**

**Verify:** 上列 test + typecheck host-runtime/host-server

**Acceptance:** Host 侧「编辑重发后可切回」成立；busy 拒绝；远程允许两条新命令。

---

### Task 7: Desktop mock + reducer 更名

**Files:**
- Modify: `apps/desktop/src/host-client-mock.ts` — 会话加 `parentByMessageId` /
  `activeLeaf`（内部，不必进 ChatMessageUi）；`session/truncate-from` L3678–3717
  **重写为子树删除**（§D6）；实现 `session/branch-list` / `session/branch-switch`；
  prompt 若带 `branchFromMessageId` 则先 rebase 再 append。本文件禁止净增：
  抽出 `host-client-mock-branches.ts` 承载新逻辑，mock 只 switch 委托。
- Modify: `apps/desktop/src/chat-reducer.ts` — `'session/truncate'` **更名为**
  `'session/branch-switched'`（§D5），实现保持换消息 + transcriptPage + 清
  historyView + bump epoch。全文件替换 action 名。
- Modify: `apps/desktop/src/chat-reducer.test.ts` 及所有 dispatch 该 action 的测试
- Modify: `apps/desktop/src/host-client-mock.test.ts`

- [ ] **Step 1: 更名 reducer，修编译/测试**
- [ ] **Step 2: mock 树 + 新命令测试**（fork 仍切独立会话，不要改 SF 语义）
- [ ] **Step 3: `pnpm --filter @piwin/desktop test` 相关文件绿**（Desktop 包名以 `apps/desktop/package.json` name 为准）

**Verify:** Desktop 单测里 reducer + mock

**Acceptance:** 无 `session/truncate` action 名残留；mock 分叉/切换/子树删除可单测。

---

### Task 8: Desktop UI — 删破坏链路 + ‹ n/m › + 显式删除

**Files:**
- Create: `apps/desktop/src/hooks/use-branch-actions.ts`
- Create: `apps/desktop/src/hooks/use-branch-actions.test.ts`
- Create: `apps/desktop/src/message-branch-switcher.tsx`
- Create: `apps/desktop/src/message-branch-switcher.test.tsx`
- Modify: `use-session-actions.ts` — **删除** `handleEditAndResend` 的 truncate
  段（§D1）和 **整个** `handleRetryFromMessage`（§D2）；编辑发送改调
  `branchResend`
- Modify: `App.tsx` — 删除 `pendingRevertEdit` / `dontAskAgainChecked` / 确认弹窗
  JSX / `handleRetryMessage` 分流（§D3）；Revert 改为 `setEditingMessageId`；
  再生成与 context-bar retry 改 `branchResend`；接线 switcher；右键加
  「删除此处之后」
- Modify: `ui-preferences.ts` — 删除 `dontAskRevertConfirm` 字段/键/读写（§D4）
- Modify: `chat-thread.tsx` / `chat-message-row.tsx` — 下发 branchPoints；
  `headMessageId === message.id` 的行渲染 switcher
- Modify: `context-menu/catalog.ts` — retry 文案可改为「编辑并分叉」或保持
  Retry 但行为改为打开编辑卡；新增 danger「删除此处之后」
- Modify: `chat-thread.test.tsx` / `conversation-user-message` 相关测试 /
  `ui-preferences` 测试 / App 级 revert 测试

**`branchResend(messageId, text)`:**
`requestPromptWithForeground({ text, branchFromMessageId: messageId, clientMessageId })`。
失败则现有 stale 重启刷页。不要先 truncate。

**四个触发点:**

| 触发 | 行为 |
|------|------|
| MessageEditCard send | `branchResend(编辑 id, 新文本)` |
| Revert 按钮 / 右键 retry | **只** `setEditingMessageId`（零 Host 调用） |
| 再生成 | `branchResend(precedingUserMessageId, 原文本)` 直接发 |
| context-bar 失败重试 | 同再生成，不再绕过确认（确认已不存在） |

**Switcher:** 点击相邻 sibling 的 `headMessageId` → `session/branch-switch` →
dispatch `session/branch-switched`。streaming 时 disabled。收到
`session/branch-updated`（含其他客户端）时刷新 `branchPoints` 并在 revision
不匹配时按现有 stale-cursor 路径重拉 tail。

**显式删除:** ConfirmDialog 文案：「将删除这条消息及其所有后续分支。磁盘上的
文件改动不会撤销。」走 `session/truncate-from` + `session/branch-switched`。

**清理：** 「Restore conversation to this checkpoint…」通知、
`revert-edit-confirm` testid、revert-dont-ask CSS（§D9）。`IconRevert` 保留，
行为改为进入编辑卡。

- [ ] **Step 1: 测试先写** — 编辑发送的 Host 命令含 `branchFromMessageId`、
  不含 `session/truncate-from`；Revert 点击不发 Host 命令；switcher 渲染 ‹2/2›
- [ ] **Step 2: 实现 hook + 控件 + 接线 + 删除旧代码**
- [ ] **Step 3: grep Desktop `session/truncate-from` 只剩显式删除入口**
- [ ] **Step 4: grep `dontAskRevertConfirm` / `pendingRevertEdit` /
  `handleRetryFromMessage` / `'session/truncate'` 为零**

**Verify:** Desktop 相关测试 + 上列 grep

**Acceptance:** 破坏性编辑链路从日常路径消失；切换器可点；显式删除仍可达。

---

### Task 9: CLI + ADR + spec/docs

**Files:**
- Modify: `apps/cli/src/index.ts` — `commandSession` 增加 `branches` /
  `switch`；更新 `printHelp`（约 L93–106）
- Create: `docs/adr/0055-in-session-conversation-tree.md`
- Modify: `docs/adr/0009-session-resume-product-shell.md` — truncate-from 后果
  段改为子树删除 + 指向 0055；D-M2-01b 残留改为「由 0055 / 产品 store 树取代，
  不再做 Pi JSONL 多叶 spike」
- Modify: `docs/specs/session-conversation-tree.md` — §5 状态 S2 Implemented
  （本任务结束时）；记录三处偏差；`branchFromMessageId` 语义改成 user 消息
- Modify: `docs/todo-deferred.md` — S2 行
- Modify: `docs/architecture.md` — 转录节补 parent/leaf
- Modify: design doc status → Accepted / implemented-by 本计划

**CLI:**
- `piwin session branches <sessionId>` → `session/branch-list`，缩进打印
  anchor + `n/m` + sibling preview
- `piwin session switch <sessionId> <messageId>` → `session/branch-switch`，
  打印 `switched` / `run-active` / `needs-confirmation`

与现有 `commandSession` 一样进程内 `HostRuntime.handleCommand`。

**ADR 0055 必写决策:** 树在产品 store；不接 piSessionFile；破坏性链路退位；
insertMessageRow 成链；live 命令链；偏差 #1–#3。

- [ ] **Step 1: CLI 命令 + 一个 dispatcher/help 测试**
- [ ] **Step 2: 文档**
- [ ] **Step 3: `pnpm --filter @piwin/cli test` + typecheck**

**Verify:** CLI test；文档交叉链接能点开

**Acceptance:** CLI 可列/切分支；ADR 0009 不再把 truncate 写成 edit/resend 主路径。

---

### Task 10: S3 最小写边界（warn-only）

**Files:**
- Create: `packages/contracts/src/workspace-writes.ts`
- Create: `packages/contracts/src/workspace-writes.test.ts`
- Modify: `packages/host-runtime/src/store-transcript-recorder.ts` —
  `tool/end` 合并 `metadata.workspaceWrites`
- Modify: `session-branch-commands.ts` — off-path 检查；未 `confirm` 且非空 →
  `{ status: 'needs-confirmation', offPathWrites }`
- Create: host-runtime 侧 `injectBranchCalibrationOnce`（新文件，对标
  `injectProductHistoryOnce`，不要塞进已 666 行的 `prompt-preparation.ts` 太多；
  若只加一个导出函数且文件仍 <1000 可就地加，否则新文件）
- Modify: Desktop `use-branch-actions` — switch 收到 needs-confirmation 弹
  继续/取消（无 worktree 按钮）
- Test: golden cases + 确认卡 + 注入 exactly-once

**`collectWorkspaceWrites(presentation)`:** 写类判定对齐
`isWriteLikeTool` 口径（`kind === 'filesystem' &&` edit family，或
`actionVerb` 为 edit/write）。收 `targetPaths` / `changedPaths`。bash 类写且
路径为空 → `{ files: [], hasUnknownWrites: true }`。只读工具返回 `null`。
**contracts 不 import agent-host。** 复制口径并在两边测试用同一组 fixture
名字注释「keep aligned」。

**off-path 集合：** 当前路径上、分叉点（switch 目标与当前 leaf 的 LCA / 目标
的 parent）之后的 assistant 行 metadata。非空且 `confirm !== true` 才拦截。

**校准注入（切换后首个 prompt，exactly-once per generation）:** 被弃分支
files 清单 + `git status --porcelain` + `git diff --stat` 有界摘要
（`@piwin/git`）。默认开，无设置项。

- [x] **Step 1: collectWorkspaceWrites golden**（edit / write / str_replace /
  bash 无路径 / 只读）
- [x] **Step 2: recorder 落 metadata + branch-switch 拦截测试**
- [x] **Step 3: Desktop 确认卡测试**
- [x] **Step 4: 校准注入 exactly-once 测试**

**Verify:** contracts + host-runtime + Desktop 相关测试

**Acceptance:** A 写文件后切 B 弹卡；继续后模型 prompt 含磁盘校准块；取消不切叶。

---

## Manual smoke（全部任务完成后）

1. 线性对话编辑中间一句 → ‹ 2/2 › 出现；切回 1 能看到旧回复；再问「刚才那个工具跑了什么」模型能答（S1 seed）。
2. 再生成最新助手 → 新分支，旧回答可切回。
3. Revert 只打开编辑卡，点取消会话一字不删。
4. 右键「删除此处之后」才物理删子树。
5. 跑着的时候 ‹n/m› 禁用；Host 返回 run-active。
6. （Task 10）A 分支改文件，切 B 弹卡，文案提到磁盘不跟随。

## Stop / 回滚点

- Task 1–4 可单独合：未分叉用户零可见变化。
- Task 5–6 合入后 Desktop 旧 truncate 客户端仍能说话（子树删除在线性上 ≡ 旧
  truncate），但编辑重发会变成「先删再发」直到 Task 8。**不要在 Task 6 与 8
  之间发版给用户。**
- Task 8 是用户可见切换点；Task 9–10 可紧随。

## 执行顺序

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10。全部顺序依赖，不要并行改同一包。
