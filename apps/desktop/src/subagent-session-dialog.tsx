/**
 * Read-only subagent session inspector dialog.
 *
 * A large modal preview of a child session that keeps the parent session
 * active. Closing it never aborts the child; "Open full session" promotes the
 * preview through the existing resume path. No composer, steering, or edit
 * controls in this slice.
 */
import type { ReactElement } from 'react';
import { Button, Dialog, IconButton } from '@piwin/ui-kit';
import type { ChatMessageUi, SubagentStreamState } from './chat-reducer';
import type { ActiveSubagentStatus, SubagentInspectorSelection } from './subagent-activity-model';
import { SubagentSessionTranscript } from './subagent-session-transcript';
import { useDesktopLocale } from './desktop-locale-context';
import { IconClose } from './shell-icons';

export type SubagentSessionDialogProps = {
  open: boolean;
  selection: SubagentInspectorSelection | null;
  status: ActiveSubagentStatus;
  messages: ChatMessageUi[];
  liveTail: SubagentStreamState | null;
  loading: boolean;
  error: string | null;
  /** Whether child-session thinking should be shown in the inspector. */
  showThinking?: boolean;
  onOpenChange: (open: boolean) => void;
  /** Promote the preview to the existing full session view. */
  onOpenFullSession: (sessionId: string) => void;
  onRetry: () => void;
};

const STATUS_LABEL: Record<ActiveSubagentStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function SubagentSessionDialog(props: SubagentSessionDialogProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const { selection, status } = props;
  const isLive = props.liveTail?.streaming === true;

  return (
    <Dialog
      label={selection?.displayName ?? (isChinese ? '子代理会话' : 'Subagent session')}
      open={props.open}
      onOpenChange={props.onOpenChange}
      contentClassName="subagent-session-dialog-content"
      testId="subagent-session-dialog"
    >
      {selection !== null ? (
        <div className="subagent-session-dialog">
          <header className="subagent-session-dialog-header">
            <div className="subagent-session-dialog-heading">
              <span className={`subagent-session-state state-${status}`}>
                {STATUS_LABEL[status]}
              </span>
              <h2 className="subagent-session-title" title={selection.taskSummary}>
                {selection.taskSummary || selection.displayName}
              </h2>
              <span className="subagent-session-identity muted">
                {isChinese ? '子代理会话' : 'Subagent session'} · {selection.displayName}
              </span>
            </div>
            <div className="subagent-session-actions">
              <Button
                variant="ghost"
                size="compact"
                data-testid="subagent-open-full-session"
                onClick={() => props.onOpenFullSession(selection.childSessionId)}
              >
                {isChinese ? '打开完整会话' : 'Open full session'} ↗
              </Button>
              <IconButton
                label={isChinese ? '关闭' : 'Close'}
                onClick={() => props.onOpenChange(false)}
              >
                <IconClose />
              </IconButton>
            </div>
          </header>
          <SubagentSessionTranscript
            historicalMessages={props.messages}
            stream={props.liveTail}
            loading={props.loading}
            error={props.error}
            onRetry={props.onRetry}
            locale={locale}
            {...(props.showThinking !== undefined ? { showThinking: props.showThinking } : {})}
          />
          <footer className="subagent-session-dialog-footer">
            <span className={`subagent-session-footer-status status-${status}`}>
              {isLive ? <span className="subagent-session-live-dot" aria-hidden="true" /> : null}
              {STATUS_LABEL[status]}
              {isLive ? (
                <span className="muted">
                  {isChinese ? '· 自动跟随输出' : '· auto-following output'}
                </span>
              ) : null}
            </span>
          </footer>
        </div>
      ) : null}
    </Dialog>
  );
}
