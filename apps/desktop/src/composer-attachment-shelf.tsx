/**
 * Composer diversion shelf: attachments, context pills, and comments sit
 * above the textarea, behind a hairline. Empty shelf renders nothing.
 */
import type { ReactElement } from 'react';
import type { PromptAttachment } from '@piwin/contracts';
import { MediaPreview } from './MediaPreview';
import { WebElementChip } from './WebElementChip';
import { ContextRefChip } from './context-ref-chip';
import { isFailedMediaAttachment, type PendingComposerAttachment } from './media-utils';
import type { PendingContextRefItem } from './hooks/use-composer-context-refs';
import { handleShelfChipsKeyDown } from './composer-shelf-keyboard';
import {
  IconBook,
  IconChat,
  IconClose,
  IconDocument,
} from './shell-icons';

export { nextShelfChipIndex } from './composer-shelf-keyboard';

export type ComposerAttachmentShelfCopy = {
  textOnlyModelWarning: string;
  openModelSettings: string;
  removeCommentAttachment: string;
  removeAttachment: string;
  attachmentPreparing: string;
  attachmentPreparingGif: string;
  attachmentFailedLabel: string;
  attachmentFailureConnectionHint: string;
  attachmentRetry: string;
  attachmentRemove: string;
};

export type ComposerDocCommentsAttachment = {
  docTitle: string;
  commentCount: number;
};

export type ComposerAttachmentShelfProps = {
  copy: ComposerAttachmentShelfCopy;
  pendingAttachments: PendingComposerAttachment[];
  pendingContextRefs?: PendingContextRefItem[] | undefined;
  docCommentsAttachment?: ComposerDocCommentsAttachment | null | undefined;
  showTextOnlyImageWarning: boolean;
  onRemoveAttachment: (localId: string) => void;
  onRetryAttachment?: ((localId: string) => void) | undefined;
  onRemoveContextRef?: ((key: string) => void) | undefined;
  onRemoveDocComments?: (() => void) | undefined;
  onOpenModelSettings?: (() => void) | undefined;
  onRequestComposerFocus?: (() => void) | undefined;
};

export type ComposerShelfPopTarget =
  | { kind: 'attachment'; localId: string }
  | { kind: 'context-ref'; key: string }
  | { kind: 'doc-comments' };

/** Last visual card: attachments, then context refs, then doc comments. */
export function nextComposerShelfPop(args: {
  attachments: readonly { localId: string }[];
  contextRefs: readonly { key: string }[];
  hasDocComments: boolean;
}): ComposerShelfPopTarget | null {
  const lastAttachment = args.attachments.at(-1);
  if (lastAttachment) {
    return { kind: 'attachment', localId: lastAttachment.localId };
  }
  const lastRef = args.contextRefs.at(-1);
  if (lastRef) {
    return { kind: 'context-ref', key: lastRef.key };
  }
  if (args.hasDocComments) {
    return { kind: 'doc-comments' };
  }
  return null;
}

export function composerShelfHasItems(args: {
  attachments: readonly unknown[];
  contextRefs: readonly unknown[];
  hasDocComments: boolean;
}): boolean {
  return args.hasDocComments || args.attachments.length > 0 || args.contextRefs.length > 0;
}

export function ComposerAttachmentShelf(props: ComposerAttachmentShelfProps): ReactElement | null {
  const contextRefs = props.pendingContextRefs ?? [];
  const hasItems = composerShelfHasItems({
    attachments: props.pendingAttachments,
    contextRefs,
    hasDocComments: Boolean(props.docCommentsAttachment),
  });
  if (!hasItems) {
    return null;
  }

  const failedAttachments = props.pendingAttachments.filter(isFailedMediaAttachment);
  const copy = props.copy;

  return (
    <div className="composer-attachment-shelf" data-testid="composer-attachment-shelf">
      {props.showTextOnlyImageWarning ? (
        <div
          className="composer-v2-vision-warning"
          data-testid="composer-text-only-image-warning"
          role="status"
        >
          <span className="composer-v2-vision-warning-text">{copy.textOnlyModelWarning}</span>
          {props.onOpenModelSettings ? (
            <button
              type="button"
              className="composer-v2-vision-warning-action"
              onClick={props.onOpenModelSettings}
            >
              {copy.openModelSettings}
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        className="refs composer-attachment-shelf-chips"
        data-testid="composer-attachment-shelf-chips"
        onKeyDown={(event) => handleShelfChipsKeyDown(event, props)}
      >
        {props.docCommentsAttachment ? (
          <DocCommentChip
            attachment={props.docCommentsAttachment}
            removeLabel={copy.removeCommentAttachment}
            {...(props.onRemoveDocComments
              ? { onRemove: props.onRemoveDocComments }
              : {})}
          />
        ) : null}
        {contextRefs.map((item) => (
          <ContextRefChip
            key={item.key}
            item={item}
            {...(props.onRemoveContextRef
              ? { onRemove: props.onRemoveContextRef }
              : {})}
          />
        ))}
        {props.pendingAttachments.map((item) => (
          <MediaShelfChip
            key={item.localId}
            item={item}
            copy={copy}
            onRemove={props.onRemoveAttachment}
          />
        ))}
      </div>

      {failedAttachments.length > 0 ? (
        <div className="composer-v2-attachment-failures" role="alert">
          {failedAttachments.map((item) => (
            <div
              key={item.localId}
              className="composer-v2-attachment-failure"
              data-testid="composer-attachment-failure"
            >
              <span className="composer-v2-attachment-failure-label">
                {copy.attachmentFailedLabel}
                {item.attachment.kind === 'media' && item.attachment.name
                  ? ` · ${item.attachment.name}`
                  : ''}
              </span>
              <span className="composer-v2-attachment-failure-reason">
                {item.uploadErrorKind === 'connection'
                  ? `${copy.attachmentFailureConnectionHint} — `
                  : ''}
                {item.uploadError ?? ''}
              </span>
              <span className="composer-v2-attachment-failure-actions">
                {props.onRetryAttachment ? (
                  <button
                    type="button"
                    className="composer-v2-attachment-failure-action"
                    data-testid="composer-attachment-failure-retry"
                    onClick={() => props.onRetryAttachment?.(item.localId)}
                  >
                    {copy.attachmentRetry}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="composer-v2-attachment-failure-action"
                  data-testid="composer-attachment-failure-remove"
                  onClick={() => props.onRemoveAttachment(item.localId)}
                >
                  {copy.attachmentRemove}
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MediaShelfChip(props: {
  item: PendingComposerAttachment;
  copy: ComposerAttachmentShelfCopy;
  onRemove: (localId: string) => void;
}): ReactElement {
  const { item, copy } = props;
  const badge = mediaChipBadge(item.attachment);
  const isWebElement = item.attachment.kind === 'web-element';
  return (
    <div
      className={`composer-v2-attachment-chip${isWebElement ? ' composer-v2-web-element-chip' : ' composer-v2-media-chip'}`}
      data-upload-status={item.uploadStatus ?? 'ready'}
      data-shelf-chip=""
      data-shelf-kind="attachment"
      data-shelf-id={item.localId}
      tabIndex={0}
    >
      {item.attachment.kind === 'web-element' ? (
        <WebElementChip attachment={item.attachment} compact />
      ) : (
        <>
          <MediaPreview
            attachment={item.attachment}
            compact
            {...(item.previewUrl ? { previewUrl: item.previewUrl } : {})}
            {...(item.lightboxUrl ? { lightboxUrl: item.lightboxUrl } : {})}
          />
          {badge ? (
            <span className="composer-attachment-media-badge" data-testid="composer-media-badge">
              {badge}
            </span>
          ) : null}
          {item.uploadStatus === 'saving' ? (
            <span className="composer-v2-attachment-status" data-testid="composer-attachment-saving">
              {isGifAttachment(item.attachment)
                ? copy.attachmentPreparingGif
                : copy.attachmentPreparing}
            </span>
          ) : null}
        </>
      )}
      <button
        type="button"
        className="composer-v2-chip-remove"
        tabIndex={-1}
        onClick={() => props.onRemove(item.localId)}
        aria-label={copy.removeAttachment}
      >
        <IconClose width={10} height={10} />
      </button>
    </div>
  );
}

function DocCommentChip(props: {
  attachment: ComposerDocCommentsAttachment;
  removeLabel: string;
  onRemove?: () => void;
}): ReactElement {
  return (
    <div
      className="ref composer-v2-attachment-chip composer-v2-doc-comment-chip"
      data-testid="doc-comment-chip"
      data-shelf-chip=""
      data-shelf-kind="doc-comments"
      tabIndex={0}
    >
      <span className="doc-comment-chip-icon" aria-hidden>
        {/walkthrough/i.test(props.attachment.docTitle) ? (
          <IconBook width={14} height={14} />
        ) : (
          <IconDocument width={14} height={14} />
        )}
      </span>
      <span className="doc-comment-chip-title">{props.attachment.docTitle}</span>
      <span className="doc-comment-chip-dot" aria-hidden>
        ·
      </span>
      <span className="doc-comment-chip-count">
        {props.attachment.commentCount}
        <IconChat width={12} height={12} className="doc-comment-chip-count-icon" />
      </span>
      {props.onRemove ? (
        <button
          type="button"
          className="composer-v2-chip-remove doc-comment-chip-remove"
          tabIndex={-1}
          onClick={props.onRemove}
          aria-label={props.removeLabel}
        >
          <IconClose width={12} height={12} />
        </button>
      ) : null}
    </div>
  );
}

export function isGifAttachment(attachment: PromptAttachment): boolean {
  return (
    attachment.kind === 'media' &&
    (attachment.mimeType.toLowerCase() === 'image/gif' ||
      attachment.name?.toLowerCase().endsWith('.gif') === true)
  );
}

/** Corner badge on a 56×56 media thumb. GIF wins over pixel size. */
export function mediaChipBadge(attachment: PromptAttachment): string | null {
  if (attachment.kind !== 'media') {
    return null;
  }
  if (isGifAttachment(attachment)) {
    return 'GIF';
  }
  const width = attachment.width;
  const height = attachment.height;
  if (width != null && height != null && Math.max(width, height) >= 1280) {
    return `${width}×${height}`;
  }
  return null;
}
