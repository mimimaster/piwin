# Conversation multi-pane workspace specification

## 1. Product contract

The Desktop Conversation surface can show one, two, four, or eight independent
Chat sessions in one window. A user may also split the focused pane to the
right or downward until the eight-pane ceiling is reached.

This feature does not add an Agent/Chat toggle. `general` Conversation is Chat;
`project` remains the coding Agent workbench.

## 2. Layout model

```ts
type ConversationPaneNode =
  | { kind: 'leaf'; paneId: string; sessionId: string | null }
  | {
      kind: 'split';
      splitId: string;
      orientation: 'row' | 'column';
      ratio: number;
      first: ConversationPaneNode;
      second: ConversationPaneNode;
    };
```

`row` places children left/right; `column` places them above/below. Ratios are
clamped to 20–80 percent. State also contains `activePaneId` and an optional
`maximizedPaneId`. The primary pane id is stable and cannot be closed.

Preset trees are balanced and deterministic:

- 1: primary only;
- 2: two columns;
- 4: 2 × 2;
- 8: 4 × 2 on a sufficiently large stage.

Existing bindings are retained in visual order when a preset grows or shrinks.
Shrinking closes views only; it never changes the sessions.

## 3. Session behavior

- Empty leaves offer `New Chat` and a picker containing unbound general
  Conversations.
- Creating a Chat sends `session/create` with general scope and immediately
  binds the returned session.
- Binding resumes a bounded transcript page and reconciles the foreground Run.
- Prompt sends use the existing foreground-admission and idempotency path.
- A pane may send only when its own session is idle. Stop targets that pane's
  exact foreground `runId`.
- Supplementary panes reuse the compact prompt card, including the shared
  model/thinking picker; the selected profile is persisted per session.
- Host event, transcript, run, and reply-writer pushes are filtered by the
  pane's bound session before entering its reducer.
- A deleted session leaves an empty pane instead of silently rebinding.

## 4. Interaction

| Action | macOS chord | Windows/Linux chord |
|---|---|---|
| Split focused pane right | `⌘D` | `Ctrl+D` |
| Split focused pane down | `⇧⌘D` | `Shift+Ctrl+D` |
| Focus previous / next pane | `⌘[` / `⌘]` | `Ctrl+[` / `Ctrl+]` |
| Focus by direction | `⌥⌘Arrow` | `Alt+Ctrl+Arrow` |
| Maximize / restore focused pane | `⇧⌘Enter` | `Shift+Ctrl+Enter` |
| Resize focused pane | `⌃⌘Arrow` | `Shift+Alt+Ctrl+Arrow` |
| Close focused supplementary pane | `⌥⌘W` | `Alt+Ctrl+W` |

Pane commands intentionally work while a composer has focus. Enter sends;
Shift+Enter inserts a line break. `⌘W` is not captured because it retains the
native window-close meaning.

With one Chat, the existing workbench is visually unchanged and pane chrome is
not mounted. The first split uses the documented shortcut. Once two or more
panes exist, each pane exposes visible controls for split right/down,
maximize/restore, and close; the layout menu exposes 1/2/4/8 presets. Resizing
never relies on dragging alone because separators and pane-resize chords are
keyboard-operable.

## 5. Accessibility and responsive policy

- The active pane has a two-channel focus indication: border plus header state.
- Every leaf is a labelled region and can receive programmatic focus.
- A divider has `role="separator"`, the correct orientation,
  `aria-valuemin/max/now`, a name describing the adjacent panes, and arrow-key
  ratio changes.
- Pointer resizing uses Pointer Events with capture; keyboard and menu/button
  alternatives remain available.
- Pane headers and controls keep stable bounds and theme-token contrast.
- Supplementary panes use the same assistant media surface as the main
  transcript: generated-image/video progress, final attachments, and Artifact
  previews are rendered in the pane and sized from the pane's own width and
  height rather than the desktop viewport.
- Narrow panes switch media galleries to one column, wrap compact controls,
  and ellipsize paths/status labels so activity animation never creates hidden
  horizontal overflow. Reduced motion keeps the status content while removing
  nonessential shimmer and pulse loops.
- A split is rejected when the stage cannot preserve a 300 × 220 px minimum
  pane. Existing layouts are not destroyed when the window temporarily gets
  smaller; maximize is the compact escape hatch.
- Reduced motion removes nonessential pane transitions.

## 6. Persistence and recovery

Desktop stores a versioned JSON document under
`piwin.desktop.conversationPanes.v1`. Parsing is defensive: invalid node kinds,
duplicate ids, duplicate session bindings, excessive depth/count, missing
primary leaf, and non-finite ratios fall back to one primary pane.

Scroll offsets and drafts remain leaf-local memory in the first slice and are
not Host state. Closing/reloading may discard an unsent supplementary draft.

## 7. Verification

- Pure model tests: split/close, presets, uniqueness, direction focus, ratio
  clamp, persistence validation, eight-pane ceiling.
- Component tests: visible controls, active focus, session picker, keyboard
  separator, send/stop isolation.
- Protocol tests: the shared normalizer retains eight unique ids and drops the
  ninth; existing hello and mid-stream update tests cover both call paths.
- Desktop typecheck and touched-package tests are green.
- Manual smoke at 1280 × 800 and 1920 × 1080, light/dark, keyboard-only, and
  auxiliary create/send; audit the reduced-motion stylesheet policy.
