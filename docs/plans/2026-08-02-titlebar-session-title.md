# Titlebar Session Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the centered titlebar show a short, readable session title (with optional project prefix) that matches coding-agent norms — not a raw multi-line prompt dump.

**Architecture:** Split titlebar identity into structured props (`projectName` + `sessionName`) instead of a fragile `"project / name"` string. Keep host auto-naming (LLM → text fallback) as the source of truth for `session.name`, but tighten the fallback for CJK and improve titlebar truncation/tooltip. Optionally set an optimistic interim name on first send so the bar never shows `session-xxxxxxxx` for long.

**Tech Stack:** React (desktop shell), CSS in `region-titlebar.css`, host auto-name in `@piwin/agent-host` + `@piwin/session`, Vitest.

## Global Constraints

- Apps must not import Pi packages; only `@piwin/*`.
- Session name source of truth remains host session index (`name` + `nameSource`: `default` | `auto` | `user`).
- User renames (`nameSource: 'user'`) must never be overwritten by auto-name.
- No new dependencies.
- TypeScript strict; colocated tests; `pnpm --filter @piwin/desktop typecheck` + package tests green.

---

## Current implementation (as of 2026-08-02)

### Data flow

```text
Host session index (name, nameSource)
  → session/list + session/name-updated push
  → chat-reducer sessions[]
  → activeSessionName = sessions.find(active)?.name ?? 'New chat'
  → App builds sessionTitle string:
        projectPath ? `${projectDisplayName(path)} / ${activeSessionName}` : activeSessionName
  → WorkspaceTitlebar splits on ' / ' for project vs session spans
```

### Key files

| File | Role |
|------|------|
| `apps/desktop/src/App.tsx` (~1397–1405, ~1601–1605) | Builds `activeSessionName` + concatenated `sessionTitle` |
| `apps/desktop/src/workspace-titlebar.tsx` | Renders identity; splits string on `' / '` |
| `apps/desktop/src/styles/region-titlebar.css` (~193–243) | Absolute center, max-width 560px, ellipsis |
| `apps/desktop/src/hooks/use-host-bootstrap.ts` (~147–152) | Applies `session/name-updated` → `session/update` |
| `packages/agent-host/src/session-naming-service.ts` | LLM title then `deriveDefaultNameFromMessage` |
| `packages/agent-host/src/lightweight-completion.ts` | LLM title: 3–7 words, max 80 chars |
| `packages/session/src/derive-default-name.ts` | Fallback: strip md/urls, max **60** chars, space word-boundary |
| `packages/agent-host/src/host-runtime.ts` (`maybeTriggerAutoName`) | After each completed exchange until `auto`/`user` |

### Observed product bugs (screenshot)

1. **Title is the first user prompt** (or 60-char slice of it), not a short agent title → bar reads like a truncated chat bubble.
2. **Composition is stringly-typed**: `project / session` then `split(' / ')` breaks if the session name itself contains ` / `.
3. **No full-title tooltip** on the project/session split path (only the non-split branch sets `title=`).
4. **CSS**: `.titlebar-project-name { flex-shrink: 0 }` + long CJK session name → session ellipsis works, but hierarchy still looks like “dump the prompt in the chrome”.
5. **Fallback is English-space oriented**: Chinese has no spaces; truncate cuts mid-phrase at 59 code units (acceptable) but 60 chars is still too long for a titlebar label next to project name.
6. **Interim state**: new session is `session-<8 hex>` until first exchange completes auto-name — titlebar can flash junk id.

### Industry reference (Cursor / VS Code Copilot / coding agents)

| Surface | Norm |
|---------|------|
| Session list + header | Same short title |
| Title quality | AI summary **3–7 words**; not the raw prompt |
| Fallback chain | user rename → AI title → truncated first message → placeholder |
| Project context | Sidebar grouping / secondary label; header primary = **session** title |
| Rename | Manual rename sticky; sync list + header |
| Truncation | Single-line ellipsis + hover full string |

piwin already has the host pipeline (LLM + fallback + `nameSource` guard + push). Gaps are **UI composition**, **fallback length/CJK**, and **interim naming**.

---

## Target UX

```text
[ ☰ ] [ ← → ]     piwin  /  Walkthrough 交付文档     [ ··· ] [ ▤ ]
                   muted     primary (ellipsis)
                   tooltip: full "piwin / Walkthrough 交付文档"
```

Rules:

1. **Primary text** = short session title (auto or user).
2. **Secondary** = project basename only when a project is open (muted + `/`).
3. Never put the raw multi-paragraph prompt in the titlebar; fallback max **32** display chars (CJK-safe).
4. Full string always available via `title` tooltip.
5. List row and titlebar always show the same `session.name`.

---

## File map (create / modify)

| Path | Responsibility |
|------|----------------|
| `apps/desktop/src/workspace-titlebar.tsx` | Structured props; render project + session; tooltip |
| `apps/desktop/src/workspace-titlebar.test.tsx` | Unit tests for identity rendering |
| `apps/desktop/src/App.tsx` | Pass `projectName` + `sessionName` separately |
| `apps/desktop/src/styles/region-titlebar.css` | Truncation hierarchy, max widths |
| `packages/session/src/derive-default-name.ts` | Shorter CJK-aware fallback |
| `packages/session/src/derive-default-name.test.ts` | Cover CJK + new max |
| `apps/desktop/src/hooks/use-session-actions.ts` | Optimistic interim name on first prompt (optional task) |
| `apps/desktop/src/title-display.ts` | Pure helpers: `formatTitlebarTooltip`, placeholder copy |

---

### Task 1: Structured titlebar identity props + tests

**Files:**
- Modify: `apps/desktop/src/workspace-titlebar.tsx`
- Create: `apps/desktop/src/workspace-titlebar.test.tsx`
- Modify: `apps/desktop/src/App.tsx` (call site only)
- Create: `apps/desktop/src/title-display.ts`
- Create: `apps/desktop/src/title-display.test.ts`

**Interfaces:**
- Consumes: `projectDisplayName(path)` from existing `project-display-name.ts`
- Produces:
  - `WorkspaceTitlebarProps.projectName?: string`
  - `WorkspaceTitlebarProps.sessionName?: string`
  - Deprecate/remove `sessionTitle?: string` after call sites updated
  - `buildTitlebarTooltip(projectName: string | undefined, sessionName: string): string`

- [ ] **Step 1: Write failing pure helper tests**

```ts
// apps/desktop/src/title-display.test.ts
import { describe, expect, it } from 'vitest';
import { buildTitlebarTooltip } from './title-display';

describe('buildTitlebarTooltip', () => {
  it('joins project and session with thin separator', () => {
    expect(buildTitlebarTooltip('piwin', 'Fix auth')).toBe('piwin / Fix auth');
  });

  it('returns session only when project missing', () => {
    expect(buildTitlebarTooltip(undefined, 'Fix auth')).toBe('Fix auth');
    expect(buildTitlebarTooltip('', 'Fix auth')).toBe('Fix auth');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @piwin/desktop exec vitest run src/title-display.test.ts`
Expected: FAIL module not found / export missing

- [ ] **Step 3: Implement helper**

```ts
// apps/desktop/src/title-display.ts
/** Full string for titlebar hover tooltip (and a11y name). */
export function buildTitlebarTooltip(
  projectName: string | undefined,
  sessionName: string,
): string {
  const project = projectName?.trim() ?? '';
  const session = sessionName.trim();
  if (!project) return session;
  if (!session) return project;
  return `${project} / ${session}`;
}
```

- [ ] **Step 4: Run helper tests**

Run: `pnpm --filter @piwin/desktop exec vitest run src/title-display.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing titlebar render tests**

```tsx
// apps/desktop/src/workspace-titlebar.test.tsx
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceTitlebar } from './workspace-titlebar';

describe('WorkspaceTitlebar identity', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders project and session as separate nodes without string-split', () => {
    act(() => {
      root.render(
        <WorkspaceTitlebar projectName="piwin" sessionName="Auth / OAuth fix" />,
      );
    });
    expect(container.querySelector('.titlebar-project-name')?.textContent).toBe('piwin');
    expect(container.querySelector('.titlebar-session-name')?.textContent).toBe(
      'Auth / OAuth fix',
    );
    // Must NOT treat "Auth" as project because of internal " / "
    expect(container.querySelectorAll('.titlebar-sep')).toHaveLength(1);
  });

  it('sets tooltip to full project / session', () => {
    act(() => {
      root.render(
        <WorkspaceTitlebar projectName="piwin" sessionName="Walkthrough 交付文档" />,
      );
    });
    const identity = container.querySelector('.titlebar-session-identity');
    expect(identity?.getAttribute('title')).toBe('piwin / Walkthrough 交付文档');
  });

  it('renders session only when no project', () => {
    act(() => {
      root.render(<WorkspaceTitlebar sessionName="General chat" />);
    });
    expect(container.querySelector('.titlebar-project-name')).toBeNull();
    expect(container.querySelector('.titlebar-session-name')?.textContent).toBe(
      'General chat',
    );
  });
});
```

- [ ] **Step 6: Run titlebar tests — expect FAIL**

Run: `pnpm --filter @piwin/desktop exec vitest run src/workspace-titlebar.test.tsx`
Expected: FAIL (props still `sessionTitle` / split logic)

- [ ] **Step 7: Implement structured props in titlebar**

Replace identity block in `workspace-titlebar.tsx`:

```tsx
import { buildTitlebarTooltip } from './title-display';

export type WorkspaceTitlebarProps = {
  // ...existing props...
  /** Project basename when a project is open; omit for general scope. */
  projectName?: string;
  /** Active session display name (auto / user / placeholder). */
  sessionName?: string;
  // remove sessionTitle
};

// inside render:
const sessionName = props.sessionName?.trim() ?? '';
const projectName = props.projectName?.trim() || undefined;
const showIdentity = sessionName.length > 0 || Boolean(projectName);
const tooltip = buildTitlebarTooltip(projectName, sessionName || projectName || '');

{showIdentity ? (
  <div
    className="titlebar-session-identity"
    data-testid="titlebar-session-identity"
    title={tooltip}
  >
    {projectName ? (
      <>
        <span className="titlebar-project-name">{projectName}</span>
        {sessionName ? <span className="titlebar-sep" aria-hidden="true">/</span> : null}
      </>
    ) : null}
    {sessionName ? (
      <span className="titlebar-session-name">{sessionName}</span>
    ) : null}
    {/* keep scope pill + permission badge as today */}
  </div>
) : null}
```

- [ ] **Step 8: Update App.tsx call site**

```tsx
// remove sessionTitle=...
projectName={state.projectPath ? projectDisplayName(state.projectPath) : undefined}
sessionName={activeSessionName}
```

Also update any compact-layout duplicate title props (~1698) the same way if present.

- [ ] **Step 9: Run titlebar + typecheck**

Run:
```bash
pnpm --filter @piwin/desktop exec vitest run src/title-display.test.ts src/workspace-titlebar.test.tsx
pnpm --filter @piwin/desktop typecheck
```
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src/title-display.ts apps/desktop/src/title-display.test.ts \
  apps/desktop/src/workspace-titlebar.tsx apps/desktop/src/workspace-titlebar.test.tsx \
  apps/desktop/src/App.tsx
git commit -m "$(cat <<'EOF'
fix(desktop): structure titlebar project/session identity props

Avoid splitting a concatenated "project / session" string so session
names containing " / " render correctly and tooltips show the full title.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

### Task 2: Titlebar truncation CSS hierarchy

**Files:**
- Modify: `apps/desktop/src/styles/region-titlebar.css` (~193–243)

**Interfaces:**
- Consumes: structured DOM from Task 1 (`.titlebar-project-name`, `.titlebar-session-name`)
- Produces: stable single-line chrome; session name is the flex shrink target

- [ ] **Step 1: Adjust CSS**

```css
.titlebar-session-identity {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  /* Leave room for traffic lights / history / actions */
  max-width: min(560px, calc(100% - 280px));
  overflow: hidden;
  pointer-events: none; /* keep drag region behavior */
  -webkit-app-region: drag;
}

.titlebar-project-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* Project can shrink a little, but prefer shrinking session */
  flex: 0 1 auto;
  max-width: 28%;
}

.titlebar-sep {
  font-size: 13px;
  color: var(--faint);
  flex-shrink: 0;
  user-select: none;
}

.titlebar-session-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1 1 auto;
  min-width: 0; /* critical for ellipsis in flex */
}
```

Remove unused `.titlebar-session-title` if no longer referenced, or keep as alias of `.titlebar-session-name` for one release.

- [ ] **Step 2: Manual smoke**

Run desktop, open a project session with a long Chinese name:
- Project muted, session primary
- Ellipsis on session, not wrapping to two lines
- Hover shows full tooltip (native `title`)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/styles/region-titlebar.css
git commit -m "$(cat <<'EOF'
style(desktop): fix titlebar identity truncation hierarchy

Session name is the primary flex shrink target; project stays secondary.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

### Task 3: Tighten text fallback naming (CJK-safe, shorter)

**Files:**
- Modify: `packages/session/src/derive-default-name.ts`
- Modify: `packages/session/src/derive-default-name.test.ts`

**Interfaces:**
- Consumes: first user message string
- Produces: `deriveDefaultNameFromMessage(text): string` — max **32** chars (was 60), CJK-safe cut

Rationale: LLM path already aims for 3–7 words / 80 max. Fallback is what users see when LLM fails (common offline / key issues). 60-char Chinese prompt still looks like a dump in the titlebar.

- [ ] **Step 1: Update tests first**

```ts
// packages/session/src/derive-default-name.test.ts — replace/extend
it('truncates at 32 chars with ellipsis', () => {
  const long = 'This is a very long prompt that exceeds thirty two characters easily';
  const result = deriveDefaultNameFromMessage(long);
  expect(result.length).toBeLessThanOrEqual(32);
  expect(result.endsWith('…')).toBe(true);
});

it('truncates CJK without requiring spaces', () => {
  const long =
    '请为Walkthrough生成一份详细的交付文档请包含以下文本格式以及更多说明内容确保足够长';
  const result = deriveDefaultNameFromMessage(long);
  expect(result.length).toBeLessThanOrEqual(32);
  expect(result.endsWith('…')).toBe(true);
  expect(result.startsWith('请为Walkthrough')).toBe(true);
});
```

- [ ] **Step 2: Run tests — expect FAIL on length**

Run: `pnpm --filter @piwin/session exec vitest run src/derive-default-name.test.ts`
Expected: FAIL (still 60)

- [ ] **Step 3: Implement**

```ts
/** Max length for a text-derived default session name (titlebar-friendly). */
const MAX_DEFAULT_NAME_CHARS = 32;

export function deriveDefaultNameFromMessage(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/<walkthrough-context[\s\S]*?<\/walkthrough-context>/gi, '');
  cleaned = cleaned.replace(
    /\[piwin walkthrough context\][\s\S]*?\[end walkthrough context\]/gi,
    '',
  );
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');
  cleaned = cleaned.replace(/\*\*(.+?)\*\*/g, '$1');
  cleaned = cleaned.replace(/__(.+?)__/g, '$1');
  cleaned = cleaned.replace(/\*(.+?)\*/g, '$1');
  cleaned = cleaned.replace(/_(.+?)_/g, '$1');
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
  cleaned = cleaned.replace(/https?:\/\/\S+/g, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return '';
  if (cleaned.length <= MAX_DEFAULT_NAME_CHARS) return cleaned;

  const limit = MAX_DEFAULT_NAME_CHARS - 1; // room for …
  const slice = cleaned.slice(0, limit);
  // Prefer space boundary for Latin; for CJK (no space) cut at limit.
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > Math.floor(limit * 0.5) ? lastSpace : slice.length;
  return `${cleaned.slice(0, cut).trimEnd()}…`;
}
```

- [ ] **Step 4: Run session package tests**

Run: `pnpm --filter @piwin/session exec vitest run src/derive-default-name.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/session/src/derive-default-name.ts packages/session/src/derive-default-name.test.ts
git commit -m "$(cat <<'EOF'
fix(session): shorten CJK-safe default session title fallback

Cap text-derived names at 32 chars so titlebar/list stay scannable when
LLM auto-title is unavailable.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

### Task 4: Optimistic interim title on first send (desktop)

**Files:**
- Modify: `apps/desktop/src/hooks/use-session-actions.ts` (prompt / create path)
- Modify: `apps/desktop/src/hooks/use-host-bootstrap.ts` only if needed (already handles name-updated)
- Test: extend existing session action tests if present; else add focused unit test for a pure “should set interim name” helper

**Interfaces:**
- Consumes: `deriveDefaultNameFromMessage` from `@piwin/session`
- Produces: after successful `session/prompt` on a session still named `session-xxxxxxxx` or empty placeholder, dispatch `session/update` with interim name; host auto-name later overwrites when `nameSource` becomes `auto`

- [ ] **Step 1: Add pure helper**

```ts
// apps/desktop/src/title-display.ts
const PLACEHOLDER_SESSION_RE = /^session-[0-9a-f]{6,}$/i;

/** True when the list label is still a host placeholder, not user/auto content. */
export function isPlaceholderSessionName(name: string | undefined): boolean {
  if (!name) return true;
  return PLACEHOLDER_SESSION_RE.test(name.trim()) || name === 'New chat' || name === '新会话';
}
```

Test:

```ts
expect(isPlaceholderSessionName('session-ab12cd34')).toBe(true);
expect(isPlaceholderSessionName('Walkthrough 交付')).toBe(false);
```

- [ ] **Step 2: On first prompt success, optimistic update**

In the send path (where `session/prompt` succeeds), after you know `sessionId` + user text:

```ts
import { deriveDefaultNameFromMessage } from '@piwin/session';
import { isPlaceholderSessionName } from '../title-display';

// after prompt accepted:
const current = /* lookup session name from state or closure */;
if (isPlaceholderSessionName(current)) {
  const interim = deriveDefaultNameFromMessage(text);
  if (interim) {
    dispatch({
      type: 'session/update',
      session: { id: sessionId, name: interim },
    });
  }
}
```

Do **not** call `session/rename` for interim — that would set `nameSource: 'user'` and block LLM auto-name. Local UI update only; host remains `default` until auto-name push.

- [ ] **Step 3: Verify name-updated still wins**

Existing bootstrap:

```ts
if (message.type === 'session/name-updated') {
  dispatch({
    type: 'session/update',
    session: { id: message.sessionId, name: message.name },
  });
}
```

No change required if merge is `{ ...session, ...action.session }`.

- [ ] **Step 4: Manual / unit verify**

- New session → send long Chinese prompt → titlebar immediately shows ≤32 char slice
- After turn completes + auto-name → title becomes short LLM phrase (when provider works)
- Manual rename still sticky

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/title-display.ts apps/desktop/src/title-display.test.ts \
  apps/desktop/src/hooks/use-session-actions.ts
git commit -m "$(cat <<'EOF'
feat(desktop): optimistic interim session title from first prompt

Show a short derived label immediately while host auto-name is in flight,
without marking nameSource user.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

### Task 5 (optional polish): Double-click titlebar to rename

**Files:**
- Modify: `apps/desktop/src/workspace-titlebar.tsx`
- Modify: `apps/desktop/src/App.tsx` / `app-dialogs.tsx` (reuse existing rename dialog)
- Modify: `apps/desktop/src/styles/region-titlebar.css` (`pointer-events` on identity)

Only if product wants parity with sidebar rename from the chrome.

- [ ] **Step 1:** Add `onRenameSession?: () => void` prop; set `pointer-events: auto` on `.titlebar-session-name` only; `onDoubleClick` opens existing rename draft for `activeSessionId`.
- [ ] **Step 2:** Test double-click fires callback; single click does not steal window drag.
- [ ] **Step 3:** Commit as `feat(desktop): double-click titlebar session name to rename`.

Skip this task if YAGNI — sidebar rename already exists.

---

## Verification checklist (all tasks)

```bash
pnpm --filter @piwin/session exec vitest run src/derive-default-name.test.ts
pnpm --filter @piwin/desktop exec vitest run src/title-display.test.ts src/workspace-titlebar.test.tsx
pnpm --filter @piwin/desktop typecheck
pnpm --filter @piwin/session typecheck
```

Manual matrix:

| Theme / case | Expect |
|--------------|--------|
| Project + short auto title | `piwin / Walkthrough 交付` |
| Project + long fallback | ellipsis; tooltip full |
| Session name contains ` / ` | single separator; full session text |
| General scope | session only, no project |
| After LLM auto-name push | list + titlebar match |
| User rename | not overwritten by later turns |

---

## Out of scope

- Changing LLM system prompt quality beyond existing 3–7 words (already correct).
- OS window title (`document.title` / Tauri title) — can follow later using same helper.
- Redesigning sidebar session rows (already truncate independently).

---

## Self-review

1. **Spec coverage:** structured props, truncation CSS, fallback length/CJK, optimistic interim, optional rename — all mapped to tasks.
2. **Placeholders:** none; code and commands are concrete.
3. **Types:** `projectName?: string`, `sessionName?: string`, `buildTitlebarTooltip`, `isPlaceholderSessionName` consistent across tasks.
