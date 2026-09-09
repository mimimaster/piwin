# Spec: Turn repair vs. branch exploration (会话树重做)

| Field | Value |
|-------|-------|
| Date | 2026-08-27 |
| Status | Implemented |
| ADR | [0064](../adr/0064-turn-repair-vs-branch-exploration.md) (revises [0055](../adr/0055-in-session-conversation-tree.md)) |
| Touches | `contracts`, `session`, `host-runtime`, `apps/desktop`, `apps/cli` |
| Out of scope | Fork Chat / cross-session lineage (`2026-08-27-session-tree-and-fork-chat.md`, ST-D1..D8) — unchanged |

---

## 1. 问题

一句话：**树被拿来记录"我只是想让它再跑一遍"，而不是"我要探索另一条路"。**

现状（ADR 0055 决策 3）把 edit/resend、regenerate、失败重试**全部**走
`PromptInput.branchFromMessageId`。该字段把 active leaf 挪到目标 user 行的
**父节点**，于是每次手势都追加一条新的 **user** 兄弟行。

实测后果（`session-mt9w1adm-cktxc1ux`）：用户从未打开会话树，只是在两次中断后
点了重试，结果一个分叉点下挂了三条**一字不差**的提问，其中两条的助手回复是
`Request was aborted`。同一会话根部还有四条同文提问，同样成因。

这与产品自己更早的判断冲突（`session-fork-product-adaptation.md` §1：默认线性，
树只在用户显式创建后出现），也与 Pi 原生模型冲突——Pi 的树是 append-only 存储
加**显式** `/tree` 导航，自动重试从不分叉，选中 user 条目只是把文本回填编辑器，
分不分叉由用户决定。

## 2. 产品语义：三个动词，不许混

| 动词 | 用户心智 | 是否产生兄弟 | 触发方式 |
|------|----------|--------------|----------|
| **修复 Repair** | "这轮没跑好，再来一次" | 否（默认），失败版本被丢弃 | 重试按钮 / 错误卡 |
| **探索 Explore** | "旧的留着，我要另一条" | 是 | 改了内容后重发；显式"另生成一版" |
| **回退 Revert** | "这里之后我都不要了" | 否，删子树 | 「回到此处」确认框 |

推论（本方案的全部约束都从这三行推出）：

- **内容没变 = 修复**，不是分叉。
- **失败的尝试没有保留价值**，重试时直接删掉，不留兄弟。
- **成功的回答有比较价值**，"另生成一版"保留旧答案作兄弟。
- **同一个提问的多个回答不该显示成多个提问**。
- **Revert 这个词只归 `session/truncate-from`**，别的地方不许用。

## 3. 动作矩阵

| UI 入口 | 现在 | 改成 | 写入 |
|---------|------|------|------|
| user 气泡 ↺ 图标（`message-revert-btn`） | 进编辑卡，实为 branchResend | **删除该图标**，改为 ✎ 编辑 | — |
| 编辑卡「重试」，文本/附件**未变**（含只换模型） | 新 user 兄弟 | **重试**：复用原 user 行，丢掉上一份回答 | `retryUserMessageId` |
| 编辑卡「开分支」，文本未变 | （无此按钮） | **探索**：保留当前回答，新 user 兄弟 | `branchFromMessageId` |
| 编辑卡「发送」，文本/附件**已变** | 新 user 兄弟 | 不变（真·提问分叉） | `branchFromMessageId` |
| 错误卡 / 中断后「重试」（空气泡） | 新 user 兄弟 | **重试**：删掉失败尝试再跑 | `retryUserMessageId`, `keepPreviousAttempt: false` |
| 错误卡「继续」/ 截断条 | — | **继续**：不截断、不新建用户行 | `source: continuation` |
| 错误卡「从头再来」 | — | 显式 wipe-retry | `retryUserMessageId`, `keepPreviousAttempt: false` |
| 助手操作条「再生成」 | 新 user 兄弟 | **另生成一版**：保留旧回答作兄弟 | `retryUserMessageId`, `keepPreviousAttempt: true` |
| 「删除此处及之后」 | truncate-from | 文案改「回到此处」，行为不变 | `session/truncate-from` |
| Fork Chat | 新会话 | 不变 | `session/fork` |

## 4. 数据模型：两种兄弟

`transcript_message.parent_message_id` 不变；区分只靠**兄弟节点的 role**：

```
提问分叉（Explore）              回答版本（Repair / 另生成一版）
  parent                            user "写个函数"
  ├── user "写个函数"                 ├── assistant  第 1 版
  └── user "写个类"                   └── assistant  第 2 版  ← active
```

- `listBranchPoints` **无需改 schema**：回答版本天然表现为「anchor 是 user 行、
  siblings 是 assistant 行」的分叉点。
- 客户端按 `siblings[0].role` 分流渲染：user → 提问分叉卡片；assistant →
  挂在回答上的 `‹n/m›` 版本切换。

## 5. 契约变更（`packages/contracts/src/host.ts`）

```ts
export type PromptInput = {
  // ...
  /**
   * 真·提问分叉：本次 prompt 作为目标 user 行的兄弟替代它（ADR 0055）。
   * 仅当文本 / 附件 / contextRefs 相对原轮**确有变化**时发送。
   */
  branchFromMessageId?: string;
  /**
   * 重跑同一轮（ADR 0064）。Host 把 active leaf 挪到该 user 行**自身**，
   * 不新建 user 行——备选答案落成该轮的 assistant 兄弟。
   * 目标必须是 user 行且在当前活跃路径上。
   */
  retryUserMessageId?: string;
  /**
   * 保留上一次尝试作为兄弟回答（"另生成一版"）。默认 false：
   * 先 truncate 掉上一次尝试的子树再重跑（失败轮无保留价值）。
   * 仅与 `retryUserMessageId` 同用。
   */
  keepPreviousAttempt?: boolean;
};
```

`branchFromMessageId` 与 `retryUserMessageId` **互斥**，同时出现由 Host 拒绝。

Desktop 局部裁剪需要一个对偶动作（`apps/desktop/src/chat-reducer.ts`）：
`session/branch-switched` 增加 `clipAfterMessageId?: string`，保留该行、丢弃其后
的可见消息（现有 `clipBeforeMessageId` 用于提问分叉，保留）。

## 6. Host 变更（`packages/host-runtime`）

### 6.1 `session-prompt-command.ts`

在 `rebaseForBranchPrompt` 旁新增 `rebaseForRetryPrompt`，同一批前置校验：

```
1. 有前台 run → fail `run-active: cannot retry ${targetId} while a run is active`
2. 目标不存在 → fail `retry-target-not-found`
3. 目标不是 user 行 → fail `retry-target-not-user`
4. 目标不在活跃路径上 → fail `retry-target-off-path`
5. 两个字段同时出现 → fail `retry-and-branch-conflict`
6. keepPreviousAttempt !== true 时：
     找到该 user 行在活跃路径上的**首个子节点**，
     若存在则 store.truncateFrom(childId)   ← 丢弃这次失败尝试
7. store.rebaseActiveLeaf(targetUserMessageId)
```

第 6 步用已有的 `truncateFrom`，不新增删除路径。第 7 步与分叉共用
`rebaseActiveLeaf`，差别只在 rebase 到 **user 行自身** 而非其父。

### 6.2 不再重复记录 user 行

`preparePromptInput` / prompt 落库路径必须在 `retryUserMessageId` 存在时
**跳过 `recordUserPrompt`**，复用原 user 行的 id、文本、附件、contextRefs 作为
本次 run 的提问。这是"重试不产生重复提问"的关键，缺了它这个方案等于没做。

模型侧输入仍按原 user 行的内容重建；`PromptInput.text` 在重试时应为空串或被
忽略——以存储为准，避免客户端回传导致内容漂移。

### 6.3 推送

重试完成后照常 `session/branch-updated`。当 `keepPreviousAttempt !== true` 且
删除了失败子树时，分叉点数量应回落，不产生新分叉点。

## 7. Desktop 变更（`apps/desktop`）

### 7.1 `hooks/use-branch-actions.ts`

- 新增 `retryTurn(userMessageId: string, options: { keepPrevious: boolean })`：
  - 复用 `branchResend` 的守卫（无会话 / streaming / 未信任项目 / 前台冲突）。
  - **不 dispatch `user/send`**。Host **接受**后才 dispatch
    `{ type: 'session/branch-switched', clipAfterMessageId: userMessageId }`
    （保留原气泡，清掉其后的回答）。写盘确认未过关前不得裁剪，避免闪一下。
  - `buildRetryPromptInput()`：只带 `retryUserMessageId`、`keepPreviousAttempt`
    与本轮模型/thinking/permission/orchestration，**不带** `text` /
    `clientMessageId` / `attachments`（内容以 Host 存储为准，见 §6.2）。
  - Host 已改写后的失败才 `reloadTranscript` 回滚（无乐观气泡，无需
    `user/send-rollback`）。`retry-discards-writes` 只弹确认，不裁剪、不重载。
- `branchResend` 保留，但调用方必须先做内容比对（§7.2）。
- 导出 `retryTurn`，`App` 透传给错误卡、助手操作条、编辑卡。

### 7.2 编辑卡内容比对

`message-edit-card` 的 `onResend` 之前判定：

```ts
const unchanged =
  nextText.trim() === original.text.trim() &&
  attachmentsEqual(nextAttachments, original.attachments) &&
  contextRefsEqual(nextRefs, original.contextRefs);
unchanged ? retryTurn(id, { keepPrevious: false }) : branchResend(id, nextText);
```

比对函数放 `apps/desktop/src/conversation-branch.ts`（已有分支工具的归属地），
不新建 `utils.ts`。

### 7.3 消息行与操作条

- `conversation-user-message.tsx`：移除 `message-revert-btn` 与 `IconRevert`
  引用；编辑入口统一为铅笔图标 + 双击气泡（双击行为已存在，不动）。
- `assistant-response-actions.tsx`：Conversation 模式的
  `response-regenerate-btn` 改调
  `retryTurn(precedingUserId, { keepPrevious: true })`。
  Project / Agent 会话故意不提供「另生成一版」——那边的成功轮走工具循环，
  入口只保留错误卡重试。
- 失败轮（`status === 'error'` / `runRecord.outcome === 'failed'` / 空回答）
  的重试改调 `retryTurn(precedingUserId, { keepPrevious: false })`。
- 回答有多版本时，在助手气泡底部渲染 `‹ 2/3 ›` 切换器，点击走
  `switchBranch(siblingHeadId)`。数据来自 §4 的 assistant-sibling 分叉点。

### 7.4 会话树面板

- `branch-points-panel.tsx`：分两类渲染。
  - **提问分叉**：保持现有卡片。
  - **回答版本**：折叠进对应提问下的一行 "N 个回答版本"，不再各占一张卡。
- 空态文案改写（§8）：不再教用户"编辑重发即可产生分支"——那正是 bug 成因。
- `conversation-tree-popover.tsx` 的计数只统计**提问分叉**，回答版本不计入
  header 徽标，避免"我没分叉却显示 3"。

## 8. 文案（zh / en）

| 位置 | 现在 | 改成 |
|------|------|------|
| user 气泡动作 | 撤回 / Revert | 编辑 / Edit |
| 编辑卡按钮（内容未变） | 发送 | 重试 / Retry |
| 编辑卡按钮（内容已变） | 发送 | 发送新版本 / Send new version |
| 助手操作条 | 再生成 / Regenerate | 另生成一版 / Try another answer |
| 截断确认框标题 | 删除此处及之后 | 回到此处 / Revert to here |
| 截断确认框正文 | — | 这条之后的所有消息会被删除，不可恢复。 |
| 树面板空态 | "编辑并重发即可创建分支" | "改写某一轮的提问后发送，会在这里留下一个分叉。" |

## 9. 边界与拒绝

- **重试期间有前台 run**：拒绝，`run-active`，不静默排队（与分叉一致）。
- **重试目标不在活跃路径**：拒绝。要重试历史分支上的一轮，先 `branch-switch`。
- **失败尝试写过文件**：`keepPreviousAttempt: false` 会删除该子树。删除前沿用
  `listAbandonedAssistantRows` 检查，命中则弹既有的 write 警告确认框，不新造
  一套确认 UI。
- **重试第一轮（root user 行）**：合法，rebase 到该行自身即可，不产生根级同文
  提问（正是现在的 bug）。
- **contextRefs 时效性**：以存储为准重解析，与首次发送同路径。

## 10. 迁移

不迁移。旧会话里已有的同文提问兄弟仍然合法可切换。可选后续：会话树面板对
"同文相邻兄弟"给一个"合并/清理"入口——本方案不含。

## 11. 验收

手动（Desktop）：

1. 发一轮 → 中途 Stop → 点重试。**期望**：提问只有一条，树面板无新分叉点，
   失败回答消失。
2. 一轮成功 → 点「另生成一版」。**期望**：提问仍一条，回答出现 `‹1/2›`，
   可来回切换；树面板在该提问下显示"2 个回答版本"，header 徽标不变。
3. 双击提问 → 一字不改点发送。**期望**：等同用例 1（重试，不分叉）。
4. 双击提问 → 改文字发送。**期望**：产生提问分叉 `‹1/2›`，旧提问与其回答完整
   保留可切回，header 徽标 +1。
5. 「回到此处」→ 确认。**期望**：该行及其后全部消失，不可恢复。
6. 全程未开树的普通对话，树面板保持空态。

自动化：

| 层 | 用例 |
|----|------|
| `packages/session` | `rebaseActiveLeaf(userRow)` 后 append，得到 assistant 兄弟；`truncateFrom(firstChild)` 后重试不留残留 |
| `packages/host-runtime` `session-conversation-tree.integration.test.ts` | 新增：retry 不新增 user 行；`keepPreviousAttempt` 两种取值；四类拒绝错误码；retry+branch 互斥 |
| `apps/desktop` | 编辑卡内容比对分流；`clipAfterMessageId` reducer；retry 不 dispatch `user/send` |
| `apps/cli` | `session retry` 命令；branches 输出区分两类兄弟 |

## 12. CLI

- `piwin session retry <userMessageId> [--keep]` → `retryUserMessageId`
  (+ `keepPreviousAttempt`)。
- `runSessionBranches` 输出按 §4 分类：
  - `fork N at <anchor>` 用于提问分叉（保持现状）；
  - `answers at <anchor> (2/3 active)` 用于回答版本。

## 13. 落地顺序（每步可独立 ship）

1. **contracts**：加两个字段 + 互斥说明。typecheck 全绿。
2. **host-runtime**：`rebaseForRetryPrompt` + 跳过 `recordUserPrompt` + 集成测试。
   *此时 Host 已能正确重试，客户端尚未接。*
3. **desktop 行为**：`retryTurn` + 编辑卡内容比对 + 错误卡/再生成改接线。
   *此时同文分叉的 bug 消失。*
4. **desktop 呈现**：`‹n/m›` 回答版本切换、树面板两类分流、header 徽标口径。
5. **文案** zh/en 全量替换，移除 `message-revert-btn`。
6. **CLI** 对齐。
7. **文档**：更新 `session-conversation-tree.md` §5.2 / §9.1 指向 ADR 0064。

第 1–3 步是止血，可作为一个 PR；4–7 是补全，分开走。
