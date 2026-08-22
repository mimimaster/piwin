# Spec — Product-level Session Fork and Response Actions

| Field | Value |
|-------|-------|
| Status | **Active — core contracts, Host path, response actions, and response-level lineage tree are implemented incrementally** |
| Date | 2026-08-04 |
| Trigger | Users need a safe way to leave a wrong conversational route without destroying the original session |
| Related | [ADR 0009](../adr/0009-session-resume-product-shell.md), [Product Depth](./product-depth-competitive-alignment.md), [Desktop UI modernization](./desktop-ui-modernization.md), [Canonical backlog](../todo-deferred.md) |
| Binding | `AGENTS.md`; contracts first; product transcript remains source of truth; apps never import Pi; SDK/RPC semantics stay aligned |
| Backlog prefix | **SF-*** (Session Fork) |

---

## 0. Original user requirement

This specification records the product requirement before translating it into
implementation details:

> “Pi 不是支持树状会话吗，我们现在是不是没使用这个能力？”

> “肯定要做产品级别的适配，走错路就分叉的能力太吸引人了。我需要你以产品的角度入手，设计一下，这个功能要怎么实现，最好也是让用户自己主动选择使不使用。”

> “Duplicate 好像没入口，跟‘从此处分叉’一样，加载 response 的底下，设计两个 icon，放那就好了；这种 icon 用 SVG 更合适。”

The intended product outcome is therefore:

1. A user can actively choose **Fork from here** under a completed assistant
   response.
2. Forking preserves the original conversation and creates a linked alternate
   route from the selected response.
3. Existing whole-session **Duplicate** gets a discoverable response-level
   entry instead of living only in a session-row menu.
4. Both actions use small inline SVG icons; no generated image asset is needed.
5. The architecture must stay clean: product lineage is not disguised as Pi
   JSONL state, Git history, or subagent parentage.

---

## 1. Product one-liner

> **Session Fork lets the user preserve the current conversation and start a
> linked alternative route from any completed assistant response.**

The default transcript stays linear. A tree appears only after the user
explicitly creates a fork.

---

## 2. Product judgment

### 2.1 Why this is worth building

Coding-agent conversations often fail gradually: a design assumption becomes
wrong, the model keeps compensating for it, and the user is left choosing
between continuing a polluted thread or manually recreating context in a new
session. Forking changes that choice:

- preserve a useful original route;
- try another architecture, model, or prompt from the same context;
- compare alternatives without destructive truncate/resend;
- make long sessions safer to explore;
- reduce the cost of saying “this path is wrong; try another one.”

This is a high-value product-depth feature because it improves the core agent
loop rather than adding another peripheral panel.

### 2.2 Why the first implementation must not be a full Pi tree

Pi native JSONL session trees remain valuable, but piwin currently restores a
product transcript and lazily creates a new live Pi session after restart.
Immediately coupling this feature to Pi native active-leaf restoration would
also require proving:

- stable Pi session-file restore;
- active-leaf correctness after restart;
- SDK and RPC-worker parity;
- transcript/Pi JSONL reconciliation;
- truncate, compaction, tool, and attachment behavior on every branch.

That is a separate architecture spike. The first product implementation must
create **independent product sessions with explicit lineage**, preserving ADR
0009 and the existing reliable resume path.

### 2.3 Weight assessment

| Capability | Weight | Product value | Decision |
|------------|--------|---------------|----------|
| Response-level Duplicate entry | Small | Medium | Ship with the action strip |
| Product transcript fork from a response | Medium | High | Build now in vertical slices |
| Branch lineage navigation | Medium | High after the first fork exists | Build after core fork persistence |
| Isolated Git worktree per fork | Medium/high | High for parallel coding | Follow-up slice, not a core blocker |
| Exact historical filesystem checkpoint | High | Potentially high | Defer until validated by usage |
| Full Pi native multi-leaf restore/UI | High/risky | Potentially high | Spike later; do not block product fork |

---

## 3. Terminology and domain boundaries

### 3.1 User-facing terms

| Term | Meaning |
|------|---------|
| **Duplicate conversation** | Create an independent copy of the complete current conversation |
| **Fork from here** | Create a linked child conversation ending at the selected assistant response |
| **Conversation branches** | The linked set of user-created fork sessions sharing a root |
| **Shared workspace** | Forked sessions read and write the same current project directory |
| **Isolated worktree** | A fork uses a separate Git worktree from creation onward |

Use “conversation” or “session” in UI copy. Do not call the user-facing feature
“Pi JSONL tree.”

### 3.2 Similar concepts that must remain separate

| Concept | Source of truth | Relationship to this feature |
|---------|-----------------|------------------------------|
| Product Session Fork | `~/.piwin` session index + transcript | This specification |
| Pi native session tree | Pi JSONL / active leaf | Deferred implementation detail |
| Subagent parent/child | `parentSessionId` + subagent lifecycle | Separate model-created task relationship |
| Git branch/worktree | Git repository | Optional filesystem isolation for a fork |
| Transcript outline | Linear `SessionOutlineNode[]` | Jump navigation inside one session, not lineage |
| Edit/revert | Destructive truncate of current session | Existing action; fork is the non-destructive alternative |

`SessionTreeView` remains reserved for Pi-native session-tree projection.
Product branch UI must use a new product lineage contract and must not overload
`SessionTreeView`, `SessionOutlineNode`, or `parentSessionId`.

---

## 4. Locked decisions

| ID | Decision | Reason |
|----|----------|--------|
| SF-D1 | Fork is an explicit user action; piwin never silently forks because a model or heuristic thinks the route is wrong. | User remains in control; no surprise session proliferation. |
| SF-D2 | No global “enable tree sessions” switch is required for v1. The feature is passive until the user clicks its icon. | Availability without automatic behavior is already opt-in; avoid configuration debt. |
| SF-D3 | Duplicate and Fork remain separate operations. | Duplicate creates an independent whole-session copy; Fork creates linked lineage at one response. |
| SF-D4 | ~~The newest completed assistant response shows **Duplicate + Fork**.~~ **Reversed 2026-08-21: the response footer shows Fork only.** | The original reason still holds — Duplicate copies the whole session, so it could only ever sit under the newest response. But under *that* response "whole session" and "up to this response" are the same messages, so Duplicate rendered as a Fork that forgot to record its lineage (see §10.1). Duplicate keeps its session-menu entries, where the scope picker ("continue in project") is what makes the copy meaningful. |
| SF-D5 | Fork v1 targets completed assistant responses only. | This matches the requested response footer and gives an unambiguous completed-turn boundary. |
| SF-D6 | Original sessions are immutable under Fork. | Fork must never truncate, rename, archive, or mutate the source transcript. |
| SF-D7 | Product transcript remains history truth. A fork creates a fresh product session and lazily creates a live Pi session on the next prompt. | Preserves ADR 0009 and dual-host behavior. |
| SF-D8 | Product lineage uses a dedicated discriminated origin type. It does not reuse subagent `parentSessionId`. | Prevents user-created branches from contaminating subagent lifecycle logic. |
| SF-D9 | Shared workspace is honest conversation branching, not code time travel. | Files are not automatically restored to their historical state. |
| SF-D10 | Exact filesystem checkpoints and branch merge are out of v1. | Both are substantially heavier and have separate conflict/security semantics. |
| SF-D11 | Icons are inline SVG components in the existing icon system; do not generate raster assets. | Crisp at all scales, themeable through `currentColor`, no asset pipeline. |
| SF-D12 | A source session may be archived or deleted without cascading deletion to forks. | Every fork is an independently usable session. |

---

## 5. Scope

### 5.1 Required product scope

1. Whole-session Duplicate action under the newest completed assistant response.
2. Fork action under every completed assistant response.
3. Product-session origin and lineage contracts.
4. Prefix transcript cloning through the selected response.
5. Attachment cloning and path rewriting for derived sessions.
6. Shared-workspace fork mode.
7. Source/branch navigation and lightweight lineage presentation.
8. SDK and RPC product-path parity.
9. Tests for clone boundaries, lineage, deletion independence, and UI
   visibility rules.

### 5.2 Follow-up scope

1. Optional isolated Git worktree mode.
2. CLI command parity for explicit message-id forks.
3. Exact historical filesystem checkpoints.
4. Pi native JSONL tree restore/projection spike.

### 5.3 Non-goals

- automatically deciding that a route is wrong;
- automatically creating multiple model candidates;
- rendering a permanent full-screen DAG;
- merging two conversation transcripts;
- pretending shared files were restored to the response timestamp;
- cloning active processes, PTYs, browser state, pending permissions, or live
  subagent runs;
- importing Pi packages from Desktop or `@piwin/session`;
- changing `SessionOutlineNode[]` into a branch structure.

---

## 6. Response action UX

### 6.1 Placement and ordering

Mount one `AssistantResponseActions` footer as the final child of an eligible
assistant message:

```text
assistant Markdown
tool / files-changed / walkthrough cards (when present)
response action footer:  [Duplicate] [Fork]
```

The footer is visually subordinate to the answer:

- `26px × 26px` icon buttons;
- `14px × 14px` SVG glyphs;
- `4px` gap;
- transparent background at rest;
- muted foreground at rest;
- subtle hover surface and normal text color on hover;
- hidden by opacity for mouse users until the response is hovered;
- visible while any footer control has keyboard focus;
- always visible for coarse-pointer/touch environments;
- no text labels in the row; tooltip and accessible label are required.

Use the shared `@piwin/ui-kit` `IconButton` primitive. Do not add another raw
one-off button style.

### 6.2 Visibility matrix

| Response state | Duplicate | Fork |
|----------------|-----------|------|
| Newest completed assistant response | Visible | Visible |
| Older completed assistant response | Hidden | Visible |
| Streaming response | Hidden | Hidden |
| Failed/partial response | Hidden | Hidden in v1 |
| Archived active session | Hidden | Hidden |
| Read-only subagent inspector | Hidden | Hidden |
| No active product session | Hidden | Hidden |

“Newest” means the last eligible assistant response in the persisted product
transcript, not merely the last currently mounted DOM row.

### 6.3 Duplicate action behavior

Tooltip and accessible labels:

- zh-CN: `复制整个会话`
- en: `Duplicate conversation`

Behavior:

1. Call existing `session/duplicate` for the active session.
2. Do not open a confirmation dialog; this is non-destructive.
3. Create an independent session origin of kind `duplicate`.
4. Navigate to the new session after success.
5. Show a success notification with the generated name.
6. If the request fails, remain in the source session and show a mapped error.

Although Duplicate and Fork contain the same messages when Fork is invoked on
the newest response, their product semantics are intentionally different:

- Duplicate is a standalone copy and does not join the branch tree.
- Fork is linked to the selected response and appears in conversation lineage.

### 6.4 Fork action behavior

Tooltip and accessible labels:

- zh-CN: `从此处分叉`
- en: `Fork from here`

The selected response is always included in the new transcript.

#### General session

The first release may create the fork immediately after the click because no
project filesystem ambiguity exists. A lightweight naming popover is optional,
not a blocker. The default generated name is sufficient.

#### Project session — shared workspace slice

Open a product dialog before creation:

```text
从此处分叉

新会话会保留截至这条回复的对话，原会话不会改变。

注意：对话会回到这里，但项目文件不会自动回退。
新旧会话将继续使用当前工作区。

名称（可选）
[                                          ]

[取消] [创建分支]
```

The warning is product-critical and must not be reduced to tooltip-only copy.

#### Project session — isolated worktree follow-up

When worktree support is available, the same dialog adds an explicit strategy:

```text
工作区

● 使用当前工作区
  新旧会话共享当前文件，适合顺序探索。

○ 创建隔离 Worktree
  新会话在独立目录继续，适合并行实现。
  Worktree 从当前 Git HEAD 创建，不代表这条消息当时的文件快照。
```

Do not persist a default strategy in v1. Asking in the dialog preserves user
control without adding another config field before usage is understood.

### 6.5 Post-create navigation

After a successful fork:

1. Navigate to the new session.
2. Load the cloned transcript immediately.
3. Leave the Composer empty and focused.
4. Show a compact lineage notice near the session title:

```text
分叉自「重构登录流程」
在“我们可以先移除状态库……”之后
[返回来源]
```

5. For project sessions, also show one workspace badge:
   - `共享当前工作区`
   - `隔离 Worktree`

### 6.6 Source-response branch affordance

When a response has one or more direct forks, show a quiet count next to its
action footer:

```text
⑂ 2 个分支
```

Activating the count opens a popover listing direct child forks. This is a
later lineage-UI slice and must not block the initial create operation.

---

## 7. SVG icon design

No `imagegen` call is necessary. Both glyphs belong in
`apps/desktop/src/shell-icons.tsx` and inherit the existing `IconBase` contract:

- `viewBox="0 0 24 24"`;
- `fill="none"`;
- `stroke="currentColor"`;
- rounded line caps and joins;
- no embedded colors;
- readable at `14px` and `16px`.

### 7.1 Duplicate conversation glyph

Name: `IconDuplicateConversation`

Visual: two overlapping rounded conversation/document panels with a small plus
inside the front panel. It must be distinguishable from the existing
`IconCopy`, which means “copy message text.”

Reference SVG geometry:

```tsx
<path d="M8 16H6.5A2.5 2.5 0 0 1 4 13.5v-7A2.5 2.5 0 0 1 6.5 4h7A2.5 2.5 0 0 1 16 6.5V8" />
<rect x="8" y="8" width="12" height="12" rx="2.5" />
<path d="M14 11.5v5M11.5 14h5" />
```

### 7.2 Fork conversation glyph

Name: `IconForkConversation`

Visual: one lower trunk splitting upward into two routes. It should read as a
conversation decision split, not reuse the Git branch icon used elsewhere.

Reference SVG geometry:

```tsx
<circle cx="6" cy="5" r="1.5" />
<circle cx="18" cy="5" r="1.5" />
<circle cx="12" cy="19" r="1.5" />
<path d="M12 17.5v-4.25C12 8.7 9.55 5 6 5" />
<path d="M12 13.25C12 8.7 14.45 5 18 5" />
```

The implementation may make minor optical adjustments, but changing the
metaphor requires product review.

### 7.3 Action order

On the newest response, render:

```text
[IconDuplicateConversation] [IconForkConversation]
```

Duplicate is the utility action; Fork remains the more important conceptual
action and receives the clearer tooltip. Do not add thumbs, share, or more-menu
actions as part of this feature.

---

## 8. Contracts and data model

### 8.1 Session origin

Add a dedicated product-session origin union in `@piwin/contracts`:

```ts
export type ProductSessionOrigin =
  | {
      kind: 'duplicate';
      sourceSessionId: string;
      sourceSessionNameSnapshot?: string;
      createdAt: string;
    }
  | {
      kind: 'fork';
      rootSessionId: string;
      sourceSessionId: string;
      sourceSessionNameSnapshot?: string;
      sourceMessageId: string;
      sourceMessageRole: 'assistant';
      sourceMessagePreview: string;
      sourceMessageCreatedAt: string;
      workspaceStrategy: 'shared' | 'worktree';
      sourceGitHead?: string;
      sourceWorkspaceWasDirty?: boolean;
      createdAt: string;
    };
```

Add `origin?: ProductSessionOrigin` to:

- `SessionIndexRecord`;
- `SessionSummary`;
- Desktop-safe session list projection.

This is an additive optional field. Existing v1/v2 records need no eager
migration. New derived sessions write the field; legacy duplicates continue to
load as independent sessions with no origin.

### 8.2 Product lineage view

Do not reuse `SessionTreeView`. Add:

```ts
export type ProductSessionLineageNode = {
  sessionId: string;
  name?: string;
  origin?: ProductSessionOrigin;
  isArchived: boolean;
  updatedAt: string;
};

export type ProductSessionLineageView = {
  rootSessionId: string;
  activeSessionId: string;
  rootMissing: boolean;
  nodes: ProductSessionLineageNode[];
};
```

The lineage is a product-session graph. It may contain a missing root after
permanent deletion; surviving forks remain valid.

### 8.3 Host commands

Keep the existing command and add the new command/query:

```ts
type DuplicateSessionCommand = {
  type: 'session/duplicate';
  sessionId: string;
  name?: string;
};

type ForkSessionCommand = {
  type: 'session/fork';
  sessionId: string;
  messageId: string;
  name?: string;
  workspaceStrategy: 'shared' | 'worktree';
};

type GetSessionLineageCommand = {
  type: 'session/lineage';
  sessionId: string;
};
```

Successful Duplicate/Fork responses return:

```ts
type DerivedSessionResponseData = {
  sessionId: string;
  sourceSessionId: string;
  session: SessionSummary;
  messages: SessionTranscriptMessage[];
  origin: ProductSessionOrigin;
};
```

### 8.4 Fork validation rules

Host validation is authoritative:

1. Source session exists and is not archived.
2. Source transcript exists.
3. `messageId` exists in that transcript.
4. The selected message role is `assistant`.
5. The selected message status is `done`.
6. The selected run is not active.
7. Worktree strategy is accepted only for a trusted project-scoped Git repo.
8. No model-facing caller may supply lineage fields directly.

---

## 9. Package ownership and dependency flow

```text
apps/desktop
  response action footer · fork dialog · lineage navigation
        ↓ HostCommand / HostResponse only
packages/agent-host
  validates request · orchestrates media/git/session services · binds shell
        ↓ public package APIs
packages/session
  transcript prefix clone · origin/root logic · index queries
packages/media
  clone referenced media into target session vault · rewrite refs
packages/git (follow-up)
  create/remove session-fork worktrees
        ↓
packages/contracts
  origin · lineage · IPC types
```

Architecture rules:

- Desktop never reads or writes transcript/index files directly.
- `@piwin/session` owns pure transcript and lineage logic.
- `@piwin/media` owns media-path validation and binary cloning.
- `@piwin/git` owns worktree process calls.
- `@piwin/agent-host` coordinates the transaction and live session binding.
- Only `@piwin/agent-host` may later adapt the operation to Pi-native branches.

---

## 10. Transcript derivation rules

### 10.1 Duplicate

Duplicate clones the complete persisted transcript at command execution time.

### 10.2 Fork

Fork clones messages from index `0` through the selected assistant response,
inclusive:

```ts
const sourceMessageIndex = source.messages.findIndex(
  (message) => message.id === input.messageId,
);
const forkMessages = source.messages.slice(0, sourceMessageIndex + 1);
```

The clone operation must:

- generate new message IDs for the target session;
- retain role, text, timestamps, final status, thinking, tool cards, model
  snapshot, and safe presentation metadata;
- convert any impossible legacy `streaming` status to `done` only after host
  validation confirms the source run is terminal;
- build an old-message-ID to new-message-ID map for tests and future references;
- exclude session-level live state.

Do not copy:

- active run IDs as active execution state;
- pending permission requests;
- PTY/process/browser handles;
- usage ledger entries;
- current `plan.json` by default;
- unmerged child-subagent runtime ownership;
- walkthrough generation jobs.

Already-rendered tool history and completed subagent summary cards may remain as
historical transcript presentation.

### 10.3 Name generation

Defaults:

- Duplicate: `Copy of <source name>` using the existing collision policy.
- First fork: `<source name> · Branch`.
- Later unnamed direct forks: `<source name> · Branch 2`, `Branch 3`, ...

The first new user turn may run existing auto-naming only while the generated
name remains `nameSource: 'default'` or another explicitly eligible source.
A user-supplied name writes `nameSource: 'user'` and is never overwritten.

---

## 11. Attachment and media correctness

The current Duplicate implementation preserves attachment paths as shared
references. That is not sufficient for a product-level derived-session model:
permanent deletion of the source also removes its per-session media directory,
which can break the duplicate or fork.

Before response-level Duplicate and Fork ship, both must share one hardened
media derivation path:

1. Collect media attachments referenced by the cloned message set only.
2. Validate every source path is inside `~/.piwin/media/`.
3. Clone each referenced asset into
   `~/.piwin/media/<target-session-id>/`.
4. Prefer a safe hard link when supported; fall back to byte copy.
5. Preserve MIME type and dimensions.
6. Rewrite target transcript attachment IDs and paths.
7. Never allow the target transcript to depend on the source session media
   directory.
8. If cloning fails, do not publish the target index record.

This also fixes existing Duplicate lifecycle correctness instead of creating a
second incompatible implementation for Fork.

---

## 12. Host transaction and resume behavior

### 12.1 Visibility transaction

Derived-session creation has no cross-directory filesystem transaction, so the
Host uses an explicit visibility order:

1. Validate source/index/transcript and build target data in memory.
2. Allocate target session ID.
3. Clone referenced media; clean it up on failure.
4. Save target transcript atomically.
5. Write target session index record **last** as the visibility commit point.
6. Bind a product shell for the target session.
7. Return the target summary and messages.

If a failure occurs before index publication, best-effort cleanup removes the
target transcript/media paths. Never leave a visible empty session after a
failed fork.

### 12.2 Lazy Pi session creation

Duplicate/Fork must not eagerly create a live Pi session. The new product
session resumes through `ProductShellSession`:

```text
open derived session
  → hydrate cloned product transcript
  → user sends first new prompt
  → create fresh live SDK/RPC-worker session
  → inject cloned product history once
  → continue normally
```

This behavior is identical in SDK and RPC product modes because derivation
happens above the adapter boundary.

### 12.3 Working directory forwarding

`ProductShellSession` must forward the persisted derived-session working
directory as `CreateSessionInput.cwd` when creating its live session. This is
mandatory before isolated worktree forks ship; a comment-only placeholder is
not sufficient.

---

## 13. Workspace semantics

### 13.1 Shared workspace

Shared mode means:

- source and fork use the same current project files;
- edits from one session are immediately visible to the other;
- conversation history is forked, filesystem history is not;
- running both branches concurrently can cause file conflicts.

The fork header and creation dialog must say this plainly.

### 13.2 Isolated worktree follow-up

Worktree mode requires a dedicated session-fork worktree path, not reuse of
subagent naming or lifecycle fields:

- branch prefix: `piwin/fork/<safe-session-id>`;
- worktree directory: `<project>/.piwin-worktrees/forks/<safe-session-id>`;
- `scope.projectPath` remains the trusted original repository root;
- `workingDirectory` and live `cwd` point at the worktree;
- origin records source HEAD and dirty-state facts;
- UI warns that uncommitted source changes are not historical checkpoints.

The Git package should expose a purpose-aware worktree API or a dedicated
session-fork wrapper. Do not call a function that hardcodes
`piwin/subagent/*` and then relabel the result.

### 13.3 Exact code checkpoint — deferred

Restoring files to the selected response would require a separate checkpoint
system for tracked diffs, untracked files, secrets, size limits, cleanup, and
conflict handling. It must not be implied by this feature or silently added to
the first worktree implementation.

---

## 14. Product lineage behavior

### 14.1 Root and parent resolution

- Forking a root session sets `rootSessionId = sourceSessionId`.
- Forking an existing fork preserves its `rootSessionId` and sets the immediate
  `sourceSessionId` to the current fork.
- Duplicate does not join lineage, even when duplicating a fork.

### 14.2 Navigation UI

Do not add a permanent right-side graph. Keep the default interface linear.

When lineage exists:

1. Group related sessions lightly in the session navigator.
2. Limit visible indentation to two levels.
3. Use a breadcrumb for deeper chains.
4. Show the active branch clearly.
5. Collapse large sibling sets behind `N more branches`.
6. Keep Git graph and subagent activity visually separate.

Example:

```text
重构登录流程
  Original
  ├─ 尝试原生状态管理
  └─ 保留 Zustand
```

### 14.3 Archive and delete

- Archiving a source does not archive forks.
- Archiving a fork does not affect its source or siblings.
- Deleting a source does not delete forks.
- A surviving fork with a missing source shows `Original conversation deleted`
  using stored name/message snapshots.
- Deleting a fork removes only that fork and its owned media/worktree according
  to the normal derived-session cleanup policy.

---

## 15. Desktop component design

### 15.1 Replace dead action-strip code deliberately

`apps/desktop/src/message-actions.tsx` currently defines a generic action strip
but is not mounted by `ChatThread`. Do not layer another unused component on
top of it.

Implementation choice:

1. Replace it with a focused `assistant-response-actions.tsx`, or
2. Rename and narrow the existing component in the same change.

The component owns presentation and local duplicate-busy/fork-busy state only.
Host requests and navigation stay in the existing session action hook/App
orchestration layer.

Suggested props:

```ts
type AssistantResponseActionsProps = {
  messageId: string;
  showDuplicate: boolean;
  showFork: boolean;
  directForkCount: number;
  disabled: boolean;
  onDuplicate: () => void;
  onFork: (messageId: string) => void;
  onOpenForks?: (messageId: string) => void;
  locale: 'zh-CN' | 'en';
};
```

### 15.2 State ownership

- `ChatThread` computes response eligibility from persisted message/run state.
- Session action hooks own Duplicate/Fork requests and resume navigation.
- App owns the Fork dialog because it coordinates active session, project
  scope, trust, and future worktree availability.
- The reducer stores product origin/lineage projections, never Pi-native nodes.

### 15.3 UI-kit rule

Use existing `Dialog`, `Button`, `IconButton`, `Notice`, `Popover`, and
notification primitives from `@piwin/ui-kit`. Product-specific layout CSS may
live under the transcript region stylesheet; do not create parallel modal or
button primitives.

---

## 16. Error model

Host errors should use stable names/codes at the boundary where practical:

| Code | User-facing meaning |
|------|---------------------|
| `session-fork-source-not-found` | The source conversation no longer exists |
| `session-fork-message-not-found` | The selected response is no longer present |
| `session-fork-message-incomplete` | Wait for the response to finish before forking |
| `session-fork-source-archived` | Restore the source before creating a fork |
| `session-fork-media-clone-failed` | Attachments could not be copied safely |
| `session-fork-worktree-unavailable` | This project cannot create an isolated worktree |
| `session-fork-persist-failed` | The new branch could not be saved |

Internal logs may include session/message IDs and safe paths, but never message
content, API keys, or attachment bytes.

---

## 17. Testing strategy

### 17.1 `@piwin/contracts`

- typecheck all consumers after adding `ProductSessionOrigin`;
- exact optional-property behavior remains valid;
- Host command/response unions cover Fork and lineage.

### 17.2 `@piwin/session` unit tests

Golden cases:

1. Duplicate clones every message.
2. Fork includes the selected assistant response.
3. Fork excludes every later message.
4. New message IDs are unique and a source→target map is produced.
5. Fork rejects user/tool/system/incomplete selected messages.
6. Root resolution is stable for root→child→grandchild forks.
7. Duplicate origin does not appear in fork lineage.
8. Missing/deleted root still returns a valid lineage view.
9. Generated names remain unique.

### 17.3 `@piwin/media` tests

1. Only attachments in the cloned prefix are copied.
2. Paths outside the media root are rejected.
3. Target attachments point under the target session directory.
4. Deleting source media does not break target attachments.
5. Clone failure leaves no published target record.

### 17.4 Host command tests

1. Duplicate returns an independent full transcript with origin metadata.
2. Fork returns a prefix transcript with fork origin metadata.
3. Source transcript/index are byte-equivalent before and after Fork.
4. Product shell is lazy; no live Pi session is created before first prompt.
5. First target prompt injects target history exactly once.
6. SDK and RPC-worker product paths return equivalent summaries/messages.
7. Archived source, active response, unknown message, and unsafe worktree cases
   fail with stable codes.
8. Delete source leaves child fork resumable.

### 17.5 Desktop tests

1. Latest completed response renders Duplicate + Fork icons.
2. Historical completed response renders Fork only.
3. Streaming/error responses render neither icon.
4. Hover, focus, tooltip, and accessible labels work.
5. Duplicate request navigates to the returned session.
6. Project Fork opens the filesystem warning dialog.
7. Cancel creates nothing.
8. Create loads prefix messages and focuses Composer.
9. Lineage source link and direct-fork count navigate correctly.
10. Archived sessions expose no response actions.

### 17.6 End-to-end smoke

```text
create project session
→ send three turns
→ fork from first assistant response
→ verify new session has only first turn
→ send alternate instruction
→ return to source and verify all three original turns remain
→ duplicate source from newest response
→ verify independent full copy
→ delete source
→ verify fork still loads and attachment previews remain valid
```

---

## 18. Executable implementation slices

No dead Fork icon may ship before the corresponding Host command works.

### SF-00 — Contracts and decision alignment

| Owner | Work |
|-------|------|
| `packages/contracts` | Add `ProductSessionOrigin`, lineage view, Fork/lineage IPC contracts, summary projection |
| docs | Update ADR 0009 appendix and historical “fork-light = duplicate” wording |
| tests | Typecheck all implementers |

Exit: contracts compile; no product lineage type reuses Pi tree or subagent
parentage.

### SF-01 — Derived-session core and Duplicate hardening

| Owner | Work |
|-------|------|
| `packages/session` | Extract reusable transcript clone primitives; preserve Duplicate behavior with origin metadata |
| `packages/media` | Add safe per-session attachment clone/remap API |
| `packages/agent-host` | Refactor `session/duplicate` to use the hardened derived-session transaction |
| tests | Duplicate, attachment ownership, source-delete survival |

Likely files:

- `packages/session/src/clone-session-transcript.ts`
- `packages/session/src/duplicate-session.ts`
- `packages/media/src/clone-session-media.ts`
- `packages/agent-host/src/commands/session-product-commands.ts` or a focused
  `session-derived-commands.ts`

Exit: current Duplicate remains functional and no longer depends on source
media paths.

### SF-02 — Shared-workspace Fork Host path

| Owner | Work |
|-------|------|
| `packages/session` | Implement prefix clone, root resolution, lineage query |
| `packages/agent-host` | Implement `session/fork` and `session/lineage`; bind lazy product shell |
| Desktop mock | Implement deterministic mock responses |
| tests | Boundary validation, immutability, lazy resume, SDK/RPC equivalence |

Likely files:

- `packages/session/src/fork-session.ts`
- `packages/session/src/session-lineage.ts`
- `packages/agent-host/src/commands/session-derived-commands.ts`
- `apps/desktop/src/host-client-mock.ts`

Exit: Host can create and resume a linked prefix fork without UI changes.

### SF-03 — Response action footer

| Owner | Work |
|-------|------|
| Desktop | Add the two SVG icons; mount `AssistantResponseActions`; wire Duplicate and Fork dialog |
| UI kit | Reuse existing IconButton/Dialog/Button/Notice; add no one-off primitive |
| tests | Visibility matrix, keyboard/focus, request/navigation behavior |

Likely files:

- `apps/desktop/src/shell-icons.tsx`
- `apps/desktop/src/assistant-response-actions.tsx`
- `apps/desktop/src/chat-thread.tsx`
- `apps/desktop/src/hooks/use-session-actions.ts`
- `apps/desktop/src/app-dialogs.tsx` or a focused product dialog component
- `apps/desktop/src/styles/region-transcript.css`

Exit: newest response has Duplicate + Fork; historical responses have Fork;
both are functional and accessible.

### SF-04 — Lineage navigation

| Owner | Work |
|-------|------|
| Desktop | Source badge, return action, direct-fork count, lightweight sidebar grouping |
| session/host | Serve complete related lineage including archived nodes |
| tests | Deep fork breadcrumb, archived/deleted source, grouping limits |

Exit: users can understand where a fork came from and move between branches
without a permanent DAG panel.

### SF-05 — CLI parity

Add Host-backed commands without reimplementing session logic:

```bash
piwin session duplicate <session-id> [--name <name>]
piwin session fork <session-id> --message <message-id> [--name <name>]
piwin session lineage <session-id>
```

The Desktop remains the primary message-selection UX. CLI degradation is only
the lack of a visual picker, not different semantics.

Exit: CLI commands call the same Host commands and print the new session ID.

### SF-06 — Isolated worktree option

| Owner | Work |
|-------|------|
| `packages/git` | Add purpose-aware session-fork worktree API |
| Host | Validate trust/Git state; persist working directory; clean lifecycle |
| Desktop | Add shared/worktree selector and warnings |
| tests | Dirty repo warning, cwd restore, delete/retain worktree behavior |

Exit: a project fork can continue in a distinct worktree without subagent
field reuse or false checkpoint claims.

### SF-07 — Pi native tree spike

Time-boxed, no UI commitment:

1. Verify Pi session-file restore.
2. Verify active-leaf create/switch/resume.
3. Verify SDK/RPC-worker parity.
4. Compare Pi nodes with product origin/message IDs.
5. Decide whether Host can optimize future Fork operations through Pi native
   branch APIs while retaining product index/transcript projection.

Exit: written evidence and an ADR decision. Failure leaves SF-00..06 intact.

---

## 19. Acceptance criteria

The product-level feature is complete when:

1. A completed historical assistant response offers **Fork from here**.
2. The latest completed assistant response offers **Duplicate conversation**
   and **Fork from here** as two small SVG icon buttons.
3. Fork creates a new linked session containing exactly the transcript prefix
   through the selected response.
4. Duplicate creates an independent copy containing the entire session.
5. The source session remains unchanged under both operations.
6. Project users see a clear warning that files do not rewind.
7. Derived sessions own their attachment paths and survive source deletion.
8. Fork lineage is distinct from Pi tree, transcript outline, Git, and
   subagent parentage in contracts and UI.
9. SDK and RPC product modes behave equivalently.
10. No response icon is decorative or non-functional.
11. Desktop controls are keyboard accessible and localized in zh-CN/en.
12. Targeted tests, repository typecheck, and relevant test suites are green.

---

## 20. Verification commands

Run targeted checks while implementing each slice, then the repository gates:

```bash
pnpm --filter @piwin/contracts typecheck
pnpm --filter @piwin/session test
pnpm --filter @piwin/media test
pnpm --filter @piwin/agent-host test
pnpm --filter @piwin/desktop test
pnpm typecheck
pnpm test
```

Add the relevant Desktop e2e smoke once SF-03 lands.

---

## 21. Product success signals

Because piwin is private/local-first, do not add remote analytics solely for
this feature. Evaluate through local/manual product review:

- users can recover from a wrong route without destructive edit/revert;
- users understand Duplicate versus Fork from labels and resulting navigation;
- users do not assume project files were rewound;
- lineage remains quiet when unused and understandable when present;
- branch creation feels immediate and does not create live-agent overhead until
  the next prompt;
- repeated branching does not make the session navigator visually collapse.

The feature should feel like a natural extension of conversation, not a graph
editor bolted onto the shell.
