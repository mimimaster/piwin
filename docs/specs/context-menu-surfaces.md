# Spec — Context Menu Surfaces (P0 / P1)

| Field | Value |
|-------|-------|
| Status | **Implemented (P0 + P1 surfaces shipped, integrated to main 2026-08-12)** — P0 vertical slice (pipeline + file tree + selection + path chip + drag-to-ref) and P1 surfaces (message / code-block / diff-row / tool-card / terminal-selection / error), CLI `--ref` parity, Side Chat ref handoff. CM-14 Apply is **P1a only** (copy + preview + notice): the `project/write-file` host command from the branch was **not** integrated (security review: no registered-root/symlink guard, no host permission gate) and is deferred until redesigned on the hardened project-command base |
| Date | 2026-08-08 |
| Branch / worktree | `feat/context-menu-surfaces` · `/Users/yorickjue/Developer/piwin-context-menu` |
| Trigger | 竞品右键调研后锁定 P0/P1：「指着东西跟 Agent 说话」是 Agent Shell 的核心手感 |
| Related | [Side Chat](./side-chat-session.md), [Session Fork](./session-fork-product-adaptation.md), [Product Depth](./product-depth-competitive-alignment.md), [Desktop UI modernization](./desktop-ui-modernization.md), [ADR 0032](../adr/0032-side-chat-context-branch.md), [Cursor window analysis](../cursor-window-design-analysis.md) |
| Binding | `AGENTS.md`; contracts first; product transcript is history truth; Desktop never imports Pi; UI never reads project files for prompt injection; Host resolves `PromptContextRef` |
| Backlog prefix | **CM-*** |

---

## 0. User requirement

用户需要在不同场景下右键，立刻把「当前所指」变成 Agent 上下文或动作：

1. 文件树右键文件/文件夹 → **Add to Chat** / Ask / Open / Copy path / Reveal
2. 选中文字右键 → **Ask about selection** / Explain / Fix / Add to Chat / Copy as `@ref`
3. PathChip / Citation 右键 → Open / Add to Chat / Copy path / Reveal
4. Chat 消息右键 → Copy / Quote / Retry / Fork / Side Chat
5. Code block / Diff / Tool card / Terminal 选区 / Error 右键 → Add to Chat / Explain / Fix / Apply（P1）

右键不是功能调色板，而是 **上下文入口**。菜单必须短、场景化、动作可测试。

---

## 1. Product one-liner

> Context menus turn any surface into a structured Agent entry point: add a
> `PromptContextRef` chip, run a preset ask, or open Side Chat / Fork — without
> pasting raw paths into the prompt.

---

## 2. Why this is P0 product depth

Coding agents 的体感差距不在「多几个 Generate 按钮」，而在：

- 能不能 **指哪问哪**（选区 / 文件 / 错误）
- 上下文是不是 **结构化引用**（chip + Host resolve），而不是字符串路径
- 主会话是否保持干净（Side Chat / Fork 有入口）

Cursor / Claude Code / Copilot 的公开行为都把「Add to Chat + 选区引用」当作默认手感。piwin 已有：

| 已有能力 | 缺口 |
|----------|------|
| `PromptContextRef` + Host `resolvePromptContextRefs` | Desktop composer **几乎不发** `contextRefs` |
| `@` mention 文本插入 | 右键不复用同一套 ref / chip |
| File tree `onInsertPath` 插绝对路径字符串 | 不是结构化 chip；**无右键菜单** |
| PathChip 右键只有 Copy Path | 缺 Add to Chat / Open 统一 |
| Message hover：Copy / Edit / Retry | 缺右键；Fork / Side Chat 入口不完整 |
| Session row context menu | 已完成（PD-SESS-04）；本 spec **不重做** |
| ui-kit `ContextMenu` | 缺场景工厂与动作分发层 |

本程序补的是 **入口与 Desktop 上下文管线**，不是新 Host 内核。

---

## 3. Goals and non-goals

### 3.1 Goals

| ID | Goal |
|----|------|
| CM-G1 | 统一 **场景菜单工厂**：`surface + target → ordered menu items`，禁止各处硬编码一长串 |
| CM-G2 | 统一 **Composer ContextRef 管线**：右键 / drag / `@` 最终都进入 pending refs + chip，发送时走 `PromptInput.contextRefs` |
| CM-G3 | **P0 场景**可用：file-tree file/folder、code-preview selection、path-chip |
| CM-G4 | **P1 场景**可用：message、code-block、diff row、tool-card、terminal selection、error |
| CM-G5 | 预置动作（Explain / Fix / Ask）用 **actionId + prompt template**，不把长 prompt 写死在 JSX |
| CM-G6 | 复用 Side Chat / Fork / Retry 已有 Host 命令；右键只做入口 |
| CM-G7 | 菜单 ≤ 8 可见项；常用 3–5 置顶；其余进「More…」子菜单或后续 slash |
| CM-G8 | Desktop/CLI 语义对齐：CLI 可用显式 ref 参数；Desktop 负责图形菜单 |

### 3.2 Non-goals (v1)

| ID | Non-goal | Why |
|----|----------|-----|
| CM-N1 | 完整 IDE 资源管理器菜单（Rename / Delete / New File / Cut-Paste） | PRD：Agent Shell，非 Full IDE |
| CM-N2 | 20+ Generate Xxx 动作（Docs / Storybook / …） | 菜单死亡；收敛到 Ask… 或 Skills |
| CM-N3 | Desktop 自己读文件内容拼进 prompt | 违反 Host resolve 合同；安全与截断由 Host 管 |
| CM-N4 | 把绝对路径当唯一上下文通道 | 仅 clipboard / reveal / text fallback |
| CM-N5 | 重做 Session row 菜单 | 已完成 |
| CM-N6 | 内联 Tab 补全 / Cursor-style edit selection 全套 | PRD non-goal |
| CM-N7 | 无确认的 destructive 文件操作 | 本 spec 不含 |
| CM-N8 | 每 surface 独立一套 chip UI | 必须共用 composer context chip |


---

## 4. Locked decisions

| # | Decision | Implication |
|---|----------|-------------|
| **L1** | **以现有 `PromptContextRef` / `MainContextRef` 为权威**，只做最小扩展 | 不发明平行的第二套 ref 体系 |
| **L2** | **Composer 持有 pending `contextRefs[]`**；chip 可移除；Send 时随 `PromptInput.contextRefs` 上传 | 用户可见 chip ≠ transcript 手写正文；Host 解析进 model-facing text |
| **L3** | **Add to Chat = 只加 ref，不自动发送**；**Ask = 加 ref + focus**；**Explain/Fix = 加 ref + 自动发送预置 prompt** | 三种强度清晰 |
| **L4** | **菜单定义纯函数 + Desktop 分发**；ui-kit 只提供 Radix 原语 | 可单测菜单顺序与禁用态 |
| **L5** | **预置 prompt 模板 Desktop 常量 v1**；P2 再迁 Skills/config | 先可交付，不阻塞 Host |
| **L6** | **File tree 右键升级优先于继续加强「Insert path 字符串」** | `onInsertPath` 保留 fallback；主路径 `onAddContextRef` |
| **L7** | **消息 hover 条与右键菜单共享 action catalog** | 不维护两套 Copy/Retry/Fork 语义 |
| **L8** | **P0 先垂直切片**：Context pipeline + File tree + Selection + PathChip；P1 再 Message/Code/Diff/Tool/Terminal/Error | 避免八个 surface 同时半成品 |
| **L9** | **Apply-to-file v1 先 P1a**（复制 + 打开 preview + notice）；真写盘为 P1b | 安全默认 |
| **L10** | General workspace（无 project）下：文件类动作禁用或降级；选区/消息/错误仍可用 | 对齐 ADR 0016 |
| **L11** | 新增 `kind: 'selection'` 与 `kind: 'folder'` | 无 path 选区与文件夹引用有一等公民表示 |
| **L12** | **Add to Chat 不自动改 composer 文本**；只加 chip | 避免与 `@` 文本双通道重复 |
| **L13** | Folder Host resolve = **单层 list-dir**（bounded），不递归读内容 | Agent 深读走工具 |
| **L14** | 单气泡正文划词走 `selection` 胶囊（不写 textarea）；code preview 划词 + 整 code block 右键仍有效；**跨消息**自由划词仍 P1 | 指哪问哪；跨消息选区复杂度另做 |
| **L15** | Explain/Fix **不静默切换** `agentMode` | 使用当前 composer 模式；高级选项以后再做 |
| **L16** | Session row 菜单保持 `session-actions-menu.ts`，**不**并入 CM surface enum | 避免与 PD-SESS 纠缠 |

---

## 5. Surfaces and menu catalogs

### 5.1 Surface enum

```ts
export type ContextMenuSurface =
  | 'file-tree-file'
  | 'file-tree-folder'
  | 'selection'
  | 'path-chip'
  | 'message-user'
  | 'message-assistant'
  | 'code-block'
  | 'diff-row'
  | 'tool-card'
  | 'terminal-selection'
  | 'error';
```

### 5.2 Action ids

```ts
export type ContextMenuActionId =
  | 'add-to-chat'
  | 'ask-about'
  | 'copy-as-ref'
  | 'explain'
  | 'fix'
  | 'review'
  | 'tests'
  | 'explain-failure'
  | 'fix-error'
  | 'open'
  | 'reveal'
  | 'copy'
  | 'copy-relative-path'
  | 'copy-absolute-path'
  | 'quote-in-composer'
  | 'retry'
  | 'fork'
  | 'side-chat'
  | 'open-changed-files'
  | 'apply-to-file'
  | 'rerun-tool';
```

### 5.3 Target payload (Desktop view model)

Desktop 构造 target；发往 Host 前映射为 `PromptContextRef`。

```ts
export type ContextMenuTarget =
  | {
      surface: 'file-tree-file' | 'file-tree-folder' | 'path-chip';
      projectPath: string;
      relativePath: string;
      absolutePath: string;
      label: string;
    }
  | {
      surface: 'selection' | 'code-block';
      projectPath?: string;
      relativePath?: string;
      absolutePath?: string;
      lineStart?: number;
      lineEnd?: number;
      selectedText: string;
      label: string;
    }
  | {
      surface: 'message-user' | 'message-assistant';
      sessionId: string;
      messageId: string;
      text: string;
      label: string;
      capabilities: {
        canRetry: boolean;
        canFork: boolean;
        canSideChat: boolean;
      };
    }
  | {
      surface: 'diff-row';
      projectPath: string;
      relativePath: string;
      snapshotText: string;
      label: string;
    }
  | {
      surface: 'tool-card';
      toolCallId?: string;
      toolName: string;
      outputText: string;
      relatedPath?: string;
      label: string;
      canRerun: boolean;
    }
  | {
      surface: 'terminal-selection';
      selectedText: string;
      label: string;
    }
  | {
      surface: 'error';
      title: string;
      detail: string;
      label: string;
      relatedPath?: string;
      lineStart?: number;
    };
```

### 5.4 P0 menus (must ship)

#### file-tree-file

| Order | Action | Notes |
|------:|--------|-------|
| 1 | `add-to-chat` | primary |
| 2 | `ask-about` | focus composer + chip |
| — | separator | |
| 3 | `open` | existing preview |
| 4 | `reveal` | OS reveal |
| — | separator | |
| 5 | `copy-relative-path` | |
| 6 | `copy-absolute-path` | |

P1 under More: `explain`, `review`, `tests`.

#### file-tree-folder

| Order | Action | Notes |
|------:|--------|-------|
| 1 | `add-to-chat` | `kind: 'folder'` |
| 2 | `ask-about` | |
| — | separator | |
| 3 | `reveal` | |
| 4 | `copy-relative-path` | |
| 5 | `copy-absolute-path` | |

P1: `explain` (summarize directory). **Do not** ship New File.

#### selection

| Order | Action | Notes |
|------:|--------|-------|
| 1 | `ask-about` | primary |
| 2 | `explain` | auto-send preset |
| 3 | `fix` | auto-send preset |
| — | separator | |
| 4 | `add-to-chat` | chip only |
| 5 | `side-chat` | if Side Chat available; else hide |
| — | separator | |
| 6 | `copy-as-ref` | `path#L-L` or label |
| 7 | `copy` | selected text |

Mapping: path + line range -> prefer `kind:'file'`; text only -> `kind:'selection'`.

#### path-chip

| Order | Action |
|------:|--------|
| 1 | `open` |
| 2 | `add-to-chat` |
| — | separator |
| 3 | `copy-relative-path` |
| 4 | `copy-absolute-path` |
| 5 | `reveal` |

### 5.5 P1 menus

#### message-user / message-assistant

| Order | Action | When |
|------:|--------|------|
| 1 | `copy` | always |
| 2 | `quote-in-composer` | always |
| — | separator | |
| 3 | `retry` | `canRetry` |
| 4 | `fork` | assistant completed + `canFork` |
| 5 | `side-chat` | `canSideChat` |
| — | separator | |
| 6 | `open-changed-files` | turn has changed files |
| 7 | `add-to-chat` | as `main-message` ref |

Share catalog with hover `MessageActions`; context menu is the superset.

#### code-block

| Order | Action |
|------:|--------|
| 1 | `copy` |
| 2 | `add-to-chat` |
| 3 | `ask-about` |
| 4 | `apply-to-file` | P1a first |
| 5 | `open` | if path known |

#### diff-row

| Order | Action |
|------:|--------|
| 1 | `open` |
| 2 | `add-to-chat` | `kind: 'diff'` |
| 3 | `explain` / `review` | presets |
| 4 | `ask-about` | |

#### tool-card

| Order | Action |
|------:|--------|
| 1 | `copy` | output |
| 2 | `add-to-chat` | snapshot as `terminal-output` or `selection` |
| 3 | `explain-failure` | failure state first |
| 4 | `fix-error` | |
| 5 | `open` | related path |
| 6 | `rerun-tool` | only if `canRerun` and safe read-only |

#### terminal-selection / error

| Order | Action |
|------:|--------|
| 1 | `add-to-chat` | |
| 2 | `explain-failure` / `explain` | |
| 3 | `fix-error` / `fix` | debug killer path |
| 4 | `copy` | |
| 5 | `side-chat` | optional |

---

## 6. Information architecture

### 6.1 Menu length rule

```text
Visible root items <= 8 (separators don't count as actions)
Primary AI actions first (add / ask / explain / fix)
Navigation + clipboard after separator
Destructive last (none in P0 file menus)
"More..." submenu only when P1 extras would exceed 8
```

### 6.2 Disabled / hidden rules

| Condition | Behavior |
|-----------|----------|
| No `projectPath` (general workspace) | disable/hide project file actions; selection/message/error stay |
| Empty selection | do not open selection menu |
| Streaming + retry/fork | follow existing session action disable rules |
| Side Chat unavailable | hide `side-chat` |
| Reveal unsupported | hide `reveal` |
| Binary / missing file | `open` may error-notice; chip add still allowed (Host resolve may warn) |

### 6.3 Locale

Menu labels: v1 ships as en/zh tables inside `context-menu/catalog.ts` (pure, unit-tested;
see CM-09 note). **actionId is stable and not translated.** Optional polish: migrate tables
into `desktop-locale.ts`.

---

## 7. Action semantics

### 7.1 add-to-chat

1. Map target -> `PromptContextRef` (section 8)
2. Dedupe by stable key (section 9.3)
3. Append to composer pending refs
4. Show chip; **do not** mutate textarea body (L12)

### 7.2 ask-about

1. Same as add-to-chat
2. Focus composer
3. If textarea empty, set localized placeholder or short lead-in (do not auto-send)
   - placeholder example: `Ask about the attached context...`

### 7.3 explain / fix / review / tests / explain-failure / fix-error

1. Ensure ref list for this turn
2. **Auto-send** user turn: `text = template` + `contextRefs = [...]`
3. Templates (Desktop constants v1):

```ts
export const PRESET_TEMPLATES = {
  explain:
    'Explain the attached context. Be concrete about behavior, edge cases, and risks.',
  fix:
    'Fix the attached code or error. Keep the change minimal and state assumptions.',
  review:
    'Review the attached change. List issues by severity with concrete fixes.',
  tests:
    'Propose focused tests for the attached code. Include cases and rationale.',
  'explain-failure':
    'Explain why this failed and the most likely root cause.',
  'fix-error':
    'Fix this error. Inspect related files as needed and apply a minimal fix.',
} as const;
```

4. Use current session model / agentMode / thinking (L15)
5. If no active session: same ensure-session path as normal Send

### 7.4 copy / copy-*-path / copy-as-ref

- `copy` -> selection or message text
- `copy-relative-path` / `copy-absolute-path` -> path strings
- `copy-as-ref` -> prefer `relativePath#Lstart-Lend`, else label

### 7.5 open / reveal

- `open` -> existing FileTree / DocPreview hooks
- `reveal` -> Tauri/OS reveal; failure -> notice

### 7.6 quote-in-composer

Insert message text as markdown blockquote (or prefixed quote) into composer text.
v1: **quote text only**; do not silently also add `main-message` ref.

### 7.7 retry / fork / side-chat

- `retry` -> existing `handleRetryFromMessage`
- `fork` -> existing `handleForkSession(sessionId, messageId)` (SF-*)
- `side-chat` -> `side-chat/open` with mapped refs; set `sourceMessageId` on message surfaces

### 7.8 apply-to-file (P1)

- **P1a (default in this program):** copy block + open file preview + notice
- **P1b (follow-up CM-P1-APPLY-WRITE):** confirm dialog + Host write + diff review

No silent overwrite.

### 7.9 rerun-tool / open-changed-files (P1 optional)

Hide when capability missing. Rerun only for safe read-only tools.

---

## 8. Contracts

### 8.1 Extend refs: `selection` + `folder`

In `packages/contracts/src/side-chat.ts` (or extract `context-ref.ts` + re-export):

```ts
export type SelectionContextRef = {
  kind: 'selection';
  projectPath?: string;
  relativePath?: string;
  lineStart?: number;
  lineEnd?: number;
  /** Already-bounded UI text; Host re-bounds again. */
  snapshotText: string;
  label: string;
};

export type FolderContextRef = {
  kind: 'folder';
  projectPath: string;
  /** '' means project root */
  relativePath: string;
  label: string;
};

// MainContextRef union gains SelectionContextRef | FolderContextRef
```

Existing kinds stay: `main-message`, `file`, `diff`, `terminal-output`, `error`, plus side-chat-only `side-chat-message`.

### 8.2 Host resolve branches

Extend `resolvePromptContextRefs` in `packages/host-runtime` (`session-live-commands.ts` or extracted helper):

```ts
case 'selection': {
  const body = ref.snapshotText.slice(0, 8000);
  const loc =
    ref.relativePath != null
      ? `${ref.relativePath}${
          ref.lineStart != null
            ? `:${ref.lineStart}${ref.lineEnd != null ? `-${ref.lineEnd}` : ''}`
            : ''
        }`
      : ref.label;
  blocks.push(`[selection-reference: ${loc}]\n${body}`);
  break;
}
case 'folder': {
  const listing = await listBoundedFolderForRef(ref.projectPath, ref.relativePath);
  // max 200 entries, names only, directories marked with trailing '/'
  blocks.push(`[folder-reference: ${ref.relativePath || '.'}]\n${listing}`);
  break;
}
```

**Bounds**

| Kind | Bound |
|------|-------|
| file | existing 32 KiB, binary reject, realpath jail |
| selection / diff / terminal / error | 8_000 chars |
| folder | 200 names, single level, realpath jail |

**Selection mapping preference**

1. If UI has `projectPath + relativePath + line range` -> emit `kind:'file'` (Host reads truth)
2. Else -> `kind:'selection'` with snapshotText

### 8.3 No new `context-menu/*` IPC

Menus are Desktop-only. Reuse:

- `session/prompt` (`contextRefs`)
- `side-chat/open`
- existing fork / retry session commands
- `project/list-dir`, `project/read-file`
- git commands when building diff snapshots
- Tauri reveal (not Host)

### 8.4 Optional file split

If `side-chat.ts` becomes the wrong home:

```text
packages/contracts/src/context-ref.ts   // PromptContextRef union
packages/contracts/src/side-chat.ts     // re-export + side-chat relation types
```

Not required to start P0.

---

## 9. Desktop architecture

### 9.1 Module map

```text
packages/contracts
  side-chat.ts (+ selection/folder) + tests

packages/host-runtime
  resolvePromptContextRefs branches + folder list helper + tests

apps/desktop/src/context-menu/
  types.ts                 surfaces, action ids, target, caps
  catalog.ts               pure buildContextMenuItems(...)
  catalog.test.ts
  map-to-ref.ts            target -> PromptContextRef
  map-to-ref.test.ts
  presets.ts               PRESET_TEMPLATES
  dispatch.ts              actionId -> dispatcher calls
  ContextMenuFromCatalog.tsx

apps/desktop/src/hooks/
  use-composer-context-refs.ts

apps/desktop/src/
  composer-dock.tsx        context chips UI
  file-tree-panel.tsx      menus + onAddContextRef
  path-chip.tsx            expanded menu
  code-preview-view.tsx    selection menu (P0)
  EnhancedMarkdownView.tsx code-block menu (P0/P1)
  chat-thread.tsx          message menu (P1)
  message-actions.tsx      shared catalog with hover
  App.tsx                  wire dispatchers
```

### 9.2 Pure catalog API

```ts
export type ContextMenuCapabilities = {
  hasProject: boolean;
  canReveal: boolean;
  sideChatAvailable: boolean;
  applyAvailable: boolean;
  locale: DesktopLocale;
};

export type ContextMenuItemSpec =
  | {
      type: 'item';
      id: ContextMenuActionId;
      label: string;
      disabled?: boolean;
      danger?: boolean;
      testId: string;
    }
  | { type: 'separator' }
  | {
      type: 'submenu';
      id: string;
      label: string;
      children: ContextMenuItemSpec[];
    };

export function buildContextMenuItems(
  target: ContextMenuTarget,
  caps: ContextMenuCapabilities,
): ContextMenuItemSpec[];
```

### 9.3 Composer context ref pipeline

```ts
export type PendingContextRef = {
  key: string;
  ref: PromptContextRef;
  label: string;
};

function refKey(ref: PromptContextRef): string {
  switch (ref.kind) {
    case 'file':
      return `file:${ref.projectPath}:${ref.relativePath}:${ref.lineStart ?? ''}:${ref.lineEnd ?? ''}`;
    case 'folder':
      return `folder:${ref.projectPath}:${ref.relativePath}`;
    case 'selection':
      return `selection:${ref.relativePath ?? ''}:${hash(ref.snapshotText)}`;
    case 'diff':
      return `diff:${ref.projectPath}:${(ref.relativePaths ?? []).join(',')}:${hash(ref.snapshotText)}`;
    case 'terminal-output':
      return `terminal:${hash(ref.snapshotText)}`;
    case 'error':
      return `error:${hash(ref.title + '\n' + ref.detail)}`;
    case 'main-message':
      return `main-message:${ref.sourceSessionId}:${ref.messageId}`;
    case 'side-chat-message':
      return `side-chat-message:${ref.sideChatSessionId}:${ref.messageId}`;
    default:
      return `unknown:${JSON.stringify(ref)}`;
  }
}
```

Send path:

```ts
input: {
  text: composerText,
  attachments: mediaAttachments,
  contextRefs: pendingRefs.map((item) => item.ref),
  // existing model / thinking / agentMode / ...
}
```

Clear pending refs on successful accept (same policy family as attachments).

**Chip UI:** `composer-v2-context-chip` beside media chips; label + kind affordance; remove button; works in centered and docked composer layouts.

**Cap:** max 12 pending refs; adding beyond -> refuse + notice.

### 9.4 File tree API upgrade

```ts
// FileTreePanelProps
onAddContextRef?: (ref: PromptContextRef) => void;
/** fallback only — prefer onAddContextRef */
onInsertPath?: (absolutePath: string, relativePath: string) => void;
```

App wires `onAddContextRef` into `useComposerContextRefs().add`.

Drag/drop onto composer adds a structured `file` ref chip (CM-08, shipped): the drop handler
reads the `PIWIN_PATH_MIME` payload and converts it via `addContextRefFromDrop`; absolute-path
text insertion remains the fallback when no project / no relative path / cap reached.

### 9.5 Selection detection (P0)

1. Code preview (`CodePreviewView` / Files split): on `contextmenu`, read selection inside preview; compute lineStart/lineEnd when possible
2. Fenced code block: whole-block target as `code-block` surface
3. Single-bubble transcript prose: on `contextmenu`, if the selection is non-empty and inside that bubble (and not inside a fence / tool card), use `selection`; otherwise keep the message menu
4. Free transcript **multi-message** selection: **P1** (L14)

### 9.6 Dispatchers

```ts
export type ContextMenuDispatchers = {
  addToChat: (ref: PromptContextRef) => void;
  focusComposer: () => void;
  sendPreset: (text: string, refs: PromptContextRef[]) => void;
  openPath: (absolutePath: string, relativePath: string) => void;
  revealPath: (absolutePath: string) => void;
  copyText: (text: string) => void;
  quoteInComposer: (text: string) => void;
  retryMessage: (messageId: string) => void;
  forkMessage: (messageId: string) => void;
  openSideChat: (input: {
    sourceMessageId?: string;
    refs: PromptContextRef[];
  }) => void;
  applyToFile?: (payload: { text: string; suggestedPath?: string }) => void;
  openChangedFiles?: (messageId: string) => void;
  notify: (message: string, level: 'success' | 'error' | 'info') => void;
};

export function dispatchContextMenuAction(
  actionId: ContextMenuActionId,
  target: ContextMenuTarget,
  dispatchers: ContextMenuDispatchers,
): void;
```

---

## 10. Phased delivery

### Phase 0 — Contracts + pipeline (CM-P0-INFRA)

| ID | Work | Exit criteria | Status |
|----|------|---------------|--------|
| CM-01 | contracts `selection` + `folder`; Host resolve + tests | typecheck + unit green | ✅ 2026-08-10 |
| CM-02 | `use-composer-context-refs` + chips + send merges `contextRefs` | mock/host test proves refs on prompt | ✅ 2026-08-10 |
| CM-03 | `catalog.ts` + tests for all P0 surfaces | pure order/disable tests | ✅ 2026-08-10 |
| CM-04 | `ContextMenuFromCatalog` + `dispatch.ts` | smoke unit | ✅ 2026-08-10 |

### Phase 1 — P0 surfaces (CM-P0-SURFACES)

| ID | Work | Exit criteria | Status |
|----|------|---------------|--------|
| CM-05 | File tree file/folder context menu | e2e: right-click -> chip | ✅ 2026-08-10 (e2e: file-add-to-chat green; unit: menu testIds + refs) |
| CM-06 | PathChip menu upgrade | unit/e2e | ✅ 2026-08-10 (unit) |
| CM-07 | Code preview selection + Explain/Fix presets | e2e + unit | ✅ 2026-08-10 (e2e: selection-explain green; unit: catalog + dispatch + file-tree-panel) |
| CM-08 | Drag path -> context ref | chip not raw-path-only | ✅ 2026-08-10 (drop → file ref chip; text fallback kept) |
| CM-09 | en/zh labels | both locales | ✅ 2026-08-10 (catalog-local en/zh tables — see note below) |

> **CM-09 note**: labels live in `context-menu/catalog.ts` en/zh tables (pure and unit-tested)
> instead of the `desktop-locale.ts` string registry; `actionId` stays stable and untranslated.
> Merging into `desktop-locale.ts` is optional polish, not a blocker.

### Phase 2 — P1 surfaces (CM-P1)

| ID | Work | Exit criteria | Status |
|----|------|---------------|--------|
| CM-10 | Message context menu; share catalog with hover | Copy/Quote/Retry/Fork/Side Chat | ✅ 2026-08-10 (chat-thread bubble menu; capabilities gated per message) |
| CM-11 | Code block menu + Apply P1a | notice + open | ✅ 2026-08-10 (MarkdownView fence menu; Apply P1a = copy + preview + notice) |
| CM-12 | Diff row menu | diff ref chip | ✅ 2026-08-10 (DiffCard menu) |
| CM-13 | Tool card + terminal selection + error | Fix this error path | ✅ 2026-08-10 (ToolCallCard / XtermSurface selection / MainErrorBanner menus) |
| CM-14 | Apply P1b write confirm | optional follow-up | ⏳ **deferred (2026-08-12)** — branch draft (`project/write-file` + confirm dialog) excluded from integration: no registered-root/symlink guard and no Host permission gate. Applied as **P1a** (copy + preview + notice). Redesign on hardened project commands before re-enabling |
| CM-15 | open-changed-files / rerun-tool | hide if not ready | ✅ 2026-08-10 (open-changed-files opens Review tab; rerun-tool announces unavailability) |

### Phase 3 — Polish

| ID | Work | Status |
|----|------|--------|
| CM-16 | More... submenu for review/tests | ✅ 2026-08-10 (file-tree-file More… submenu; ui-kit ContextMenuSub) |
| CM-17 | `@` mention also writes pending refs (recommended P0.1/P1) | ✅ 2026-08-10 (file/folder at-items add structured refs) |
| CM-18 | CLI note / optional ref flags parity | ✅ 2026-08-10 (`piwin chat --ref <path>` repeatable → `contextRefs`; file/folder auto-detect; jail + existence checks; unit-tested) |
| CM-19 | `todo-deferred.md` + product-status updates | ✅ 2026-08-10 |

---

## 11. Testing plan

### 11.1 Unit

- catalog order + caps for every surface
- map-to-ref preferences (file vs selection vs folder)
- refKey dedupe
- contracts assignability
- Host resolve for `selection` / `folder` with temp dir fixtures

### 11.2 Component

- PathChip menu testIds
- Composer chip add/remove/send payload (mock host)
- FileTree context menu testIds where jsdom allows; else e2e

### 11.3 E2E

| Test | Flow |
|------|------|
| file-add-to-chat | Files -> right-click file -> Add to Chat -> chip visible |
| selection-explain | preview select -> Explain -> prompt/stream starts |
| path-chip-add | path chip -> Add to Chat |
| message-fork (P1) | assistant -> Fork from here |

### 11.4 Honesty

- Host resolve failure -> `host/log` warn; user can remove chip
- No project -> file actions disabled with clear state

---

## 12. Security and bounds

| Topic | Rule |
|-------|------|
| Path jail | realpath prefix checks for file + folder listing |
| Size | file 32KiB; text snapshots 8k; folder 200 entries |
| Binary | never inject |
| Apply | no silent overwrite |
| Permissions | presets do not bypass PermissionPolicy |
| Labels | long absolute paths ellipsize in chip; copy absolute still full |

---

## 13. UX copy (en defaults)

| Action id | Label |
|-----------|-------|
| add-to-chat | Add to Chat |
| ask-about | Ask about... |
| explain | Explain |
| fix | Fix / Improve |
| review | Review |
| tests | Generate tests |
| copy-as-ref | Copy as @ref |
| copy | Copy |
| copy-relative-path | Copy Relative Path |
| copy-absolute-path | Copy Absolute Path |
| open | Open |
| reveal | Reveal in Finder / Reveal in Explorer |
| quote-in-composer | Quote in Composer |
| retry | Retry from here |
| fork | Fork from here |
| side-chat | Start Side Chat |
| apply-to-file | Apply to File... |
| explain-failure | Explain failure |
| fix-error | Fix this error |
| open-changed-files | Open changed files |
| rerun-tool | Rerun tool |

Zh strings live in `desktop-locale.ts` at implementation time.

---

## 14. Relationship to other specs

| Spec | Relationship |
|------|----------------|
| Side Chat | `side-chat` action is an entry only; capability floor unchanged |
| Session Fork | message `fork` uses SF-* semantics |
| Product Depth | this is **context-entry depth** after session chrome depth |
| `@` mention | text insert may remain; **authoritative pending list is contextRefs** |
| MessageActions | shared catalog with context menu superset |
| PD-SESS session row menu | out of scope (done) |

---

## 15. Explicitly deferred

| Item | Why |
|------|-----|
| Full IDE file ops | Non-goal |
| Skill-configurable presets | L5 -> P2 |
| Free-form **multi-message** selection | L14 -> P1（单气泡划词已落地） |
| Apply silent write | P1b |
| Multi-select batch add | P2 (`addMany` later) |
| Subagent from context menu | orchestration complexity |
| Pet menu expansion | keep toy scope |
| New Host menu commands | unnecessary |

---

## 16. Recommended first vertical slice (about one week of focused work)

1. **CM-01** contracts + Host resolve tests
2. **CM-02** composer pending refs + chips + send
3. **CM-03/04** catalog + dispatch
4. **CM-05** file tree right-click **Add to Chat**
5. **CM-06** PathChip
6. **CM-07** code preview selection **Explain / Fix**

Done means users can: point at a file -> chip; point at code -> Explain. That is the P0 explosive feel from research.

---

## 17. Acceptance checklist

### P0

- [x] `selection` + `folder` in contracts; Host resolve tested
- [x] Composer context chips; Send includes `contextRefs`; chips removable
- [x] File tree file/folder menus: Add to Chat / Ask / Open / Reveal / Copy paths
- [x] PathChip: Open / Add to Chat / Copy paths / Reveal
- [x] Code preview selection: Ask / Explain / Fix / Add to Chat / Copy
- [x] No 15-item hardcoded menus; catalog pure and tested
- [x] Desktop does not read file bytes to build prompts
- [x] `pnpm typecheck` + relevant unit/e2e green

### P1

- [ ] Message menu: Copy / Quote / Retry / Fork / Side Chat
- [ ] Code block / Diff / Tool / Terminal / Error menus
- [ ] Fix this error starts a turn with refs
- [ ] Apply P1a available

---

## 18. Open points (do not block P0)

1. Whether `@` mention writes pending refs in the same slice (recommended soon)
2. Folder listing "N more" i18n details
3. Whether Fix should offer an explicit "switch to Agent mode" confirm later
4. Chip density limits (e.g. max 12 pending refs) — prefer refuse + notice when exceeded

---

## 19. Backlog registration

Registered in `docs/todo-deferred.md` when implementation started (2026-08-10):

```text
## CM-* Context Menu Surfaces
Spec: docs/specs/context-menu-surfaces.md
Worktree: /Users/yorickjue/Developer/piwin-context-menu
Branch: feat/context-menu-surfaces
Active: CM-01 ... CM-09 (P0) — shipped 2026-08-10
Queued: CM-10 ... CM-15 (P1)
```

---

## 20. Summary

```text
Context menus = scene factories + one Composer ContextRef pipeline
P0 = file tree + selection + path chip + chips/send
P1 = message + code/diff/tool/terminal/error + apply/fix-error
Reuse PromptContextRef / Side Chat / Fork / ui-kit ContextMenu
Extend only: selection + folder kinds + Host resolve
Do not build a second IDE or a second prompt-injection path
```
