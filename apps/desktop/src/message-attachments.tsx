import type { ReactElement } from 'react';
import type { PromptContextRef } from '@piwin/contracts';
import type { ChatMessageUi } from './chat-reducer';
import { ContextRefChip } from './context-ref-chip';
import { MediaPreview } from './MediaPreview';
import { WebElementChip } from './WebElementChip';

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

  const layoutClass = isUser
    ? 'is-user-attachments'
    : count === 1
      ? 'is-hero-single'
      : count === 2
        ? 'is-pair-grid'
        : 'is-gallery-grid';

  return (
    <div
      className={`message-attachments ${layoutClass}`}
      data-testid="message-attachments"
      data-attachment-count={count}
      data-attachment-role={props.role ?? 'assistant'}
    >
      {contextRefs.length > 0 ? (
        <div className="message-context-refs" data-testid="message-context-refs">
          {contextRefs.map((ref, index) => (
            <ContextRefChip
              key={`ctx-ref-${index}-${ref.kind}`}
              item={{ ref, label: 'label' in ref && typeof ref.label === 'string' ? ref.label : '' }}
            />
          ))}
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
