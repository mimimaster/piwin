import { useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import type { DiffActionType } from './enhanced-markdown-types.js';

export function DiffBadge({ action }: { action: DiffActionType }): ReactElement {
  const toneClass =
    action === 'MODIFY'
      ? 'badge-modify'
      : action === 'NEW'
        ? 'badge-new'
        : action === 'DELETE'
          ? 'badge-delete'
          : 'badge-rename';

  return <span className={`diff-action-badge ${toneClass}`}>[{action}]</span>;
}

export function CopyButton({ text }: { text: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="compact"
      onClick={() => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* ignore */
          }
        })();
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}
