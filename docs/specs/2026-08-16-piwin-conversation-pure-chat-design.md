# Piwin Conversation 纯 Chat 改造设计 Spec

**版本：** v1.0  
**日期：** 2026-08-15  
**仓库：** `mimimaster/piwin`  
**基线：** `main @ 3fe426e75e8d`  
**状态：** 设计定稿，可进入实施

---

## 1. 一句话结论

Piwin 的 **Conversation 不再是“少开几个工具的 Coding Agent”**，而是一个真正的普通 Chat 会话：默认只知道聊天历史和用户明确给它的内容；不加载项目、AGENTS/SYSTEM、Pi Resources、Plan、Orchestration、Subagent、Touched Files，也不向用户展示工具调用链。

Conversation 仍然保留少数高价值能力：**Web、Artifact、Flashcards、ImageGen、VideoGen**。这些能力按需调用，执行痕迹后台保留，前台只展示用户真正关心的结果。

Projects 保持现有 Coding Agent 能力，不因为 Conversation 的改造而降级。Side Chat 继续保持自己的只读/继承上下文语义，不拿来冒充 Conversation。

---

## 2. 为什么要改

当前 Piwin 的会话编译和消息发送路径是从 Coding Agent 出发设计的。即使用户只是问一句普通问题，底层仍可能经历：资源发现、Context Manifest、Agent Mode、工具策略、Plan/Orchestration、文件状态等流程。

这对 Project 是合理的，对 Conversation 是负担：

- 每轮静态上下文和工具 schema 更大；
- 首轮准备路径更长；
- Chat 会无意知道工作区状态；
- UI 被 Thinking、Tool Group、Files Changed、Agent 状态等执行信息占据；
- 用户只是聊天，却得到 Coding Agent 的交互模型。

本次改造的目标不是“优化 Agent”，而是**给 Conversation 切断 Agent 默认路径**。

---

## 3. 产品边界

### 3.1 最终三类会话

| 会话 | 定位 | 默认上下文 | 工具/能力 | UI |
|---|---|---|---|---|
| Conversation | 普通 Chat | 对话历史 + 用户显式内容 | Web / Artifact / Flashcards / ImageGen / VideoGen | 内容优先，不显示调用链 |
| Project | Coding Agent | 项目 + Agent 上下文 + 对话 | 现有 Agent 全能力 | 执行过程可见 |
| Side Chat | 绑定主会话的只读辅助会话 | 有界继承快照 + 自己历史 | 保持现有只读策略 | 保持现有语义 |

### 3.2 不增加新的持久化“模式字段”

本次 **不新增**：

```ts
runtimeProfile: 'chat' | 'agent'
mode: 'chat' | 'agent'
```

原因很简单：现在产品已经天然分开了。

Host 判断规则：

```ts
const isConversationChat =
  input.sessionKind !== 'side-chat' &&
  resolvedScope.kind === 'general';
```

Project scope 继续走 Agent；Side Chat 先按 `sessionKind` 排除。

这样做没有数据库迁移，也不会出现“general session 但 mode=agent”这种自相矛盾状态。以后如果产品真的要支持“Project 里开纯 Chat”或“General 里开 Agent”，再引入显式模式字段。

---

## 4. Conversation 的硬规则

Conversation 必须满足以下规则，任何一条被破坏都算回归。

### 4.1 默认上下文只有三类

```text
1. Conversation History
2. Current User Message
3. Explicit Context / Attachments
```

其中 Explicit Context 包括：

- 用户上传的图片/文件；
- `@file`；
- selection；
- 引用消息；
- 用户明确选中的 diff / terminal output / error / folder 等 `contextRefs`。

### 4.2 默认绝不自动注入

Conversation 不自动注入：

- 项目文件树；
- 当前目录文件；
- `AGENTS.md`；
- `CLAUDE.md`；
- 项目 `SYSTEM.md` / system prompt；
- Pi native instructions；
- Skills / Extensions / Prompt Resources；
- Agent Mode；
- Orchestration Scheme；
- Active Plan；
- Files Touched；
- Subagent 信息；
- MCP 能力说明；
- Git/branch/worktree 信息。

“零上下文注入”在这里的准确含义是：**零隐式工作区上下文**。对话历史当然要保留，否则它就不是 Chat。

### 4.3 不给模型文件浏览工具

Conversation 默认没有：

```text
read / grep / find / ls
read_file / list_directory
write / edit / apply_patch
shell / process
```

`@file` 不需要这些工具。Piwin 已经有 `PromptContextRef` + `resolvePromptContextRefs`，Host 可以在用户明确引用时读取那一份内容并只注入本轮。

这条规则很重要：**显式引用文件 ≠ 给模型自由浏览磁盘。**

---

## 5. Blueprint 编译设计

### 5.1 当前问题

`packages/host-runtime/src/blueprint-compiler.ts` 的 `compileBlueprintForWorker()` 当前先做：

```text
load config / MCP
resolve session location
resolve cwd
discover Pi resources
resolve trust
compile tool policy
resolve resource activations
build context policy
Discover Context Manifest
build Agent-oriented append system prompt
project blueprint
```

如果只是在后面把几个字段删掉，Conversation 仍然付出了前面大部分准备成本。

### 5.2 改法：尽早进入 Conversation Fast Path

在解析完 config、session location、必要 provider/search 配置后，Conversation 进入专门编译路径，**在 resource discovery 之前分流**。

建议结构：

```ts
export async function compileBlueprintForWorker(input, options = {}) {
  const config = ...;
  const location = await resolveSessionLocation(...);
  const agentCwd = resolveAgentCwd(location, input.cwd);

  const isConversation =
    input.sessionKind !== 'side-chat' &&
    location.scope.kind === 'general';

  if (isConversation) {
    return compileConversationBlueprint({
      input,
      options,
      config,
      location,
      agentCwd,
      ...
    });
  }

  // 现有 Project / Side Chat 路径
  ...
}
```

`compileConversationBlueprint()` 初期就放在 `blueprint-compiler.ts` 内部，不要为了这一刀再建一套“大框架”。后续代码确实膨胀了再拆文件。

### 5.3 Conversation Blueprint 必须是空资源面

Conversation 编译时：

```ts
resourceManifest = {
  skills: [],
  extensions: [],
  prompts: [],
  diagnostics: [],
};
```

Context policy：

```ts
const contextPolicy: ContextPolicy = {
  allowPiNativeInstructions: false,
  allowProjectAgentsFiles: false,
  allowProjectSystemPrompts: false,
};
```

不要调用：

```text
discoverResourcesDefault()
createPiResourceLoader()
resolveResourceActivations() // Conversation 无资源时不需要
DiscoverContextManifest()    // Conversation 应直接使用空 manifest
```

如果 Snapshot 类型要求 manifest，构造明确的空 manifest，而不是调用扫描器得到“空结果”。

### 5.4 最小 System Prompt

Conversation 的常驻 system contract 只保留身份：

```text
<identity>
You are Piwin Chat, a general-purpose conversational assistant. Answer the user directly.
</identity>
```

不要塞入 Coding Agent 行为准则。

常驻额外提示只允许：

- Artifact compact policy:

```text
<artifact_policy>
Emit HTML/SVG Artifacts only when interactive or visual content substantially outperforms Markdown.
Before generating, invoke `artifact_instructions` once to retrieve the specification, then reuse the result.
</artifact_policy>
```

- Toolbox 自己很短的路由说明。

**不得**把 Artifact 完整 runtime contract、Image/Video schema、Flashcard schema 全塞进 system prompt。

---

## 6. Prompt 组装设计

### 6.1 最终模型输入

Conversation 每轮模型可见内容：

```text
Core Chat System
+ Conversation History
+ Explicit ContextRefs
+ Current Attachments / Vision result
+ Current User Message
+ Tool result only when a capability was actually invoked
```

### 6.2 `session-live-commands.ts` 要切的不是一处

`preparePromptInput()` 现在已经有很清楚的分段：attachment、Side Chat snapshot、contextRefs、Agent Mode、Orchestration、Plan、Files Touched。

Conversation 路径保留：

- `recordUserPrompt()`；
- `buildModelPromptInput()`；
- attachment / image preparation；
- `contextRefs` + `resolvePromptContextRefs()`；
- composer model/thinking 持久化；
- `injectProductHistoryOnce()`；
- Context assembly/usage 统计。

Conversation 路径跳过：

- Side Chat inherited snapshot（Conversation 本来就不是 Side Chat）；
- `setRunDelegationMode(auto)`；
- Agent Mode permission override；
- `mergeAgentModeIntoPrompt()`；
- `resolveOrchestrationScheme()`；
- `mergeOrchestrationSchemeIntoPrompt()`；
- `loadSessionPlan()` + active plan injection；
- `sessionFilesTouched` injection。

### 6.3 还要切掉 prompt 之前的 Agent 准备

`session/prompt` 在调用 `preparePromptInput()` 之前，目前还会：

- 校验 `orchestrationSchemeId`；
- `prepareDelegationRuntime()`。

Conversation 必须跳过这两步，否则虽然 prompt 干净了，发送路径仍然在做 Agent 准备。

### 6.4 对 stale/恶意字段的处理

不能只靠 Desktop “不传”。Host 才是边界。

Conversation 收到这些字段时：

```text
skillId
agentMode
orchestrationSchemeId
delegationMode
```

V1 建议 **忽略 Agent-only 语义，不让它影响 runtime**，必要时打 debug log；不要因为旧客户端残留字段直接让聊天失败。

特别是：即使客户端硬塞 `agentMode='agent'` 或 orchestration id，也不能让 Conversation 获得 Agent 工具或上下文。

### 6.5 对话历史继续保留

现有 `injectProductHistoryOnce()` 的思路继续使用：冷重建时有界注入一次，后续由 backend conversation state 承接。

第一阶段不需要重写 history 机制。后续可把 `maxChars` 改成 token budget，但这不是本次改造的前置条件。

---

## 7. Tool / Capability 设计

### 7.1 Conversation 允许的能力

| Family | Conversation | 说明 |
|---|---:|---|
| `web-search` | 是 | 按现有 Search Route，native 优先 / external fallback |
| `web-fetch` | 是 | 配置可用时 |
| `artifact` | 是 | 保持 lazy instructions |
| `toolbox` | 是 | 低频能力统一入口 |
| `flashcards-read/write` | 是 | 通过 toolbox |
| `image-generation` | 是 | 通过 toolbox |
| `video-generation` | 是 | 通过 toolbox |
| `filesystem-read/write` | 否 | 显式文件用 contextRefs |
| `shell` | 否 | 不属于 Chat |
| `process` | 否 | 不属于 Chat |
| `browser` | 否 | V1 不开放浏览器 Agent |
| `mcp` | 否 | 避免 Conversation 变通用 Agent |
| `planning` | 否 | 不注入 Agent Plan |
| `delegate` | 否 | 不启用 Subagent |
| `notes-read/write` | 否 | V1 不默认开放 |

注意：Flashcards/Image/Video 虽然会写入各自产品域的数据或资产，但它们不是“任意工作区写权限”。Conversation 的边界是**不读写用户工作区，不是所有产品能力都只读**。

### 7.2 直接工具面必须小

模型常驻看到的 Host 工具应尽量只有：

```text
web_search       // external route 选中时
web_fetch        // 可用时
artifact_instructions
piwin_toolbox
```

如果模型走 native search，`web_search` 不应同时暴露。

### 7.3 Toolbox 要真 lazy，不要“既 toolbox 又直出所有 target”

当前 `host-toolbox.ts` 已经有 describe/call 的 lazy 机制，这是正确方向。

Conversation 的模型 manifest 必须：

1. execution policy 允许 flashcard/image/video target families；
2. `hostToolboxTargetNames` 收集这些 target；
3. model-visible `hostTools` **排除这些 target 的直接 descriptor**；
4. 只留下重写过 target enum 的 `piwin_toolbox` descriptor。

也就是：

```text
模型看到：piwin_toolbox
后台可路由：flashcard_create / image_generate / video_generate / ...
模型默认看不到这些具体 schema
```

这才是真正省工具 token。

### 7.4 修一下 Toolbox 描述文案

当前 toolbox 描述固定写着 browser/process/notes/flashcards/image/video，即使当前 target enum 没有 browser/process/notes，也会误导模型。

改成动态/中性文案：

```text
Lazy access to selected Host capabilities. First describe a target to load its
exact schema, then call it. Available targets: ...
```

这项改动可以全局安全复用。

### 7.5 Artifact 保持现状

`artifact-instructions-tool.ts` 当前已经是正确结构：

```text
常驻：compact capability hint
需要 Artifact 时：artifact_instructions -> full runtime contract
```

本次不要把完整 Artifact 指令重新塞回每轮 system prompt。

---

## 8. Web 行为

Conversation 使用 Piwin 现有 Search Route，而不是专门造第二套搜索逻辑。

规则：

1. 模型原生搜索可用且策略选中 native -> 不暴露外部 `web_search`；
2. 需要外部搜索 -> 暴露 `web_search`；
3. `web_fetch` 可独立保留；
4. 搜索工具调用不显示成 Tool Card；
5. 用户看到的是回答正文 + `CitationCards` / sources。

搜索失败时显示普通 Chat 错误语义，例如“搜索暂时失败，我仍可以基于已有信息回答”，不要吐出 raw tool result。

---

## 9. UI：Conversation 是内容页，不是执行台

### 9.1 当前前端问题

`chat-thread.tsx` 目前所有 assistant 消息都会走 `TurnWorkDetails`；`TurnWorkDetails` 会处理 thinking、permission、agent locator、`TurnToolGroup` 等 Agent 执行信息。

这套东西对 Project 合适，对 Conversation 不合适。

### 9.2 增加一个简单的 Conversation presentation 分支

给 `ChatThread` / `ChatMessageRow` 传现有的 Conversation 判定，例如：

```ts
isConversationSession: boolean
```

Conversation assistant row：

```text
Markdown / rich answer
Citations
Artifact result
Image progress/result
Video progress/result
Flashcard result
Attachments
Assistant actions
Usage (可选)
```

同一条 assistant 上的 `text` 如果还带着工作工具（search / fetch / artifact_instructions / toolbox 等），那是工具循环的进度句，不是回复：不画 Markdown 正文，不挂复制/再生成。图、视频、闪卡这类结果型工具的说明句仍是回复。

Project assistant row：继续走现有 `TurnWorkDetails`，同一套 process / reply 分类。

不要为了 Chat 复制整个 transcript 系统；只是在 assistant 内容容器处换 presentation。

### 9.3 Conversation 默认隐藏

- raw thinking；
- `TurnToolGroup`；
- Tool Call accordion；
- Permission wait block；
- Agent Locator；
- Skill activity chip；
- PlanCard；
- GoalStickyStrip；
- FilesChangedBar；
- Assembly Summary capsule；
- Walkthrough execution affordance；
- Subagent activity。

如果某个旧 Conversation 历史里已经有 tool events，**数据仍保留，只是不在正常 Conversation 视图显示**。

### 9.4 用户仍然需要“正在干什么”的轻状态

隐藏调用链不等于完全没有状态。

Conversation 可以显示一行轻量状态：

```text
Thinking…
Searching…
Generating image…
Generating video…
```

只显示人类可理解的当前动作，不显示工具名、参数、JSON、toolCallId。

现有 `ImageGenerationProgress` / `VideoGenerationProgress` 可以继续用。

### 9.5 Composer 也要去 Agent 化

Conversation Composer 隐藏：

- Agent Mode；
- Goal/Plan/Ask；
- Orchestration；
- Skill selector / slash Pi Skills；
- Permissions preset；
- 与 Project 工作区相关的入口。

保留：

- 模型；
- Thinking level（如果模型支持）；
- 文本；
- 图片/文件附件；
- 显式 context ref；
- Chat 能力入口（如图片、Artifact 等，如果 UI 需要显式按钮）。

### 9.6 Chrome 简化

`ContextBar` 已经支持 `isConversationSession` 并会隐藏 Work Panel；继续沿用。

Conversation 下建议：

- 不显示 permission mode badge；
- StatusBar 不显示 branch / Skills / MCP / Extensions；
- 保留 model；
- 保留 context usage；
- Work Panel 默认不展示、标题栏也不放入口。用户点击生成的文件（SVG / HTML 等）或 Open Canvas 后，仍打开右侧面板查看内容。
- 文件浏览 / 预览使用产品 General workspace（`~/.piwin/workspace`），不要求注册用户项目，也不用 “No workspace” 挡住内容。
- Artifact canvas 不在 Chat 里自动弹出；只有用户点开时出现，不作为常驻 Agent inspector。

---

## 10. Trace：隐藏，不删除

这是必须坚持的边界。

### 用户视图

```text
用户消息
回答
图片 / Artifact / Flashcards / Sources
```

### 后台仍保留

```text
tool_call
tool_result
runId
toolCallId
duration
error
usage
model context assembly
```

原因：

- 调试；
- crash / failure 定位；
- resume/replay；
- usage；
- 历史兼容；
- 未来 diagnostics。

不要为了“UI 不显示”去改 transcript event model，更不要丢掉 Tool Result。

如果以后需要开发者模式，可以从这些现成 trace 做 Diagnostics；这不是 V1 用户功能。

---

## 11. Token / Context 设计

Piwin 已经有两套数据，别重造。

### 11.1 ContextUsageSnapshot

用于“当前上下文占了多少”：

```text
tokensUsed / tokensLimit
promptTokens / completionTokens
cacheRead / cacheWrite
contextRatio
durationMs
breakdown
```

Conversation 继续显示 context ring / context percent。

### 11.2 UsageRecord / UsageRollup

用于“实际累计用了多少 token”：

```text
prompt
completion
cache
total
duration
TTFT
success
by session / model / day
```

### 11.3 V1 UI

优先做准确而简单的：

```text
StatusBar / Composer 附近：12.4k / 128k 或 9.7%
点击后：
- Input
- Cached read/write
- Output
- Total
- Context occupied
- Duration / TTFT（有数据才显示）
```

不要把“累计 token”跟“当前上下文占用”混成一个数字。

### 11.4 暂不强行做历史每条消息 token footer

当前 `UsageRecord` 没有 `runId/messageId`，而 `ChatMessageUi` 虽然有 `runId`，两边没有可靠的持久化关联。

所以 V1 **不要猜**某条历史消息用了多少 token。

如果后续真的要做到：

```text
1.8k tokens · 62 tok/s
```

再给 `UsageRecord` 增加可选 `runId`，并提供 session usage records 查询；这是独立增强，不应该把本次纯 Chat 改造拖大。

---

## 12. Context Assembly 与隐私边界

现有 `model-context-assembly.ts` 继续记录 Host 注入贡献，用来做诊断和 token 估算。

Conversation 的 assembly 应该能被测试成只出现这些类别：

```text
user
attachment-text / native-image / vision-description
context-ref
product-history（仅冷重建）
```

不能出现：

```text
agent-mode
orchestration
active-plan
files-touched
side-chat（普通 Conversation）
project instructions/resources
```

这不仅是省 token，也是隐私边界：用户没有显式给的文件/项目状态，不应出现在模型请求里。

---

## 13. 错误与降级

### Web 不可用

回答可以继续，但明确说无法完成实时查询；不要打开 browser/process 作为隐式替代。

### Artifact 不可用

退化成普通 Markdown/代码回答，不启用文件写工具。

### Image/Video provider 不可用

显示领域错误卡或简短错误文案，不显示 toolbox raw error。

### Flashcard store 不可用

告诉用户保存失败；生成出来的卡片内容仍可在对话中展示。

### Context ref 读取失败

保留现有 warn 日志，同时给模型/用户清晰说明引用内容没能读取；不要自动扩大到目录搜索。

### 模型切换/冷重建

继续走现有 runtime replacement 和 `injectProductHistoryOnce()`，不要为 Chat 发明第二套 session engine。

---

## 14. 向后兼容

### 14.1 不做 session 数据迁移

升级后：

- 现有 general Conversation 自动获得纯 Chat 行为；
- Project sessions 完全保留 Agent 行为；
- Side Chat 保持原有语义；
- 历史 tool events 不删；
- 历史 Plan/Tool 卡在 Conversation 普通视图中隐藏。

### 14.2 旧客户端字段

Host 对 Conversation 不执行 Agent-only 字段，即使旧 Desktop 还短暂传了它们，也不能扩大能力。

### 14.3 回滚

因为没有持久化 schema 迁移，回滚只需要恢复 Conversation fast path / presentation branch，不需要反迁移数据库。

---

## 15. 可观测性与性能验收

不要写“感觉更快”，要测。

每个 Conversation 首轮记录：

- blueprint compile duration；
- resource discovery 是否发生；
- context manifest discovery 是否发生；
- model-visible system prompt estimated tokens；
- model-visible tool schema estimated tokens；
- TTFT；
- prompt tokens；
- cache tokens。

必须满足的结构性指标：

```text
discoverResourcesDefault calls = 0
DiscoverContextManifest calls = 0
Pi builtin tools = []
MCP tools = []
filesystem tools = []
planning/delegate/process/browser = []
```

工具面按配置最多应接近：

```text
artifact_instructions
piwin_toolbox
web_search? / web_fetch?
```

性能比较用同一模型、同一短 prompt，对比改造前后 Conversation 的 compile/prompt token/TTFT。第一次提交先建立 baseline，后续 CI 做结构断言，避免靠不稳定的网络时延卡 CI。

---

## 16. 验收场景

### A. 普通聊天

用户：`你好，解释一下 transformer 的 attention。`

期望：

- 不扫资源；
- 不读取项目；
- 无 Agent Mode/Plan/Files Touched；
- 无工具卡；
- 正常连续对话。

### B. 显式 `@file`

用户：`@foo.ts 解释这个函数。`

期望：

- `foo.ts` 通过 `contextRefs` Host-side 解析；
- 模型没有 read/grep/ls/find；
- 不读取其他文件；
- 下一轮不自动继续获得其他 workspace 信息。

### C. 图片/文件附件

期望只注入当前附件和必要 vision 结果，不启用项目扫描。

### D. Web

用户：`查一下今天这个库的最新 release。`

期望：

- 按 Search Route 搜索；
- 前台显示 sources/citations；
- Conversation 同时展示 `web_search` / `web_fetch` 工具行（调用链可见，raw JSON 默认折叠）。

### E. Artifact

用户：`做一个可交互的 HTML demo。`

期望：

- 首轮静态 prompt 只有 compact Artifact hint；
- 真需要时调用 `artifact_instructions`；
- 用户看到 Artifact 结果/Canvas，并看到 `artifact_instructions` 工具行。

### F. ImageGen / VideoGen

期望：

- 通过 restricted toolbox；
- 生成状态 + 结果走现有 Image/Video 进度卡片；
- 其他 toolbox 调用（闪卡、describe）走工具行展示。

### G. Flashcards

期望：

- toolbox route；
- 可创建/复习；
- 不因此获得 notes/filesystem/process。

### H. 恶意/旧字段

给 Conversation 强行传：

```json
{
  "agentMode": "agent",
  "orchestrationSchemeId": "some-scheme",
  "delegationMode": "auto"
}
```

期望：能力和上下文完全不扩大。

### I. Project 回归

原有 Project coding session：Agent Mode、Plan、Orchestration、Subagent、工具 UI、文件修改等保持不变。

### J. Side Chat 回归

Side Chat 仍是现有 fixed read-only profile，不变成 Conversation 工具集。

---

## 17. 明确不做

本次不做：

- Conversation/Agent 模式切换按钮；
- 新 session schema/migration；
- Project 纯 Chat；
- General Agent；
- Conversation Shell；
- Conversation browser Agent；
- MCP in Conversation；
- Subagent in Conversation；
- 自动 workspace RAG；
- 自动读取最近文件；
- 删除底层 trace；
- 重写 transcript storage；
- 重写 history engine；
- 为 token footer 伪造消息级 usage。

---

## 18. 最终架构图

```text
                           Piwin Session
                               |
                 +-------------+-------------+
                 |                           |
          scope = general               scope = project
          kind != side-chat                  |
                 |                           |
        Conversation Chat               Project Agent
                 |                           |
     minimal blueprint fast path       existing full blueprint
                 |                           |
       history + explicit refs         project + agent context
                 |                           |
   Web / Artifact / Toolbox            full tool pipeline
                 |                           |
      content-first renderer           execution-first renderer

Side Chat: 独立 sessionKind 分支，继续现有 read-only/inherited-context 语义。
```

---

## 19. 最终决定清单

- **Conversation = Chat，Project = Agent。**
- **不新增 runtime mode 字段。**
- **Conversation 在 Blueprint 早期分流，资源扫描前就退出 Agent 路径。**
- **默认无工作区上下文。**
- **显式文件通过 contextRefs，不给模型 filesystem tools。**
- **Web / Artifact / Flashcards / Image / Video 保留。**
- **低频能力通过 restricted `piwin_toolbox`。**
- **Artifact 保持 lazy instructions。**
- **Tool trace 后台保留，Conversation UI 隐藏。**
- **Token/Context 复用现有 Usage contracts，先做准确的 session/last-turn 展示。**
- **Project / Side Chat 不跟着改。**
