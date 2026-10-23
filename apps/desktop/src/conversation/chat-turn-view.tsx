import { memo, type ReactElement } from 'react';
import { renderChatTurn, type ChatTurnRenderInput } from './chat-turn-renderer.js';
import { areChatTurnRenderInputsEqual } from './chat-turn-view-memo.js';

/**
 * One turn behind a memo boundary. ChatThread re-renders on every streamed
 * token; without the boundary every mounted turn re-projected its work fold
 * and rebuilt all its row props, only for the row memo to discard them.
 */
export const ChatTurnView = memo(function ChatTurnView(input: ChatTurnRenderInput): ReactElement {
  return renderChatTurn(input);
}, areChatTurnRenderInputsEqual);
