/**
 * Composer chip for a pending PromptContextRef (CM §9.3).
 * Shows label + kind affordance and a remove button. Rendered beside media
 * chips in both centered and docked composer layouts.
 */
import type { ReactElement } from 'react';
import { IconClose, IconDocument } from './shell-icons';
import type { PendingContextRefItem } from './hooks/use-composer-context-refs';

export type ContextRefChipProps = {
  item: PendingContextRefItem;
  onRemove?: (key: string) => void;
};

export function ContextRefChip({ item, onRemove }: ContextRefChipProps): ReactElement {
  return (
    <div
      className="composer-v2-attachment-chip composer-v2-context-chip"
      data-testid="composer-context-chip"
      data-context-kind={item.ref.kind}
      title={item.label}
    >
      <span className="doc-comment-chip-icon" aria-hidden>
        <IconDocument width={14} height={14} />
      </span>
      <span className="chip-text">{item.label}</span>
      <span className="doc-comment-chip-dot" aria-hidden>
        ·
      </span>
      <span className="doc-comment-chip-count">{item.ref.kind}</span>
      {onRemove ? (
        <button
          type="button"
          className="composer-v2-chip-remove"
          data-testid="composer-context-chip-remove"
          onClick={() => onRemove(item.key)}
          aria-label={`Remove ${item.label}`}
        >
          <IconClose width={12} height={12} />
        </button>
      ) : null}
    </div>
  );
}
