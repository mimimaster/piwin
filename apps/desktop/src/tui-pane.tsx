/**
 * The conversation in the terminal shell (`piwin tui --embedded`), ADR 0086.
 *
 * The pane owns no session state: the TUI is another shell on the same Host,
 * so closing or remounting it loses nothing. It follows Desktop's active
 * session by restarting on that session; with none, it starts a new
 * conversation in the active scope. When the TUI itself starts a conversation
 * it announces the session, Desktop opens that session, and the pane keeps the
 * running process instead of restarting it on the id it already shows.
 */
import { useRef, useState, type ReactElement } from 'react';
import { Button, Notice } from '@piwin/ui-kit';
import type { DesktopLocale } from './desktop-locale';
import { isTauriPtyAvailable } from './tauri-pty';
import { XtermSurface, type PtyStatus } from './xterm-surface';

export type TuiPaneProps = {
  sessionId: string | null;
  /** Project of the active scope: where a new conversation is created. */
  projectPath?: string | null;
  locale: DesktopLocale;
  /** The terminal shell started or opened this session: make it the one Desktop shows. */
  onSessionChange?: (sessionId: string) => void;
};

type TuiPaneCopy = { unavailable: string; restart: string; exited: string };

const COPY: Record<'en' | 'zh', TuiPaneCopy> = {
  en: {
    unavailable: 'The terminal UI runs in the desktop app with a local Host.',
    restart: 'Restart',
    exited: 'The terminal UI exited.',
  },
  zh: {
    unavailable: '终端界面需要在桌面应用里配合本机 Host 使用。',
    restart: '重新启动',
    exited: '终端界面已退出。',
  },
};

export function TuiPane(props: TuiPaneProps): ReactElement {
  const copy = props.locale === 'zh-CN' ? COPY.zh : COPY.en;
  const [status, setStatus] = useState<{ kind: PtyStatus; message?: string }>({ kind: 'idle' });
  /** Bumped to start a fresh process after an exit or a failed start. */
  const [generation, setGeneration] = useState(0);

  // The process is restarted when the session Desktop shows changes, except to
  // the one the TUI itself reported: it is already on it.
  const shown = useRef<{ desired: string; process: number; reported: string | null }>({
    desired: '',
    process: 0,
    reported: null,
  });
  const desired = props.sessionId ?? `new:${props.projectPath ?? ''}`;
  if (shown.current.desired !== desired) {
    const followsTui = props.sessionId !== null && props.sessionId === shown.current.reported;
    shown.current = {
      desired,
      // A counter, not the session id: starting a new conversation after the
      // TUI adopted one must still replace the process.
      process: followsTui ? shown.current.process : shown.current.process + 1,
      reported: followsTui ? null : shown.current.reported,
    };
  }

  if (!isTauriPtyAvailable()) {
    return <div className="muted terminal-empty">{copy.unavailable}</div>;
  }

  const stopped = status.kind === 'exited' || status.kind === 'error';
  return (
    <div className="tui-pane" data-testid="tui-pane">
      {stopped ? (
        <Notice tone={status.kind === 'error' ? 'error' : 'info'} testId="tui-pane-stopped">
          {status.kind === 'error' ? (status.message ?? copy.exited) : copy.exited}{' '}
          <Button
            type="button"
            data-testid="tui-pane-restart"
            onClick={() => {
              setStatus({ kind: 'idle' });
              setGeneration((value) => value + 1);
            }}
          >
            {copy.restart}
          </Button>
        </Notice>
      ) : null}
      <div className="tui-pane-surface">
        <XtermSurface
          key={`${shown.current.process}:${generation}`}
          cwd=""
          {...(props.projectPath ? { projectPath: props.projectPath } : {})}
          tui={props.sessionId === null ? {} : { sessionId: props.sessionId }}
          onTuiSession={(sessionId) => {
            shown.current.reported = sessionId;
            props.onSessionChange?.(sessionId);
          }}
          onStatus={(kind, _ptyId, message) => {
            setStatus(message === undefined ? { kind } : { kind, message });
          }}
        />
      </div>
    </div>
  );
}
