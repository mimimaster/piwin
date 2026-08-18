import type { ReactElement } from 'react';
import type { ChatMessageUi } from './chat-reducer';
import { MediaPreview } from './MediaPreview';
import { WebElementChip } from './WebElementChip';

export function MessageAttachments(props: {
  attachments: ChatMessageUi['attachments'];
  role?: ChatMessageUi['role'] | undefined;
  locale?: 'zh-CN' | 'en' | undefined;
}): ReactElement | null {
  if (props.attachments.length === 0) return null;
  const isUser = props.role === 'user';
  const isAssistant = props.role === 'assistant' || !props.role;
  const count = props.attachments.length;

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
      {props.attachments.map((attachment) =>
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
