/**
 * Composer chip for a pending PromptContextRef (CM §9.3).
 * File/selection ranges show as `file:start-end` capsules; terminal and
 * error refs use distinct icons. Rendered on the composer diversion shelf.
 */
import type { ReactElement } from 'react';
import type { PromptContextRef } from '@piwin/contracts';
import {
  IconAlertCircle,
  IconClose,
  IconDocument,
  IconFile,
  IconFileDiff,
  IconFolder,
  IconTerminal,
} from './shell-icons';
import type { PendingContextRefItem } from './hooks/use-composer-context-refs';

export type ContextRefChipProps = {
  item:
    | PendingContextRefItem
    | {
        ref: PromptContextRef;
        label?: string | undefined;
        key?: string | undefined;
      };
  onRemove?: ((key: string) => void) | undefined;
};

export function formatContextRefChipCaption(ref: PromptContextRef): {
  title: string;
  meta: string;
} {
  if (ref.kind === 'file' && ref.lineStart != null) {
    const start = ref.lineStart;
    const end = ref.lineEnd ?? start;
    const range = start === end ? `${start}` : `${start}-${end}`;
    const lines = end - start + 1;
    return {
      title: `${fileName(ref.relativePath)}:${range}`,
      meta: `${lines} lines`,
    };
  }
  if (ref.kind === 'selection') {
    const path = ref.relativePath ? fileName(ref.relativePath) : ref.label;
    if (ref.lineStart != null) {
      const start = ref.lineStart;
      const end = ref.lineEnd ?? start;
      const range = start === end ? `${start}` : `${start}-${end}`;
      return { title: `${path}:${range}`, meta: 'selection' };
    }
    return { title: path, meta: 'selection' };
  }
  if (ref.kind === 'terminal-output') {
    return { title: ref.label, meta: 'terminal' };
  }
  if (ref.kind === 'error') {
    return { title: ref.title.trim() || ref.label, meta: 'error' };
  }
  if (ref.kind === 'folder') {
    return { title: ref.label, meta: 'folder' };
  }
  if (ref.kind === 'diff') {
    return { title: ref.label, meta: 'diff' };
  }
  return { title: ref.label, meta: ref.kind };
}

function contextRefChipTitle(item: { ref: PromptContextRef; label?: string | undefined }): string {
  const { ref } = item;
  const label =
    item.label ||
    ('label' in ref && typeof ref.label === 'string'
      ? ref.label
      : 'relativePath' in ref && typeof ref.relativePath === 'string'
        ? ref.relativePath
        : '');
  if (ref.kind === 'error' && ref.detail.trim().length > 0) {
    return `${ref.title}\n${ref.detail}`.slice(0, 800);
  }
  if (ref.kind === 'terminal-output' && ref.snapshotText.trim().length > 0) {
    return ref.snapshotText.slice(0, 800);
  }
  if (ref.kind === 'file') {
    return ref.relativePath;
  }
  if (ref.kind === 'folder') {
    return ref.relativePath === '' ? label : ref.relativePath;
  }
  return label;
}

function fileName(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/');
  return slash >= 0 ? relativePath.slice(slash + 1) : relativePath;
}

function ContextRefKindIcon(props: { kind: PromptContextRef['kind'] }): ReactElement {
  const size = { width: 14, height: 14 };
  switch (props.kind) {
    case 'folder':
      return <IconFolder {...size} />;
    case 'diff':
      return <IconFileDiff {...size} />;
    case 'terminal-output':
      return <IconTerminal {...size} />;
    case 'error':
      return <IconAlertCircle {...size} />;
    case 'file':
      return <IconFile {...size} />;
    default:
      return <IconDocument {...size} />;
  }
}

export function ContextRefChip({ item, onRemove }: ContextRefChipProps): ReactElement {
  const caption = formatContextRefChipCaption(item.ref);
  const error = item.ref.kind === 'error';
  const itemKey = 'key' in item && item.key ? item.key : undefined;
  const itemLabel = item.label || caption.title;
  return (
    <div
      className={`composer-v2-attachment-chip composer-v2-doc-comment-chip composer-v2-context-chip${error ? ' is-error' : ''}`}
      data-testid="composer-context-chip"
      data-context-kind={item.ref.kind}
      data-shelf-chip=""
      data-shelf-kind="context-ref"
      {...(itemKey ? { 'data-shelf-id': itemKey } : {})}
      tabIndex={0}
      title={contextRefChipTitle(item)}
    >
      <span className="doc-comment-chip-icon" aria-hidden>
        <ContextRefKindIcon kind={item.ref.kind} />
      </span>
      <span className="chip-text">{caption.title}</span>
      <span className="doc-comment-chip-dot" aria-hidden>
        ·
      </span>
      <span className="doc-comment-chip-count">{caption.meta}</span>
      {onRemove && itemKey ? (
        <button
          type="button"
          className="composer-v2-chip-remove doc-comment-chip-remove"
          data-testid="composer-context-chip-remove"
          tabIndex={-1}
          onClick={() => onRemove(itemKey)}
          aria-label={`Remove ${itemLabel}`}
        >
          <IconClose width={12} height={12} />
        </button>
      ) : null}
    </div>
  );
}
