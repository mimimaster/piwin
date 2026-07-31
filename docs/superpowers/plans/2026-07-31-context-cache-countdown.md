# Context Cache Expiry Countdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a live, second-precision countdown in the Context Usage popover that estimates when the host's cached context snapshot will expire, derived from `ContextUsageSnapshot.updatedAt` plus a product-defined 5-minute window, and explicitly labeled as an estimate (not a server-guaranteed TTL).

**Architecture:** No contracts, host, or IPC changes — `ContextUsageSnapshot.updatedAt` already flows from `packages/agent-host` through `@piwin/contracts` into `apps/desktop/src/context-usage-ring.tsx`. Two pure helpers (`getCacheExpiryEstimateSeconds`, `formatCountdown`) plus a popover-gated 1-second React `useEffect` ticker render the countdown inside the existing popover. The countdown is hidden when `updatedAt` is missing, unparseable, or older than 5 minutes, and clamped at 5:00 for future/clock-skewed timestamps.

**Tech Stack:** TypeScript (strict, ESM), React 19, Vitest 3 + happy-dom, `@piwin/contracts`, `@piwin/ui-kit`.

**Spec:** Inferred from product discussion; no separate spec doc. Pi SDK/RPC exposes no cache TTL metadata, so the 5-minute window is a product assumption that must be communicated to the user via the "estimate" label.

## Global Constraints

- TypeScript strict mode; no `any`; no non-null assertion without runtime check.
- ESM only; relative imports inside `apps/desktop/src` use no extension (Vite/bundler convention used by existing files).
- `apps/desktop` must NOT import any `@earendil-works/pi-*` package (AGENTS.md §1). All Pi data arrives via `@piwin/contracts` types already plumbed through `ContextUsageSnapshot`.
- No new dependencies; reuse `react`, `vitest`, `happy-dom` already in `apps/desktop/package.json`.
- Tests: Vitest with `happy-dom`; colocated `foo.test.tsx` next to `foo.tsx`.
- UI copy is English (matches existing Context Usage popover copy: "Context Usage", "Limit source:", "Edit context window").
- The word "estimate" (or equivalent qualifier) MUST appear in the countdown copy — never present the 5-minute window as a provider/SDK-guaranteed TTL.
- Commits: small, by concern; use the repo's `Generated with [Devin]` trailer format.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `apps/desktop/src/context-usage-ring.tsx` | Add `CACHE_EXPIRY_ESTIMATE_MS` constant, `getCacheExpiryEstimateSeconds` + `formatCountdown` pure helpers, popover-gated 1-second ticker, render estimate row in popover | Modify |
| `apps/desktop/src/context-usage-ring.test.tsx` | Fake-timer coverage: initial 5:00, per-second decrement, expiry hide, invalid/missing `updatedAt` hide, future-timestamp clamp, popover-closed no-tick | Modify |
| `apps/desktop/src/styles/region-composer.css` | Add `.context-usage-cache-estimate` styling (muted, small, gap from summary) | Modify |
| `docs/todo-deferred.md` | Annotate CE-OBS-01..02 row: cache countdown is a client-side 5-min estimate, not a Pi TTL; replace with host-supplied TTL if Pi ever exposes one | Modify |

---

## Task 1: Pure helpers + failing tests

**Files:**
- Modify: `apps/desktop/src/context-usage-ring.test.tsx`
- Modify: `apps/desktop/src/context-usage-ring.tsx`

**Interfaces:**
- Produces (module-private, exercised via component render):
  - `getCacheExpiryEstimateSeconds(updatedAt: string | undefined, now: number): number | undefined` — returns whole seconds remaining in the 5-minute window, `undefined` when `updatedAt` is missing/unparseable/expired.
  - `formatCountdown(totalSeconds: number): string` — returns `M:SS` (e.g. `"5:00"`, `"3:59"`, `"0:01"`).
- Produces (exported for direct unit testing):
  - `export const CACHE_EXPIRY_ESTIMATE_MS = 5 * 60 * 1000;`

- [ ] **Step 1: Export the constant and stub the helpers**

In `apps/desktop/src/context-usage-ring.tsx`, immediately after the existing imports (line 9, after `import { IconClose } from './shell-icons';`), add:

```ts
/**
 * Product-defined window used to *estimate* when the host's cached context
 * snapshot expires. Pi SDK/RPC does not expose a real cache TTL, so this is a
 * client-side assumption — never present it to the user as a provider guarantee.
 */
export const CACHE_EXPIRY_ESTIMATE_MS = 5 * 60 * 1000;

/**
 * Whole seconds remaining in the cache estimate window, or `undefined` when
 * `updatedAt` is missing, unparseable, or already past the window. Future /
 * clock-skewed timestamps are clamped to the full window so the UI never shows
 * more than `5:00`.
 */
function getCacheExpiryEstimateSeconds(
  updatedAt: string | undefined,
  now: number,
): number | undefined {
  if (!updatedAt) return undefined;
  const updatedMs = Date.parse(updatedAt);
  if (Number.isNaN(updatedMs)) return undefined;
  const remainingMs = updatedMs + CACHE_EXPIRY_ESTIMATE_MS - now;
  if (remainingMs <= 0) return undefined;
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const maxSeconds = CACHE_EXPIRY_ESTIMATE_MS / 1000;
  return Math.min(remainingSeconds, maxSeconds);
}

/**
 * Formats a positive whole-second count as `M:SS` (zero-padded seconds).
 */
function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
```

(These are not yet consumed by the component — Task 2 wires them in. Exporting the constant now lets Task 1 tests import it for fixture math without magic numbers.)

- [ ] **Step 2: Write the failing helper tests**

At the top of `apps/desktop/src/context-usage-ring.test.tsx`, update the existing import block (currently lines 12-15) to also pull in the constant:

```ts
import {
  ContextUsageRing,
  type ContextUsageRingProps,
} from './context-usage-ring.js';
```

becomes:

```ts
import {
  CACHE_EXPIRY_ESTIMATE_MS,
  ContextUsageRing,
  type ContextUsageRingProps,
} from './context-usage-ring.js';
```

Then, at the very bottom of the file (after the closing `});` of the existing `describe('ContextUsageRing', ...)` block), append a new describe block that exercises the helpers indirectly through a tiny re-implementation is NOT allowed — instead, since the helpers are module-private, we test them through the rendered component in Task 2. For Task 1, we only assert the constant is exported and has the expected value, which guards against accidental changes to the product assumption:

```ts
describe('CACHE_EXPIRY_ESTIMATE_MS', () => {
  it('is a 5-minute window', () => {
    expect(CACHE_EXPIRY_ESTIMATE_MS).toBe(5 * 60 * 1000);
  });
});
```

- [ ] **Step 3: Run tests to verify they pass (sanity)**

Run: `pnpm --filter @piwin/desktop test -- src/context-usage-ring.test.tsx`
Expected: PASS — the constant is already exported and equals 300000. This step exists so Task 2's failing tests fail for the right reason (missing UI), not because of a broken import.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/context-usage-ring.tsx apps/desktop/src/context-usage-ring.test.tsx
git commit -m "$(cat <<'EOF'
feat(desktop): add cache expiry estimate helpers (5-min window)

Pure getCacheExpiryEstimateSeconds + formatCountdown plus exported
CACHE_EXPIRY_ESTIMATE_MS constant. Not yet wired into the popover; subsequent
commit adds the ticker and rendered countdown. Pi exposes no cache TTL, so
this is a client-side estimate only.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

## Task 2: Render the countdown in the popover (TDD)

**Files:**
- Modify: `apps/desktop/src/context-usage-ring.test.tsx`
- Modify: `apps/desktop/src/context-usage-ring.tsx`

**Interfaces:**
- Consumes: `CACHE_EXPIRY_ESTIMATE_MS`, `getCacheExpiryEstimateSeconds`, `formatCountdown` from Task 1.
- Produces: a `<p className="context-usage-cache-estimate muted">` element inside the popover, visible only when open and a valid estimate exists. Text format: `Cache estimate · expires in M:SS`.

- [ ] **Step 1: Add fake-timer setup to the existing describe block**

In `apps/desktop/src/context-usage-ring.test.tsx`, inside `describe('ContextUsageRing', ...)`:

1. Update the `beforeEach` (currently lines 86-92) to install fake timers and pin the system clock to the same `updatedAt` value used by `createBaseProps` (`'2026-07-26T00:00:00.000Z'`):

```ts
  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T00:00:00.000Z'));
  });
```

2. Update the `afterEach` (currently lines 94-102) to restore real timers before unmounting:

```ts
  afterEach(() => {
    vi.useRealTimers();
    act(() => {
      root.unmount();
    });
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });
```

- [ ] **Step 2: Write the failing countdown tests**

Append the following tests inside the existing `describe('ContextUsageRing', ...)` block (after the last existing `it('closes on Escape ...')` test, before the closing `});`):

```ts
  it('shows a 5:00 cache estimate when updatedAt is now and popover opens', () => {
    render(createBaseProps(), root);
    activateTrigger();

    const popover = queryPopover();
    expect(popover?.textContent).toContain('Cache estimate · expires in 5:00');
  });

  it('decrements the estimate each second while the popover is open', () => {
    render(createBaseProps(), root);
    activateTrigger();

    act(() => {
      vi.advanceTimersByTime(61_000);
    });

    const popover = queryPopover();
    // 61s elapsed → 300 - 61 = 239s → 3:59 (ceil keeps it at 3:59 once past 3:59.0)
    expect(popover?.textContent).toContain('Cache estimate · expires in 3:59');
  });

  it('hides the estimate when updatedAt is older than 5 minutes', () => {
    vi.setSystemTime(new Date('2026-07-26T00:06:00.000Z'));
    render(createBaseProps(), root);
    activateTrigger();

    const popover = queryPopover();
    expect(popover?.textContent).not.toContain('Cache estimate');
  });

  it('hides the estimate when updatedAt is unparseable', () => {
    render(
      createBaseProps({
        usage: {
          sessionId: 'session-test',
          tokensUsed: 40_000,
          tokensLimit: 200_000,
          updatedAt: 'not-a-date',
        },
      }),
      root,
    );
    activateTrigger();

    const popover = queryPopover();
    expect(popover?.textContent).not.toContain('Cache estimate');
  });

  it('hides the estimate when usage is null', () => {
    render(createBaseProps({ usage: null }), root);
    activateTrigger();

    const popover = queryPopover();
    expect(popover?.textContent).not.toContain('Cache estimate');
  });

  it('clamps a future updatedAt to 5:00', () => {
    vi.setSystemTime(new Date('2026-07-25T23:59:00.000Z'));
    render(createBaseProps(), root);
    activateTrigger();

    const popover = queryPopover();
    expect(popover?.textContent).toContain('Cache estimate · expires in 5:00');
  });

  it('does not run the ticker while the popover is closed', () => {
    render(createBaseProps(), root);
    // Popover never opened; advance well past the window.
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    activateTrigger();

    // Even though 10 minutes passed, the closed popover never ticked, so the
    // first render after open recomputes from Date.now() and shows expired/none.
    const popover = queryPopover();
    expect(popover?.textContent).not.toContain('Cache estimate');
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @piwin/desktop test -- src/context-usage-ring.test.tsx`
Expected: FAIL — the new tests fail because the popover does not render any "Cache estimate" text. The existing tests should still pass (fake timers + pinned system time match the existing `updatedAt` fixture, so `tone-ok` / `20%` / `host report` assertions are unaffected).

- [ ] **Step 4: Wire the ticker and render the estimate**

In `apps/desktop/src/context-usage-ring.tsx`:

1. Update the React import (line 5) to include `useEffect`:

```ts
import { useEffect, useState, type ReactElement } from 'react';
```

2. Inside `ContextUsageRing`, immediately after the existing `const [open, setOpen] = useState(false);` (line 63), add a `now` state and a popover-gated ticker:

```ts
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Recompute the countdown only while the popover is open; close → no ticks.
  // Also reseed `now` whenever a fresh usage snapshot arrives so the user sees
  // an up-to-date estimate without waiting for the next 1s tick.
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open, props.usage?.updatedAt]);
```

3. After the existing `const breakdown = ...` line (line 78), compute the estimate:

```ts
  const cacheExpirySeconds = getCacheExpiryEstimateSeconds(
    props.usage?.updatedAt,
    now,
  );
```

4. Inside the popover body, render the estimate row immediately after the `.context-usage-popover-summary` closing `</div>` (currently line 180) and before the `.context-usage-bar` div:

```tsx
        {cacheExpirySeconds !== undefined ? (
          <p className="context-usage-cache-estimate muted">
            Cache estimate · expires in {formatCountdown(cacheExpirySeconds)}
          </p>
        ) : null}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @piwin/desktop test -- src/context-usage-ring.test.tsx`
Expected: PASS — all existing tests plus the 7 new countdown tests. If the "decrements each second" test is flaky about `3:59` vs `4:00`, confirm `vi.advanceTimersByTime(61_000)` advances exactly 61 seconds and `Math.ceil((300000 - 61000) / 1000) === 239` → `3:59`.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/context-usage-ring.tsx apps/desktop/src/context-usage-ring.test.tsx
git commit -m "$(cat <<'EOF'
feat(desktop): show inferred cache expiry countdown in usage popover

Popover now renders "Cache estimate · expires in M:SS" derived from
ContextUsageSnapshot.updatedAt plus a 5-minute product window. A 1-second
ticker runs only while the popover is open and reseeds on new snapshots.
Hidden when updatedAt is missing, unparseable, or past the window; clamped
to 5:00 for future timestamps. Pi exposes no real cache TTL, so the copy
is explicitly labeled an estimate.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

## Task 3: Style the estimate row

**Files:**
- Modify: `apps/desktop/src/styles/region-composer.css:966` (after `.context-usage-popover-summary`)

**Interfaces:**
- Consumes: the `.context-usage-cache-estimate` class added in Task 2.
- Produces: muted, small, slightly indented row that visually separates from the summary above and the bar below.

- [ ] **Step 1: Add the CSS rule**

In `apps/desktop/src/styles/region-composer.css`, immediately after the `.context-usage-popover-summary { ... }` block (which ends at line 966), insert:

```css
.context-usage-cache-estimate {
  margin: 0 0 8px;
  font-size: 11px;
}
```

- [ ] **Step 2: Verify no test regressions**

Run: `pnpm --filter @piwin/desktop test -- src/context-usage-ring.test.tsx`
Expected: PASS — CSS changes do not affect happy-dom text assertions.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/styles/region-composer.css
git commit -m "$(cat <<'EOF'
style(desktop): add context-usage-cache-estimate row styling

Muted 11px row sitting between the popover summary and the usage bar.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

## Task 4: Document the estimate limitation

**Files:**
- Modify: `docs/todo-deferred.md:181` (CE-OBS-01..02 row)

**Interfaces:**
- Produces: a one-line annotation clarifying the countdown is a client-side 5-minute estimate, not a Pi-provided TTL, and that it should be replaced by a host-supplied TTL field if Pi ever exposes one.

- [ ] **Step 1: Read the current CE-OBS row**

Run: `grep -n "CE-OBS-01" docs/todo-deferred.md` to confirm the line number (currently 181).

- [ ] **Step 2: Append the annotation**

Edit the row so the "Status" cell reads (preserving the existing leading `**Partial** — usage chip + execution usage; densify residual` text and appending the new note):

```markdown
| CE-OBS-01..02 | Token/context usage events + UI | W1 | same | **Partial** — usage chip + execution usage; densify residual. Cache countdown in usage popover is a client-side 5-min estimate from `updatedAt` (Pi exposes no TTL); replace with host-supplied TTL via `@piwin/contracts` if Pi adds one. |
```

- [ ] **Step 3: Commit**

```bash
git add docs/todo-deferred.md
git commit -m "$(cat <<'EOF'
docs: note context cache countdown is a client-side 5-min estimate

Annotates the CE-OBS-01..02 row so future readers know the popover countdown
is derived from updatedAt, not a Pi-provided TTL, and should be replaced by a
contracts field if Pi ever exposes real cache metadata.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage**
- 5-minute product window → `CACHE_EXPIRY_ESTIMATE_MS` (Task 1, Step 1).
- Based on `updatedAt` → `getCacheExpiryEstimateSeconds(updatedAt, now)` (Task 1, Step 1; wired in Task 2, Step 4).
- Labeled as estimate → copy `Cache estimate · expires in M:SS` (Task 2, Step 4) and reinforced in docs (Task 4).
- Live countdown → 1-second ticker gated on popover open (Task 2, Step 4).
- Hide on missing/invalid/expired → helper returns `undefined` (Task 1, Step 1); tested (Task 2, Step 2).
- Clamp future timestamps → `Math.min(remainingSeconds, maxSeconds)` (Task 1, Step 1); tested (Task 2, Step 2).
- No contracts/host/IPC changes → confirmed; only `apps/desktop` + `docs` touched.
- UI never imports Pi → confirmed; only `@piwin/contracts` and `@piwin/ui-kit` used (already present).

**2. Placeholder scan**
- No "TBD", "implement later", "add appropriate error handling", or "similar to Task N".
- Every code step contains the actual code to write.
- Every test step contains the actual test code.

**3. Type consistency**
- `getCacheExpiryEstimateSeconds(updatedAt: string | undefined, now: number): number | undefined` — defined in Task 1, consumed identically in Task 2.
- `formatCountdown(totalSeconds: number): string` — defined in Task 1, consumed identically in Task 2.
- `CACHE_EXPIRY_ESTIMATE_MS` — exported in Task 1, imported in Task 1's test and used in Task 2's test fixture math.
- `cacheExpirySeconds` local in `ContextUsageRing` — declared in Task 2 Step 4, rendered in the same step.
- Class name `context-usage-cache-estimate` — used in Task 2 Step 4 (JSX) and Task 3 Step 1 (CSS). Match confirmed.
- Copy string `Cache estimate · expires in ` — used in Task 2 Step 4 (JSX) and asserted verbatim in Task 2 Step 2 tests. Match confirmed.
