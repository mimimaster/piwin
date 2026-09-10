# ADR 0032: Side Chat 作为共享上下文的独立只读会话

## Status

Accepted — implementation complete (2026-08-06)

## Context

piwin 需要在 Desktop 右侧栏提供 Side Chat。它的产品价值不是再提供一个
sessionStorage 便签，而是让用户在主 Agent 继续工作时，围绕当前问题
讨论一个分支：

- 继承主会话的上下文；
- 可以读取同一个项目和当前工作区；
- 不打断主会话；
- 侧聊默认不具备写文件、执行命令和编排任务的能力。

Cursor 3.11 的公开行为明确采用了这种模型：Side Chat 从主聊天继承上下文，
自身是持久的完整 Agent 对话，并可以把结果通过 at-mention 拉回主线程。
主会话继续运行，Side Chat 默认用于读取、搜索和回答。

直接复用主 session 会违反当前 Host 的运行语义：同一个 product session
只有一个 foreground run，新 prompt 会取代已有 run。直接复用 subagent
也不正确，因为 parentSessionId 表示模型创建的任务子关系，会触发
subagent 生命周期和合并语义。

## Decision

### 1. Side Chat 是 product session 的独立种类

新增 sessionKind: side-chat 和专用 SideChatRelation。Side Chat：

- 拥有独立的 sessionId、transcript、runId、runtime generation 和 stream；
- 绑定一个 sourceSessionId；
- 不使用 parentSessionId；
- 不伪装成 ProductSessionOrigin.kind = fork；
- 不进入 subagent lineage、batch、merge 或 worktree 流程。

### 2. 上下文共享，运行状态隔离

Side Chat 在创建时捕获主会话的上下文边界，并允许显式同步后续主会话
内容。共享的是：

- 主会话 transcript 的有界快照或引用；
- 项目 scope、working directory 和项目规则；
- 用户明确选择的消息、文件、diff、终端输出和错误上下文。

不共享的是：

- foreground run；
- streaming event reducer；
- permission prompt；
- plan、subagent、job、PTY 和 browser 生命周期；
- Side Chat 的后续 transcript。

### 3. Side Chat 使用 Host 强制的 read-only capability profile

UI 隐藏按钮不是安全边界。Host 必须为 Side Chat 编译独立的 capability
profile：

- 允许只读文件/代码检索；
- 可选只读网络工具，受产品 web 配置和 Host policy 约束；
- 不提供写文件、编辑、Shell、进程、MCP、浏览器交互、计划、子代理、
  Artifact 执行和图片生成工具；
- agentMode = ask 只作为权限语义补充，不能替代工具 allowlist。

即使主会话使用 yolo，也不能通过 UI 或 prompt 让 Side Chat 获得
Side Chat profile 之外的工具。

### 4. 同步上下文必须显式

创建时使用主会话最新的持久化边界。主会话继续产生新消息时，Side Chat
不自动把每个 token 或每个新回复塞进自己的上下文。用户可以点击
“同步主会话上下文”，Host 以新的 context version 更新绑定。

这样同时保留：

- Cursor 风格的共享上下文；
- 并行会话的稳定性；
- 可解释的 token 成本；
- 主会话和侧聊之间不隐式漂移的边界。

### 5. Side Chat 不进入主会话列表

Side Chat transcript 必须持久化到 ~/.piwin，但默认只在 Side Chat picker
中展示。主会话列表不被 Side Chat 数量污染。侧聊可以 rename、archive、
resume 和 delete，但 v1 不支持从侧聊再次 duplicate/fork。

### 6. 架构变更先经过 contracts

实现顺序必须是：

1. @piwin/contracts 类型和 HostCommand/HostPush；
2. @piwin/session 的 relation、context snapshot 和存储；
3. @piwin/host-runtime 的 command、profile、prompt preparation；
4. apps/desktop 的右侧栏和独立 UI state；
5. CLI 的同合同降级入口；
6. SDK/RPC backend conformance。

apps/* 不得导入 Pi 包；@piwin/agent-host 仍只负责 Pi backend 和
event/tool adapter。

## Consequences

### Positive

- Side Chat 真的拥有“继承上下文”的产品价值；
- 主会话和 Side Chat 可并行运行；
- 写操作和高风险工具不会因为上下文共享而意外扩权；
- 运行、权限、事件和 transcript 边界清晰；
- 后续可以增加“引用 Side Chat 回复回主会话”而不复制整段文本。

### Negative

- 需要新增 session relation 和 context snapshot 合同；
- Desktop 需要维护第二个 chat state projection；
- Host 需要区分 source context 与 side transcript；
- SDK、RPC、CLI 需要一起更新。

## Rejected alternatives

### Reuse the main session

Rejected。同一个 session 的新 prompt 会抢占已有 foreground run，且无法
独立 stop、permission 和 event routing。

### Use parentSessionId

Rejected。这是 subagent relationship，带有 depth、task、lifecycle、
merge 和 child listing 语义，不是用户侧的讨论分支。

### Keep a local scratchpad

Rejected。不持久化 Host transcript，也不能共享模型上下文，无法满足
Side Chat 的产品目的。

### Duplicate the complete main transcript forever

Rejected as the long-term model。MVP 可以复用已有 product history injection
能力做有界快照；长期应使用 context reference + on-demand resolution，避免
每次刷新都复制整个长 transcript。

## Implementation gate

在新增合同前，应将本 ADR 的结论同步到
docs/specs/side-chat-session.md。实现完成后将本 ADR 状态改为 Accepted，
并补充 SDK/RPC conformance 和 Desktop smoke evidence。

## Conformance evidence

### Contracts (@piwin/contracts)

- `src/side-chat.ts`: `SideChatRelation`, `SideChatContextSnapshot`,
  `SideChatContextRef`, `SideChatOpenData`, `SideChatSyncData`, `SideChatListData`
  types exported.
- `src/host.ts`: `CreateSessionInput.sessionKind`, `SessionSummary.kind`,
  `SessionSummary.sideChatRelation`, `PromptInput.contextRefs` added.
- `src/session-index.ts`: `SessionIndexRecord.kind` extended to
  `'main' | 'subagent' | 'side-chat'`; `sideChatRelation` and `sideChatContext`
  fields added.
- `src/ipc.ts`: `side-chat/open`, `side-chat/list`, `side-chat/sync`
  HostCommand variants added.
- 6 unit tests pass (`side-chat.test.ts`).

### Session (@piwin/session)

- `side-chat-store.ts`: `createSideChatSessionRecord`, `getSideChatSessionRecord`,
  `listSideChatSessions`, `updateSideChatContext`, `markSideChatSourceState`.
- `side-chat-context.ts`: `buildSideChatContextSnapshot` (24k chars / 40 msgs
  bounds), `formatSideChatContextBlock`, `mergeSideChatContextIntoPrompt`.
- `session-index-store.ts`: `listSessionsForProject` uses
  `isPrimarySessionRecord` so side chats (SIDE-D9) stay off the main list.
- `session-search.ts`: search uses the same primary-session predicate.
- 9 unit tests pass (`side-chat-store.test.ts`); 128 total session tests pass.

### Host runtime (@piwin/host-runtime)

- `commands/side-chat-commands.ts`: `handleSideChatCommand` implements
  open/list/sync with source validation (rejects non-main sources), context
  snapshot capture, version bumping, and source-state gating.
- `blueprint-compiler.ts`: `buildSideChatToolPolicy` compiles a fixed
  read-only profile (`filesystem-read` + `read/grep/find/ls` pi builtins +
  optional `web-search`/`web-fetch`); write/shell/process/browser/mcp/
  planning/delegate/notes/flashcards/image-gen are explicitly absent.
- `commands/session-product-commands.ts`: `session/archive` marks
  `sourceState: 'archived'`; `session/delete` marks `sourceState: 'missing'`.
- `commands/session-live-commands.ts`: side-chat snapshot injected via
  `needsProductHistoryInjection` (exactly once per recovered handle);
  `resolvePromptContextRefs` resolves file/message/diff/terminal/error refs.
- 12 unit tests pass (`side-chat-commands.test.ts`); 900 total host-runtime
  tests pass.

### CLI (apps/cli)

- `side-chat-command.ts`: `runSideChatList`, `runSideChatOpen`,
  `runSideChatSync`, `runSideChatSend`, `runSideChatResume`.
- `index.ts`: `piwin side-chat list|open|sync|send|resume` dispatched.
- 12 unit tests pass (`side-chat-command.test.ts`).

### Desktop (apps/desktop)

- `side-chat-panel.tsx`: Host-backed panel with a side-chat tab strip, empty
  state, reused ComposerCard (send/stop), sync, and handoff (insert to main).
- `host-client.ts`: `sideChatOpen`, `sideChatList`, `sideChatSync` methods.
- `App.tsx`: `SideChatPanel` wired with `hostClient` prop.
- Typecheck passes.

### SDK/RPC conformance

- Side Chat sessions use `CreateSessionInput.sessionKind: 'side-chat'`,
  which flows through `compileBlueprintForWorker` → `buildSideChatToolPolicy`
  in both SDK and RPC paths (the compiler is transport-agnostic).
- `session/prompt` and `session/abort` are existing commands that work
  identically for side-chat sessions (run isolation is by sessionId).
- `session/resume` reuses the same host path as main sessions.
