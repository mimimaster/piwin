# ADR 0063: Conversation multi-pane workspace

- Status: accepted
- Date: 2026-08-24

## Context

Desktop currently paints one selected session in one stage. That is suitable
for a single Project Agent run, but it prevents a user from monitoring several
independent sessions at once.

Conversation and Project Agent sessions share the same Host session authority.
The requested tmux-like behavior therefore belongs to Desktop presentation,
not to Agent execution or Host session authority. Supplementary panes may use
the compact session renderer, while the primary pane keeps the full workbench
and inspector.

The interaction references converge on the same model:

- tmux recursively splits the current pane and gives the active pane visible
  focus and split, focus, resize, zoom, and even-layout commands;
- VS Code represents editor groups as resizable left/right/above/below splits
  with grid presets and maximize;
- Warp exposes split-right, split-down, pane navigation, resize, close, and
  maximize keyboard commands;
- WAI-ARIA's Window Splitter pattern requires a focusable separator with a
  value and arrow-key operation; WCAG requires a non-drag alternative.

References:

- <https://github.com/tmux/tmux/wiki/Getting-Started>
- <https://code.visualstudio.com/docs/configure/custom-layout>
- <https://docs.warp.dev/terminal/windows/split-panes>
- <https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/>
- <https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements>

## Decision

1. Desktop owns a recursive binary split tree. A leaf contains a stable
   `paneId` and at most one session id from the active scope; a branch contains
   its orientation and bounded ratio.
2. The tree, active pane, and maximized pane are device-local shell state. They
   are versioned in Desktop storage and never enter Host settings or session
   transcripts.
3. Host remains the only authority for sessions, prompts, runs, transcripts,
   and push events. Each visible leaf independently resumes and renders its
   bound Conversation.
4. Multi-pane is enabled for both `general` and `project` scopes. Each scope
   has its own device-local layout storage, so switching projects cannot show
   sessions from another scope.
5. One window supports at most eight visible panes. The remote live-session
   subscription bound is raised from four to eight so every visible pane can
   remain live without polling.
6. A session can be bound to only one pane in a window. Choosing an already
   visible session focuses its existing pane.
7. Closing a pane removes only the device-local view. It does not stop a Run,
   archive a session, or delete a transcript.
8. Every drag separator is also a keyboard-operable `separator`, and split,
   preset, close, and maximize actions remain available as buttons or menus.
9. The first leaf is the primary pane and reuses the existing full Conversation
   stage. Supplementary leaves use the same Host contract and shared message
   renderers with a compact text composer. Project-only Agent chrome is never
   mounted in supplementary panes.
10. A one-pane layout is visually identical to the pre-feature Conversation
    stage. Pane borders, headers, numbering, and controls appear only after the
    first split.

## Consequences

- Eight sessions can run and update concurrently without multiplying Host
  authorities or Pi adapters.
- Layout can differ safely between Desktop devices connected to one Host.
- The primary pane continues to own global titlebar/sidebar integration during
  the first slice. Supplementary panes own their title, transcript, run state,
  text composer, and the shared assistant media surface. Media galleries,
  generation progress, activity labels, and Artifact previews size against the
  pane container; per-pane history controls can be added without changing the
  split-tree contract.
- The protocol subscription ceiling is a compatibility-safe additive capacity
  change under protocol v1; older clients still send smaller lists.

## Rejected alternatives

- **Duplicate the whole workbench per pane.** This would duplicate sidebar,
  inspector, bootstrap, and active-session authorities and create conflicting
  subscriptions.
- **Use Side Chat as a pane.** Side Chat is a read-only context branch with
  different semantics, not an independent Conversation.
- **Store layout on Host.** Window geometry is device-local and should not roam
  across unrelated display sizes.
- **Duplicate the whole Project Agent workbench per pane.** Project panes use
  the same compact session renderer as supplementary Chat panes; only the
  primary pane owns the full Agent workbench and inspector.
