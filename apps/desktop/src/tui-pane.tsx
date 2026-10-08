/**
 * The current session in the terminal shell (`piwin tui --embedded`), ADR 0086.
 *
 * The pane owns no session state: the TUI is another shell on the same Host,
 * so closing or remounting it loses nothing. It follows Desktop's active
 * session by restarting on that session.
 */
import { useState, type ReactElement } from 'react';
import { Button, Notice } from '@piwin/ui-kit';
import type { DesktopLocale } from './desktop-locale';
import { isTauriPtyAvailable } from './tauri-pty';
import { XtermSurface, type PtyStatus } from './xterm-surface';

export type TuiPaneProps = {
  sessionId: string | null;
  locale: DesktopLocale;
};

type TuiPaneCopy = { unavailable: string; noSession: string; restart: string; exited: string };

const COPY: Record<'en' | 'zh', TuiPaneCopy> = {
  en: {
    unavailable: 'The terminal UI runs in the desktop app with a local Host.',
    noSession: 'Open or start a session to use the terminal UI.',
    restart: 'Restart',
    exited: 'The terminal UI exited.',
  },
  zh: {
    unavailable: '终端界面需要在桌面应用里配合本机 Host 使用。',
    noSession: '先打开或开始一个会话，再使用终端界面。',
    restart: '重新启动',
    exited: '终端界面已退出。',
  },
};

export function TuiPane(props: TuiPaneProps): ReactElement {
  const copy = props.locale === 'zh-CN' ? COPY.zh : COPY.en;
  const [status, setStatus] = useState<{ kind: PtyStatus; message?: string }>({ kind: 'idle' });
  /** Bumped to start a fresh process after an exit or a failed start. */
  const [generation, setGeneration] = useState(0);

  if (!isTauriPtyAvailable()) {
    return <div className="muted terminal-empty">{copy.unavailable}</div>;
  }
  if (props.sessionId === null) {
    return <div className="muted terminal-empty">{copy.noSession}</div>;
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
          key={`${props.sessionId}:${generation}`}
          cwd=""
          tuiSessionId={props.sessionId}
          onStatus={(kind, _ptyId, message) => {
            setStatus(message === undefined ? { kind } : { kind, message });
          }}
        />
      </div>
    </div>
  );
}
