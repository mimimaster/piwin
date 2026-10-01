/**
 * Mount gate for the per-turn change summary in chat rows.
 *
 * A turn the Host recorded gets the TurnChangeBar (exact counts, one-click
 * undo / redo). Older turns, or Hosts without the record, keep the per-call
 * FilesChangedBar.
 */
import type { ReactElement } from 'react';
import { TurnChangeBar } from './turn-changes/turn-change-bar.js';
import { decodeTurnRunIds } from './turn-changes/turn-change-index.js';
import { useTurnChangesApi, useTurnChangeSummaries } from './turn-changes/turn-changes-context.js';
import type { ChatMessageUi, ToolCardUi } from './chat-reducer';
import {
  FilesChangedBar,
  type FilesChangedBarRequest,
} from './files-changed-bar';

export type { FilesChangedBarRequest };

export type ChatTurnFilesSummaryProps = {
  isConversationSession?: boolean;
  role: ChatMessageUi['role'];
  /** The turn is still running: its file set and line counts are not final yet. */
  turnInProgress?: boolean;
  tools: readonly ToolCardUi[];
  projectPath?: string | null;
  request?: FilesChangedBarRequest;
  onReview?: () => void;
  locale?: string;
  sessionId?: string;
  /** The turn's runIds as one string (see encodeTurnRunIds). */
  turnRunKey?: string;
};

export function ChatTurnFilesSummary(props: ChatTurnFilesSummaryProps): ReactElement | null {
  const api = useTurnChangesApi();
  const eligible = props.isConversationSession !== true && props.role === 'assistant';
  const summaries = useTurnChangeSummaries(
    eligible ? props.sessionId : undefined,
    decodeTurnRunIds(props.turnRunKey),
  );
  if (api && eligible && summaries.length > 0) {
    const locale = props.locale === 'en' ? 'en' : 'zh-CN';
    return (
      <>
        {summaries.map((summary) => (
          <TurnChangeBar
            key={summary.changeSetId}
            summary={summary}
            api={api}
            projectPath={props.projectPath}
            locale={locale}
          />
        ))}
      </>
    );
  }
  if (props.isConversationSession === true) return null;
  if (props.role !== 'assistant') return null;
  if (props.turnInProgress === true) return null;
  if (props.tools.length === 0) return null;
  return (
    <FilesChangedBar
      tools={props.tools}
      {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
      {...(props.request !== undefined ? { request: props.request } : {})}
      {...(props.onReview !== undefined ? { onReview: props.onReview } : {})}
      {...(props.locale === 'zh-CN' || props.locale === 'en' ? { locale: props.locale } : {})}
    />
  );
}
