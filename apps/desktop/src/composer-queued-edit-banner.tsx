import type { ReactElement } from 'react';
import { IconClose, IconEdit } from './shell-icons';

export type ComposerQueuedEditBannerProps = {
  position: number;
  title: string;
  hint: string;
  cancelLabel: string;
  onCancel: () => void;
};

export function ComposerQueuedEditBanner(props: ComposerQueuedEditBannerProps): ReactElement {
  return (
    <div className="composer-queued-edit" data-testid="composer-queued-edit-banner">
      <span className="composer-queued-edit-icon" aria-hidden>
        <IconEdit width={14} height={14} />
      </span>
      <span className="composer-queued-edit-index" aria-hidden>
        {props.position}
      </span>
      <span className="composer-queued-edit-title">{props.title}</span>
      <span className="composer-queued-edit-hint">{props.hint}</span>
      <button
        type="button"
        className="composer-queued-edit-cancel"
        data-testid="composer-queued-edit-cancel"
        aria-label={props.cancelLabel}
        title={props.cancelLabel}
        onClick={props.onCancel}
      >
        <IconClose width={14} height={14} />
      </button>
    </div>
  );
}
