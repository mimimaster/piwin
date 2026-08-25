import type { ReactElement, ReactNode } from 'react';
import { Button } from '@piwin/ui-kit';
import { IconChat, IconCheck, IconClose, IconTrash } from '../../shell-icons';

export type MediaLightboxStat = { label: string; value: string };

export type MediaLightboxProps = {
  testId: string;
  title: string;
  onClose: () => void;
  /** Stage area: the <img> or <video> element. */
  media: ReactNode;
  promptLabel: string;
  prompt: string;
  stats: MediaLightboxStat[];
  copyLabel: string;
  copiedLabel: string;
  remixLabel: string;
  deleteLabel: string;
  copied: boolean;
  onCopyPrompt: () => void;
  onRemixInChat: () => void;
  onDelete: () => void;
};

/**
 * Fullscreen detail view shared by the image lightbox and video theater:
 * media stage on the left, prompt + stats + actions on the right.
 */
export function MediaLightbox(props: MediaLightboxProps): ReactElement {
  return (
    <div className="media-lightbox-backdrop" onClick={props.onClose}>
      <div
        className="media-lightbox"
        data-testid={props.testId}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="media-lightbox-close"
          onClick={props.onClose}
          aria-label="Close"
        >
          <IconClose width={16} height={16} />
        </button>
        <div className="media-lightbox-stage">{props.media}</div>
        <div className="media-lightbox-side">
          <h3 className="media-lightbox-title">{props.title}</h3>
          <div className="media-lightbox-block">
            <span className="media-lightbox-label">{props.promptLabel}</span>
            <p className="media-lightbox-prompt">{props.prompt}</p>
          </div>
          <dl className="media-lightbox-stats">
            {props.stats.map((stat) => (
              <div key={stat.label} className="media-lightbox-stat">
                <dt>{stat.label}</dt>
                <dd>{stat.value}</dd>
              </div>
            ))}
          </dl>
          <div className="media-lightbox-actions">
            <Button variant="primary" onClick={props.onRemixInChat}>
              <IconChat width={14} height={14} />
              <span>{props.remixLabel}</span>
            </Button>
            <Button variant="secondary" onClick={props.onCopyPrompt}>
              <IconCheck width={14} height={14} />
              <span>{props.copied ? props.copiedLabel : props.copyLabel}</span>
            </Button>
            <Button variant="ghost" onClick={props.onDelete}>
              <IconTrash width={14} height={14} />
              <span>{props.deleteLabel}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
