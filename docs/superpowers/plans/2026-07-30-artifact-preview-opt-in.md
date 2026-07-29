# Artifact Preview Opt-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the heavy HTML Artifact path opt-in on Desktop — default chat renders ordinary Markdown + code fences; a single Appearance toggle enables per-fence `Preview artifact`; flashcards keep a one-click Preview card even when the global toggle is off.

**Architecture:** A new Desktop preference `artifactPreviewEnabled` (localStorage, default `false`) gates the heavy `@piwin/artifact` path in `MarkdownView`. The parser flag `htmlUiModeEnabled` is set to the capability value so `evaluateCodeFence` still runs (preserving language/source normalization) but native `html` fences fall through to `code` when capability is off. `maxBytes` is plumbed from `PiwinConfig.artifact` (already in App state via `use-host-bootstrap`) into evaluate. A new pure helper `isFlashcardArtifactSource` detects `data-card-id` and unlocks a per-fence Preview card without flipping the global preference. Host default `htmlUiModeDefault` is lowered from `true` to `false` for consistency.

**Tech Stack:** TypeScript (strict, ESM, NodeNext), React 18, Vitest + happy-dom, `@piwin/artifact`, `@piwin/contracts`, `@piwin/ui-kit`.

**Spec:** `docs/superpowers/specs/2026-07-30-artifact-preview-opt-in-design.md`

## Global Constraints

- TypeScript strict mode; no `any`; no non-null assertion without runtime check.
- ESM only; relative imports use `.js` extensions for NodeNext (Desktop app uses Vite/bundler — `.ts`/no-extension is fine within `apps/desktop/src`).
- `@piwin/artifact` runtime modules must NOT be modified (per spec §9 "Do not change").
- No new dependencies.
- Tests: Vitest with `happy-dom`; colocated `foo.test.ts(x)` next to `foo.ts(x)`.
- UI copy is bilingual EN/ZH per existing Appearance page pattern.
- `data-card-id` detection is a hint only — action validation in `ArtifactFrame` is the security boundary (spec §6, §11).
- Commits: small, by concern; use the repo's `Generated with [Devin]` trailer format.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `apps/desktop/src/ui-preferences.ts` | Add `artifactPreviewEnabled` field + storage key + load/save | Modify |
| `apps/desktop/src/ui-preferences.test.ts` | Round-trip + default-false coverage | Modify |
| `apps/desktop/src/flashcard-artifact.ts` | Pure `isFlashcardArtifactSource(source)` helper | Create |
| `apps/desktop/src/flashcard-artifact.test.ts` | Helper unit tests (positive, negative, comment edge) | Create |
| `apps/desktop/src/MarkdownView.tsx` | Implement §7 policy: capability gate, flashcard exception, `maxBytes` wiring, `htmlUiModeEnabled=capability` | Modify |
| `apps/desktop/src/MarkdownView.test.tsx` | Policy tests (capability on/off, streaming, flashcard, byte-stability, mermaid) | Create |
| `apps/desktop/src/chat-thread.tsx` | Add `artifactPreviewEnabled`, `artifactMaxBytes` props; plumb to `MarkdownView` | Modify |
| `apps/desktop/src/App.tsx` | Pass `preferences.artifactPreviewEnabled` + `config?.artifact?.maxBytes` to `ChatThread` | Modify |
| `apps/desktop/src/settings/pages/appearance-page.tsx` | Add Artifact preview switch + EN/ZH copy; include in reset-to-defaults | Modify |
| `apps/desktop/src/host-client-mock.ts` | Change mock `htmlUiModeDefault` to `false` | Modify |
| `packages/agent-host/src/config-store.ts` | Change `defaults.artifact.htmlUiModeDefault` to `false` | Modify |
| `packages/agent-host/src/config-store.test.ts` | Update default assertion if present | Modify (verify) |
| `docs/adr/0005-artifact-and-media.md` | Amendment bullet for opt-in default + host default lowered | Modify |
| `docs/todo-deferred.md` | Note light fence registry / AR-07/08 still deferred | Modify (if exists) |

---

## Task 1: `artifactPreviewEnabled` preference

**Files:**
- Modify: `apps/desktop/src/ui-preferences.ts`
- Modify: `apps/desktop/src/ui-preferences.test.ts`

**Interfaces:**
- Produces: `DesktopPreferences.artifactPreviewEnabled: boolean` (default `false`); storage key `piwin.desktop.artifactPreviewEnabled`; parsed via `readBool`-style helper.

- [ ] **Step 1: Write the failing tests**

Add to `apps/desktop/src/ui-preferences.test.ts`. Update the two existing `toEqual<DesktopPreferences>({...})` blocks (lines ~54-60 and ~156-162) to include `artifactPreviewEnabled: false`, then add a new describe block:

```ts
describe('artifactPreviewEnabled', () => {
  beforeEach(() => {
    clearLocalStorage();
  });

  it('defaults to false when key missing', () => {
    expect(loadDesktopPreferences().artifactPreviewEnabled).toBe(false);
  });

  it('reads true from localStorage', () => {
    setLocalStorage('artifactPreviewEnabled', 'true');
    expect(loadDesktopPreferences().artifactPreviewEnabled).toBe(true);
  });

  it('reads false from localStorage', () => {
    setLocalStorage('artifactPreviewEnabled', 'false');
    expect(loadDesktopPreferences().artifactPreviewEnabled).toBe(false);
  });

  it('falls back to false on invalid value', () => {
    setLocalStorage('artifactPreviewEnabled', 'maybe');
    expect(loadDesktopPreferences().artifactPreviewEnabled).toBe(false);
  });

  it('roundtrips true through save/load', () => {
    saveDesktopPreferences({
      assistantTextSize: 'default',
      codeTextSize: 'default',
      codeWrap: false,
      toolDensity: 'comfortable',
      workDetailsExpanded: 'auto',
      artifactPreviewEnabled: true,
    });
    expect(loadDesktopPreferences().artifactPreviewEnabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @piwin/desktop test -- src/ui-preferences.test.ts`
Expected: FAIL — `artifactPreviewEnabled` does not exist on type / is `undefined`.

- [ ] **Step 3: Implement the preference**

In `apps/desktop/src/ui-preferences.ts`:

1. Add to `DesktopPreferences` type (after `workDetailsExpanded`):
```ts
  /**
   * When false (default), chat never offers the heavy Artifact iframe path
   * except the flashcard exception (design §6). Markdown + ordinary code only.
   */
  artifactPreviewEnabled: boolean;
```

2. Add the storage key constant (after `WORK_DETAILS_EXPANDED_KEY`):
```ts
const ARTIFACT_PREVIEW_KEY = 'piwin.desktop.artifactPreviewEnabled';
```

3. Add a parser helper (after `parseToolCallDensity`):
```ts
function parseBoolean(raw: string | null, fallback: boolean): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
}
```

4. In `loadDesktopPreferences`, add to the returned object:
```ts
    artifactPreviewEnabled: parseBoolean(readString(ARTIFACT_PREVIEW_KEY), false),
```

5. In `saveDesktopPreferences`, add:
```ts
  writeString(ARTIFACT_PREVIEW_KEY, String(prefs.artifactPreviewEnabled));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @piwin/desktop test -- src/ui-preferences.test.ts`
Expected: PASS (all tests including the two updated `toEqual` blocks).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/ui-preferences.ts apps/desktop/src/ui-preferences.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop): add artifactPreviewEnabled preference (default false)

Markdown-first product default; heavy Artifact path will be gated by this
preference in MarkdownView. Storage key piwin.desktop.artifactPreviewEnabled.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

## Task 2: `isFlashcardArtifactSource` helper

**Files:**
- Create: `apps/desktop/src/flashcard-artifact.ts`
- Create: `apps/desktop/src/flashcard-artifact.test.ts`

**Interfaces:**
- Produces: `isFlashcardArtifactSource(source: string): boolean` — true iff source contains a `data-card-id="..."` attribute. Pure, no DOM.

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/flashcard-artifact.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isFlashcardArtifactSource } from './flashcard-artifact';

describe('isFlashcardArtifactSource', () => {
  it('returns true for source containing data-card-id', () => {
    const source = `<div class="piwin-flashcard" data-card-id="card-abc12345-xyz"></div>`;
    expect(isFlashcardArtifactSource(source)).toBe(true);
  });

  it('returns false for plain html without data-card-id', () => {
    const source = `<div><h1>Hello</h1></div>`;
    expect(isFlashcardArtifactSource(source)).toBe(false);
  });

  it('returns false for empty source', () => {
    expect(isFlashcardArtifactSource('')).toBe(false);
  });

  it('returns true even when data-card-id is inside an HTML comment', () => {
    // The helper is a hint-only affordance; action validation in ArtifactFrame
    // is the real security boundary (design §6, §11). A commented id grants
    // only the Preview card button, no privilege.
    const source = `<!-- data-card-id="fake" --><div></div>`;
    expect(isFlashcardArtifactSource(source)).toBe(true);
  });

  it('returns false for data-card-id without quotes', () => {
    const source = `<div data-card-id=card-1></div>`;
    expect(isFlashcardArtifactSource(source)).toBe(false);
  });

  it('returns true for single-quoted data-card-id', () => {
    const source = `<div data-card-id='card-1'></div>`;
    expect(isFlashcardArtifactSource(source)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @piwin/desktop test -- src/flashcard-artifact.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `apps/desktop/src/flashcard-artifact.ts`:

```ts
/**
 * Hint-only detection of flashcard artifact fences.
 *
 * A fence is treated as a flashcard artifact when its source contains a
 * `data-card-id="..."` (or single-quoted) attribute. This unlocks the
 * per-fence Preview card affordance (design §6) when the global
 * `artifactPreviewEnabled` preference is off.
 *
 * This is NOT a security boundary. Action validation in `ArtifactFrame`
 * requires the real `data-card-id="${cardId}"` substring to be present in
 * the actual (non-commented) source and the action name to be whitelisted
 * (design §11). A forged match only grants a Preview button, not privilege.
 */
export function isFlashcardArtifactSource(source: string): boolean {
  return /data-card-id=(?:"[^"]+"|'[^']+')/.test(source);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @piwin/desktop test -- src/flashcard-artifact.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/flashcard-artifact.ts apps/desktop/src/flashcard-artifact.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop): add isFlashcardArtifactSource hint helper

Pure regex detector for data-card-id attribute. Unlocks per-fence Preview
card affordance when global Artifact preview is off. Hint-only; action
validation in ArtifactFrame remains the security boundary.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

## Task 3: `MarkdownView` rendering policy

**Files:**
- Modify: `apps/desktop/src/MarkdownView.tsx`
- Create: `apps/desktop/src/MarkdownView.test.tsx`

**Interfaces:**
- Consumes: `isFlashcardArtifactSource` from `./flashcard-artifact` (Task 2).
- Produces: `MarkdownView` accepts new optional props `artifactPreviewEnabled?: boolean` (default `false`) and `artifactMaxBytes?: number`. When `artifactPreviewEnabled` is false, native `html`/`htm` fences render as ordinary code; flashcard fences show a Preview card; no iframe mounts. When true, behavior matches today (source-first + Preview toggle).

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/MarkdownView.test.tsx`:

```ts
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MarkdownView } from './MarkdownView';

const ARTIFACT_HTML_FENCE = '```artifact-html\n<div><h1>Hi</h1></div>\n```';
const PLAIN_HTML_FENCE = '```html\n<div><p>Hello</p></div>\n```';
const FLASHCARD_FENCE =
  '```html\n<div class="piwin-flashcard" data-card-id="card-abc12345-xyz"></div>\n```';
const MERMAID_FENCE = '```mermaid\ngraph TD\nA-->B\n```';

describe('MarkdownView artifact preview policy', () => {
  it('capability off: artifact-html fence shows no Preview toggle', () => {
    render(<MarkdownView text={ARTIFACT_HTML_FENCE} renderingPhase="completed" />);
    expect(screen.queryByTestId('artifact-preview-toggle')).toBeNull();
    expect(screen.getByTestId('code-fence-source')).toBeTruthy();
  });

  it('capability off: plain html fence renders as ordinary code, no Preview', () => {
    render(<MarkdownView text={PLAIN_HTML_FENCE} renderingPhase="completed" />);
    expect(screen.queryByTestId('artifact-preview-toggle')).toBeNull();
    expect(screen.getByTestId('code-fence-source')).toBeTruthy();
  });

  it('capability on: artifact-html fence shows Preview toggle', () => {
    render(
      <MarkdownView
        text={ARTIFACT_HTML_FENCE}
        renderingPhase="completed"
        artifactPreviewEnabled
      />,
    );
    expect(screen.getByTestId('artifact-preview-toggle')).toBeTruthy();
  });

  it('capability on: plain html fence shows Preview toggle (promoted by parser)', () => {
    render(
      <MarkdownView
        text={PLAIN_HTML_FENCE}
        renderingPhase="completed"
        artifactPreviewEnabled
      />,
    );
    expect(screen.getByTestId('artifact-preview-toggle')).toBeTruthy();
  });

  it('streaming: never mounts ArtifactFrame even when capability on', () => {
    render(
      <MarkdownView
        text={ARTIFACT_HTML_FENCE}
        renderingPhase="streaming"
        artifactPreviewEnabled
      />,
    );
    expect(screen.queryByTestId('artifact-preview-toggle')).toBeNull();
    expect(screen.getByTestId('code-fence-streaming')).toBeTruthy();
  });

  it('capability off + flashcard source: shows Preview card affordance', () => {
    render(<MarkdownView text={FLASHCARD_FENCE} renderingPhase="completed" />);
    expect(screen.getByTestId('flashcard-preview-card')).toBeTruthy();
  });

  it('capability on + flashcard source: shows standard Preview toggle', () => {
    render(
      <MarkdownView
        text={FLASHCARD_FENCE}
        renderingPhase="completed"
        artifactPreviewEnabled
      />,
    );
    expect(screen.getByTestId('artifact-preview-toggle')).toBeTruthy();
  });

  it('mermaid still renders when capability off', () => {
    render(<MarkdownView text={MERMAID_FENCE} renderingPhase="completed" />);
    // MermaidBlock renders an svg or container; the streaming source fallback
    // testid must NOT be present.
    expect(screen.queryByTestId('mermaid-stream-source')).toBeNull();
  });

  it('byte-stability: artifact-html fence language label is identical in both modes', () => {
    const { rerender } = render(
      <MarkdownView text={ARTIFACT_HTML_FENCE} renderingPhase="completed" />,
    );
    const offLang = screen.getByTestId('code-fence-source').querySelector('.md-code-lang');
    const offText = offLang?.textContent ?? '';

    rerender(
      <MarkdownView
        text={ARTIFACT_HTML_FENCE}
        renderingPhase="completed"
        artifactPreviewEnabled
      />,
    );
    // When capability on and the fence is a render candidate, the source
    // block also carries a language label inside artifact-with-source.
    const onLang = document.querySelector('.artifact-with-source .md-code-lang');
    const onText = onLang?.textContent ?? '';

    // Both should normalize to the same language label (evaluate normalizes
    // artifact-html -> html). The exact label is whatever evaluate yields;
    // the invariant is equality across modes.
    expect(onText).toBe(offText);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @piwin/desktop test -- src/MarkdownView.test.tsx`
Expected: FAIL — `@testing-library/react` may need setup; if not installed, fall back to `vitest`'s `render` via `happy-dom` + direct `screen` queries. First run will fail because `artifactPreviewEnabled` prop is ignored and `flashcard-preview-card` testid does not exist.

**Note on testing-library:** Check `apps/desktop/package.json` devDependencies. If `@testing-library/react` is NOT present, do NOT add it (no new deps). Instead use `react-dom/test-utils` or direct DOM queries against `render`'s container. Inspect an existing `.test.tsx` in the repo (e.g. `apps/desktop/src/settings/settings-shell.test.tsx`) for the established pattern and mirror it. Adjust the test imports accordingly before re-running.

- [ ] **Step 3: Inspect existing test pattern and adjust imports**

Run: `grep -l "render(" apps/desktop/src/**/*.test.tsx | head -3` then read one to confirm the render helper. Update the test file's import to match the repo convention. Re-run the test to confirm it now fails on the assertion (not the import).

- [ ] **Step 4: Implement the policy in `MarkdownView.tsx`**

Open `apps/desktop/src/MarkdownView.tsx`. Apply these changes:

1. Add import at top (after the `@piwin/artifact` import block):
```ts
import { isFlashcardArtifactSource } from './flashcard-artifact';
```

2. Extend `MarkdownViewProps` (add after `onArtifactAction?`):
```ts
  /**
   * When false (default), the heavy Artifact iframe path is not offered.
   * Native html/htm fences render as ordinary code; flashcard fences get a
   * one-click Preview card (design §6). Mermaid/math are unaffected.
   */
  artifactPreviewEnabled?: boolean;
  /** Security byte cap forwarded to evaluateCodeFence when heavy path runs. */
  artifactMaxBytes?: number;
```

3. In the `MarkdownView` function signature, destructure the new props with defaults:
```ts
export function MarkdownView({
  text,
  htmlUiModeEnabled,
  streamComplete = true,
  renderingPhase,
  artifactTheme,
  initPriorityBase = 0,
  artifactThemeKey = 'default',
  onArtifactAction,
  artifactPreviewEnabled = false,
  artifactMaxBytes,
}: MarkdownViewProps): ReactElement {
```

4. **Remove the `htmlUiModeEnabled = true` default** — it is now derived from capability. Change the signature so `htmlUiModeEnabled` has no default (it is computed below). Concretely, replace the `htmlUiModeEnabled = true,` line in the destructure with nothing, and add after the `phase` computation:
```ts
  const phase: MarkdownRenderingPhase =
    renderingPhase ?? (streamComplete ? 'completed' : 'streaming');
  const streamMode = phase === 'streaming';
  // Parser flag mirrors the product capability: when off, native html/htm
  // fences fall through to `code` in evaluate (byte-stable normalization).
  const effectiveHtmlUiMode = htmlUiModeEnabled ?? artifactPreviewEnabled;
```

5. Update the `normalizeStreamingArtifactFences` call to use `effectiveHtmlUiMode`:
```ts
  const normalized = normalizeStreamingArtifactFences(
    text,
    effectiveHtmlUiMode,
    !streamMode,
  );
```

6. In the `fenceProps` object literal, replace `htmlUiModeEnabled,` with `htmlUiModeEnabled: effectiveHtmlUiMode,` and add the two new fields:
```ts
          const fenceProps: {
            language: string;
            source: string;
            htmlUiModeEnabled: boolean;
            fenceIndex: number;
            renderingPhase: MarkdownRenderingPhase;
            initPriority: number;
            artifactThemeKey: string;
            artifactTheme?: ArtifactThemeVariables;
            onArtifactAction?: (action: ArtifactActionMessage) => void;
            artifactPreviewEnabled: boolean;
            artifactMaxBytes?: number;
          } = {
            language: block.language,
            source: block.source,
            htmlUiModeEnabled: effectiveHtmlUiMode,
            fenceIndex: index,
            renderingPhase: phase,
            initPriority: initPriorityBase + index,
            artifactThemeKey,
            artifactPreviewEnabled,
          };
          if (artifactMaxBytes !== undefined) {
            fenceProps.artifactMaxBytes = artifactMaxBytes;
          }
```

7. Extend the `CodeFenceView` props type:
```ts
function CodeFenceView(props: {
  language: string;
  source: string;
  htmlUiModeEnabled: boolean;
  fenceIndex: number;
  renderingPhase: MarkdownRenderingPhase;
  artifactTheme?: ArtifactThemeVariables;
  initPriority: number;
  artifactThemeKey?: string;
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  artifactPreviewEnabled: boolean;
  artifactMaxBytes?: number;
}): ReactElement {
```

8. Inside `CodeFenceView`, after the mermaid/math/streaming early returns, add the capability gate. Replace the existing `evaluateOptions` + `decision` block (lines ~176-187) with:
```ts
  const evaluateOptions: Parameters<typeof evaluateCodeFence>[0] = {
    language: props.language,
    source: props.source,
    id: `fence-${props.fenceIndex}`,
    htmlUiModeEnabled: props.htmlUiModeEnabled,
    mode: 'interactive',
  };
  if (props.artifactMaxBytes !== undefined) {
    evaluateOptions.maxBytes = props.artifactMaxBytes;
  }
  if (props.artifactTheme) {
    evaluateOptions.theme = props.artifactTheme;
  }

  const decision: ArtifactPreviewDecision = evaluateCodeFence(evaluateOptions);
  const isFlashcard = isFlashcardArtifactSource(props.source);
```

9. Replace the `if (decision.kind === 'render' || decision.kind === 'blocked' || decision.kind === 'preparing')` block with the capability-aware version:
```ts
  // Flashcard exception (design §6): when capability is off but the source
  // carries a data-card-id, offer a one-click Preview card that temporarily
  // mounts the heavy path for this fence only — without flipping the global
  // preference.
  if (!props.artifactPreviewEnabled && isFlashcard) {
    return (
      <FlashcardPreviewCard
        language={props.language}
        source={props.source}
        artifactTheme={props.artifactTheme}
        artifactThemeKey={props.artifactThemeKey}
        initPriority={props.initPriority}
        artifactMaxBytes={props.artifactMaxBytes}
        {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
      />
    );
  }

  if (
    decision.kind === 'render' ||
    decision.kind === 'blocked' ||
    decision.kind === 'preparing'
  ) {
    // When capability is off, evaluate returned `code` for native html (because
    // htmlUiModeEnabled=false). Explicit artifact-* descriptors still parse,
    // but we must NOT offer the heavy path. Render as ordinary code.
    if (!props.artifactPreviewEnabled) {
      return (
        <div className="md-code-block" data-testid="code-fence-source">
          <div className="md-code-header">
            <span className="md-code-lang muted">{decision.language || 'code'}</span>
            <CopyCodeButton text={decision.source} />
          </div>
          <pre className="md-code">
            <code data-language={decision.language || undefined}>{decision.source}</code>
          </pre>
        </div>
      );
    }
    return (
      <div className="artifact-with-source">
        <div className="md-code-block">
          <div className="md-code-header">
            <span className="md-code-lang muted">{props.language || 'html'}</span>
            <div className="md-code-header-actions">
              <CopyCodeButton text={props.source} />
              {decision.kind === 'render' || decision.kind === 'preparing' ? (
                <Button
                  size="compact"
                  data-testid="artifact-preview-toggle"
                  aria-expanded={artifactPreviewOpen}
                  onClick={() => setArtifactPreviewOpen((previous) => !previous)}
                >
                  {artifactPreviewOpen ? 'Hide preview' : 'Preview artifact'}
                </Button>
              ) : null}
            </div>
          </div>
          <pre className="md-code">
            <code data-language={props.language || undefined}>{props.source}</code>
          </pre>
        </div>
        {decision.kind === 'blocked' ? (
          <div className="artifact-blocked muted" data-testid="artifact-blocked" role="status">
            Artifact blocked
            {`: ${decision.reason}`}
          </div>
        ) : null}
        {artifactPreviewOpen &&
        (decision.kind === 'render' || decision.kind === 'preparing') ? (
          <ArtifactFrame
            key={`${props.artifactThemeKey ?? 'default'}:${decision.descriptor.id}`}
            decision={decision}
            initPriority={props.initPriority}
            {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
          />
        ) : null}
      </div>
    );
  }
```

10. Add the `FlashcardPreviewCard` component at the end of the file (before `CopyCodeButton` or after it — keep file order tidy):
```ts
/**
 * Per-fence flashcard Preview card (design §6). Shown when global
 * artifactPreviewEnabled is off but the fence source contains a data-card-id.
 * Mounts the heavy path for this fence only; does not flip the global
 * preference.
 */
function FlashcardPreviewCard(props: {
  language: string;
  source: string;
  artifactTheme?: ArtifactThemeVariables;
  artifactThemeKey?: string;
  initPriority: number;
  artifactMaxBytes?: number;
  onArtifactAction?: (action: ArtifactActionMessage) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div className="md-code-block" data-testid="code-fence-source">
        <div className="md-code-header">
          <span className="md-code-lang muted">{props.language || 'html'}</span>
          <div className="md-code-header-actions">
            <CopyCodeButton text={props.source} />
            <Button
              size="compact"
              data-testid="flashcard-preview-card"
              onClick={() => setOpen(true)}
            >
              Preview card
            </Button>
          </div>
        </div>
        <pre className="md-code">
          <code data-language={props.language || undefined}>{props.source}</code>
        </pre>
      </div>
    );
  }
  const evaluateOptions: Parameters<typeof evaluateCodeFence>[0] = {
    language: props.language,
    source: props.source,
    id: `flashcard-${props.initPriority}`,
    htmlUiModeEnabled: true,
    mode: 'interactive',
  };
  if (props.artifactMaxBytes !== undefined) {
    evaluateOptions.maxBytes = props.artifactMaxBytes;
  }
  if (props.artifactTheme) {
    evaluateOptions.theme = props.artifactTheme;
  }
  const decision = evaluateCodeFence(evaluateOptions);
  return (
    <div className="artifact-with-source">
      <div className="md-code-block">
        <div className="md-code-header">
          <span className="md-code-lang muted">{props.language || 'html'}</span>
          <div className="md-code-header-actions">
            <CopyCodeButton text={props.source} />
            <Button
              size="compact"
              data-testid="flashcard-preview-card"
              aria-expanded
              onClick={() => setOpen(false)}
            >
              Hide preview
            </Button>
          </div>
        </div>
        <pre className="md-code">
          <code data-language={props.language || undefined}>{props.source}</code>
        </pre>
      </div>
      {decision.kind === 'render' || decision.kind === 'preparing' ? (
        <ArtifactFrame
          key={`${props.artifactThemeKey ?? 'default'}:${decision.descriptor.id}`}
          decision={decision}
          initPriority={props.initPriority}
          {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
        />
      ) : decision.kind === 'blocked' ? (
        <div className="artifact-blocked muted" data-testid="artifact-blocked" role="status">
          Artifact blocked{`: ${decision.reason}`}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @piwin/desktop test -- src/MarkdownView.test.tsx`
Expected: PASS. If `byte-stability` test fails on the language label, inspect what `decision.language` yields for `artifact-html` and adjust the assertion to compare the normalized label (the invariant is equality across modes, not a specific string). If `mermaid` test fails because `MermaidBlock` requires async rendering, relax to assert the streaming-source fallback is absent and a mermaid container element exists.

- [ ] **Step 6: Run the full desktop test suite**

Run: `pnpm --filter @piwin/desktop test`
Expected: PASS (all pre-existing tests still green — the new prop defaults preserve old behavior for callers that don't pass it, EXCEPT the default of `htmlUiModeEnabled` which now follows `artifactPreviewEnabled` defaulting to false).

**Important:** Existing callers of `MarkdownView` (e.g. `chat-thread.tsx`) do not pass `artifactPreviewEnabled`, so it defaults to `false`. This means native `html` fences will stop showing Preview until Task 5 wires the preference through. This is the intended product default. Any existing test that asserts a Preview toggle on a plain `html` fence WITHOUT passing `artifactPreviewEnabled` will now fail — update those tests to pass `artifactPreviewEnabled` explicitly (they are testing the capability-on path). Search: `grep -rn "artifact-preview-toggle" apps/desktop/src`.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/MarkdownView.tsx apps/desktop/src/MarkdownView.test.tsx
git commit -m "$(cat <<'EOF'
feat(desktop): gate heavy Artifact path behind artifactPreviewEnabled

MarkdownView now defaults to Markdown + ordinary code fences. Native
html/htm fences fall through to `code` via evaluate (htmlUiModeEnabled
mirrors capability) so language/source normalization stays byte-stable.
Flashcard fences (data-card-id) get a one-click Preview card without
flipping the global preference. maxBytes is forwarded to evaluate.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

## Task 4: Appearance page switch

**Files:**
- Modify: `apps/desktop/src/settings/pages/appearance-page.tsx`

**Interfaces:**
- Consumes: `DesktopPreferences.artifactPreviewEnabled` from Task 1; `updatePreference` helper already in the file.
- Produces: a `Switch` bound to `preferences.artifactPreviewEnabled`; included in the reset-to-defaults button.

- [ ] **Step 1: Add the switch**

In `apps/desktop/src/settings/pages/appearance-page.tsx`, insert a new `FieldRow` block immediately BEFORE the "Work details default" `FieldRow` (so it sits next to code wrap, which is thematically adjacent):

```tsx
        {/* Artifact preview toggle */}
        <FieldRow
          label={locale === 'zh-CN' ? 'Artifact 预览' : 'Artifact preview'}
          description={
            locale === 'zh-CN'
              ? '允许对 artifact 代码块做沙箱 HTML 预览。关闭后仅 Markdown 与源码。'
              : 'Allow sandboxed HTML UI previews for artifact fences. Off = Markdown and code only.'
          }
        >
          <Switch
            checked={preferences.artifactPreviewEnabled}
            onCheckedChange={(checked) => {
              updatePreference(preferences, 'artifactPreviewEnabled', checked, onPreferencesChange);
            }}
            aria-label={locale === 'zh-CN' ? 'Artifact 预览' : 'Artifact preview'}
          />
        </FieldRow>
```

- [ ] **Step 2: Update reset-to-defaults**

In the same file, find the `reset-typography-defaults` button's `defaults` object (around line 125-131) and add `artifactPreviewEnabled: false`:

```tsx
              const defaults: DesktopPreferences = {
                assistantTextSize: 'default',
                codeTextSize: 'default',
                codeWrap: false,
                toolDensity: 'comfortable',
                workDetailsExpanded: 'auto',
                artifactPreviewEnabled: false,
              };
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @piwin/desktop typecheck`
Expected: PASS (the `DesktopPreferences` type now includes `artifactPreviewEnabled` from Task 1).

- [ ] **Step 4: Run desktop tests**

Run: `pnpm --filter @piwin/desktop test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/settings/pages/appearance-page.tsx
git commit -m "$(cat <<'EOF'
feat(desktop): add Artifact preview switch to Appearance settings

Single user-visible control for the heavy Artifact capability. Default
off; included in reset-to-defaults. Bilingual EN/ZH copy.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

## Task 5: Plumb preference + maxBytes from App → ChatThread → MarkdownView

**Files:**
- Modify: `apps/desktop/src/chat-thread.tsx`
- Modify: `apps/desktop/src/App.tsx`

**Interfaces:**
- Consumes: `DesktopPreferences.artifactPreviewEnabled` (App already holds `preferences` state); `PiwinConfig.artifact.maxBytes` (App already holds `config` state via `use-host-bootstrap`).
- Produces: `ChatThreadProps.artifactPreviewEnabled?: boolean`; `ChatThreadProps.artifactMaxBytes?: number`; both forwarded to `MarkdownView`.

- [ ] **Step 1: Extend `ChatThreadProps`**

In `apps/desktop/src/chat-thread.tsx`, add to `ChatThreadProps` (after `onArtifactAction?`):

```ts
  /** When false (default), MarkdownView hides the heavy Artifact path. */
  artifactPreviewEnabled?: boolean;
  /** Security byte cap forwarded to evaluateCodeFence. */
  artifactMaxBytes?: number;
```

- [ ] **Step 2: Forward props to `MarkdownView`**

In the same file, in the `<MarkdownView ... />` JSX (around line 350-361), add the two new props:

```tsx
          <MarkdownView
            text={message.text}
            renderingPhase={resolveAssistantRenderingPhase(
              message,
              props.runRecordsById,
              props.activeRunId,
            )}
            artifactTheme={mapThemeToArtifactVariables(props.activeTheme)}
            initPriorityBase={props.messageIndex * 10}
            artifactThemeKey={`${props.activeTheme?.id ?? 'none'}:${props.artifactThemeKey}`}
            {...(props.artifactPreviewEnabled ? { artifactPreviewEnabled: true } : {})}
            {...(props.artifactMaxBytes !== undefined ? { artifactMaxBytes: props.artifactMaxBytes } : {})}
            {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
          />
```

- [ ] **Step 3: Pass props from `App.tsx`**

In `apps/desktop/src/App.tsx`, find the `<ChatThread ... />` JSX (around line 1215-1234) and add the two new props. `config` is the `PiwinConfig | null` state from `use-host-bootstrap`; `preferences` is the `DesktopPreferences` state:

```tsx
                  <ChatThread
                    messages={state.messages}
                    streaming={state.streaming}
                    editingMessageId={editingMessageId}
                    lastUserMessageId={lastUserMessageId}
                    activeTheme={activeTheme}
                    artifactThemeKey={artifactThemeKey}
                    runRecordsById={state.runRecordsById}
                    activeRunId={state.activeRunId}
                    permissionPrompt={state.permissionPrompt}
                    workDetailsExpanded={preferences.workDetailsExpanded}
                    toolDensity={preferences.toolDensity}
                    artifactPreviewEnabled={preferences.artifactPreviewEnabled}
                    {...(config?.artifact?.maxBytes !== undefined
                      ? { artifactMaxBytes: config.artifact.maxBytes }
                      : {})}
                    locale={desktopLocale}
                    onOpenSubagentSession={handleOpenSubagentSession}
                    onEdit={setEditingMessageId}
                    onCancelEdit={handleCancelMessageEdit}
                    onEditResend={handleEditAndResendMessage}
                    onRetry={handleRetryMessage}
                    onFeedback={handleMessageFeedback}
                    onArtifactAction={handleArtifactAction}
                    // ...remaining existing props unchanged
                  />
```

Preserve all existing props that follow `onArtifactAction` in the original JSX — only insert the two new lines, do not remove anything.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @piwin/desktop typecheck`
Expected: PASS.

- [ ] **Step 5: Run desktop tests**

Run: `pnpm --filter @piwin/desktop test`
Expected: PASS. If any snapshot/structural test on `ChatThread` or `App` breaks because `artifactPreviewEnabled` now flows through, update the test fixture to set the preference explicitly.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/chat-thread.tsx apps/desktop/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(desktop): wire artifactPreviewEnabled + maxBytes into chat

App passes preferences.artifactPreviewEnabled and config.artifact.maxBytes
through ChatThread into MarkdownView. No new IPC; both values are already
in App state (use-host-bootstrap for config, localStorage for preferences).

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

## Task 6: Lower host `htmlUiModeDefault` to `false`

**Files:**
- Modify: `packages/agent-host/src/config-store.ts`
- Modify: `apps/desktop/src/host-client-mock.ts`
- Verify: `packages/agent-host/src/config-store.test.ts` (update if it asserts the old default)

**Interfaces:**
- Produces: `defaults.artifact.htmlUiModeDefault === false` in the host config store; mock matches.

- [ ] **Step 1: Find existing assertions**

Run: `grep -n "htmlUiModeDefault" packages/agent-host/src/config-store.test.ts apps/desktop/src/settings/settings-shell.test.tsx`
Note any line that asserts `true` so it can be updated.

- [ ] **Step 2: Update the host default**

In `packages/agent-host/src/config-store.ts`, change line ~46:

```ts
    artifact: {
      maxBytes: 100 * 1024,
      htmlUiModeDefault: false,
    },
```

- [ ] **Step 3: Update the Desktop mock**

In `apps/desktop/src/host-client-mock.ts`, change line ~72:

```ts
    artifact: { maxBytes: 100 * 1024, htmlUiModeDefault: false },
```

- [ ] **Step 4: Update any test that asserted the old default**

For each line found in Step 1 that asserts `htmlUiModeDefault: true`, change it to `false`. (The `settings-shell.test.tsx:173` already uses `false` — leave it.)

- [ ] **Step 5: Run agent-host + desktop tests**

Run: `pnpm --filter @piwin/agent-host test -- src/config-store.test.ts && pnpm --filter @piwin/desktop test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-host/src/config-store.ts apps/desktop/src/host-client-mock.ts packages/agent-host/src/config-store.test.ts
git commit -m "$(cat <<'EOF'
chore(host): lower htmlUiModeDefault to false

Aligns the host config default with the Markdown-first product intent
(design §5.2). Desktop v1 ignores this field (R1) but the default is now
consistent for any non-Desktop client that chooses to honor it.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

## Task 7: ADR 0005 amendment + deferred notes

**Files:**
- Modify: `docs/adr/0005-artifact-and-media.md`
- Modify: `docs/todo-deferred.md` (if it exists; else skip the second edit)

- [ ] **Step 1: Check for deferred doc**

Run: `ls docs/todo-deferred.md 2>/dev/null || echo "missing"`

- [ ] **Step 2: Amend ADR 0005**

In `docs/adr/0005-artifact-and-media.md`, append a new amendment block at the end of the file:

```markdown

## Amendment (2026-07-30): Artifact preview opt-in on Desktop

- Desktop chat now defaults to **Markdown + ordinary code fences**. The heavy
  HTML Artifact path (sandbox iframe + bridge) is **opt-in** via a single
  Appearance preference `artifactPreviewEnabled` (default `false`,
  localStorage `piwin.desktop.artifactPreviewEnabled`).
- When the preference is off, `evaluateCodeFence` still runs with
  `htmlUiModeEnabled: false` so language/source normalization stays
  byte-stable; native `html`/`htm` fences fall through to `code`. No Preview
  button, no iframe.
- When the preference is on, the existing source-first + per-fence
  `Preview artifact` behavior is preserved. Streaming remains source-only.
- **Flashcard exception:** a fence whose source contains `data-card-id="..."`
  gets a one-click **Preview card** even when the global preference is off,
  so interactive rating stays usable without hunting settings. This does
  not flip the global preference.
- Host config `artifact.htmlUiModeDefault` default lowered from `true` to
  `false` for consistency. Desktop v1 ignores it (R1); the field remains as
  a backward-compat seed for non-Desktop clients.
- `artifact.maxBytes` is now wired from `PiwinConfig.artifact` into
  `evaluateCodeFence` on Desktop.
- Future Cherry-style **light** fence renderers (svg, html-preview, …) are
  reserved for a separate fence registry and are NOT gated by this switch.
- See `docs/superpowers/specs/2026-07-30-artifact-preview-opt-in-design.md`
  for the full design.
```

- [ ] **Step 3: Add deferred note (if file exists)**

If `docs/todo-deferred.md` exists, append:

```markdown

- Light fence registry (svg / html-preview / Cherry-style): deferred — design
  §10 reserves the boundary; not gated by `artifactPreviewEnabled`.
- Artifact side panel / fullscreen workspace (PRD AR-07): deferred.
- Export single artifact HTML to project file (PRD AR-08): deferred.
- CLI HTML preview: deferred (NG6).
```

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0005-artifact-and-media.md docs/todo-deferred.md
git commit -m "$(cat <<'EOF'
docs(adr): amend ADR 0005 for Artifact preview opt-in

Records the Desktop opt-in default, flashcard exception, host default
lowering, maxBytes wiring, and the reserved light-fence boundary.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

## Task 8: Full verification

- [ ] **Step 1: Typecheck all touched packages**

Run: `pnpm --filter @piwin/desktop --filter @piwin/agent-host typecheck`
Expected: PASS.

- [ ] **Step 2: Run all tests**

Run: `pnpm test`
Expected: PASS (contracts, session, agent-host, desktop all green).

- [ ] **Step 3: Manual smoke (document in PR body)**

With a fresh Desktop profile (clear `piwin.desktop.artifactPreviewEnabled` from localStorage):
- [ ] Assistant ` ```html ` and ` ```artifact-html ` UI blocks render as ordinary code (Copy only); no Preview, no iframe.
- [ ] Mermaid diagram still renders.
- [ ] KaTeX math still renders.
- [ ] Enable Artifact preview in Settings → Appearance → ` ```html ` fence now shows `Preview artifact`; clicking mounts the iframe; `Hide preview` unmounts it.
- [ ] Streaming message never mounts an iframe.
- [ ] Flashcard HTML with `data-card-id`: `Preview card` button appears even with global preview off; clicking mounts the iframe and rating works; global preference stays false.
- [ ] Disabling the preference while a preview is open removes the iframe on next render.

- [ ] **Step 4: Final commit (if any smoke-fixes were needed)**

Only if Step 3 surfaced bugs. Otherwise no commit.

---

## Self-Review

**Spec coverage:**
- §3 Approach 1 → Task 3 (policy) + Task 1 (preference default false) + Task 4 (switch).
- §5.1 Desktop preference → Task 1.
- §5.2 host config + `htmlUiModeEnabled` vs `artifactPreviewEnabled` distinction → Task 3 (parser flag mirrors capability) + Task 6 (host default).
- §5.3 per-fence state + `explicit-artifact-review` inert → Task 3 (phase logic unchanged; capability gate makes it inert when off).
- §6 flashcard exception → Task 2 (helper) + Task 3 (`FlashcardPreviewCard`).
- §7 rendering policy + preprocessing → Task 3 (`normalizeStreamingArtifactFences` called with `effectiveHtmlUiMode`; evaluate always runs).
- §7.1 ordinary code fence → Task 3 (capability-off branch renders `decision.language`/`decision.source`).
- §8 data flow → Task 5 (App → ChatThread → MarkdownView).
- §9 Modify table → Tasks 1-7 cover every file listed.
- §11 edge cases → Task 3 (disable while open → next render unmounts; fake data-card-id → helper true but action validation unchanged) + Task 8 smoke.
- §12 testing plan → Task 1 (prefs), Task 2 (helper), Task 3 (MarkdownView policy incl. byte-stability case 6), Task 8 (manual smoke).
- §13 docs → Task 7.
- §14 phases → Phase A = Tasks 1,3,4,5,6; Phase B = Task 2 + flashcard parts of Task 3; Phase C = Task 7.
- §15 acceptance criteria → Task 8 smoke checklist maps 1:1.

**Placeholder scan:** No "TBD"/"implement later"/"add appropriate" found. The one conditional ("if `@testing-library/react` is not present") is a real environment check with a concrete fallback instruction, not a placeholder.

**Type consistency:**
- `artifactPreviewEnabled: boolean` — same name in `DesktopPreferences`, `MarkdownViewProps`, `ChatThreadProps`, App prop spread.
- `artifactMaxBytes?: number` — same name in `MarkdownViewProps`, `ChatThreadProps`, App prop spread.
- `isFlashcardArtifactSource(source: string): boolean` — defined Task 2, consumed Task 3.
- `FlashcardPreviewCard` — defined and used within Task 3.
- `effectiveHtmlUiMode` — internal to `MarkdownView`, not exported.
