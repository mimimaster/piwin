# Piwin Conversation 纯 Chat 改造可执行计划

**对应 Spec：** `Piwin-Conversation-Pure-Chat-Design-Spec.md`  
**版本：** v1.0  
**日期：** 2026-08-15  
**仓库基线：** `main @ 3fe426e75e8d`  
**原则：** 小步提交、先 Host 边界、再 UI；不改持久化 schema；每阶段都必须保住 Project / Side Chat 回归测试。

---

## 0. 实施结果应该是什么

实施完成后：

```text
Conversations
  -> general scope
  -> pure Chat blueprint
  -> no Pi/project resource discovery
  -> no Agent prompt assembly
  -> explicit context only
  -> Web / Artifact / Flashcards / Image / Video
  -> no visible Tool chain
  -> context/token stats kept

Projects
  -> existing Coding Agent behavior unchanged

Side Chat
  -> existing read-only behavior unchanged
```

不需要 migration，不需要新 mode toggle，不需要重建 session engine。

---

## 1. 修改范围总表

| 区域 | 主要文件 | 改动 |
|---|---|---|
| Blueprint | `packages/host-runtime/src/blueprint-compiler.ts` | Conversation fast path、空 resources/context、Chat tool policy |
| Tool Policy | `packages/host-runtime/src/capabilities/tool-policy-resolver.ts`（尽量复用） | 只复用 resolver；不扩大 Agent 行为 |
| Toolbox | `packages/host-runtime/src/host-toolbox.ts` | descriptor 文案按实际 targets 生成；验证 lazy surface |
| Prompt | `packages/host-runtime/src/commands/session-live-commands.ts` | 跳过 orch/delegation/agent/plan/filesTouched，保留 refs/attachments/history |
| Artifact | `packages/host-runtime/src/artifact-instructions-tool.ts` | 原则上不改；补回归测试 |
| Desktop Thread | `apps/desktop/src/chat-thread.tsx` | Conversation content-first 分支 |
| Agent Work UI | `apps/desktop/src/turn-work-details.tsx` | Project 原样；Conversation 不进入此组件 |
| Chrome | `apps/desktop/src/context-bar.tsx`, `status-bar.tsx`, `App.tsx` | Conversation 隐藏 Agent chrome，保留 model/context |
| Composer | `apps/desktop/src/composer-dock.tsx` + App 组装 | Conversation 隐藏 Agent/Orchestration/Skills/Permission controls |
| State | `apps/desktop/src/chat-reducer.ts` | 尽量不改事件模型；复用 `contextUsage` 和 trace |
| Tests | 对应 `.test.ts/.test.tsx` + desktop e2e | Pure Chat 边界 + Project/SideChat 回归 |

---

# Phase 0 — 先锁住现状

目标：改 Host 前先把“不能被误伤的东西”写成测试。

## CHT-001：建立会话分类测试

**位置：** Host runtime 测试层，优先放 `blueprint-compiler.test.ts`。

覆盖：

```text
general + main/undefined -> Conversation
project + main/undefined -> Project Agent
any + side-chat -> Side Chat 分支
```

**实现建议：** 不必新增 contracts schema。若多个 Host 文件确实需要同一判断，可抽一个极小内部 helper；否则就保持局部判断。

**完成标准：** 测试能明确防止 Side Chat 被 general scope 误判为 Conversation。

## CHT-002：冻结 Project Blueprint 回归

对一个 trusted project fixture 断言现有：

- resource discovery 仍发生；
- Pi/project context policy 不变；
- Agent tool families 不变；
- `DEFAULT_AGENT_MODE_SYSTEM_PROMPT` 仍在 Project；
- Artifact/Search/MCP 现有逻辑不变。

## CHT-003：冻结 Side Chat 回归

断言：

- fixed read-only tool profile 继续存在；
- Pi builtins `read/grep/find/ls` 保持现有结果；
- 无 write/shell/process/delegate；
- external-only search route 行为保持。

**Phase 0 退出条件：** 后续任何改动破坏 Project/Side Chat 时测试会直接红。

---

# Phase 1 — Blueprint 真正切成 Chat

这是整个改造最关键的一刀。

## CHT-101：在 `compileBlueprintForWorker()` 早期识别 Conversation

**文件：** `packages/host-runtime/src/blueprint-compiler.ts`

当前顺序在 location/cwd 后立刻进入 resource discovery。修改成：

```ts
const location = await resolveSessionLocation(...);
const agentCwd = resolveAgentCwd(location, input.cwd);

const isConversation =
  input.sessionKind !== 'side-chat' &&
  location.scope.kind === 'general';

if (isConversation) {
  return compileConversationBlueprint(...);
}

// 现有 resource discovery + project/side-chat path
```

### 注意

Conversation 仍需：

- config；
- provider envelope；
- model；
- search route；
- concrete Host tool descriptor/family index；
- settings/rules revisions（如果 Snapshot/Runtime 需要）；
- stable product session id。

不要把这些一起砍掉。

## CHT-102：实现 `compileConversationBlueprint()`

**建议先放同文件 private function。**

输入尽量复用 `CompileBlueprintOptions` 和当前编译产物类型。

构造：

```ts
contextPolicy = {
  allowPiNativeInstructions: false,
  allowProjectAgentsFiles: false,
  allowProjectSystemPrompts: false,
};

resourceManifest = empty;
contextManifest = empty;
```

不要调用：

```text
discoverResourcesDefault
resolveResourceActivations
DiscoverContextManifest
```

### 测试

给 `options.discoverResources` 传一个会 `throw new Error('should not call')` 的 mock，Conversation 编译必须成功。

同理给 context discovery 做可测试边界；如果当前函数不可注入，至少对返回 manifest + assembly 做结构断言，并考虑给 compiler 增加只供测试的 discovery override，而不是让测试依赖真实 HOME。

## CHT-103：Conversation System Prompt

新增一个小常量/函数，例如：

```ts
formatConversationSystemPrompt()
```

只写：

- general conversational assistant；
- only explicit external context；
- use available capabilities when useful；
- present results, not mechanics。

**不要引用 `DEFAULT_AGENT_MODE_SYSTEM_PROMPT`。**

然后拼接：

```text
conversation core
artifact compact hint? (only when tool present)
search route brief? (only when needed)
```

MCP prompt 永远不进入 Conversation。

### 测试

断言 system append：

```text
contains chat boundary
not contains agent mode prompt marker
not contains MCP capability prompt
```

不要用完整字符串 snapshot 卡死措辞；测试关键语义/组成项。

---

# Phase 2 — Conversation 专属 Tool Policy

## CHT-201：构造 Conversation exposure

**文件：** `blueprint-compiler.ts`，复用 `resolveToolPolicyDetails()`。

为 Conversation 显式传：

```text
filesystemRead = false
filesystemWrite = false
shell = false
mcp = false
process = off
browser = off
subagents = off
delegate = false
planning = false
notes = off
flashcards = agent-create (配置允许时)
artifact = config.artifact.enabled
imageGeneration = enabled & available
videoGeneration = enabled & available
webSearch / webFetch = 按现有 route/config
```

这样 tool family 的可用性仍由现有 resolver + `availableFamilies` 交叉验证，不自己发明第二套 availability 规则。

## CHT-202：分离 execution families 和 model-visible tools

Conversation 需要 target family 用于 toolbox 的执行许可，但具体 target schema 不该常驻模型。

实现流程：

```text
1. resolvedPolicy.enabledFamilies
2. 从 hostToolFamilyIndex 得到 effective tool names
3. 得到 toolbox target families 的 targetNames
4. model-visible tool names 过滤掉 targetNames
5. 保留 piwin_toolbox 自身
6. 用 buildHostToolboxDescriptor(targetNames) 重写 toolbox descriptor
```

伪代码：

```ts
const toolboxTargetNames = ...;
const hiddenBehindToolbox = new Set(toolboxTargetNames);

const modelToolNames = effectiveToolNames.filter((name) =>
  !hiddenBehindToolbox.has(name) || name === HOST_TOOLBOX_NAME
);
```

### 关键验收

Conversation model manifest **不能同时出现**：

```text
piwin_toolbox
image_generate
video_generate
flashcard_create
...
```

应该只出现 toolbox + 非 toolbox 能力。

## CHT-203：限定 Toolbox targets

Conversation 允许 target families：

```text
flashcards-read
flashcards-write
image-generation
video-generation
```

禁止：

```text
process
browser
notes-read
notes-write
```

测试 descriptor `parameters.properties.target.enum` 中完全没有禁用 target。

## CHT-204：修 `host-toolbox.ts` 固定描述

**文件：** `packages/host-runtime/src/host-toolbox.ts`

把：

```text
Use proactively when the task needs browser, process, notes, flashcards, image, or video...
```

改成基于实际 target 的中性说明。

### 测试

- Conversation enum 无 browser/process/notes；
- description 不再声称未开放能力；
- Agent toolbox 的 available target list 仍正确。

## CHT-205：Artifact lazy 回归

**文件：** `artifact-instructions-tool.test.ts` + `blueprint-compiler.test.ts`

断言：

- Conversation 有 `artifact_instructions` 时只有 compact hint 常驻；
- full runtime contract 不在 blueprint system prompt；
- tool call 后才返回 full contract。

---

# Phase 3 — Prompt 发送路径去 Agent 化

这里分成“发送前”和“prompt assembly”两处做。

## CHT-301：在 `session/prompt` 入口拿到 session scope

**文件：** `packages/host-runtime/src/commands/session-live-commands.ts`

在 prompt admission 阶段需要可靠判断当前 session 是 Conversation。

优先从 durable session record / 已有 scope helper 获取，不要相信客户端额外传一个 `isChat`。

得到：

```ts
const conversationChat = ...;
```

这个值在本次 run preparation 中复用。

## CHT-302：Conversation 跳过 Orchestration 预校验

当前 `session/prompt` 在接受 run 前会读取 `orchestrationSchemeId` 并 resolve。

改成：

```ts
if (!conversationChat) {
  // existing orchestration validation
}
```

Conversation 即使旧客户端传了 id，也不执行。

## CHT-303：Conversation 跳过 Delegation Runtime

当前：

```ts
await context.prepareDelegationRuntime?.(...)
```

只允许 Agent/Side Chat 现有语义需要的路径调用。Conversation 不准备 Subagent runtime。

同时 Conversation 的 effective delegation 必须视为 disabled。

## CHT-304：把 `preparePromptInput()` 拆成“公共部分 + Agent 增量”

不要复制整份函数。

建议结构：

```ts
preparePromptInput(..., { conversationChat })
```

公共部分继续执行：

```text
record user prompt
buildModelPromptInput
attachment contributions
side-chat snapshot（仅 side-chat，自身判断继续）
contextRefs
persist model/thinking
```

Agent 增量整个包在：

```ts
if (!conversationChat) {
  applyAgentMode...
  applyOrchestration...
  injectActivePlan...
  injectFilesTouched...
}
```

为了代码更干净，可以把这四块抽成：

```ts
applyAgentPromptContext(...)
```

但不要建立策略类/注册表。

## CHT-305：Conversation 清除/忽略 Agent permission override

Conversation 每轮明确：

```ts
context.clearSessionPermissionOverride(sessionId);
```

避免这个 general session 曾经被旧行为设置过 override 后残留。

## CHT-306：保持 `contextRefs`

测试必须覆盖：

```text
@file -> exactly one context-ref assembly contribution
selection -> context-ref
attachment -> attachment/native-image
```

同时模型工具 manifest 没有 filesystem read。

## CHT-307：保持 cold history

保留 `injectProductHistoryOnce()`。

测试：

- reconstructed Conversation 首次 prompt 有 product-history；
- 第二轮不重复注入；
- history 不包含隐藏的 Project/Agent state；
- persisted `contextRefs` 能按现有机制重新解析。

## CHT-308：Conversation assembly 白名单测试

对普通 `hello`：

允许：

```text
user
product-history?（仅 cold）
```

禁止：

```text
agent-mode
orchestration
active-plan
files-touched
side-chat
```

对 attachment/ref 场景只增加对应 explicit contribution。

---

# Phase 4 — Desktop 变成真正的 Chat UI

## CHT-401：把现有 Conversation 判定传进 `ChatThread`

**文件：** `apps/desktop/src/App.tsx`, `chat-thread.tsx`

`ContextBar` 已有 `isConversationSession`，沿用 App 里现有 general-session 判断，不增加第二套 UI mode state。

新增：

```ts
ChatThreadProps.isConversationSession?: boolean
```

默认 false，避免测试/Project 调用者被意外改变。

## CHT-402：Conversation assistant row 不进入 `TurnWorkDetails`

**文件：** `apps/desktop/src/chat-thread.tsx`

现在：

```tsx
<TurnWorkDetails>
  <MarkdownView />
  <CitationCards />
</TurnWorkDetails>
```

改成逻辑：

```tsx
isConversationSession
  ? <ConversationResponseContent ... />
  : <TurnWorkDetails ...>...</TurnWorkDetails>
```

`ConversationResponseContent` 可以先是当前文件内的小组件，内容只有：

- MarkdownView；
- CitationCards；
- message attachments；
- Chat 领域结果；
- streaming caret。

不需要复制 message actions / context menu / fork 等外层逻辑。

## CHT-403：Conversation 隐藏 Tool/Thinking/Agent blocks

确保 Conversation 不渲染：

```text
TurnToolGroup
raw thinking
permission block
AgentLocator
SkillActivityChip
SubagentActivityCard
FilesChangedBar
PlanCard
GoalStickyStrip
AssemblySummaryCapsule
WalkthroughAction
```

实现时优先在更高层“不进入”这些组件，不要在每个子组件里加 `if conversation`。

## CHT-404：保留 Generation progress

`ImageGenerationProgress`、`VideoGenerationProgress` 当前已经在 `TurnWorkDetails` 外部渲染，可继续保留。

确认 toolbox describe/call 本身不会变成额外卡片；只根据 generation tool/status 推导人类状态。

## CHT-405：Web 只显示 CitationCards

Conversation 搜索回答：

- Markdown answer；
- CitationCards；
- 无 `web_search` Tool Card；
- 无 raw output。

## CHT-406：Flashcard 结果使用领域 UI

如果当前 flashcard tool result 已有 structured `ToolPresentation` / Artifact action，优先复用现有 Flashcards domain component。

如果现有结果仍完全依赖 ToolCard，则新增一个很薄的 Conversation mapping：

```text
tool presentation kind -> Flashcard result block
```

不要把通用 Tool Card 样式搬过来。

## CHT-407：旧 Conversation 历史兼容

fixture 放一段旧 transcript：assistant text + tool events + thinking。

Conversation 打开后：

- 正文正常；
- generation/artifact/domain result 正常；
- raw thinking/tool group 隐藏；
- reducer 中 `message.tools` 仍然存在。

这个测试证明你只是改 presentation，没有删 trace。

---

# Phase 5 — Composer / Chrome 去 Agent 化

## CHT-501：Composer controls

**文件：** `composer-dock.tsx` + `App.tsx` 的 props 组装。

给 Composer 一个现有 scope 推导出来的 `conversation` presentation flag，Conversation 隐藏：

```text
Agent Mode
Goal / Plan / Ask
Orchestration
Pi Skill picker
Agent permission controls
Project-only controls
```

保留：

```text
model
thinking level
attachment
context refs
send / stop
```

Host 仍然要做 Phase 3 的防线，不能只靠这里。

## CHT-502：ContextBar

已有 `isConversationSession`：

- 保持隐藏 Work Panel；
- Conversation 不传 `permissionMode`，因此不显示 Auto/Ask/YOLO；
- run status 只显示普通状态，不提供 Activity/Plan/Permission Agent action。

## CHT-503：StatusBar

**文件：** `status-bar.tsx`, `App.tsx`

增加类似：

```ts
isConversationSession?: boolean
```

Conversation：

```text
隐藏 branch
隐藏 skills count
隐藏 MCP count
隐藏 extensions entry
保留 model
保留 context usage
保留 ready/running 状态，但文案不要叫 Agent
```

Project 保持现状。

## CHT-504：轻量 Chat activity

Conversation streaming 时只允许：

```text
Thinking…
Searching…
Generating image…
Generating video…
Stopping…
```

可以从现有 run phase + generation kind 映射。

不要显示 tool name、tool args、permission details、subagent locator。

---

# Phase 6 — Token / Context UX

## CHT-601：复用现有 `ContextUsageSnapshot`

**文件：** `chat-reducer.ts` 已经有 `contextUsage`，`status-bar.tsx` 已经有 `contextPercent`。

不改 usage event 模型。

Conversation status/context UI 显示：

```text
context used / limit（已知时）
context percent
last prompt/output/cache（已知时）
```

## CHT-602：增加 context details popover

可以从 status context ring 点击打开轻 popover。

字段只在有真实值时显示：

```text
Context occupied
Context limit
Input
Cache read
Cache write
Output
Total
Duration
```

`source=host-estimate` 时标记 Estimated，不能伪装 provider-reported。

## CHT-603：累计 Usage 继续走现有 ledger

如果 UI 已有 usage/settings 页面，只需确保 general sessions 仍被正常归因。

如果 Conversation 页面要显示 session cumulative，可以调用现有 `usage/get-rollup`，取 `bySession` 对应 active session。

### V1 明确不做

不要为了 assistant footer 强行按时间戳猜 UsageRecord 对应哪条 message。

如果将来需要历史逐条 token：单独做 `UsageRecord.runId?` + session records query。

---

# Phase 7 — 测试矩阵

## 7.1 Host unit tests

### `blueprint-compiler.test.ts`

至少新增：

1. general Conversation skips resource discovery；
2. Conversation context policy 全 false；
3. empty resource/context manifests；
4. no Pi builtin tools；
5. no filesystem/shell/process/browser/mcp/planning/delegate/notes；
6. web route preserved；
7. artifact instructions exposed lazily；
8. toolbox targets restricted；
9. toolbox target direct descriptors hidden；
10. Project baseline unchanged；
11. Side Chat baseline unchanged。

### `host-toolbox.test.ts`（不存在就新建）

1. descriptor target enum exact；
2. description only claims actual capabilities；
3. empty/duplicate targets stable；
4. describe/call execution route existing behavior unchanged。

### `session-live-commands` 相关测试

1. Conversation does not resolve orchestration；
2. Conversation does not prepare delegation runtime；
3. `agentMode` does not inject；
4. active plan does not inject；
5. filesTouched does not inject；
6. contextRefs still inject；
7. attachments still work；
8. cold history still injects once；
9. Project still injects Agent context；
10. Side Chat inherited snapshot still works。

## 7.2 Desktop component tests

### `chat-thread.test.tsx`（若现有同类测试则加进去）

Conversation fixture：

- assistant has text + thinking + tools；
- assert text visible；
- assert `turn-work-details` absent；
- assert tool group absent；
- assert raw thinking absent；
- citations visible；
- image/video progress visible when applicable。

Project fixture：`turn-work-details` 仍存在。

### `context-bar` / `status-bar`

Conversation：

- no permission badge；
- no work panel；
- no branch/skills/MCP；
- model/context visible。

## 7.3 E2E

放进 `apps/desktop/e2e`：

### E2E-CHAT-01 普通聊天

发送 `hello`，检查：

- 无 tool card；
- 无 Agent controls；
- 有 answer。

### E2E-CHAT-02 @file

选择/引用 fixture 文件，检查：

- answer 能看到引用内容；
- UI 无 read/grep tool；
- Host test log/assembly 无其他 workspace context。

### E2E-CHAT-03 Web

mock web result，检查 citations visible / raw tool hidden。

### E2E-CHAT-04 Image

mock generation lifecycle，检查 status -> image result，toolbox call hidden。

### E2E-CHAT-05 legacy transcript

加载已有 tool event 的 general session，检查无 Tool accordion，但正文不丢。

### E2E-AGENT-01 Project regression

打开 project session，验证 Agent mode + work details + tool card 仍在。

---

# Phase 8 — 性能与上下文验证

## CHT-801：建立改造前 baseline fixture

同一个 model/config，prompt：

```text
hello
```

记录：

```text
blueprint compile duration
resource discovery count
tool schema estimated tokens
system prompt estimated tokens
prompt tokens
TTFT（只做观察，不作为硬 CI）
```

## CHT-802：结构性性能断言

Conversation 改造后 CI 硬断言：

```text
resource discovery count = 0
context manifest discovery count = 0
Pi builtin tool count = 0
forbidden family count = 0
```

## CHT-803：Token snapshot

利用现有 `estimateHostTokens` / assembly 统计，为简单 Conversation fixture 输出：

```text
system tokens
tool definition tokens
conversation/history tokens
explicit context tokens
```

保存为测试 snapshot 或数值上限。

上限只限制“静态 Chat overhead”，不要把用户历史长度算进固定上限。

---

# Phase 9 — PR / 提交拆分

推荐拆成 4 个可独立 review 的变更，不要一次把 Host + Desktop 全糊一起。

## PR 1 — Conversation Runtime Fast Path

包含：

```text
CHT-001 ~ CHT-103
CHT-201 ~ CHT-205
```

结果：后台已经是纯 Chat Blueprint，但 UI 暂时还能显示历史 Tool trace。

**Merge gate：** Project/Side Chat compiler tests 全绿。

## PR 2 — Prompt Isolation

包含：

```text
CHT-301 ~ CHT-308
```

结果：Conversation 每轮 prompt 真正不再带 Agent context。

**Merge gate：** assembly 白名单测试 + explicit ref/history tests。

## PR 3 — Content-first Conversation UI

包含：

```text
CHT-401 ~ CHT-504
```

结果：用户看到真正的普通 Chat。

**Merge gate：** legacy transcript + Project UI regression。

## PR 4 — Usage UX + E2E + Perf Guard

包含：

```text
CHT-601 ~ CHT-803
```

结果：Context/Token 可见，E2E 和性能边界锁死。

---

# 10. 每个 PR 的提交纪律

每个 PR 都做：

1. 先加/改测试；
2. 实现；
3. `typecheck`；
4. host runtime tests；
5. desktop component tests；
6. 相关 e2e（进入 UI PR 后）；
7. 检查 Project/Side Chat；
8. 查看简单 Conversation 的 assembly summary；
9. 不顺手重构无关模块。

如果仓库 package scripts 名称与下面示例不同，以根 `package.json` / workspace scripts 为准，不要为了计划强造命令名。

建议执行顺序：

```bash
# 先看实际 scripts
cat package.json
cat packages/host-runtime/package.json
cat apps/desktop/package.json

# 然后运行仓库已有对应命令
<typecheck>
<host-runtime tests>
<desktop tests>
<desktop e2e targeted>
```

---

# 11. 关键代码改造草图

## 11.1 Compiler

```ts
const isConversation =
  input.sessionKind !== 'side-chat' &&
  location.scope.kind === 'general';

if (isConversation) {
  return compileConversationBlueprint({ ... });
}

// existing agent path
```

## 11.2 Prompt

```ts
const promptInput = await prepareCommonPromptInput(...);

if (!conversationChat) {
  await applyAgentPromptContext(...);
}

return promptInput;
```

如果不想真拆函数，也可以先保留一个函数：

```ts
// common
attachments
contextRefs

if (!conversationChat) {
  agentMode
  orchestration
  plan
  filesTouched
}

// common
persist model/thinking
```

优先可读性，不要为“架构漂亮”增加三层 abstraction。

## 11.3 Tool surface

```ts
const toolboxTargets = collectTargets([
  'flashcards-read',
  'flashcards-write',
  'image-generation',
  'video-generation',
]);

const modelToolNames = effectiveToolNames.filter(
  (name) => !toolboxTargets.includes(name) || name === HOST_TOOLBOX_NAME,
);
```

## 11.4 UI

```tsx
{message.role === 'assistant' ? (
  props.isConversationSession ? (
    <ConversationResponseContent message={message} ... />
  ) : (
    <TurnWorkDetails message={message} ...>
      <AgentResponseContent ... />
    </TurnWorkDetails>
  )
) : ...}
```

---

# 12. 风险清单与处理

## R1：general scope 里混入 Side Chat

**风险：** 把 Side Chat 误判成普通 Conversation。

**处理：** 判断顺序先 `sessionKind === 'side-chat'`，测试覆盖。

## R2：只隐藏 UI，后台仍是 Agent

**风险：** 看起来干净，但 token/latency 一点没省。

**处理：** Phase 1/3 先于 UI；CI 断言 resource discovery 0、forbidden assembly 0。

## R3：只改 Blueprint，Prompt 还注入 Plan/FilesTouched

**处理：** assembly whitelist test。

## R4：Toolbox 仍直出 target schema

**处理：** model manifest test：target descriptor 不出现，只在 toolbox enum 中出现。

## R5：Conversation 通过 stale client 打开 Agent 能力

**处理：** Host 忽略 Agent-only fields；tool policy 不依赖客户端 mode。

## R6：隐藏 ToolCard 后 Image/Video 进度也没了

**处理：** generation progress 独立保留；对现有 `ImageGenerationProgress` / `VideoGenerationProgress` 写组件测试。

## R7：历史 Conversation tool-only message 变空白大块

**处理：** Conversation renderer 对 tool-only legacy row：若没有用户可见 domain result，整个 row return null；但 reducer/trace 不删除。

## R8：Context usage 和 cumulative usage 混淆

**处理：** UI 分开命名：Context occupied vs Total tokens。

## R9：误伤 Project

**处理：** 所有新逻辑只在 `general && !side-chat`；Phase 0 baseline + 每 PR regression。

---

# 13. 手工 QA 脚本

开发完成后按顺序手测：

### QA-01 新建 Conversation

- 页面无 Agent/Plan/Orchestration/Permission/MCP/Skills chrome；
- 发送一句普通问题；
- 状态只有 Thinking/Working 风格；
- 无 tool accordion。

### QA-02 连续 10 轮聊天

- 能记住前文；
- 切模型后继续有界历史；
- context ring 正常增长；
- 没有突然出现 project context。

### QA-03 显式文件

- `@file` 能解释；
- 不 @ 的邻近文件不能被模型“自己找出来”；
- 发送下一轮普通问题时不自动注入 workspace。

### QA-04 Web

- sources 正常；
- 搜索失败时是普通错误文案；
- 不出现 JSON/tool name。

### QA-05 Artifact

- 生成 HTML/SVG/Artifact；
- Canvas/preview 正常；
- 不显示 `artifact_instructions` 调用。

### QA-06 Image/Video

- 生成进度和结果正常；
- 不出现 `piwin_toolbox describe/call`。

### QA-07 Flashcards

- 创建/复习正常；
- 不出现 notes/process/browser 能力。

### QA-08 打开 Project

- Agent mode；
- Plan；
- tool history；
- file changes；
- subagent/orchestration；
- permissions；
全部按原行为。

### QA-09 打开 Side Chat

- 只读能力/继承 snapshot 仍正常。

### QA-10 老 Conversation

- 历史正文正常；
- 旧 tool trace 不显示；
- 不丢 transcript 数据。

---

# 14. 完成定义（Definition of Done）

以下全部满足才算完成：

- [ ] Conversation 编译不调用 Pi resource discovery。
- [ ] Conversation 编译不调用 project/context discovery。
- [ ] Conversation resource manifest 为空。
- [ ] Conversation Pi builtin tools 为空。
- [ ] Conversation 无 filesystem/shell/process/browser/MCP/planning/delegate/notes。
- [ ] Conversation Web route 保持可用。
- [ ] Artifact 仍 lazy。
- [ ] Flashcards/Image/Video 通过 restricted toolbox。
- [ ] Toolbox target tools 不直接暴露给模型。
- [ ] Conversation prompt 不注入 Agent Mode。
- [ ] Conversation prompt 不注入 Orchestration。
- [ ] Conversation prompt 不注入 Active Plan。
- [ ] Conversation prompt 不注入 Files Touched。
- [ ] Conversation 不 prepare delegation runtime。
- [ ] `contextRefs` / attachments / images 正常。
- [ ] cold history 正常且只注入一次。
- [ ] Conversation UI 不渲染 `TurnWorkDetails`/`TurnToolGroup`。
- [ ] Web citations 正常。
- [ ] Image/Video progress 正常。
- [ ] 旧 tool trace 数据仍保存。
- [ ] Conversation Composer 无 Agent controls。
- [ ] Conversation Chrome 无 branch/Skills/MCP/permission mode。
- [ ] context usage 正常显示。
- [ ] Project 全能力回归通过。
- [ ] Side Chat 回归通过。
- [ ] E2E pure Chat 场景通过。
- [ ] baseline 对比证明静态上下文/工具面下降。

---

# 15. 实施时不要顺手做的事

为了防止这次改造失控，实施期间明确禁止顺手：

- 重写 Session storage；
- 重写 Agent event protocol；
- 把 Side Chat 合并进 Conversation；
- 新建通用 Runtime Profile 框架；
- 重写 Permission 系统；
- 重写 Search Route；
- 重写 Artifact runtime；
- 重写 Usage ledger；
- 做新的 Plugin/Skill 系统；
- 全面拆 `App.tsx`；
- 全面重构 `chat-thread.tsx`。

只做让 Conversation 真正成为 Chat 所必需的改造。

---

# 16. 推荐实际执行顺序

```text
1. Phase 0 tests
2. Compiler fast path
3. Conversation tool policy + lazy toolbox surface
4. Prompt preflight isolation
5. Prompt assembly isolation
6. Host tests + inspect assembly
7. ChatThread presentation branch
8. Composer/Chrome cleanup
9. Usage/context UI
10. E2E
11. Perf/token baseline comparison
12. Project + Side Chat final regression
```

如果中途发现某个“Chat 能力”必须依赖被禁止的 Agent family，不要直接把 family 放回来。先判断它是否应该被改成显式 Host capability / toolbox target。这样可以防止 Conversation 再次慢慢长回 Coding Agent。
