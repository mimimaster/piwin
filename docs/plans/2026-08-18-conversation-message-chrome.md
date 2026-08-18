# Conversation 消息身份与用量显示

| Field | Value |
| ----- | ----- |
| Status | Proposed |
| Date | 2026-08-18 |
| Scope | Desktop Conversation（`general && !side-chat`）；`apps/desktop` 为主，contracts 只做透传 |
| Background | 竞品调研（Cherry Studio / LobeChat / LibreChat / Open WebUI / Chatbox / ChatGPT）；`docs/plans/2026-08-16-piwin-conversation-pure-chat-plan.md` Phase 4/6 |
| Non-goals | 多模型同问 Tab；翻译 / TTS / 点赞最佳；改 Usage ledger schema；改 Project Agent 工具链；Mobile / CLI 本轮不跟 |

纯 Chat 计划已经把 Conversation 做成 content-first（无 Tool 手风琴、无 Agent chrome、composer 上有 Context 环）。用户现在觉得「不友好」，缺的不是再藏一层 Agent，而是**每条回复上看不见谁在说话**。

本方案只补消息级身份与用量，不重开 Conversation runtime。

---

## 1. Goal

Conversation 每条助手回复看起来像多模型桌面壳（Cherry / LibreChat），而不是未完成的 Agent 日志。

完成后用户能直接读出：

```text
[厂商图标]  claude-sonnet-4     Anthropic     14:15     1.2K → 486
思考过程（可折）
正文 Markdown
悬停：复制 · 再生成          （Fork / 复制会话进次要位）
```

用户侧保持右气泡，带轻身份，不再是通栏系统通知。

---

## 2. 为什么现在看起来空

对照 Cherry：消息 = Header（身份）+ Body + Footer（操作 / token）。

piwin Conversation 现在：

| 层 | 现状 |
| -- | ---- |
| 助手头 | 无头像、无模型名、无厂商、无时间 |
| 助手身 | Markdown + 思考折叠 + 引用 / Artifact / 生成进度（保留） |
| 助手脚 | 仅最后一条：复制 / 复制会话 / Fork |
| 用户 | 通栏胶囊；悬停才有时间、复制、撤回 |
| 用量 | 只在 composer `ContextUsageRing`，不在消息上 |

数据其实已经在 Host 里：

- `SessionTranscriptMessage.model?: ModelRef`（spec §7.3，`transcript-recorder` 在 `message/start` 写入快照）
- `ChatMessageUi` 的 `mapTranscriptMessagesToUi()` **丢掉了 `model`**
- `usage/update` → session 级 `ContextUsageSnapshot`；`UsageRecord` **没有 `runId`**
- 纯 Chat 计划 CHT-603 明确禁止按时间戳猜 ledger 对应哪条消息

所以 P0 是把已有快照画出来。逐条历史 token 不能靠猜。

---

## 3. 设计

### 3.1 产品站队

ChatGPT / Claude 可以不写模型名，因为整页只有一个品牌模型。piwin 是多 Provider 壳，同一会话会换模型。

**身份钉在消息快照上。** Composer 的模型芯片只说明下一轮，禁止用当前选择回填历史行。

### 3.2 助手消息解剖（Conversation only）

```text
Header   始终可见
         ProviderIcon(20) + 短模型名 + 厂商（次要色）+ 时间
         有本条用量时：入 → 出（或合计），估算标「估算」

Body     现有 ConversationResponseContent
         思考 / Markdown / 引用 / Flashcard / Artifact / 图视频进度

Footer   桌面悬停或 focus-within 出现
         主操作：复制、再生成（仅最新一条）
         次要：Fork / 复制会话（现有，不抢第一排）
```

Project Agent 本轮不改 `TurnWorkDetails`。Header 做成无会话类型依赖的小组件，以后 Agent 要复用只接线，不复制。

### 3.3 用户消息

- 右对齐：`max-width` 约 72%，`margin-left: auto`，不再 100% 通栏。
- 轻身份：右侧 24px 首字母头像（「我」/ 系统 locale 下 You）。v1 不接自定义头像设置。
- 现有折叠、时间、复制、撤回 / 编辑、干预状态全部保留。

### 3.4 模型怎么显示

`ModelRef = { protocol, providerId, modelId }`。展示名解析顺序：

1. 当前 config 里该 `providerId` 的 `provider.name` + `model.label ?? modelId`
2. 配置已删：退回 `providerId` / `modelId`
3. 短名：取 `modelId` 最后一段（`org/claude-sonnet-4` → `claude-sonnet-4`），超长中间省略

图标复用 `apps/desktop/src/provider-icons.tsx`（`modelicons` + 未知厂商字母）。不要新装图标库。

历史行只用 `message.model`。正在流式的那一条允许 `message.model ?? livePromptModel`（发送时冻结的 ModelRef，不是此刻 composer 选择）。

### 3.5 Token 怎么显示（诚实分层）

**v1（本方案必做）**

只把 **session 上最后一次 turn usage** 画在 **当前会话最新已完成助手行**：

- 数据：现有 `contextUsage`（`source === 'assistant-usage' | 'host-estimate'`）
- 文案：复用 `conversation-usage-copy.ts`（`1.2K` / `486` / 耗时）
- `host-estimate` 必须标估算，不能装成账单
- `pi-contextUsage` 是窗口占用，继续只属于 composer 环，不进消息头
- 旧历史行没有芯片，空着，不拿 ledger 按时间戳对消息

这和 Cherry「有 usage 才显示」一致，也遵守 CHT-603。

**v1.1（本方案不实施，只锁接口方向）**

以后要历史逐条 token，正确做法是 Host 在该 run 的 `usage/update` 落到对应 assistant 行：

```ts
// SessionTranscriptMessage 增量，另开 PR
usage?: Pick<ContextUsageSnapshot,
  'promptTokens' | 'completionTokens' | 'cacheReadTokens' |
  'cacheWriteTokens' | 'totalTokens' | 'durationMs' | 'source'>
```

用 `runId` 对齐，禁止客户端猜。本轮不改 ledger、不加 `UsageRecord.runId`。

### 3.6 再生成

不新开 Host 命令。Conversation 助手「再生成」= 对**上一条用户消息**走现有 `onRetry` / revert-and-resend。

- 仅最新助手行显示
- 流式中禁用
- 文案用「再生成」，不要用用户气泡上的「撤回」

Fork / 复制会话是 piwin 会话树能力，留在次要位，不要从 Conversation 主操作里拿掉。

---

## 4. 文件与体量

`apps/desktop/src/chat-thread.tsx` 已超过 1000 行硬顶。本方案**禁止**再往里堆 Header / 用量 / 用户气泡。

新建（按职责拆，不要 `utils.ts`）：

| 文件 | 职责 |
| ---- | ---- |
| `conversation-message-identity.ts` + `.test.ts` | 短模型名、厂商标签、历史 vs 在飞模型解析；纯函数 |
| `conversation-message-header.tsx` + `.test.tsx` | 助手头：图标、名称、时间、可选用量芯片 |
| `conversation-user-message.tsx` | 从 `chat-thread.tsx` 迁出 `UserMessageContent` + 右对齐 / 头像 |
| `region-transcript.css`（或新 `region-conversation-message.css` 若样式 >150 行） | Header / 用户右气泡 |

改动、不新造协议：

| 文件 | 改动 |
| ---- | ---- |
| `chat-reducer.ts` `ChatMessageUi` | 增加 `model?: ModelRef` |
| `mapTranscriptMessagesToUi` | 透传 `message.model` |
| `applyAgentEvent` `message/start` | 不在 reducer 里猜 composer 模型；等 transcript 或 UI 的 live fallback |
| `conversation-response-content.tsx` | 顶部渲染 Header |
| `chat-thread.tsx` | 接线、把用户块迁出；Conversation 下复制不限于最后一条 |
| `assistant-response-actions.tsx` | Conversation 增加「再生成」；Fork/Duplicate 视觉降为次要 |
| `App.tsx` / `ChatThread` props | 传入 `livePromptModel`（本轮已发送冻结的 ModelRef） |

contracts：v1 **不改** `AgentEvent` / `SessionTranscriptMessage`。Host 已经写模型快照。若 live 行在 hydrate 前闪一下无模型，用 `livePromptModel` 填，不扩 `message/start`。

若实施中发现 live 行经常永远没有 `model`（transcript append 不带回快照），再开很小的 follow-up：`message/start` 带 `model?: ModelRef`。不要预支。

---

## 5. 实施阶段

### Phase 0 — 锁测试

**MSG-001** `mapTranscriptMessagesToUi` 丢模型的回归：fixture 带 `model`，断言 UI 现在没有该字段（先写失败测试，再改 mapper 让它绿）。

**MSG-002** Conversation 线程：助手行没有 `conversation-message-header`（先红）。

**MSG-003** 冻结 Project：`TurnWorkDetails` 仍在，不出现 Conversation header。

### Phase 1 — 数据透传

**MSG-101** `ChatMessageUi.model?: ModelRef`

**MSG-102** `mapTranscriptMessagesToUi` 复制 `message.model`。`transcript/append`、resume、load-older 自动带上。

**MSG-103** 纯函数 `resolveConversationMessageModel({ message, livePromptModel, isStreaming })`：

- 有快照 → 快照
- 无快照且正在流式 → `livePromptModel`
- 其余 → `undefined`（Header 仍可只显示时间）

禁止：用 App 里「当前下拉框选中模型」标注 `status === 'done'` 的旧行。

### Phase 2 — 助手 Header

**MSG-201** `ConversationMessageHeader`

- `ProviderIcon` size 20
- 短模型名 `semibold`；厂商 `tertiary`；时间复用现有 `formatMessageTime`（从 chat-thread 抽到 identity 模块或小 `message-time.ts`）
- 无 `model` 时：不渲染假名「Assistant」，只留时间（若有）
- `data-testid="conversation-message-header"`

**MSG-202** 只在 `isConversationSession` 的助手行挂 Header，放在 `ConversationResponseContent` 顶部。

**MSG-203** 样式：一行、不换行、名称中间省略。不要做成卡片，不要彩色描边。

### Phase 3 — 用户行

**MSG-301** 迁出 `UserMessageContent`。

**MSG-302** 右对齐 + 24px 字母头像。双击编辑、折叠、干预按钮行为不变。

**MSG-303** 现有 `chat-thread.test.tsx` 用户复制 / 时间 / revert 全绿。

### Phase 4 — 用量芯片（最新一条）

**MSG-401** Header 可选 `usageChip`。数据从 `ChatThread` 传入，不让 Header 自己订 `contextUsage`。

规则：

```text
message 是最新已完成助手
AND contextUsage.source 是 assistant-usage 或 host-estimate
AND 至少有 promptTokens 或 completionTokens 或 totalTokens
→ 显示「入 → 出」；缺一侧则只显示有的；host-estimate 加估算标记
```

占用 / 上限仍只在 composer 环。芯片 hover title 可复用 `buildConversationUsageDetailRows` 的入出缓存耗时，不新开 popover。

**MSG-402** 流式中不显示本条芯片（数字会跳）。`message/end` 且 usage 到达后再出现。

### Phase 5 — 操作分层

**MSG-501** Conversation：每个 `status === 'done'` 且有正文的助手行都有复制。

**MSG-502** 最新助手行增加「再生成」，调用上一条用户 `onRetry`。找不到用户行则隐藏。

**MSG-503** 桌面：Footer `opacity: 0`，row hover / focus-within 显示。触控（`pointer: coarse`）常显。

**MSG-504** Fork / 复制会话留在同一条 Footer，排在复制 / 再生成后面，图标尺寸一致、tooltip 写清楚不是「再生成」。

### Phase 6 — 回归与手工 QA

见 §7 / §8。

---

## 6. 风险

| ID | 风险 | 处理 |
| -- | ---- | ---- |
| R1 | 用当前 composer 模型标历史 | 测试：两条助手、不同 `model` 快照，切 composer 后旧行不变 |
| R2 | 把 `pi-contextUsage` 当本条账单 | 芯片只认 assistant-usage / host-estimate；占用留在环上 |
| R3 | 按时间戳把 ledger 贴到旧消息 | v1 禁止；只标最新一条 |
| R4 | `chat-thread.tsx` 继续膨胀 | Phase 3 必须先迁出用户块；Header 独立文件 |
| R5 | Project 被加头像变得像 Chat | Header 只挂 `isConversationSession` |
| R6 | live 行模型闪烁 | `livePromptModel` fallback；快照到达后以快照为准 |
| R7 | 「再生成」和「撤回」搞混 | 文案分离；再生成只在助手 Footer |
| R8 | 远程 Host 旧投影丢掉 `model` | Header 降级为仅时间；不编造名称 |

---

## 7. 测试

### 7.1 纯函数

`conversation-message-identity.test.ts`

- 短名：`anthropic/claude-sonnet-4-20250514` → 可读短名
- 解析：快照优先于 live
- done 且无快照 → `undefined`，即使传入 live
- streaming 且无快照 → live

### 7.2 Mapper

`chat-reducer.test.ts`

- transcript `model` 出现在 `ChatMessageUi`
- 无 `model` 的 legacy 行不抛、字段省略

### 7.3 Conversation UI

`conversation-message-header.test.tsx` / `chat-thread.test.tsx`

- Conversation 助手行：图标 + 模型名 + 厂商
- 切换 composer 模型不改已完成行的名称
- 最新完成行在 mock `assistant-usage` 下显示芯片；`host-estimate` 有估算标记
- 更早的助手行无芯片
- 每条完成助手都能复制；只有最新条有再生成
- Project fixture：无 `conversation-message-header`
- 用户行右对齐 + 头像；复制 / revert 仍在

### 7.4 不写

- 不为 v1.1 transcript `usage` 字段预写 Host 测试
- 不改 e2e 套件也能合；若现有 Conversation e2e 断言「无额外 chrome」，改断言允许 header

---

## 8. 手工 QA

1. 新建 Conversation，发「你好」：助手头有模型图标和名称，时间合理。
2. 换模型再发一轮：两条助手名称不同；旧的不变。
3. 重开该会话：名称仍是快照，不是当前 composer。
4. 看最新一条：有入/出芯片（provider 有 usage 时）；composer 环仍是占用/上限。
5. 悬停最新助手：复制、再生成；再生成重答上一问。
6. 长用户消息：仍可折叠；气泡在右侧。
7. 打开 Project session：无此 Header，工具卡还在。
8. 无模型快照的老 general 会话：不崩溃，Header 可只显示时间。

---

## 9. Definition of Done

- [ ] Conversation 助手行有身份头（图标 + 名称；有厂商则显示）。
- [ ] 名称来自消息快照，不被当前 composer 污染。
- [ ] 流式行可用 `livePromptModel`，hydrate 后改用快照。
- [ ] 用户行右对齐并有轻头像。
- [ ] 最新完成助手在真实 turn usage 下显示入/出；估算有标记。
- [ ] 历史行不强行贴 token。
- [ ] Conversation 每条完成回复可复制；最新条可再生成。
- [ ] Project / Side Chat 视觉与工具链不变。
- [ ] `chat-thread.tsx` 行数下降（迁出用户块），新文件各 <400 行。
- [ ] 相关 unit / component 测试绿；`pnpm typecheck` 绿。

---

## 10. 明确不做

- 多模型 Tab / 点赞最佳 / 翻译 / TTS
- 自定义用户头像、助手角色人设
- 改 Usage ledger、`UsageRecord.runId`、按时间对齐
- 把占用环搬到消息上（环仍表示 context window）
- 为 Header 改 ADR / 新 Host 命令
- 顺手重构 `App.tsx`、Markdown、Artifact
- Mobile 消息头（需要再开一刀，复用 identity 纯函数即可）

---

## 11. 推荐提交拆分

1. **Mapper + identity 纯函数**（MSG-001, 101–103）— 无视觉，可单独合
2. **Header + 用户右气泡**（Phase 2–3）— 友好性主体
3. **最新条用量芯片 + 再生成 / hover Footer**（Phase 4–5）

不要把 2 和 3 跟无关 Desktop 改动绑在一个 PR。
