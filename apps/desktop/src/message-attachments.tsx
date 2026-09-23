import { useState, type ReactElement } from 'react';
import type { PromptContextRef } from '@piwin/contracts';
import type { ChatMessageUi } from './chat-reducer';
import { MediaPreview } from './MediaPreview';
import { WebElementChip } from './WebElementChip';
import {
  TranscriptAttChip,
  isTranscriptMediaPreviewable,
  transcriptAttFromContextRef,
  transcriptAttFromMedia,
} from './transcript-att-chip';

function UserAttachmentCapsules(props: {
  attachments: ChatMessageUi['attachments'];
  contextRefs: readonly PromptContextRef[];
  locale?: 'zh-CN' | 'en' | undefined;
  cardCollapsed?: boolean | undefined;
  onPreviewOpen?: (() => void) | undefined;
}): ReactElement {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  const [revealedIds, setRevealedIds] = useState<ReadonlySet<string>>(() => new Set());
  // A collapsed card clamps its height; an open preview inside it overflows
  // and squeezes the text row under the chips. Fold previews with the card —
  // expanding the card again restores them.
  const cardCollapsed = props.cardCollapsed === true;
  const isPreviewOpen = (id: string): boolean => !cardCollapsed && openIds.has(id);

  function togglePreview(id: string): void {
    const opening = !isPreviewOpen(id);
    setOpenIds((current) => {
      const next = new Set(current);
      if (opening) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
    if (opening) props.onPreviewOpen?.();
    setRevealedIds((current) => {
      if (current.has(id)) {
        return current;
      }
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }

  return (
    <div
      className="atts message-attachments is-user-attachments"
      data-testid="message-attachments"
      data-attachment-count={props.attachments.length}
      data-attachment-role="user"
    >
      <div className="atts-chips">
        {props.contextRefs.length > 0 ? (
          <div className="message-context-refs" data-testid="message-context-refs">
            {props.contextRefs.map((ref, index) => {
              const model = transcriptAttFromContextRef(ref);
              return (
                <TranscriptAttChip
                  key={`ctx-ref-${index}-${ref.kind}`}
                  variant={model.variant}
                  text={model.text}
                />
              );
            })}
          </div>
        ) : null}
        {props.attachments.map((attachment) => {
          if (attachment.kind === 'web-element') {
            return <WebElementChip key={attachment.id} attachment={attachment} />;
          }
          const model = transcriptAttFromMedia(attachment);
          const previewable = isTranscriptMediaPreviewable(attachment);
          return (
            <TranscriptAttChip
              key={attachment.id}
              variant={model.variant}
              text={model.text}
              {...(previewable
                ? {
                    expanded: isPreviewOpen(attachment.id),
                    onToggle: () => togglePreview(attachment.id),
                  }
                : {})}
            />
          );
        })}
      </div>
      {props.attachments.map((attachment) => {
        if (attachment.kind === 'web-element' || !isTranscriptMediaPreviewable(attachment)) {
          return null;
        }
        const open = isPreviewOpen(attachment.id);
        return (
          <div
            key={`preview-${attachment.id}`}
            className="att-image-preview-slot"
            data-testid="att-image-preview-slot"
            data-open={open ? 'true' : 'false'}
            aria-hidden={open ? undefined : true}
            {...(!open ? ({ inert: true } as Record<string, boolean>) : {})}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="att-image-preview">
              {open || revealedIds.has(attachment.id) ? (
                <MediaPreview
                  attachment={attachment}
                  role="user"
                  {...(props.locale !== undefined ? { locale: props.locale } : {})}
                />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MessageAttachments(props: {
  attachments: ChatMessageUi['attachments'];
  contextRefs?: readonly PromptContextRef[] | undefined;
  role?: ChatMessageUi['role'] | undefined;
  locale?: 'zh-CN' | 'en' | undefined;
  /** User cards only: previews stay folded while the host card is collapsed. */
  cardCollapsed?: boolean | undefined;
  /** User cards only: a preview opened, so the host card should expand. */
  onPreviewOpen?: (() => void) | undefined;
}): ReactElement | null {
  const contextRefs = props.contextRefs ?? [];
  const attachments = props.attachments ?? [];
  if (attachments.length === 0 && contextRefs.length === 0) return null;
  const isUser = props.role === 'user';
  const isAssistant = props.role === 'assistant' || !props.role;
  const count = attachments.length;

  if (isUser) {
    return (
      <UserAttachmentCapsules
        attachments={attachments}
        contextRefs={contextRefs}
        {...(props.locale !== undefined ? { locale: props.locale } : {})}
        cardCollapsed={props.cardCollapsed}
        onPreviewOpen={props.onPreviewOpen}
      />
    );
  }

  const layoutClass =
    count === 1 ? 'is-hero-single' : count === 2 ? 'is-pair-grid' : 'is-gallery-grid';

  return (
    <div
      className={`message-attachments ${layoutClass}`}
      data-testid="message-attachments"
      data-attachment-count={count}
      data-attachment-role={props.role ?? 'assistant'}
    >
      {contextRefs.length > 0 ? (
        <div className="message-context-refs" data-testid="message-context-refs">
          {contextRefs.map((ref, index) => {
            const model = transcriptAttFromContextRef(ref);
            return (
              <TranscriptAttChip
                key={`ctx-ref-${index}-${ref.kind}`}
                variant={model.variant}
                text={model.text}
              />
            );
          })}
        </div>
      ) : null}
      {attachments.map((attachment) =>
        attachment.kind === 'web-element' ? (
          <WebElementChip key={attachment.id} attachment={attachment} />
        ) : (
          <MediaPreview
            key={attachment.id}
            attachment={attachment}
            hero={isAssistant && count === 1}
            role={props.role}
            {...(props.locale !== undefined ? { locale: props.locale } : {})}
          />
        ),
      )}
    </div>
  );
}
