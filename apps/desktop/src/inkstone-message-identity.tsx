import type { ChatMessageUi } from './chat-ui-types.js';
import { ChatTurnHead, resolveTurnMarginalia } from './chat-turn-marginalia.js';

/** Conversation uses the same quiet byline as the Agent document. The wrapper
 * is theme-scoped so other themes retain their existing identity chrome. */
export function InkstoneMessageIdentity({ message, locale }: {
  message: ChatMessageUi;
  locale: 'zh-CN' | 'en';
}) {
  const data = resolveTurnMarginalia([message]);
  if (message.role === 'user') data.who = locale === 'zh-CN' ? '你' : 'You';
  return (
    <div className="inkstone-message-identity">
      <ChatTurnHead data={data} />
    </div>
  );
}
