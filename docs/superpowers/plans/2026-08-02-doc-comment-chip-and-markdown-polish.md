# Doc Comment Icon / Chip / Highlight + Walkthrough Markdown Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make right-panel document line comments visually obvious (Antigravity-style blue action button + line highlight), attach a clean Walkthrough-style chip to the composer without stuffing text into the textarea, send comments with the prompt, polish general attachment chips, and improve walkthrough markdown rendering.

**Architecture:** All changes stay in `apps/desktop`. Comment state remains desktop-local (`docComments` in `App.tsx`). On send, format comments into prompt text (no contracts/host change). Icons live in `shell-icons.tsx`; styles in `region-inspector.css` + `region-composer.css`. Markdown polish is pure CSS + parser extensions in `EnhancedMarkdownView.tsx`.

**Tech Stack:** React 19, TypeScript strict, existing `EnhancedMarkdownView`, `composer-dock`, `shell-icons`, CSS semantic tokens.

## Global Constraints

- TypeScript strict / `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` stay on.
- No `apps/desktop` imports of `@earendil-works/pi-*`.
- No contracts/host changes for comments (desktop-only → text at send time).
- No emoji in chrome UI (use SVG icons).
- Do **not** inject comment quote text into the composer textarea; chip is the sole attachment affordance.
- Colocated tests; `pnpm --filter @piwin/desktop test` + typecheck green.
- Prefer minimal diffs; do not drive-by refactor unrelated packages.

---

## File map

| File | Responsibility |
|------|----------------|
| `apps/desktop/src/shell-icons.tsx` | New/redrawn comment action icons |
| `apps/desktop/src/EnhancedMarkdownView.tsx` | Line wrapper classes for has-comment; optional MD parser polish |
| `apps/desktop/src/styles/region-inspector.css` | Comment button, line highlight, MD typography |
| `apps/desktop/src/styles/region-composer.css` | Doc-comment chip + attachment chip polish |
| `apps/desktop/src/composer-dock.tsx` | Chip markup (SVG icons, no emoji) |
| `apps/desktop/src/App.tsx` | Stop textarea injection; format comments on send; clear after send |
| `apps/desktop/src/doc-comments.ts` (new) | Pure helpers: format comments → prompt text |
| `apps/desktop/src/doc-comments.test.ts` (new) | Unit tests for format helper |
| `apps/desktop/src/composer-dock.test.tsx` | Chip render assertions |

---

## Task 1: Redraw comment icon + blue action button

**Files:**
- Modify: `apps/desktop/src/shell-icons.tsx`
- Modify: `apps/desktop/src/EnhancedMarkdownView.tsx` (icon usage)
- Modify: `apps/desktop/src/styles/region-inspector.css` (`.line-comment-btn`)

**Interfaces:**
- Produces: `IconCommentAction` (outline for hover-empty), reuse/refine `IconCommentFilled` for has-comment
- Consumes: existing `LineCommentWrapper` button

### Design (from user Image 1)

- **Button:** 26×26 rounded square (`border-radius: 7px`), solid accent blue background, white icon
- **Default (no comment):** hidden until row hover; on hover show blue filled button
- **Has comment:** always visible, same blue filled style (slightly stronger)
- **Icon glyph:** clean speech-bubble with three dots (or document-quote). Prefer a single consistent glyph for both states; filled vs outline only differs by stroke/fill weight if needed. **No emoji.**

- [ ] **Step 1: Add `IconCommentAction` in `shell-icons.tsx`**

Replace/augment the weak outline icons with a high-contrast action glyph matching Image 1 (document/comment mark suitable for a 14–15px white-on-blue button):

```tsx
/** Blue-button comment action glyph (Antigravity-style line comment). */
export function IconCommentAction(props: IconProps): ReactElement {
  return (
    <IconBase
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {/* Rounded doc / quote card */}
      <rect x="4" y="4" width="16" height="14" rx="2.5" />
      <path d="M8 9h8M8 12.5h5" />
      {/* Small tail / bubble corner */}
      <path d="M9 18v2.5L12.5 18" />
    </IconBase>
  );
}
```

If the filled-on-blue look needs a solid glyph, also export:

```tsx
export function IconCommentActionSolid(props: IconProps): ReactElement {
  return (
    <IconBase viewBox="0 0 24 24" fill="currentColor" stroke="none" {...props}>
      <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2h9A2.5 2.5 0 0 1 19 4.5v9A2.5 2.5 0 0 1 16.5 16H12l-3.5 3.2V16H7.5A2.5 2.5 0 0 1 5 13.5v-9Z" />
      <path d="M8.5 7.5h7M8.5 10.5h4.5" fill="none" stroke="var(--accent-contrast, #fff)" strokeWidth="1.6" strokeLinecap="round" />
    </IconBase>
  );
}
```

Prefer the stroke version with `color: #fff` on the blue button — simpler and matches Image 1.

- [ ] **Step 2: Use the new icon in `LineCommentWrapper`**

In `EnhancedMarkdownView.tsx`, import `IconCommentAction` and use it for both states (has-comment can keep a filled variant if desired):

```tsx
import { IconCommentAction } from './shell-icons';
// ...
<button
  type="button"
  className={`line-comment-btn ${hasComment ? 'has-comment' : ''}`}
  title={hasComment ? 'View comment' : 'Add comment'}
  aria-label={hasComment ? 'View comment' : 'Add comment'}
  onClick={(e) => {
    e.stopPropagation();
    handleTogglePopover();
  }}
>
  <IconCommentAction width={14} height={14} />
</button>
```

- [ ] **Step 3: Restyle `.line-comment-btn` to blue filled pill (Image 1)**

Replace the transparent muted styles in `region-inspector.css`:

```css
.line-comment-btn {
  opacity: 0;
  visibility: hidden;
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 5;
  border: none;
  width: 26px;
  height: 26px;
  padding: 0;
  border-radius: 7px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  /* Image 1: solid accent blue + white icon */
  background: var(--accent, #3b82f6);
  color: #ffffff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.18);
  transition:
    opacity 0.15s ease,
    visibility 0.15s ease,
    background-color 0.15s ease,
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.line-comment-btn:hover {
  background: color-mix(in srgb, var(--accent, #3b82f6) 88%, #000);
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.35);
}

.line-comment-btn.has-comment {
  opacity: 1;
  visibility: visible;
}

.enhanced-line-wrapper:hover > .line-comment-btn,
.enhanced-line-wrapper:hover .line-comment-btn,
.enhanced-line-wrapper.popover-open > .line-comment-btn {
  opacity: 1;
  visibility: visible;
}

/* Light theme: keep same blue (high contrast on light paper) */
[data-theme='light'] .line-comment-btn {
  background: #3b82f6;
  color: #ffffff;
}
```

- [ ] **Step 4: Manual smoke**

Open a walkthrough/plan in the right panel, hover a list line → blue square button appears. Add a comment → button stays visible.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shell-icons.tsx apps/desktop/src/EnhancedMarkdownView.tsx apps/desktop/src/styles/region-inspector.css
git commit -m "$(cat <<'EOF'
feat(desktop): blue Antigravity-style line comment action button

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

## Task 2: Highlight commented lines (light bg, deepen on hover)

**Files:**
- Modify: `apps/desktop/src/EnhancedMarkdownView.tsx` (`LineCommentWrapper` className)
- Modify: `apps/desktop/src/styles/region-inspector.css`

**Interfaces:**
- Consumes: `hasComment` already computed in `LineCommentWrapper`
- Produces: `.enhanced-line-wrapper.has-comment` visual state

- [ ] **Step 1: Add `has-comment` class on the wrapper when a comment exists**

In `LineCommentWrapper` return:

```tsx
return (
  <div
    className={[
      'enhanced-line-wrapper',
      'has-hover-highlight',
      hasComment ? 'has-comment' : '',
      popoverOpen ? 'popover-open' : '',
      className,
    ]
      .filter(Boolean)
      .join(' ')}
  >
```

- [ ] **Step 2: CSS for soft highlight + hover deepen**

Replace the current transparent hover rules:

```css
.enhanced-line-wrapper {
  position: relative;
  transition: background-color 0.15s ease;
  border-radius: 6px;
  background: transparent;
  /* room for the absolute comment button */
  padding-right: 34px;
}

/* Soft hover for any commentable line */
.enhanced-line-wrapper.has-hover-highlight:hover,
.enhanced-line-wrapper.popover-open {
  background: color-mix(in srgb, var(--accent, #3b82f6) 6%, transparent);
}

/* Commented lines: always tinted */
.enhanced-line-wrapper.has-comment {
  background: color-mix(in srgb, var(--accent, #3b82f6) 10%, transparent);
}

/* Commented + hover: deepen */
.enhanced-line-wrapper.has-comment:hover,
.enhanced-line-wrapper.has-comment.popover-open {
  background: color-mix(in srgb, var(--accent, #3b82f6) 16%, transparent);
}

[data-theme='light'] .enhanced-line-wrapper.has-hover-highlight:hover,
[data-theme='light'] .enhanced-line-wrapper.popover-open {
  background: rgba(59, 130, 246, 0.06);
}

[data-theme='light'] .enhanced-line-wrapper.has-comment {
  background: rgba(59, 130, 246, 0.09);
}

[data-theme='light'] .enhanced-line-wrapper.has-comment:hover,
[data-theme='light'] .enhanced-line-wrapper.has-comment.popover-open {
  background: rgba(59, 130, 246, 0.14);
}
```

- [ ] **Step 3: Manual smoke**

Add a comment on a list item → row shows light blue tint. Hover → tint deepens. Delete comment → tint gone.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/EnhancedMarkdownView.tsx apps/desktop/src/styles/region-inspector.css
git commit -m "$(cat <<'EOF'
feat(desktop): soft highlight for commented document lines

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

## Task 3: Composer doc-comment chip (Image 2 style) + send wiring

**Files:**
- Create: `apps/desktop/src/doc-comments.ts`
- Create: `apps/desktop/src/doc-comments.test.ts`
- Modify: `apps/desktop/src/composer-dock.tsx`
- Modify: `apps/desktop/src/styles/region-composer.css`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/composer-dock.test.tsx` (if present; else add assertions)

**Interfaces:**
- Consumes: `docCommentsAttachment: { docTitle: string; commentCount: number } | null`
- Produces: `formatDocCommentsForPrompt(docTitle, comments): string`
- Antigravity pattern: comments live on the artifact; composer shows a compact chip; on send, comments are serialized into the user message. **No text stuffed into the textarea.**

### Design (from user Image 2)

```
┌─────────────────────────────────┐
│  📖  Walkthrough  ·  1 💬       │  ← soft pill, SVG icons, no emoji
└─────────────────────────────────┘
[ Ask anything...                 ]
```

- Icon: `IconBook` (or `IconDocument` for non-walkthrough titles)
- Title: bold, truncated
- Dot separator + count + small `IconChat` (not emoji)
- Remove (×) on the right, visible on chip hover
- Soft surface background + subtle border (match walkthrough card tokens)

- [ ] **Step 1: Write pure format helper + failing tests**

`apps/desktop/src/doc-comments.ts`:

```ts
import type { LineCommentItem } from './EnhancedMarkdownView';

/**
 * Serialize desktop line comments into prompt text for session/prompt.
 * Desktop-only; host never sees structured comment objects.
 */
export function formatDocCommentsForPrompt(
  docTitle: string,
  comments: readonly LineCommentItem[],
): string {
  if (comments.length === 0) return '';
  const header = `## Comments on \`${docTitle}\` (${comments.length})`;
  const body = comments
    .map((c, index) => {
      const quote = c.lineText.trim().slice(0, 200);
      const note = c.commentText.trim();
      return `${index + 1}. > ${quote}\n   ${note}`;
    })
    .join('\n\n');
  return `${header}\n\n${body}`;
}

export function mergeComposerWithDocComments(
  composerText: string,
  docTitle: string,
  comments: readonly LineCommentItem[],
): string {
  const block = formatDocCommentsForPrompt(docTitle, comments);
  const text = composerText.trim();
  if (!block) return text;
  if (!text) return block;
  return `${block}\n\n${text}`;
}
```

`apps/desktop/src/doc-comments.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatDocCommentsForPrompt, mergeComposerWithDocComments } from './doc-comments';

describe('formatDocCommentsForPrompt', () => {
  it('returns empty string for no comments', () => {
    expect(formatDocCommentsForPrompt('Walkthrough', [])).toBe('');
  });

  it('formats title, quoted line, and comment body', () => {
    const out = formatDocCommentsForPrompt('Walkthrough', [
      {
        id: '1',
        lineId: 'list-0',
        lineText: 'Font System: Adopted -apple-system',
        commentText: 'Use Inter only',
      },
    ]);
    expect(out).toContain('## Comments on `Walkthrough` (1)');
    expect(out).toContain('> Font System: Adopted -apple-system');
    expect(out).toContain('Use Inter only');
  });
});

describe('mergeComposerWithDocComments', () => {
  it('prepends comment block before user text', () => {
    const merged = mergeComposerWithDocComments(
      'please fix this',
      'Plan',
      [
        {
          id: '1',
          lineId: 'h-1',
          lineText: 'Step 2',
          commentText: 'skip this step',
        },
      ],
    );
    expect(merged.startsWith('## Comments on `Plan`')).toBe(true);
    expect(merged.endsWith('please fix this')).toBe(true);
  });

  it('returns only comments when composer empty', () => {
    const merged = mergeComposerWithDocComments('', 'Plan', [
      { id: '1', lineId: 'a', lineText: 'x', commentText: 'y' },
    ]);
    expect(merged).toContain('## Comments on `Plan`');
    expect(merged).not.toContain('please');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL then implement file and PASS**

```bash
pnpm --filter @piwin/desktop test -- src/doc-comments.test.ts
```

Expected first run: FAIL (module not found). After creating `doc-comments.ts`: PASS.

- [ ] **Step 3: Redesign chip markup in `composer-dock.tsx`**

Replace emoji chip with SVG icons:

```tsx
import { IconBook, IconChat, IconClose, IconDocument } from './shell-icons';

// inside attachments row:
{props.docCommentsAttachment ? (
  <div
    className="composer-v2-attachment-chip composer-v2-doc-comment-chip"
    data-testid="doc-comment-chip"
  >
    <span className="doc-comment-chip-icon" aria-hidden>
      {/* Walkthrough-like titles use book; others document */}
      {/walkthrough/i.test(props.docCommentsAttachment.docTitle) ? (
        <IconBook width={14} height={14} />
      ) : (
        <IconDocument width={14} height={14} />
      )}
    </span>
    <span className="doc-comment-chip-title">
      {props.docCommentsAttachment.docTitle}
    </span>
    <span className="doc-comment-chip-dot" aria-hidden>
      ·
    </span>
    <span className="doc-comment-chip-count">
      {props.docCommentsAttachment.commentCount}
      <IconChat width={12} height={12} className="doc-comment-chip-count-icon" />
    </span>
    {props.onRemoveDocComments ? (
      <button
        type="button"
        className="composer-v2-chip-remove doc-comment-chip-remove"
        onClick={props.onRemoveDocComments}
        aria-label="Remove comment attachment"
      >
        <IconClose width={12} height={12} />
      </button>
    ) : null}
  </div>
) : null}
```

- [ ] **Step 4: Chip CSS (Image 2 polish)**

Replace emoji-oriented rules in `region-composer.css`:

```css
.composer-v2-doc-comment-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px 5px 8px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--card, var(--surface)) 92%, var(--surface-inset, transparent));
  border: 1px solid var(--line-soft, rgba(255, 255, 255, 0.08));
  font-size: 13px;
  font-weight: 500;
  color: var(--text, #f1f5f9);
  max-width: 280px;
  position: relative;
}

[data-theme='light'] .composer-v2-doc-comment-chip {
  background: rgba(255, 255, 255, 0.9);
  border-color: rgba(0, 0, 0, 0.08);
  color: #1e293b;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.doc-comment-chip-icon {
  display: inline-flex;
  color: var(--accent, #3b82f6);
  flex-shrink: 0;
}

.doc-comment-chip-title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
}

.doc-comment-chip-dot {
  color: var(--muted, #94a3b8);
  flex-shrink: 0;
}

.doc-comment-chip-count {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  color: var(--muted, #94a3b8);
  flex-shrink: 0;
}

.doc-comment-chip-count-icon {
  opacity: 0.85;
}

/* Remove control: inline for text chips (not absolute over image thumbs) */
.composer-v2-doc-comment-chip .doc-comment-chip-remove {
  position: static;
  width: 18px;
  height: 18px;
  margin-left: 2px;
  border-radius: 50%;
  background: transparent;
  color: var(--muted, #94a3b8);
  opacity: 0;
  transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
}

.composer-v2-doc-comment-chip:hover .doc-comment-chip-remove,
.composer-v2-doc-comment-chip:focus-within .doc-comment-chip-remove {
  opacity: 1;
}

.composer-v2-doc-comment-chip .doc-comment-chip-remove:hover {
  background: color-mix(in srgb, var(--danger, #ef4444) 15%, transparent);
  color: var(--danger, #ef4444);
}
```

Also polish generic image attachment chips slightly (user: "现在 attach 的 ui 也很丑"):

```css
.composer-v2-attachment-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--line-soft, rgba(255, 255, 255, 0.08));
  background: var(--surface, rgba(255, 255, 255, 0.04));
}

.composer-v2-attachment-chip .media-chip-thumb {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  display: block;
  object-fit: cover;
}

.composer-v2-chip-remove {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
  line-height: 1;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.composer-v2-attachment-chip:hover .composer-v2-chip-remove,
.composer-v2-attachment-chip:focus-within .composer-v2-chip-remove {
  opacity: 1;
}
```

- [ ] **Step 5: Stop injecting quote text into textarea; wire send**

In `App.tsx`:

1. **Remove or no-op the text-injection path** in `handleCommentLine` (or stop passing `onCommentLine` that mutates composer). Preferred: keep focus-only:

```tsx
const handleCommentLine = useCallback((_lineContent: string) => {
  // Chip is the attachment; do not inject quote text into the textarea.
  setTimeout(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="composer-input"]',
    );
    textarea?.focus();
  }, 50);
}, []);
```

Note: `onCommentLine` is still called from `handleCreateSubmit` after `onAddComment`. That is fine — focus only.

2. **On send**, merge comments into the prompt. The cleanest desktop-only approach without rewriting `useComposerMedia`:

Option A (minimal): wrap `handleSend` from the hook:

```tsx
// After useComposerMedia destructure:
const handleSendWithComments = useCallback(async () => {
  const docTitle = activeDocument?.title || 'Document';
  if (activeComments.length > 0) {
    const merged = mergeComposerWithDocComments(composer, docTitle, activeComments);
    setComposer(merged);
    // Clear comments so chip disappears; next tick send uses merged text.
    setDocComments((prev) => ({ ...prev, [activeDocKey]: [] }));
    // Allow React to flush composer state — better: pass text directly.
  }
  await handleSend();
}, [/* ... */]);
```

**Do not use the setState-then-send race.** Prefer Option B:

Option B (correct): extend `handleSend` path by temporarily setting composer, OR add an optional `getExtraPromptPrefix` / pre-send transform.

Minimal correct approach without hook API churn:

```tsx
const handleSendWithComments = useCallback(async () => {
  const docTitle = activeDocument?.title || 'Document';
  const comments = activeComments;
  if (comments.length > 0) {
    const merged = mergeComposerWithDocComments(composer, docTitle, comments);
    // Write merged text into composer state synchronously via functional update,
    // then call the underlying send which reads from the hook's composer ref/state.
    // If handleSend closes over `composer`, we must either:
    //  (1) expose handleSendWithText(text) from the hook, or
    //  (2) setComposer(merged) and rely on a dedicated send path.
    setComposer(merged);
    setDocComments((prev) => ({ ...prev, [activeDocKey]: [] }));
  }
  // PROBLEM: handleSend still sees old composer until re-render.
}, [...]);
```

**Required small hook change** in `use-composer-media.ts`:

```ts
const handleSend = useCallback(async (overrideText?: string): Promise<void> => {
  const text = (overrideText ?? composer).trim();
  // ... rest unchanged, use `text` instead of composer.trim()
```

Then in `App.tsx`:

```tsx
const handleSendWithComments = useCallback(async () => {
  const docTitle = activeDocument?.title || 'Document';
  const comments = activeComments;
  const text =
    comments.length > 0
      ? mergeComposerWithDocComments(composer, docTitle, comments)
      : composer;
  if (comments.length > 0) {
    setDocComments((prev) => ({ ...prev, [activeDocKey]: [] }));
  }
  await handleSend(text);
}, [activeDocument?.title, activeComments, composer, activeDocKey, handleSend]);
```

Wire `composerCard.onSend` to `() => void handleSendWithComments()`.

Also allow send when composer is empty but comments exist:

In `handleSend` guard:

```ts
const text = (overrideText ?? composer).trim();
const attachments = pendingAttachments.map((item) => item.attachment);
if ((!text && attachments.length === 0) || args.state.streaming || ...) {
  return;
}
```

`mergeComposerWithDocComments` already produces non-empty text when comments exist, so empty composer + comments works if we pass overrideText.

- [ ] **Step 6: Header badge — drop emoji**

In `DocPreviewPanel.tsx`:

```tsx
{commentCount > 0 ? (
  <span className="doc-comment-badge">
    · {commentCount}
    <IconChat width={12} height={12} />
  </span>
) : null}
```

- [ ] **Step 7: Tests + typecheck**

```bash
pnpm --filter @piwin/desktop test -- src/doc-comments.test.ts src/composer-dock.test.tsx
pnpm --filter @piwin/desktop typecheck
```

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/doc-comments.ts apps/desktop/src/doc-comments.test.ts \
  apps/desktop/src/composer-dock.tsx apps/desktop/src/styles/region-composer.css \
  apps/desktop/src/App.tsx apps/desktop/src/hooks/use-composer-media.ts \
  apps/desktop/src/DocPreviewPanel.tsx apps/desktop/src/composer-dock.test.tsx
git commit -m "$(cat <<'EOF'
feat(desktop): Walkthrough-style doc comment chip and send wiring

Stop stuffing quote text into the composer; serialize comments on send.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

## Task 4: Walkthrough markdown — analysis + targeted polish

### 4A. Analysis (current vs desired)

`EnhancedMarkdownView` already handles a solid subset used by plans/walkthroughs:

| Feature | Status | Notes |
|---------|--------|-------|
| H1–H6 | OK | Editorial sizes in CSS; H5/H6 share weak styling |
| Paragraphs | OK | 14px / 1.68 lh |
| Unordered lists + 1-level sub | OK | Nested depth >1 flattened to subItems strings |
| Ordered lists (`1.`) | **Missing** | Parsed as paragraphs |
| Task lists `[ ]`/`[x]` | Partial | Checkbox present; styling plain |
| Tables | OK | Basic; no zebra / sticky header |
| Fenced code + fold | OK | No syntax highlighting |
| Diff lines | OK | +/- coloring |
| Callouts `> [!NOTE]` | OK | |
| Blockquotes (plain `>`) | **Missing** | Only callout form |
| Mermaid / KaTeX | OK | |
| Images `![]()` | **Missing** | |
| Path chips / file links | OK | |
| HR | OK | |
| Details/summary | OK | |
| Inline strong/em/code/link | OK | |
| First-line title rhythm | Weak | Double padding (body + root) |
| Commentable rows | OK after Tasks 1–2 | |

**Walkthrough-specific pain (priority order):**

1. **Ordered lists** — walkthroughs often use numbered steps; currently broken into paragraphs.
2. **Plain blockquotes** — evidence quotes render as paragraphs.
3. **Nested list depth** — multi-level bullets collapse.
4. **Typography rhythm** — double vertical padding (`doc-preview-body` 24px + `enhanced-markdown-root` 24/32/64) wastes space; first H1 should act as page title with less top margin.
5. **Task list polish** — larger hit target, muted completed text.
6. **Table polish** — zebra rows, better header contrast (walkthrough comparison tables).
7. **Code block light-theme** — header/fade use dark-biased rgba whites.
8. **Images** — lower priority unless walkthroughs embed screenshots often.

**Out of scope this pass (YAGNI):** full syntax highlighting engine, sticky TOC, heading anchor copy, GFM autolinks beyond current path chips.

### 4B. Implementation (high-value only)

**Files:**
- Modify: `apps/desktop/src/EnhancedMarkdownView.tsx` (parser + render)
- Modify: `apps/desktop/src/styles/region-inspector.css`
- Test: `apps/desktop/src/EnhancedMarkdownView.test.tsx` (create if missing)

- [ ] **Step 1: Extend block types**

```ts
// Add to EnhancedBlock union:
| { type: 'ordered-list'; items: EnhancedListItem[] }
| { type: 'blockquote'; text: string }
```

- [ ] **Step 2: Parse ordered lists**

After bullet-list branch in `parseEnhancedMarkdownBlocks`:

```ts
// Ordered lists (1. 2. …)
if (/^\d+\.\s+/.test(trimmed)) {
  const items: EnhancedListItem[] = [];
  while (i < lines.length) {
    const currentTrimmed = (lines[i] ?? '').trim();
    const itemMatch = /^(\d+)\.\s+(.*)$/.exec(currentTrimmed);
    if (!itemMatch || itemMatch[2] === undefined) break;
    const itemText = itemMatch[2];
    const checkMatch = /^\[([ xX])\]\s+(.*)$/.exec(itemText);
    let checked: boolean | undefined;
    let cleanText = itemText;
    if (checkMatch?.[1] !== undefined && checkMatch[2] !== undefined) {
      checked = checkMatch[1].toLowerCase() === 'x';
      cleanText = checkMatch[2];
    }
    // one-level sub-bullets (same as unordered)
    const subItems: string[] = [];
    i++;
    while (i < lines.length) {
      const nextLine = lines[i] ?? '';
      const nextTrimmed = nextLine.trim();
      if (/^\s+[-*]\s+/.test(nextLine) || (nextLine.startsWith('  ') && /^[-*]\s+/.test(nextTrimmed))) {
        const subMatch = /^[-*]\s+(.*)$/.exec(nextTrimmed);
        if (subMatch?.[1]) subItems.push(subMatch[1]);
        i++;
      } else {
        break;
      }
    }
    items.push({
      text: cleanText,
      ...(checked !== undefined ? { checked } : {}),
      ...(subItems.length > 0 ? { subItems } : {}),
    });
  }
  blocks.push({ type: 'ordered-list', items });
  continue;
}
```

- [ ] **Step 3: Parse plain blockquotes (non-callout)**

Before paragraph fallback, after callout handling:

```ts
if (trimmed.startsWith('>') && !trimmed.startsWith('> [!')) {
  const quoteLines: string[] = [];
  while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
    quoteLines.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
    i++;
  }
  blocks.push({ type: 'blockquote', text: quoteLines.join('\n') });
  continue;
}
```

- [ ] **Step 4: Render ordered-list + blockquote with LineCommentWrapper**

Mirror list rendering with `<ol className="enhanced-list enhanced-ordered-list">`.

Blockquote:

```tsx
if (block.type === 'blockquote') {
  return (
    <LineCommentWrapper
      lineId={`quote-${blockIndex}`}
      lineText={block.text}
      comments={comments}
      onAddComment={onAddComment}
      onEditComment={onEditComment}
      onDeleteComment={onDeleteComment}
      onCommentLine={onCommentLine}
      className="enhanced-blockquote"
    >
      <blockquote>{renderFormattedText(block.text, onOpenFile)}</blockquote>
    </LineCommentWrapper>
  );
}
```

- [ ] **Step 5: CSS polish for walkthrough readability**

```css
/* Reduce double padding */
.doc-preview-body {
  padding: 12px 8px 24px;
}

.enhanced-markdown-root {
  padding: 8px 28px 48px;
  gap: 10px;
}

.enhanced-heading.level-1:first-child {
  margin-top: 4px;
}

.enhanced-ordered-list {
  list-style: decimal;
  padding-left: 24px;
}

.enhanced-blockquote {
  margin: 8px 0;
  padding: 10px 14px;
  border-left: 3px solid var(--accent, #3b82f6);
  background: color-mix(in srgb, var(--accent, #3b82f6) 6%, transparent);
  border-radius: 0 8px 8px 0;
  color: var(--muted, #64748b);
  font-size: 13.5px;
  line-height: 1.6;
}

.enhanced-list-item .enhanced-checkbox {
  width: 14px;
  height: 14px;
  margin-right: 8px;
  vertical-align: -2px;
}

.enhanced-list-item:has(.enhanced-checkbox:checked) .item-text {
  color: var(--muted, #94a3b8);
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}

.md-table thead th {
  background: color-mix(in srgb, var(--surface-hover, rgba(0, 0, 0, 0.04)) 100%, transparent);
  font-weight: 600;
  font-size: 12.5px;
}

.md-table tbody tr:nth-child(even) {
  background: color-mix(in srgb, var(--surface-hover, rgba(0, 0, 0, 0.03)) 100%, transparent);
}

/* Light-theme code header (was dark-biased) */
[data-theme='light'] .enhanced-code-header {
  background: rgba(0, 0, 0, 0.03);
  border-bottom-color: rgba(0, 0, 0, 0.06);
  color: #64748b;
}

[data-theme='light'] .enhanced-code-block {
  background: #f8fafc;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.06);
}
```

- [ ] **Step 6: Tests for ordered list + blockquote**

```ts
it('parses ordered lists as ordered-list blocks', () => {
  const { getByText } = render(
    <EnhancedMarkdownView text={'1. First\n2. Second\n'} />,
  );
  expect(getByText('First')).toBeTruthy();
  expect(document.querySelector('ol.enhanced-ordered-list')).toBeTruthy();
});

it('parses plain blockquotes', () => {
  render(<EnhancedMarkdownView text={'> quoted evidence\n'} />);
  expect(document.querySelector('.enhanced-blockquote')).toBeTruthy();
  expect(document.querySelector('blockquote')?.textContent).toContain('quoted evidence');
});
```

```bash
pnpm --filter @piwin/desktop test -- src/EnhancedMarkdownView.test.tsx
pnpm --filter @piwin/desktop typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/EnhancedMarkdownView.tsx \
  apps/desktop/src/EnhancedMarkdownView.test.tsx \
  apps/desktop/src/styles/region-inspector.css
git commit -m "$(cat <<'EOF'
feat(desktop): walkthrough markdown ordered lists, blockquotes, rhythm polish

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

## Verification checklist (all tasks)

1. Hover line in right panel → blue 26×26 comment button (Image 1).
2. Add comment → line soft blue highlight; hover deepens; button stays.
3. Composer shows pill chip: book/doc icon + title + `·` + count + chat icon (Image 2); **no emoji**; **no quote text in textarea**.
4. Send with only comments (empty textarea) → prompt includes `## Comments on ...`; chip clears.
5. Send with comments + typed text → comments prepended, then user text.
6. Remove chip (×) → comments cleared, highlights gone.
7. Walkthrough with `1. 2. 3.` renders as ordered list; `> quote` as blockquote.
8. `pnpm --filter @piwin/desktop test` and `pnpm typecheck` green.

---

## Self-review

| Spec item | Task |
|-----------|------|
| 1. Redraw comment icon (Image 1) | Task 1 |
| 2. Composer chip like Image 2, no text injection | Task 3 |
| 2b. Ugly attach UI polish | Task 3 Step 4 |
| 3. Commented line light bg + hover deepen | Task 2 |
| 4. Analyze walkthrough MD + plan | Task 4A analysis + 4B implementation |
| Comments actually reach the model | Task 3 Step 5 (`mergeComposerWithDocComments` + `handleSend(overrideText)`) |

No placeholders left. Types: `LineCommentItem` from `EnhancedMarkdownView`; `formatDocCommentsForPrompt` / `mergeComposerWithDocComments` from `doc-comments.ts`; `handleSend(overrideText?: string)` in `use-composer-media.ts`.
