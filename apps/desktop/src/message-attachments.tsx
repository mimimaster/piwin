import type { ReactElement } from 'react';
import type { PromptContextRef } from '@piwin/contracts';
import type { ChatMessageUi } from './chat-reducer';
import { MediaPreview } from './MediaPreview';
import { WebElementChip } from './WebElementChip';
import {
  TranscriptAttChip,
  transcriptAttFromContextRef,
  transcriptAttFromMedia,
} from './transcript-att-chip';

export function MessageAttachments(props: {
  attachments: ChatMessageUi['attachments'];
  contextRefs?: readonly PromptContextRef[] | undefined;
  role?: ChatMessageUi['role'] | undefined;
  locale?: 'zh-CN' | 'en' | undefined;
}): ReactElement | null {
  const contextRefs = props.contextRefs ?? [];
  const attachments = props.attachments ?? [];
  if (attachments.length === 0 && contextRefs.length === 0) return null;
  const isUser = props.role === 'user';
  const isAssistant = props.role === 'assistant' || !props.role;
  const count = attachments.length;

  if (isUser) {
    return (
      <div
        className="atts message-attachments is-user-attachments"
        data-testid="message-attachments"
        data-attachment-count={count}
        data-attachment-role="user"
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
            <TranscriptAttChip
              key={attachment.id}
              {...transcriptAttFromMedia(attachment)}
            />
          ),
        )}
      </div>
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
