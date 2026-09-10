import { useEffect, type ReactElement, type ReactNode } from 'react';
import { Button, IconButton } from '@piwin/ui-kit';
import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconClose,
  IconCopy,
  IconSpark,
  IconTrash,
} from '../../shell-icons';
import { useModalFocus } from './use-modal-focus';

export type MediaLightboxStat = { label: string; value: string };

export type MediaLightboxProps = {
  testId: string;
  title: string;
  onClose: () => void;
  media: ReactNode;
  promptLabel: string;
  prompt: string;
  stats: MediaLightboxStat[];
  copyLabel: string;
  copiedLabel: string;
  deleteLabel?: string;
  copied: boolean;
  onCopyPrompt: () => void;
  onDelete?: () => void;
  onRemix?: () => void;
  remixLabel?: string;
  onPrev?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
  currentIndex?: number | undefined;
  totalCount?: number | undefined;
  closeLabel?: string;
  closeHint?: string;
  prevLabel?: string;
  prevHint?: string;
  nextLabel?: string;
  nextHint?: string;
};

/** In-page media viewer. Sits on the gallery, not over the page chrome. */
export function MediaLightbox(props: MediaLightboxProps): ReactElement {
  const { onPrev, onNext, onClose } = props;
  const dialogRef = useModalFocus<HTMLDivElement>(onClose);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' && onPrev) {
        event.preventDefault();
        onPrev();
      } else if (event.key === 'ArrowRight' && onNext) {
        event.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onPrev, onNext]);

  return (
    <div className="vault-look-back" onClick={onClose}>
      <div
        ref={dialogRef}
        className="vault-look"
        data-testid={props.testId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${props.testId}-title`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="media-lightbox-close vault-look-close"
          onClick={onClose}
          aria-label={props.closeLabel ?? 'Close'}
          title={props.closeHint ?? 'Close (Esc)'}
        >
          <IconClose width={16} height={16} aria-hidden="true" />
        </button>

        <div className="vault-look-stage">
          {onPrev ? (
            <button
              type="button"
              className="vault-look-nav is-prev"
              onClick={onPrev}
              aria-label={props.prevLabel ?? 'Previous'}
              title={props.prevHint ?? 'Previous (←)'}
            >
              <IconArrowLeft width={18} height={18} aria-hidden="true" />
            </button>
          ) : null}

          <div className="vault-look-frame">{props.media}</div>

          {onNext ? (
            <button
              type="button"
              className="vault-look-nav is-next"
              onClick={onNext}
              aria-label={props.nextLabel ?? 'Next'}
              title={props.nextHint ?? 'Next (→)'}
            >
              <IconArrowRight width={18} height={18} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <footer className="vault-look-dock">
          <div className="vault-look-copy">
            <div className="vault-look-title-row">
              <h3 id={`${props.testId}-title`} className="vault-look-title">
                {props.title}
              </h3>
              {props.currentIndex !== undefined && props.totalCount !== undefined ? (
                <span className="vault-look-count">
                  {props.currentIndex + 1} / {props.totalCount}
                </span>
              ) : null}
              <IconButton
                label={props.copied ? props.copiedLabel : props.copyLabel}
                title={props.copied ? props.copiedLabel : props.copyLabel}
                onClick={props.onCopyPrompt}
              >
                {props.copied ? (
                  <IconCheck width={13} height={13} />
                ) : (
                  <IconCopy width={13} height={13} />
                )}
              </IconButton>
            </div>
            <p className="vault-look-prompt">
              <span className="sr-only">{props.promptLabel}</span>
              {props.prompt}
            </p>
            <p className="vault-look-meta">
              {props.stats
                .map((stat) => stat.value)
                .filter((value) => value && value !== '—')
                .join(' · ')}
            </p>
          </div>
          <div className="vault-look-actions">
            {props.onRemix ? (
              <Button variant="primary" size="compact" onClick={props.onRemix}>
                <IconSpark width={14} height={14} aria-hidden="true" />
                <span>{props.remixLabel || 'Remix'}</span>
              </Button>
            ) : null}
            <Button variant="secondary" size="compact" onClick={props.onCopyPrompt}>
              {props.copied ? (
                <IconCheck width={14} height={14} aria-hidden="true" />
              ) : (
                <IconCopy width={14} height={14} aria-hidden="true" />
              )}
              <span>{props.copied ? props.copiedLabel : props.copyLabel}</span>
            </Button>
            {props.onDelete && props.deleteLabel ? (
              <Button variant="danger" size="compact" onClick={props.onDelete}>
                <IconTrash width={14} height={14} aria-hidden="true" />
                <span>{props.deleteLabel}</span>
              </Button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}
