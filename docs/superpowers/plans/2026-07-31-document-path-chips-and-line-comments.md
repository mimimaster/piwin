# Document Path Chips + Per-Line Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the right-panel document preview (`DocPreviewPanel` / `EnhancedMarkdownView`), render file paths as compact chips with the same interaction as chat, and add hover-activated comment icons on every document line so users can attach line-specific feedback to the composer.

**Architecture:** Keep all UI changes in `apps/desktop`. Reuse the existing `PathChip` component for path rendering. Add a small `LineCommentable` wrapper component for the comment affordance. Extend `PendingComposerAttachment` with a comment kind and let `useComposerMedia` convert comments into prompt text on send, so no host or contracts changes are required.

**Tech Stack:** React 19, TypeScript strict, `@piwin/ui-kit` (`Popover`, `TextInput`, `Button`, `IconButton`), existing `path-chip.tsx`, `EnhancedMarkdownView`, `composer-dock.tsx`, `useComposerMedia`.

---

## Global Constraints

- TypeScript strict / `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` must remain enabled; do not weaken without ADR.
- No `apps/desktop` imports of `@earendil-works/pi-*`; only `@piwin/*` packages and local files.
- Keep `packages/contracts` unchanged for these features; treat comments as a desktop-only composer concept that becomes text at send time.
- ESM only; use project-relative imports with no `.js` extension (matching `apps/desktop` convention).
- Colocated tests; every behavior change that can be unit-tested gets a test.
- `pnpm typecheck` and `pnpm test` must pass before marking done.

---

## Task 1: Render document-internal file paths as chips

**Files:**
- Modify: `apps/desktop/src/EnhancedMarkdownView.tsx`
- Modify: `apps/desktop/src/DocPreviewPanel.tsx`
- Test: `apps/desktop/src/EnhancedMarkdownView.test.tsx`

**Interfaces:**
- Consumes: `PathChip` and `fileNameFromPath` from `apps/desktop/src/path-chip.tsx`; `onOpenDocument` callback from `DocPreviewPanel`.
- Produces: `EnhancedMarkdownView` renders `.md`/file paths as `PathChip`; clicking a chip opens the target document in the right panel.

### Step 1: Add `onOpenDocument` prop to `EnhancedMarkdownView`

Update the props type:

```ts
export type EnhancedMarkdownViewProps = {
  text: string;
  documentTitle?: string | undefined;
  onOpenFile?: ((filePath: string) => void) | undefined;
  onOpenDocument?: ((doc: { title: string; path?: string }) => void) | undefined;
  onAddComment?: ((comment: { sourceText: string; commentText: string; documentTitle: string }) => void) | undefined;
};
```

(The `onAddComment` and `documentTitle` props are used by Task 2; adding them now keeps the type from churning later.)

### Step 2: Detect and chip-ize paths in `renderFormattedText`

`renderFormattedText` currently tokenizes inline code, strong, em, math, and links. Add path handling:

- For any remaining plain text after link tokenization, run `pushTextWithFilePaths` (same regex as `MarkdownView.tsx`) and render matches as `PathChip` with `onOpen={() => onOpenDocument?.({ title: fileNameFromPath(fullPath), path: fullPath })}`.
- For inline code spans that look like file paths (contain `/`, `\`, or start with `file://` and end with an extension), render a `PathChip` instead of `<code>`.
- For link tokens where the URL ends with `.md`, render a `PathChip` with `label={title}` instead of a raw `<a>`.

Import the helper and component:

```ts
import { fileNameFromPath, PathChip } from './path-chip';
```

Add to `renderFormattedText` after link handling:

```ts
if (lastIndex < text.length) {
  const remaining = text.slice(lastIndex);
  pushTextWithFilePaths(remaining, parts, key, onOpenDocument);
  key += 100;
}
```

Use this local `pushTextWithFilePaths` inside `EnhancedMarkdownView.tsx`:

```ts
function pushTextWithFilePaths(
  text: string,
  parts: Array<string | ReactElement>,
  keyBase: number,
  onOpenDocument?: ((doc: { title: string; path?: string }) => void) | undefined,
): void {
  if (!onOpenDocument) {
    parts.push(text);
    return;
  }
  const pathRegex = /(?:file:\/\/|\/|[A-Za-z]:[\\/]|(?:\.\.?\/))+[\w\u4e00-\u9fa5_./-]+\.md\b/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = keyBase;

  while ((match = pathRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const fullPath = match[0];
    parts.push(
      <PathChip
        key={key++}
        fullPath={fullPath}
        onOpen={() => onOpenDocument({ title: fileNameFromPath(fullPath), path: fullPath })}
      />,
    );
    lastIndex = pathRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
}
```

### Step 3: Wire `DocPreviewPanel` to open documents on chip click

In `DocPreviewPanel.tsx`, the `onSelectDocument` prop already has the right signature. Pass it to `EnhancedMarkdownView`:

```tsx
<EnhancedMarkdownView
  text={defaultContent}
  onOpenFile={onOpenFile}
  onOpenDocument={onSelectDocument}
  documentTitle={displayTitle}
  onAddComment={onAddComment}
/>
```

Add `onAddComment?: (comment: { sourceText: string; commentText: string; documentTitle: string }) => void` to `DocPreviewPanelProps` and destructure it.

### Step 4: Add test for path chip in document

In `EnhancedMarkdownView.test.tsx`, render a paragraph with an absolute `.md` path and assert the chip text is the basename and `onOpenDocument` is called with the full path on click.

Run:

```bash
pnpm --filter @piwin/desktop test -- src/EnhancedMarkdownView.test.tsx
```

---

## Task 2: Hover-activated comment icons on each document line

**Files:**
- Create: `apps/desktop/src/line-comment.tsx`
- Create: `apps/desktop/src/line-comment.test.tsx`
- Modify: `apps/desktop/src/EnhancedMarkdownView.tsx`
- Modify: `apps/desktop/src/DocPreviewPanel.tsx`
- Modify: `apps/desktop/src/media-utils.ts`
- Modify: `apps/desktop/src/composer-dock.tsx`
- Modify: `apps/desktop/src/hooks/use-composer-media.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/styles/region-inspector.css`

**Interfaces:**
- Consumes: `Popover`, `TextInput`, `Button`, `IconButton` from `@piwin/ui-kit`; `IconChat` from `./shell-icons`.
- Produces: `LineCommentable` wrapper; `PendingComposerAttachment` union with a `comment` kind; `useComposerMedia.addComment` API.

### Step 1: Create `LineCommentable` component

New file `apps/desktop/src/line-comment.tsx`:

```ts
import { useState, type ReactElement, type ReactNode } from 'react';
import { Button, Popover, TextInput } from '@piwin/ui-kit';
import { IconChat } from './shell-icons';

export type LineCommentPayload = {
  sourceText: string;
  commentText: string;
  documentTitle: string;
};

export type LineCommentableProps = {
  documentTitle: string;
  sourceText: string;
  onAddComment: (payload: LineCommentPayload) => void;
  children: ReactNode;
};

export function LineCommentable({
  documentTitle,
  sourceText,
  onAddComment,
  children,
}: LineCommentableProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');

  function handleSubmit(): void {
    const trimmed = comment.trim();
    if (!trimmed) return;
    onAddComment({ documentTitle, sourceText, commentText: trimmed });
    setComment('');
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      side="right"
      contentClassName="line-comment-popover"
      trigger={
        <div className="line-commentable" data-source-text={sourceText}>
          {children}
          <button
            type="button"
            className="line-comment-trigger"
            aria-label="Add comment"
            onClick={(event) => {
              event.preventDefault();
              setOpen(true);
            }}
          >
            <IconChat width={14} height={14} />
          </button>
        </div>
      }
    >
      <div className="line-comment-form">
        <TextInput
          value={comment}
          onChange={(event) => setComment(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Comment on this line..."
          data-testid="line-comment-input"
          autoFocus
        />
        <Button size="compact" onClick={handleSubmit} data-testid="line-comment-submit">
          Submit
        </Button>
      </div>
    </Popover>
  );
}
```

### Step 2: Add CSS for hover and popover

Append to `apps/desktop/src/styles/region-inspector.css` (or a new file `line-comment.css` if it grows):

```css
.line-commentable {
  position: relative;
  padding-right: 28px;
}

.line-comment-trigger {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--muted, #a1a1aa);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease, background 0.12s ease;
}

.line-commentable:hover .line-comment-trigger,
.line-comment-trigger:focus-visible {
  opacity: 1;
  background: var(--surface-hover, rgba(255, 255, 255, 0.06));
}

.line-comment-popover {
  min-width: 240px;
  padding: 8px;
}

.line-comment-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
```

### Step 3: Wrap every `EnhancedMarkdownView` block in `LineCommentable`

In `EnhancedMarkdownView.tsx`, pass `documentTitle` and `onAddComment` down and wrap `EnhancedBlockView` output. Compute a short `sourceText` from each block for the comment payload.

Change the render loop:

```tsx
export function EnhancedMarkdownView({
  text,
  documentTitle,
  onOpenFile,
  onOpenDocument,
  onAddComment,
}: EnhancedMarkdownViewProps): ReactElement {
  const blocks = parseEnhancedMarkdownBlocks(text);

  return (
    <div className="enhanced-markdown-root" data-testid="enhanced-markdown">
      {blocks.map((block, index) => {
        const sourceText = blockSourceText(block);
        const child = <EnhancedBlockView key={index} block={block} onOpenFile={onOpenFile} onOpenDocument={onOpenDocument} />;
        if (!onAddComment || !documentTitle) return child;
        return (
          <LineCommentable
            key={index}
            documentTitle={documentTitle}
            sourceText={sourceText}
            onAddComment={onAddComment}
          >
            {child}
          </LineCommentable>
        );
      })}
    </div>
  );
}
```

Add `blockSourceText` helper:

```ts
function blockSourceText(block: EnhancedBlock): string {
  switch (block.type) {
    case 'paragraph':
    case 'callout':
      return block.text;
    case 'heading':
      return block.text;
    case 'diff-header':
      return block.path;
    case 'list':
      return block.items.map((item) => item.text).join('; ');
    case 'code':
      return block.source.slice(0, 200);
    default:
      return '';
  }
}
```

### Step 4: Extend `PendingComposerAttachment` to support comments

Modify `apps/desktop/src/media-utils.ts`:

```ts
import type { MediaAttachmentRef } from '@piwin/contracts';

export type PendingImageAttachment = {
  localId: string;
  kind: 'image';
  attachment: MediaAttachmentRef;
  previewUrl: string;
};

export type PendingCommentAttachment = {
  localId: string;
  kind: 'comment';
  documentTitle: string;
  sourceText: string;
  commentText: string;
};

export type PendingComposerAttachment = PendingImageAttachment | PendingCommentAttachment;

export function isPendingImageAttachment(
  item: PendingComposerAttachment,
): item is PendingImageAttachment {
  return item.kind === 'image';
}

export function isPendingCommentAttachment(
  item: PendingComposerAttachment,
): item is PendingCommentAttachment {
  return item.kind === 'comment';
}
```

Update existing image creation in `useComposerMedia.ts` and `composer-dock.tsx` to use `kind: 'image'`.

### Step 5: Render comment chips in the composer

In `composer-dock.tsx` attachment row, branch on `item.kind`:

```tsx
{props.pendingAttachments.map((item) => (
  <div key={item.localId} className="composer-v2-attachment-chip">
    {isPendingImageAttachment(item) ? (
      <MediaPreview attachment={item.attachment} previewUrl={item.previewUrl} compact />
    ) : (
      <span className="composer-v2-comment-chip" title={item.sourceText}>
        <IconDocument width={14} height={14} />
        {item.documentTitle} · 1
      </span>
    )}
    <button
      type="button"
      className="composer-v2-chip-remove"
      onClick={() => props.onRemoveAttachment(item.localId)}
      aria-label="Remove attachment"
    >
      <IconClose width={12} height={12} />
    </button>
  </div>
))}
```

Add `IconDocument` import if not present, and import the type guards from `media-utils`.

Style `composer-v2-comment-chip` in CSS to match the existing chip row:

```css
.composer-v2-comment-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--accent, #60a5fa);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
}
```

### Step 6: Add `addComment` and update send flow in `useComposerMedia.ts`

Return new `addComment` from the hook:

```ts
const addComment = useCallback(
  (comment: { documentTitle: string; sourceText: string; commentText: string }): void => {
    setPendingAttachments((current) => [
      ...current,
      {
        localId: crypto.randomUUID(),
        kind: 'comment',
        documentTitle: comment.documentTitle,
        sourceText: comment.sourceText,
        commentText: comment.commentText,
      },
    ]);
  },
  [],
);
```

Update `revokePending` to only revoke object URLs for image attachments:

```ts
const revokePending = useCallback((localId: string): void => {
  setPendingAttachments((current) => {
    const target = current.find((item) => item.localId === localId);
    if (target && isPendingImageAttachment(target)) {
      URL.revokeObjectURL(target.previewUrl);
    }
    return current.filter((item) => item.localId !== localId);
  });
}, []);
```

Update `clearPendingAttachments` similarly:

```ts
const clearPendingAttachments = useCallback((): void => {
  setPendingAttachments((current) => {
    for (const item of current) {
      if (isPendingImageAttachment(item)) {
        URL.revokeObjectURL(item.previewUrl);
      }
    }
    return [];
  });
}, []);
```

Update `handleSend` to merge comment text into the prompt and only send media attachments:

```ts
const handleSend = useCallback(async (): Promise<void> => {
  const text = composer.trim();
  const mediaAttachments = pendingAttachments.filter(isPendingImageAttachment).map((item) => item.attachment);
  const commentAttachments = pendingAttachments.filter(isPendingCommentAttachment);

  if (
    (!text && pendingAttachments.length === 0) ||
    args.state.streaming ||
    promptSubmissionInProgress.current
  ) {
    return;
  }

  // ... trust / session setup ...

  // Build prompt with comments appended.
  let promptText = applyAgentModeToPrompt(args.agentMode, text);
  if (commentAttachments.length > 0) {
    const commentBlock = commentAttachments
      .map((c, index) => `> Comment ${index + 1} on "${c.documentTitle}":\n> Source: "${c.sourceText}"\n> Feedback: ${c.commentText}`)
      .join('\n\n');
    promptText = promptText ? `${promptText}\n\n${commentBlock}` : commentBlock;
  }

  args.dispatch({ type: 'user/send', text: promptText, attachments: mediaAttachments });
  setComposer('');
  clearPendingAttachments();

  const input: { text: string; attachments?: MediaAttachmentRef[]; model?: ModelRef; thinkingLevel?: ThinkingLevel } = {
    text: promptText,
  };
  if (mediaAttachments.length > 0) {
    input.attachments = mediaAttachments;
  }
  // ... model / thinking ...
}, [args, composer, pendingAttachments, clearPendingAttachments, resolveSessionIdForComposer, resolveTurnModel]);
```

Include `addComment` in the hook return object:

```ts
return {
  // ... existing fields ...
  addComment,
};
```

### Step 7: Wire `App.tsx`

In `App.tsx`, destructure `addComment` from `useComposerMedia` and pass it to `DocPreviewPanel`:

```ts
const {
  composer,
  setComposer,
  pendingAttachments,
  // ...
  addComment,
} = useComposerMedia({ /* ... */ });
```

Pass into the right panel:

```tsx
docPreviewContent={
  <DocPreviewPanel
    title={activeDocument?.title}
    content={activeDocument?.content}
    filePath={activeDocument?.filePath}
    sessionDocuments={sessionDocuments}
    onSelectDocument={(doc) => handleOpenDocument({ title: doc.title, ...(doc.path ? { path: doc.path } : {}) })}
    onAddComment={addComment}
    locale={desktopLocale}
  />
}
```

### Step 8: Add tests

- `line-comment.test.tsx`: render `LineCommentable`, simulate opening the popover, type a comment, submit, assert `onAddComment` called.
- `EnhancedMarkdownView.test.tsx`: assert that a block renders a `line-commentable` wrapper when `onAddComment` is provided and that hover/focus reveals the trigger.
- `composer-dock` test (or a targeted test for `useComposerMedia`): assert that `addComment` adds a comment attachment and that `handleSend` injects the comment into the sent text.

Run:

```bash
pnpm --filter @piwin/desktop typecheck
pnpm --filter @piwin/desktop test
```

---

## Verification

- [ ] `pnpm typecheck` passes for the whole workspace.
- [ ] `pnpm test` passes for `apps/desktop`.
- [ ] Manual smoke: open a document in the right panel; hover over a line; click the chat icon; type a comment; confirm a chip appears in the composer; send and verify the model receives the source line and comment text.
