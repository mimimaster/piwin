# Spec — Shared-context Side Chat Session

| Field | Value |
|-------|-------|
| Status | Ready for implementation — product spec recorded; code pending |
| Date | 2026-08-05 |
| Trigger | 右侧栏 Side Chat 需要继承主会话上下文，同时明确少于主会话的能力边界 |
| Related | [ADR 0009](../adr/0009-session-resume-product-shell.md), [ADR 0015](../adr/0015-async-desktop-turn-transport.md), [ADR 0019](../adr/0019-permission-rule-engine.md), [ADR 0024](../adr/0024-run-modes-and-sandbox.md), [ADR 0032](../adr/0032-side-chat-context-branch.md), [Runtime Refactor](./runtime-refactor.md) |
| Binding | AGENTS.md; contracts first; product transcript is history truth; Desktop/CLI share Host |
| Backlog prefix | SIDE-* |

## 0. User requirement

Side Chat 不是 Notes，也不是第二个功能完整的主 Agent。用户需要在主会话
右侧打开一个轻量侧聊：

1. 自动继承主会话当前上下文；
2. 主会话继续运行时，侧聊可以单独提问；
3. 侧聊主要用于解释、调查、比较方案和确认决定；
4. 侧聊的能力少于主会话，默认不能修改代码或执行命令；
5. 侧聊的有用结果可以显式带回主会话；
6. 关闭右侧栏或重启应用后，侧聊仍可恢复。

本 spec 记录可执行的产品、合同、Host、Desktop、CLI 和测试边界。

## 1. Product one-liner

> Side Chat 是继承主会话上下文的持久只读讨论分支；它拥有独立运行状态，
> 让用户可以在不打断主 Agent 的情况下追问和验证想法。

## 2. Research findings

### 2.1 Cursor 3.11 — primary reference

[Cursor Side Chats and Conversation Search](https://cursor.com/changelog/side-chat)
（3.11，2026-07-10）公开了以下行为：

- 使用 /side、/btw 或聊天面板的加号创建 Side Chat；
- Side Chat 继承主聊天上下文；
- 每个 Side Chat 是持久、完整的 Agent 对话；
- 可以继续追问、之后重新打开；
- 可以通过 at-mention 把 Side Chat 上下文带回主线程；
- 默认侧重读取、搜索和回答，同时主 Agent 可以继续运行。

这说明“独立会话”不等于“独立上下文”。正确拆分是：

~~~text
共享 context source
  ├── Main session: full execution
  └── Side Chat: reduced read-only execution
~~~

### 2.2 Cursor dynamic context discovery

[Cursor Dynamic Context Discovery](https://cursor.com/blog/dynamic-context-discovery)
公开了另一条重要原则：长历史、工具输出和终端内容更适合被保存为可按需
发现的上下文，而不是每次完整静态注入。Cursor 的公开文章提到：

- 长工具结果可写入文件后按需读取；
- 历史可作为压缩后的可检索来源；
- 终端输出可被同步为可查询内容。

因此 piwin 的实现采用两阶段策略：

- MVP：创建时捕获有界主会话 context snapshot；
- 后续：使用 context reference + explicit sync + lazy resolution。

### 2.3 Antigravity

[Antigravity Agent Side Panel](https://antigravity.google/docs/ide/agent-side-panel)
把右侧面板定义为完整 Agent 工作区，支持新建会话、图片附件、Agent mode、
模型选择，并在输入区上方显示文件变更、终端进程和 Artifact 状态。

[Antigravity Feature Overview](https://antigravity.google/docs/features?app=antigravity-ide)
还强调了 Project 的多文件夹上下文、规则和权限边界。

piwin 借鉴其“上下文/工作区状态可见”的信息架构，但不在 Side Chat v1
开放完整执行能力。右侧栏必须明确显示：

- 继承自哪个主会话；
- 上下文捕获到哪个消息；
- 当前工作区是 live 还是 frozen snapshot；
- Side Chat 当前是 Ask/read-only。

### 2.4 GitHub Copilot context surfaces

[GitHub Copilot codebase exploration](https://docs.github.com/en/enterprise-cloud%40latest/copilot/tutorials/explore-a-codebase)
强调从仓库、文件和选中代码行提供显式上下文。

[GitHub Copilot CLI ↔ VS Code](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/connecting-vs-code)
展示了选择区、实时诊断、diff 和可恢复 session 之间的上下文传递。

piwin 采用相同的显式引用原则：文件、行、错误、diff、终端输出都通过
结构化 ContextRef 进入 Host，不由 Desktop 自己读文件或把任意绝对路径
拼进 prompt。

### 2.5 Research boundary

上述产品的内部 session/context 实现没有完整公开。本 spec 对它们的内部
实现不做假设，只对齐已公开的用户可见行为，并根据 piwin 当前
SessionHandle、Product transcript、RunRegistry 和 capability blueprint
推导实现方案。

## 3. Definitions

| Term | Meaning |
|------|---------|
| Main session | 用户主任务的 product session，拥有完整 Agent 能力 |
| Side Chat | 绑定主会话的持久 product session，默认只读 |
| Source session | Side Chat 继承上下文的主会话 |
| SideChatRelation | Side Chat 与 source session 的产品关系；不是 subagent parent |
| Context snapshot | Side Chat 创建或同步时捕获的有界上下文版本 |
| ContextRef | Host 可解析的消息、文件、diff、终端或错误引用 |
| Live workspace | 当前 project/cwd 的实时文件状态，不等于历史 transcript |
| Handoff | 用户显式将 Side Chat 结果带回主会话的动作 |

以下概念保持独立：

| Similar concept | Must remain separate |
|-----------------|----------------------|
| Subagent | parentSessionId、child lifecycle、merge、worktree |
| Fork | 用户从 assistant response 创建的产品分支 |
| Duplicate | 当前整个主会话的完整独立副本 |
| Side Chat | 共享上下文的讨论分支，默认只读 |
| Scratchpad | 纯本地便签；不再作为 Side Chat 实现 |

## 4. Goals and non-goals

### 4.1 Goals

| ID | Goal |
|----|------|
| SIDE-G1 | 右侧栏提供真正的 Host-backed Side Chat，不再使用 sessionStorage transcript |
| SIDE-G2 | 创建时继承主会话的有界上下文快照 |
| SIDE-G3 | 主会话和 Side Chat 具有独立 run、stream、stop 和 error 状态，可并行 |
| SIDE-G4 | Side Chat 的能力显著少于主会话，Host 强制只读边界 |
| SIDE-G5 | 支持显式同步主会话的新上下文，而不是自动 token 级同步 |
| SIDE-G6 | 支持从主会话消息、文件、diff、错误和终端入口创建 Side Chat |
| SIDE-G7 | Side Chat 回复可显式引用回主会话 |
| SIDE-G8 | Side Chat transcript 和 relation 可跨重启恢复，SDK/RPC 语义一致 |
| SIDE-G9 | Desktop 右侧栏保持当前 right-panel 架构，不引入第二套窗口壳 |
| SIDE-G10 | CLI 能访问同一套 Host 合同，缺少图形面板时提供诚实的文本入口 |

### 4.2 Non-goals for v1

| ID | Non-goal |
|----|----------|
| SIDE-N1 | 复用主 session 的同一个 foreground run |
| SIDE-N2 | 让 Side Chat 写文件、编辑代码、执行 bash 或管理进程 |
| SIDE-N3 | 在 Side Chat 中运行 Plan、Subagent、Job、PTY 或交互式 Browser |
| SIDE-N4 | 开放任意 MCP；读写能力无法仅靠 UI 可靠区分 |
| SIDE-N5 | 从 Side Chat 再次 Duplicate/Fork 或建立分支 DAG |
| SIDE-N6 | 自动把主会话之后的每条消息持续注入 Side Chat |
| SIDE-N7 | 完整复制 Pi native JSONL tree 或共享 Pi active leaf |
| SIDE-N8 | 自动把 Side Chat 的建议应用到工作区 |
| SIDE-N9 | 在 Side Chat 中提供 Artifact Canvas、Artifact action bridge 或 Walkthrough |
| SIDE-N10 | 通过新增独立 Pi kernel 实现侧聊 |

## 5. Locked product decisions

| ID | Decision |
|----|----------|
| SIDE-D1 | Side Chat 是独立 product session，但必须继承 source session context |
| SIDE-D2 | Side Chat 不使用 parentSessionId，不进入 subagent lifecycle |
| SIDE-D3 | Side Chat relation 不使用 ProductSessionOrigin.kind = fork |
| SIDE-D4 | 创建时捕获最新持久化上下文；主会话 streaming 中创建时使用上一条完成边界 |
| SIDE-D5 | 上下文同步由用户主动触发；同步产生递增 contextVersion |
| SIDE-D6 | Side Chat 默认固定为 Ask/read-only，不能被主会话 yolo 设置扩权 |
| SIDE-D7 | Side Chat 使用 source session 的 project scope 和 live working directory |
| SIDE-D8 | v1 不创建 worktree；没有写能力就不需要文件隔离 |
| SIDE-D9 | Side Chat transcript 持久化，但默认不出现在主会话列表 |
| SIDE-D10 | 关闭右侧栏不 abort Side Chat；只有用户点击 Stop 才取消运行 |
| SIDE-D11 | Side Chat 只能普通 Send + Stop；不提供 steer、follow-up、manual compact |
| SIDE-D12 | model/thinking profile 默认继承创建时的主会话快照；侧聊 composer 复用主输入框的模型选择器，可按 session 覆盖并写入 `session/set-composer-profile` |
| SIDE-D13 | Side Chat 结果通过 ContextRef 或显式 Insert 回主 Composer，不自动发送 |
| SIDE-D14 | source session archive/delete 不级联删除 Side Chat；Side Chat 保留 frozen context |
| SIDE-D15 | source session 不可用时，Side Chat 仍可阅读/继续对话，但不能 Sync |
| SIDE-D16 | Side Chat 的读取和网络能力由 Host capability profile 决定，UI 隐藏不是安全边界 |

## 6. Capability boundary

主会话能力会继续演进；下表锁定 Side Chat v1 的相对边界。

| Capability | Main session | Side Chat v1 | Notes |
|------------|--------------|--------------|-------|
| 普通文本对话 | Full | Yes | 支持 streaming |
| Markdown/code response | Full | Yes | 复用 Markdown rendering |
| 继承主 transcript | N/A | Required | 有界 snapshot + relation |
| 读取当前项目 | Yes | Yes | Host read-only tools |
| 搜索代码 | Yes | Yes | read / grep / find / ls 等等效只读能力 |
| 读取 git diff/status | Yes | Context-first | 默认通过 ContextRef；不开放写 git |
| 读取主会话错误/终端输出 | Yes | Yes | 使用捕获快照，不依赖活跃 PTY |
| 新增图片附件 | Yes | P1 | 复用 media contract；仍走 native image path |
| 模型选择 | Per turn/session | Per side session | 默认继承创建快照；composer 复用主输入框选择器 |
| Thinking level | Selectable | Per side session | 与模型选择器一起覆盖 |
| Agent mode | Agent/Plan/Ask | Ask only | UI + Host 双重约束 |
| 文件 write/edit | Yes | No | 不注册工具；提示用户 Handoff |
| bash/Shell | Yes | No | 不注册工具 |
| Process/Job | Yes | No | 不注册工具 |
| PTY | Desktop surface | No | 不复制终端生命周期 |
| Web search/fetch | Configurable | Optional read-only P1 | 只有 Host config 开启时可见 |
| MCP | Configurable | No in v1 | 后续需要 read-only server manifest |
| Browser navigate/click/type | Yes | No | 可读取已捕获 Browser context |
| Plan create/execute | Yes | No | 可以阅读主 Plan snapshot |
| Subagent/delegation | Yes | No | 不产生 child session |
| Notes/flashcard mutation | Yes | No | 不注册写工具 |
| Image generation | Yes | No | 不注册 image_gen |
| Artifact preview/Canvas | Yes | No | 仅普通 Markdown/source |
| Extension questionnaire | Yes | No | 不产生 side-specific UI request |
| Steer/follow-up | Yes | No | Side Chat 只有普通 Send |
| Abort/Stop | Yes | Yes | 只操作 Side Chat 自己的 run |
| Manual compaction | Yes | No | Host 可自动 compact |
| Duplicate/Fork | Yes | No | v1 不创建二级 side lineage |
| Rename/archive/delete | Yes | Yes | Side Chat picker 内操作 |
| Handoff to main | N/A | Yes | 显式、用户确认、不自动发送 |

### 6.1 Exact v1 tool profile

Side Chat 的 Host blueprint 必须生成独立 profile，至少满足：

~~~text
Pi built-in read family:
  read, grep, find, ls

Host custom family:
  filesystem-read

Optional P1:
  web-search, web-fetch

Explicitly absent:
  filesystem-write, shell, process, browser, mcp, planning, delegate,
  notes-write, flashcards-write, image-generation
~~~

实现可以复用当前 capability/tool manifest builder 的纯映射逻辑，但不能
把 Side Chat 伪装成 subagent profile。应新增产品级 sessionProfile 或等价
的 session capability input。

## 7. Context model

### 7.1 Binding

建议在 @piwin/contracts 增加：

~~~ts
export type SideChatRelation = {
  kind: 'side-chat';
  sourceSessionId: string;
  sourceMessageId?: string;
  sourceCapturedAt: string;
  contextVersion: number;
  sourceState: 'active' | 'archived' | 'missing';
};
~~~

SessionSummary 增加 kind: side-chat，并以独立 relation 字段表达
Side Chat 关系。不要把 relation 放进 subagent parentSessionId。

### 7.2 Context snapshot

~~~ts
export type SideChatContextSnapshot = {
  version: number;
  capturedAt: string;
  sourceSessionId: string;
  throughMessageId?: string;
  conversation: {
    messageIds: string[];
    formattedText: string;
    truncated: boolean;
  };
  workspace: {
    scope: 'general' | 'project';
    projectPath?: string;
    workingDirectory: string;
    instructionRevision?: string;
  };
  refs: SideChatContextRef[];
};
~~~

formattedText 必须是 Host 生成的有界上下文。可以复用
@piwin/session 当前 buildProductHistoryContext 的 message/character
上限策略，但 Side Chat 要把“来自主会话的上下文”标记为 context block，
不能把它伪装成 Side Chat 用户消息。

### 7.3 ContextRef

上下文引用进入 contracts，由 Host 解析：

~~~ts
export type SideChatContextRef =
  | {
      kind: 'main-message';
      sourceSessionId: string;
      messageId: string;
      label: string;
    }
  | {
      kind: 'file';
      projectPath: string;
      relativePath: string;
      lineStart?: number;
      lineEnd?: number;
      label: string;
    }
  | {
      kind: 'diff';
      projectPath: string;
      relativePaths?: string[];
      snapshotText: string;
      label: string;
    }
  | {
      kind: 'terminal-output';
      snapshotText: string;
      label: string;
    }
  | {
      kind: 'error';
      title: string;
      detail: string;
      label: string;
    }
  | {
      kind: 'side-chat-message';
      sideChatSessionId: string;
      messageId: string;
      label: string;
    };
~~~

安全规则：

- relativePath 必须在 Host 校验后才能解析；
- UI 不直接读文件或调用 fs；
- diff、terminal-output 和 error 使用有界快照；
- Side Chat 的 prompt 不能把任意绝对路径或未校验的 context 字符串当作
  默认模型指令；
- 图片继续使用既有 media contract 和 native ImageContent 路径。

### 7.4 Snapshot 与 live workspace 的区别

Side Chat UI 必须同时显示两个状态：

~~~text
Conversation context: snapshot through <message/time>
Workspace: live <project/cwd>
~~~

因此用户能理解：侧聊继承的是主会话历史快照，但读取文件时看到的是当前
工作区内容。文件被主会话修改后，Side Chat 的只读工具读取新内容；这不是
历史文件 checkpoint。

### 7.5 Sync

side-chat/sync 的行为：

1. 校验 source session 仍存在；
2. 找到 sourceMessageId 之后的新完成消息；
3. 生成新的有界 snapshot；
4. 保存新 contextVersion；
5. 下次 Side Chat prompt 使用新 context block；
6. 不修改 Side Chat 已有 user/assistant transcript；
7. 如果 source message 已被 truncate/fork 删除，返回可解释的 stale error，
   保留旧 snapshot，不静默替换。

主会话 streaming 中点击 Sync 时，只能同步最后一个已持久化完成边界。

## 8. IPC and contracts

### 8.1 New product commands

在 @piwin/contracts 增加专用 Side Chat commands。普通对话仍复用现有
session/prompt、session/messages、session/abort：

~~~ts
type SideChatOpenCommand = {
  type: 'side-chat/open';
  sourceSessionId: string;
  sourceMessageId?: string;
  name?: string;
  refs?: SideChatContextRef[];
};

type SideChatListCommand = {
  type: 'side-chat/list';
  sourceSessionId: string;
  includeArchived?: boolean;
};

type SideChatSyncCommand = {
  type: 'side-chat/sync';
  sideChatSessionId: string;
  refs?: SideChatContextRef[];
};
~~~

side-chat/open 返回：

~~~ts
type SideChatOpenData = {
  sideChatSessionId: string;
  session: SessionSummary;
  relation: SideChatRelation;
  context: SideChatContextSnapshot;
};
~~~

session/create 可以增加内部的 sessionKind/relation input，但 Desktop
和 CLI 不应通过裸 session/create 自己拼 side relation。专用 command 是
产品语义入口，HostRuntime 负责调用内部 session service。

### 8.2 Handoff context

主 Composer 需要支持结构化的 side-chat reference：

~~~ts
type PromptContextRef = SideChatContextRef | MainContextRef;

type PromptInput = {
  text: string;
  attachments?: PromptAttachment[];
  contextRefs?: PromptContextRef[];
  agentMode?: AgentModeId;
  // existing fields remain
};
~~~

contextRefs 的来源：

- Side Chat 消息上的“引用到主会话”；
- Composer at-mention 菜单选择 Side Chat 或具体回复；
- 主消息、文件、diff、错误和终端面板上的“在 Side Chat 讨论”。

Host 在 session/prompt preparation 阶段解析引用，用户 transcript 仍保留
原始 text + contextRefs，不会把 resolved context 当成用户手写内容。

### 8.3 Push and response requirements

现有 HostPush 的 event、run/updated、run/terminal、permission push
都必须保留真实 sessionId。Desktop 不能把 Side Chat event dispatch
到主 chatUiReducer。

新增或调整的 push 必须满足：

- side-chat/open response 先返回 session/relation/context；
- prompt 仍按 ADR 0015 快速返回 runId；
- Side Chat run 的 terminal/error 必须带 side sessionId；
- permission request 若出现，必须带 side sessionId 和 runId；
- Host reconnect/replay 后，Side Chat 可以通过 session/messages 重建；
- late event 不能更新已经切换离开的主会话 UI。

## 9. Host behavior

### 9.1 Open flow

~~~text
Desktop right panel
  -> side-chat/open(sourceSessionId, sourceMessageId, refs)
  -> Host validates source + resolves snapshot
  -> Session service creates side session + relation
  -> Host compiles side-chat capability profile
  -> returns sideChatSessionId + context
  -> Desktop hydrates side state
  -> first prompt uses context snapshot + side transcript
~~~

具体规则：

1. source 必须是普通 main product session；
2. source 可以正在 streaming；
3. source streaming 时 cursor 使用最近完成的 transcript boundary；
4. Side Chat 使用 source 的 scope/cwd，但不复制 source 的 active run；
5. model/thinking snapshot 从 source 创建时捕获；
6. side session 不写 parentSessionId；
7. side session 默认 session name 为 Side Chat · <source name>；
8. 创建失败不产生半成品 session/index record。

### 9.2 Prompt flow

Side Chat 使用标准 session/prompt，但 Host 必须：

1. 识别 session kind；
2. 应用 Side Chat tool profile；
3. 记录 side user message 的原始 text/refs；
4. 在首次 live handle 或恢复后的首次 prompt 中注入 side context snapshot；
5. 对后续 prompt 只使用 side transcript + 当前 binding version；
6. 禁止 Side Chat 使用 write/execute/planning/delegate 等 tool；
7. 保持 SDK/RPC adapter 接收相同 SessionBlueprint；
8. 在 context preparation 或 tool profile 阻止时返回用户可读错误，并提供
   “继续到主会话”的 handoff。

可优先复用 @piwin/session 当前 product history injection 的有界格式，
但必须新建 Side Chat context formatter，避免把 Side Chat 逻辑塞入通用
product-context.ts 的隐式分支。

### 9.3 Tool refusal

Side Chat 不应等模型先调用高风险工具再弹权限。不可用能力应从
tool manifest 中省略。若模型文本仍然建议用户执行写操作，UI 可提供：

~~~text
此操作属于主会话能力。
[继续到主会话] [复制建议]
~~~

“继续到主会话”只把带有 side-chat-message reference 的 prompt 放入
主 Composer，不自动发送。

### 9.4 Permissions

v1 的 Side Chat 不产生 file-write、bash、process、MCP 或 browser mutation
permission request。只读 local inspection 不需要 permission bar。

如果 P1 开启 web_search/web_fetch：

- Host 仍执行正常 network policy；
- permission push 必须带 side session/run；
- Desktop permission bar 必须显示在 Side Chat，而不是覆盖主会话；
- main 和 side 两个 pending permission 不能互相清除；
- CLI 以相同合同处理，非交互环境按既有规则拒绝 ask。

## 10. Desktop UX

### 10.1 Right panel integration

Side Chat 是现有 Right Panel 的一个正常 tab：

- SECTION_META 增加 sideChat；
- readStoredRightPanelState 的 allowed kinds 增加 sideChat；
- Home/+ picker 显示 Side Chat；
- 现有多 tab 挂载语义保留，切换 tab 不清空 draft/scroll；
- Compact mode 使用既有 drawer，不引入第二个 overlay；
- Desktop mode 使用现有第三列 right panel；
- side chat 需要可读宽度，目标 360–520px；
- 不为 Side Chat 复制一套 shell/layout。

### 10.2 Header

Side Chat 会话 tab 占用右侧栏 **同一条** titlebar，不再在面板内另起一行：

~~~text
[+] [Side chat ×] …                     [expand]
~~~

- 打开 Side Chat 时，titlebar 只放会话 tab（其它工具 tab 收进左侧 `+`）；
- 每个 tab 是当前 source session 的一条 Side Chat；
- 新建侧聊走主会话引用 / 上下文菜单，不再在 titlebar 放第二个 `+`；
- tab 上的 `×` 归档该 Side Chat；关掉最后一条（含草稿）即关掉 Side Chat 表面；
- 没有 side session 时显示草稿 tab，发送时再 `side-chat/open`；
- 创建时继承主会话上下文快照；不提供手动「同步」；
- expand / close 仍由 Right Panel titlebar 拥有。

### 10.3 Side Chat picker

picker 只展示当前 source session 的 Side Chats：

- newest first；
- running 显示 activity dot；
- unread 显示 badge；
- archived 默认隐藏；
- 支持 rename/archive/delete；
- New Side Chat 永远创建新 side session，不复用已完成侧聊；
- source session 切换后 picker 自动换 scope；
- Side Chat 运行中切换主 session 不 abort 原 run。

### 10.4 Empty state

无消息时在列中居中显示 icon +「侧聊 / Side chat」标题 + 一行只读说明。
底部 composer 始终可见。没有 active main session 时 Send 禁用，
说明改为：先打开一个主会话，再针对它的上下文提问。

### 10.5 Composer

Side Chat 直接复用主会话的 `ComposerCard`（同一块 slab），以
`embedded` 收窄列宽并去掉主会话才有的能力：

- 多行 textarea、model / thinking picker、Send；
- 运行中显示 Stop（`session/abort`），不 Pause、不排队、不 steer；
- 没有 Agent / Plan / plus / Live chrome；
- 从主会话引用打开时，composer 显示与主会话相同的 context 胶囊；发送时带上 `contextRefs`；
- `isConversationSession` 隐藏 Skills / MCP / Run Mode。

### 10.6 Transcript

Side Chat transcript：

- 复用主会话的 Markdown/code rendering；
- 使用独立 sideChatState / reducer；
- context snapshot 以可折叠的系统区块显示，不伪装成 user message；
- read-only tool 只显示 compact tool card；
- 不显示 PlanCard、SubagentActivityCard、Artifact Canvas 或 mutation diff；
- assistant response footer 提供“引用到主会话”；
- 主会话仍可通过 at-mention 选择 Side Chat 或具体 side assistant message。

### 10.7 Handoff

Handoff 有两种形式：

1. Insert into Composer：把可读文本放入主 Composer，不自动发送；
2. Reference：在主 Composer 里插入 side-chat-message context chip，
   由 Host 在主 prompt preparation 阶段解析。

默认推荐 Reference，因为它保留来源、长度边界和可追溯性。

## 11. Session persistence and lifecycle

### 11.1 Storage

Side Chat 需要写入现有 product session index/transcript 体系：

~~~text
~/.piwin/
  sessions-index/
  sessions/<side-chat-session-id>/transcript.json
~~~

relation 和 snapshot 可以作为 session index 的 JSON-safe 字段，或作为
Side Chat 专属 metadata document；不能只存在 sessionStorage。

### 11.2 Listing

建议：

- session/list 默认只返回 main sessions；
- side-chat/list 按 sourceSessionId 返回 side sessions；
- 全局 conversation search 后续可增加 kind filter；
- CLI 需要显式 --side-chat 才列出 side sessions。

### 11.3 Archive/delete

- archive/delete side chat 不影响 source main；
- archive/delete source main 不级联删除 side chat；
- source archived 时 relation 标记 sourceState = archived；
- source deleted 时 relation 标记 sourceState = missing；
- source missing 时保留 frozen snapshot，Side Chat 可继续对话但不能 sync；
- delete side chat 才删除其 transcript、relation 和 side-owned media；
- 不删除 source session 的 transcript 或媒体。

### 11.4 Restart/reconnect

重启后：

1. right-panel tab state 可以从 sessionStorage 恢复；
2. Side Chat session/relation/context 从 Host transcript/index 恢复；
3. Desktop 通过 side-chat/list 恢复 picker；
4. 选中 Side Chat 后通过 session/messages hydrate；
5. 首次新 prompt 才 lazy-create live Pi handle；
6. SDK/RPC 走同一 SessionBlueprint 和 Side Chat profile。

## 12. CLI behavior

CLI 没有右侧栏，但不能制造第二套 session 语义。实现侧：

~~~text
piwin side-chat list --session <main-session-id>
piwin side-chat open --session <main-session-id> [--message <id>]
piwin side-chat send <side-chat-session-id> "<question>"
piwin side-chat sync <side-chat-session-id>
piwin side-chat resume <side-chat-session-id>
~~~

CLI v1：

- 使用同一 HostCommand/HostPush 合同；
- 显示 Side Chat (read-only) 标识；
- 不提供 Desktop picker、context chip 和 visual handoff；
- 可以用 @side-chat:<id> 或显式 --context 把结果带回主 prompt；
- 不把 side chat 当作 subagent child；
- non-interactive CLI 遵守既有 permission/ask 规则。

这是有意的 surface degradation，而不是 Desktop-only 的分叉实现。

## 13. Edge cases

| Case | Required behavior |
|------|-------------------|
| Main is streaming when Side Chat opens | Use last persisted completed boundary; show stale/update indicator |
| Main finishes after Side Chat opens | Do not auto-inject; offer Sync |
| Main is truncated/forked | Keep old snapshot; invalidate missing refs; show stale state |
| Main edits files while Side Chat reads | Side sees live current files; UI says transcript snapshot + live workspace |
| Side Chat is running and right panel closes | Run continues; reopen shows running/unread state |
| Main session switches | Side panel switches picker scope; old Side Chat run continues |
| Side Chat run errors | Show side-local error; never set main state.error |
| Host disconnects | Preserve draft; show reconnect state; replay/hydrate by side session id |
| Permission request from optional network tool | Route by side session/run; do not overwrite main permission |
| Source deleted | Freeze relation; allow resume; disable Sync |
| No active main session | Disable creation |
| Side Chat attempts write/execute | Tool is unavailable; show handoff CTA |
| Side Chat output contains Artifact fence | Render source/Markdown only; no Canvas promotion |

## 14. Implementation slices

### Slice A — Contracts

| Area | Work |
|------|------|
| session kind | Extend SessionSummary.kind with side-chat or equivalent explicit session kind |
| relation | Add SideChatRelation, source state, context version |
| context | Add SideChatContextSnapshot, SideChatContextRef, PromptContextRef |
| commands | Add side-chat/open, side-chat/list, side-chat/sync |
| prompt | Persist contextRefs without replacing original user text |
| transcript | Add context/ref metadata needed for render and handoff |
| tests | Contract discriminant and serialization coverage |

### Slice B — Session application package

| Area | Work |
|------|------|
| metadata | Store side relation and source cursor |
| snapshot | Pure bounded snapshot builder and stale-ref validation |
| lifecycle | Side archive/delete/list projection |
| media | Reuse existing media root and path rules |
| tests | Snapshot bounds, deletion independence, source-missing resume |

### Slice C — Host Runtime

| Area | Work |
|------|------|
| command | Implement side-chat/* in a focused command module |
| session creation | Internal create with side kind and relation; never parentSessionId |
| blueprint | Compile read-only side profile |
| prompt preparation | Inject context snapshot once per recovered live handle and on sync |
| tools | Exact read-only manifest; optional web profile |
| pushes | Preserve side sessionId/runId through event/run/permission paths |
| tests | SDK/RPC backend conformance and parallel main/side runs |

### Slice D — Desktop

| Area | Work |
|------|------|
| panel registry | Register sideChat and persist tab |
| state | Add side-specific reducer/hook keyed by side session id |
| panel | Replace local scratchpad with Host-backed transcript |
| context | Header, chips, snapshot/live labels, Sync |
| composer | Reuse compact prompt card: Send/Stop + model/thinking picker |
| picker | List/create/rename/archive/delete side chats |
| handoff | Insert and reference actions |
| render | Reuse shared Markdown/message components; compact read cards |
| tests | Right-panel, context, event routing, handoff, restart behavior |

### Slice E — CLI

| Area | Work |
|------|------|
| commands | Add side-chat list/open/send/sync/resume |
| output | Read-only label and source session label |
| context | Explicit --context or at-mention reference |
| parity | Same Host contracts and event semantics |

### Slice F — Docs and architecture

| Area | Work |
|------|------|
| ADR | Update ADR 0032 from Proposed to Accepted after conformance evidence |
| architecture | Add SideChatRelation and side capability profile to architecture docs |
| backlog | Add SIDE rows to canonical backlog only when implementation starts |
| status | Record Desktop/CLI parity and intentional UI degradation |

## 15. Verification requirements

### 15.1 Unit tests

- relation discriminants and JSON round-trip；
- context snapshot max messages/max chars；
- stale source cursor and missing source behavior；
- context ref path validation；
- side profile excludes all write/execute/mutation tools；
- source delete does not delete side transcript；
- sync increments context version without rewriting side transcript。

### 15.2 Host tests

- side-chat/open creates a side session with no parentSessionId；
- open while main is streaming uses last completed boundary；
- first side prompt receives inherited context；
- resumed side session receives inherited context exactly once；
- main and side run concurrently；
- main abort does not abort side, and side abort does not abort main；
- side event/run/permission pushes retain correct session id；
- SDK and RPC use equivalent Side Chat blueprint；
- optional network permission is scoped to side session/run；
- write/bash/process/MCP/browser/planning/delegate calls are unavailable。

### 15.3 Desktop tests

- sideChat appears in Home and + picker；
- side tab persists across right-panel collapse/reopen；
- side transcript does not enter main chatUiReducer；
- main and side streaming indicators are independent；
- Sync updates context chip/version；
- stale source state is visible；
- Handoff inserts without auto-sending；
- source session switching scopes the picker；
- right-panel close preserves active side run；
- side error does not show as main error。

### 15.4 Manual smoke

1. Start a main session and send a prompt.
2. While main is running, open Side Chat.
3. Ask Side Chat to explain the current main response.
4. Confirm Side Chat can read project files but cannot write or run commands.
5. Confirm main continues and can be stopped independently.
6. Modify a file from the main session, then read it from Side Chat; confirm the
   UI distinguishes live workspace from conversation snapshot.
7. Sync main context and confirm contextVersion changes.
8. Reference a Side Chat response from the main Composer and confirm it is not
   auto-sent.
9. Close/reopen the right panel and restart the app; confirm transcript and
   relation recover.
10. Repeat the run/event checks with SDK and RPC host modes。

Required project gates before merge:

~~~text
pnpm typecheck
pnpm test
pnpm --filter @piwin/desktop test
pnpm test:architecture
~~~

## 16. Exit criteria

The spec is implemented only when all of the following are true:

1. Side Chat is a real persisted session, not sessionStorage notes.
2. It inherits and visibly identifies main context.
3. Main/side run and event state are independent.
4. Host tool manifest prevents mutation and execution.
5. Side Chat sync and handoff are explicit and test-covered.
6. Side Chat never appears as a subagent child or ordinary main session.
7. Desktop and CLI share contracts and Host behavior.
8. SDK/RPC conformance is green.
9. Main session list remains free of Side Chat noise by default.
10. ADR 0032 is accepted with implementation evidence.

## 17. References

- [Cursor Side Chats and Conversation Search](https://cursor.com/changelog/side-chat)
- [Cursor Dynamic Context Discovery](https://cursor.com/blog/dynamic-context-discovery)
- [Antigravity Agent Side Panel](https://antigravity.google/docs/ide/agent-side-panel)
- [Antigravity Feature Overview](https://antigravity.google/docs/features?app=antigravity-ide)
- [GitHub Copilot: Explore a codebase](https://docs.github.com/en/enterprise-cloud%40latest/copilot/tutorials/explore-a-codebase)
- [GitHub Copilot CLI and VS Code context sharing](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/connecting-vs-code)
- [piwin architecture](../architecture.md)
- [Product-level session fork](./session-fork-product-adaptation.md)
- [Runtime refactor](./runtime-refactor.md)
