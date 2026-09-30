/**
 * One transcript turn's frame: the user article and the assistant article,
 * each with its byline head and marginalia. ChatThread builds the rows; this
 * lays them out.
 */
import type { ReactElement } from 'react';
import type { ChatMessageUi } from './chat-reducer';
import {
  ChatTurnHead,
  ChatTurnMarginalia,
  hasTurnByline,
  resolveTurnMarginalia,
  type ResolveTurnMarginaliaOptions,
} from './chat-turn-marginalia.js';

export type ChatTurnSectionProps = {
  turnId: string;
  isCurrentResponse: boolean;
  userMessages: readonly ChatMessageUi[];
  /** Assistant rows of the turn; the whole turn stands in when there are none. */
  assistantMessages: readonly ChatMessageUi[];
  turnMessages: readonly ChatMessageUi[];
  userItems: ReactElement[];
  assistantItems: ReactElement[];
  /** Mount the assistant article even before it has rows (a run just started). */
  assistantPending: boolean;
  /** Live state of the current response; null once the turn is settled. */
  liveState: 'running' | 'waiting' | null;
  editingMessageId: string | null;
  locale: 'zh-CN' | 'en' | undefined;
  isConversationSession: boolean;
  model: ResolveTurnMarginaliaOptions['model'];
  contextUsage: ResolveTurnMarginaliaOptions['contextUsage'];
};

function liveStatusLabel(
  liveState: ChatTurnSectionProps['liveState'],
  locale: ChatTurnSectionProps['locale'],
): string | null {
  if (liveState === null) return null;
  if (liveState === 'waiting') return locale === 'en' ? 'Waiting' : '等待批准';
  return locale === 'en' ? 'Running' : '运行中';
}

export function ChatTurnSection(props: ChatTurnSectionProps): ReactElement {
  const hasAssistantActivity = props.assistantItems.length > 0 || props.assistantPending;
  const userMarginaliaResolved =
    props.userItems.length === 0
      ? null
      : resolveTurnMarginalia(props.userMessages, {
          editingMessageId: props.editingMessageId,
          locale: props.locale,
          forceRole: 'user',
          isConversationSession: props.isConversationSession,
        });
  const userMarginaliaData =
    userMarginaliaResolved !== null && hasTurnByline(userMarginaliaResolved)
      ? userMarginaliaResolved
      : null;
  const assistantMarginaliaData = !hasAssistantActivity
    ? null
    : resolveTurnMarginalia(
        props.assistantMessages.length > 0 ? props.assistantMessages : props.turnMessages,
        {
          locale: props.locale,
          forceRole: 'assistant',
          model: props.model,
          contextUsage: props.contextUsage,
          status: liveStatusLabel(props.liveState, props.locale),
          statusTone: props.liveState,
          isConversationSession: props.isConversationSession,
        },
      );

  return (
    <section
      className={`chat-turn-group${props.isCurrentResponse ? ' is-current-response' : ''}`}
      {...(props.isCurrentResponse ? { 'data-testid': 'current-response-turn' } : {})}
    >
      {props.userItems.length > 0 ? (
        <article key="user-turn" className="turn chat-turn chat-turn-user">
          <div className="chat-turn-body">
            {userMarginaliaData !== null ? <ChatTurnHead data={userMarginaliaData} /> : null}
            {props.userItems}
          </div>
          {userMarginaliaData !== null ? <ChatTurnMarginalia data={userMarginaliaData} /> : null}
        </article>
      ) : null}
      {hasAssistantActivity ? (
        <article key="assistant-turn" className="turn chat-turn chat-turn-assistant">
          {assistantMarginaliaData !== null ? (
            <ChatTurnMarginalia data={assistantMarginaliaData} />
          ) : null}
          <div className="chat-turn-body">
            {assistantMarginaliaData !== null ? <ChatTurnHead data={assistantMarginaliaData} /> : null}
            {props.assistantItems}
          </div>
        </article>
      ) : null}
    </section>
  );
}
