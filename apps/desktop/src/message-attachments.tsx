import type { ReactElement } from 'react';
import type { ChatMessageUi } from './chat-reducer';
import { MediaPreview } from './MediaPreview';
import { WebElementChip } from './WebElementChip';

export function MessageAttachments(props: {
  attachments: ChatMessageUi['attachments'];
}): ReactElement | null {
  if (props.attachments.length === 0) return null;
  return (
    <div className="message-attachments">
      {props.attachments.map((attachment) =>
        attachment.kind === 'web-element' ? (
          <WebElementChip key={attachment.id} attachment={attachment} />
        ) : (
          <MediaPreview key={attachment.id} attachment={attachment} />
        ),
      )}
    </div>
  );
}
