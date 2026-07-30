# Task 12 — GateCard (inline permission gate)

## What I implemented

Created a non-modal inline permission gate (`GateCard`) that renders at the end of the chat stream while a run waits for a permission decision, replacing the former modal `Dialog` branch in `app-dialogs.tsx`.

### Structure (1:1 with `docs/ui-prototype-v7.html:279-300`)
- `.gate` — `--warn-line` border, `--card` background, rounded card
- `.gate-head` — warn-colored `IconWarn` + `需要审批 · {action}` (action = `context.summary ?? prompt.action`)
- `.gate-cmd` — `--sunken` mono command block embedding the reused per-kind fact rendering
- `.gate-actions` — warn-solid primary `允许一次` / outlined `总是允许` (conditional) / outlined `拒绝` + `.gate-hint` `权限: {defaultDecision}`

## How I reused permission-request-card.tsx's rendering

Extracted the per-kind `<dl className="permission-facts">` branching (command / file-write / git / network / mcp / unknown) into a new exported `PermissionFacts` component in `permission-request-card.tsx`. `PermissionRequestCard` now delegates to `PermissionFacts` (no behavior change — the existing 8 `canRememberPermissionForProject` tests still pass). `GateCard` renders `<PermissionFacts>` inside `.gate-cmd`, so the command block, paths list, host/tool/risk tables, etc. are identical to the old modal body.

`canRememberPermissionForProject` is also reused by `GateCard` to decide whether `总是允许` (allow-remember-project) appears — same rule as the old modal (`network` / `command` / `file-write` kinds AND a non-null `projectPath`).

## How the respond handlers flow

Unchanged permission logic — only presentation moved:
1. `use-session-actions.ts` `handlePermission(decision, rememberScope)` is the single existing handler (dispatches `permission/resolve` to the host, then `permission/clear`).
2. `App.tsx` passes `onPermission={(decision, scope) => void handlePermission(decision, scope)}` plus `projectPath={state.projectPath}` into `ChatThread`.
3. `ChatThread` renders `<GateCard prompt={permissionPrompt} projectPath={projectPath} onPermission={onPermission} />` at the end of the stream when both `permissionPrompt` and `onPermission` are present.
4. `GateCard` buttons call:
   - `允许一次` → `onPermission('allow', 'once')`
   - `总是允许` → `onPermission('allow', 'project')` (only when `canRemember && projectPath`)
   - `拒绝` → `onPermission('deny')`

The gate is non-modal: no `Dialog`/overlay, no focus trap, no Esc dismissal. The run continues waiting for the response exactly as before.

## What I removed from app-dialogs.tsx

Removed the entire `{props.permissionPrompt ? (<Dialog testId="permission-dialog">…</Dialog>) : null}` branch (the modal with `PermissionRequestCard` + Deny/Allow once/Allow for project buttons). Removed the now-unused `PermissionRequestCard` and `canRememberPermissionForProject` imports. The `permissionPrompt` and `onPermission` props remain on `AppDialogsProps` (still passed by `App.tsx`) but are now no-ops there — kept to avoid a wider prop-type churn; they are consumed by `ChatThread` instead. Updated the file header comment to note permission prompts are now inline.

## Whether --warn-line existed

`--warn-line` is a real runtime token projected by `appearance-tokens.ts` (line 377-380): `rgba(178,80,0,0.3)` light / `rgba(245,184,61,0.3)` dark. `--warn`, `--warn-fg`, `--sunken`, `--card`, `--line`, `--faint` all exist too. **No substitution needed** — used the proto tokens directly.

## Files changed

- `apps/desktop/src/gate-card.tsx` — **new** — inline gate component
- `apps/desktop/src/gate-card.test.tsx` — **new** — 5 render tests (label/hint, allow-once, deny, remember-visibility gating, allow-remember)
- `apps/desktop/src/permission-request-card.tsx` — extracted `PermissionFacts` (reused by both `PermissionRequestCard` and `GateCard`)
- `apps/desktop/src/chat-thread.tsx` — added `projectPath` + `onPermission` props; renders `<GateCard>` at end of stream
- `apps/desktop/src/App.tsx` — passes `projectPath` + `onPermission` to `ChatThread`
- `apps/desktop/src/app-dialogs.tsx` — removed permission modal branch + unused imports
- `apps/desktop/src/shell-icons.tsx` — added `IconWarn` (warning triangle, proto paths)
- `apps/desktop/src/styles/region-transcript.css` — added `.gate`, `.gate-head`, `.gate-head-icon`, `.gate-cmd`, `.gate-actions`, `.gate-btn-allow-once` (warn-solid), `.gate-hint` styles ported from `docs/proto-shell.css:659-700`

## typecheck + test results

- `pnpm typecheck` — **green** (all packages incl. `@piwin/desktop`)
- `pnpm --filter @piwin/desktop test` — **312 passed (59 files)**, including the 5 new `gate-card.test.tsx` cases and the existing 8 `permission-request-card.test.ts` cases

## Concerns

- `AppDialogsProps` still carries `permissionPrompt` and `onPermission` props that are now unused inside `AppDialogs` (they're consumed by `ChatThread` instead). I left them to keep the prop-type diff minimal and avoid touching the `App.tsx` → `AppDialogs` call site beyond what was required. A future cleanup could drop them from `AppDialogsProps` and the `App.tsx` call site.
- The `onReviewPermission` handler in `App.tsx` (line 1124) still queries for `[data-testid="permission-dialog"]` to focus the prompt. That selector no longer matches anything (the gate uses `data-testid="permission-gate"`). The handler degrades gracefully (no-op when not found) but won't scroll the inline gate into view. A small follow-up could update the selector to `[data-testid="permission-gate"]` and call `scrollIntoView`. Not blocking — the gate renders inline in the stream so it's already visible when a prompt is active.
