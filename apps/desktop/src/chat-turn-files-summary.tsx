/**
 * Mount gate for the per-assistant-message FilesChangedBar in chat rows.
 */
import type { ReactElement } from 'react';
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
};

export function ChatTurnFilesSummary(props: ChatTurnFilesSummaryProps): ReactElement | null {
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
