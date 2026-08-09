# Session lineage tree — implementation plan

Status: Completed — persistent frontend entry shipped (2026-08-09)

## Goal

Make product-level conversation forks visible as a first-class session
navigation surface. The tree is a navigation surface for
`ProductSessionLineageView`; it is not the deferred Pi-native JSONL
`SessionTreeView`.

## Locked behavior

- Duplicate remains an independent complete copy and is not added to lineage.
- Fork remains a response-level prefix copy and records the immediate source
  session plus the root session.
- The originating response shows a branch count when direct forks exist.
- The middle-column session header always exposes a labeled **Session tree**
  entry while a product session is active, including before the first fork.
- An unbranched tree opens to the current node plus guidance that Fork is
  available below completed assistant responses; the entry is never hidden by
  `nodes.length === 1`.
- Response actions remain contextual: Fork creates a branch, while an existing
  direct branch count opens the same tree navigation surface.
- Selecting a tree node resumes that product session through HostClient.
- Missing/deleted roots render as a non-clickable placeholder; surviving forks
  remain navigable.
- No Pi package is imported by Desktop and no Pi-native active-leaf behavior is
  added in this slice.

## Implementation slices

1. Add a pure Desktop projection from the flat lineage response into a rooted
   tree, including missing-root and malformed-lineage handling.
2. Complete MockHostBackend lineage persistence/query behavior so Desktop
   tests exercise the same shape as the real Host.
3. Load lineage for the active session, derive direct-fork counts by source
   response, and pass the projection into ChatThread.
4. Render a reusable, keyboard-accessible tree panel for response actions and
   the persistent ContextBar entry.
5. Give Fork and Session tree distinct icons, add a useful single-node empty
   state, and resume selected nodes through the existing session action.
6. Add unit/component tests and update the deferred backlog/status notes.

## Frontend entry design

- **Primary entry:** a labeled `Session tree` pill beside the active session
  title in ContextBar, with a numeric related-session count. This is visible for
  every active session and remains usable while there are zero branches.
- **Secondary entry:** the response footer keeps Duplicate and Fork; when a
  response owns direct forks, its count opens the shared tree panel.
- **Panel:** header summary, rooted connector tree, current/archived/missing-root
  states, source-response preview, and a single-node guidance card.
- **Responsive behavior:** the primary control keeps its tree icon and count;
  only the text label may collapse at narrow stage widths.

## Verification

```bash
pnpm --dir apps/desktop exec vitest run \
  src/session-lineage-tree.test.ts \
  src/session-lineage-popover.test.tsx \
  src/context-bar.test.tsx \
  src/chat-thread.test.tsx
pnpm --dir apps/desktop typecheck
pnpm --dir apps/desktop build
pnpm --dir apps/desktop exec playwright test e2e/session-lineage.spec.ts
```

Results on 2026-08-09:

- 32 targeted unit/component tests passed.
- Desktop TypeScript project build and Vite production build passed.
- The focused App-level Playwright flow passed: persistent single-node entry,
  response fork, two-node tree, and return-to-root navigation.
- Manual browser visual QA passed at 1024 px and 680 px widths. The full label
  remains visible at normal width; narrow mode preserves the icon and count.
- Browser console reported no warnings or errors during the visual flow.
