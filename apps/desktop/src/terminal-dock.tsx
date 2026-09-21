/**
 * Terminal panel body (right-panel tab).
 * - Tauri desktop: interactive multi-session PTY via Rust portable-pty + xterm.js (ADR 0013)
 * - Browser mock / non-Tauri: host pty/* line-oriented Shell preview
 *
 * The Tauri path now supports multiple zsh sessions inside the Terminal side tool.
 * General-scope terminals (no project) open in $HOME by default.
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { HostResponse } from '@piwin/contracts';
import { Button, Notice } from '@piwin/ui-kit';
import { isTauriPtyAvailable } from './tauri-pty';
import { XtermSurface } from './xterm-surface';
import {
  IconClose,
  IconPlus,
  IconTerminal,
} from './shell-icons';
import {
  MAX_TERMINAL_SESSIONS,
  useTerminalSessions,
  type TerminalSession,
  type TerminalSessionsApi,
} from './use-terminal-sessions';
import { useDesktopLocale } from './desktop-locale-context';

export type PtyOutputLine = {
  id: string;
  data: string;
  at: string;
};

export type TerminalDockProps = {
  projectPath: string | null;
  projectTrusted: boolean;
  ptyOutput: PtyOutputLine[];
  onClearPtyOutput: () => void;
  /** Current terminal working directory (persisted to preferences). */
  currentCwd: string;
  /** Called when the user changes the terminal directory. */
  onCwdChange: (cwd: string) => void;
  /** Recent directories for quick access dropdown. */
  recentDirs: string[];
  request: (command: {
    type: 'pty/open' | 'pty/write' | 'pty/resize' | 'pty/close' | 'pty/list';
    input?: { projectPath: string; cwd?: string; cols?: number; rows?: number };
    ptyId?: string;
    data?: string;
    cols?: number;
    rows?: number;
    projectPath?: string;
  }) => Promise<HostResponse>;
  /** Shared multi-session terminal controller. */
  terminalSessions?: TerminalSessionsApi;
};

export function TerminalDock(props: TerminalDockProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const useInteractivePty = isTauriPtyAvailable();
  const [inputLine, setInputLine] = useState('');
  const [ptyId, setPtyId] = useState<string | null>(null);
  const [ptyStatus, setPtyStatus] = useState<TerminalSession['status']>('idle');
  const [ptyError, setPtyError] = useState<string | null>(null);
  const ptyEndRef = useRef<HTMLDivElement | null>(null);
  const [sessionCapNotice, setSessionCapNotice] = useState<string | null>(null);

  const localSessionsApi = useTerminalSessions(
    props.projectPath,
    props.projectTrusted,
    useInteractivePty,
    props.currentCwd,
  );
  const terminalSessions = props.terminalSessions ?? localSessionsApi;

  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    addSession,
    closeSession,
    onSessionStatus,
    sidebarOpen,
  } = terminalSessions;

  // Keep the single-host (browser preview) pty scroll pinned to the bottom.
  useEffect(() => {
    if (!useInteractivePty) {
      ptyEndRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [props.ptyOutput, useInteractivePty]);

  // Single-host (browser mock) helpers.
  async function ensureHostPtyOpen(): Promise<string | null> {
    if (ptyId) return ptyId;
    setPtyStatus('starting');
    setPtyError(null);
    const response = await props.request({
      type: 'pty/open',
      input: { projectPath: props.projectPath ?? '', cwd: props.currentCwd },
    });
    if (!response.success) {
      setPtyStatus('error');
      setPtyError(response.error);
      return null;
    }
    const data = response.data as { ptyId?: string };
    if (!data.ptyId) {
      setPtyStatus('error');
      setPtyError('No pty id returned');
      return null;
    }
    setPtyId(data.ptyId);
    setPtyStatus('open');
    return data.ptyId;
  }

  async function handleSubmitLine(): Promise<void> {
    const text = inputLine;
    if (!text) return;
    const id = await ensureHostPtyOpen();
    if (!id) return;
    setInputLine('');
    await props.request({ type: 'pty/write', ptyId: id, data: `${text}\n` });
  }

  return (
    <section
      className="terminal-dock terminal-dock-panel open"
      data-testid="terminal-dock"
      data-variant="panel"
      data-pty-mode={useInteractivePty ? 'tauri' : 'shell-preview'}
      aria-label={isZh ? '终端' : 'Terminal'}
    >
      <div className="terminal-dock-body">
        <div
          className={`terminal-dock-content${sidebarOpen ? ' has-sidebar' : ''}`}
          data-testid="terminal-dock-content"
        >
          <div className="terminal-surface-main">
            <div className="pty-panel" data-testid="pty-panel">
              {!props.projectTrusted && props.projectPath ? (
                <div className="muted terminal-empty" data-testid="pty-untrusted">
                  Trust this project to open a shell (PTY requires trusted cwd).
                </div>
              ) : useInteractivePty ? (
                <div className="pty-xterm-wrap" data-testid="pty-xterm-wrap">
                  {sessions.length > 0 ? (
                    <>
                      {sessionCapNotice ? (
                        <Notice tone="warning" testId="terminal-session-cap-notice">
                          {sessionCapNotice}
                        </Notice>
                      ) : null}

                      <div className="terminal-dock-surfaces" data-testid="terminal-dock-surfaces">
                        {sessions.map((session) => (
                          <div
                            key={session.id}
                            className="terminal-dock-surface"
                            role="tabpanel"
                            hidden={session.id !== activeSessionId}
                            data-testid={`terminal-session-${session.id}`}
                          >
                            {session.status === 'error' && session.error ? (
                              <Notice tone="error">{session.error}</Notice>
                            ) : null}
                            {session.status === 'starting' ? (
                              <div className="muted terminal-empty">Starting interactive terminal…</div>
                            ) : null}
                            <XtermSurface
                              key={`${session.id}:${session.generation}`}
                              cwd={session.cwd}
                              {...(session.projectPath ? { projectPath: session.projectPath } : {})}
                              onStatus={(status, ptyId, message) => {
                                onSessionStatus(session.id, status, ptyId, message);
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="muted terminal-empty">No terminal session open.</div>
                  )}
                </div>
              ) : (
                <>
                  <div className="pty-stream" data-testid="pty-output" aria-live="polite">
                    {ptyStatus === 'starting' ? <div className="muted">Starting shell…</div> : null}
                    {ptyError ? <Notice tone="error">{ptyError}</Notice> : null}
                    {props.ptyOutput.length === 0 && ptyStatus === 'open' ? (
                      <div className="muted terminal-empty">
                        Line-oriented shell preview — interactive/TUI programs are unsupported. Desktop
                        (Tauri) uses a real PTY + xterm.
                      </div>
                    ) : null}
                    <pre className="pty-pre">{props.ptyOutput.map((line) => line.data).join('')}</pre>
                    <div ref={ptyEndRef} />
                  </div>
                  <form
                    className="pty-input-row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleSubmitLine();
                    }}
                  >
                    <span className="pty-prompt muted">$</span>
                    <input
                      className="pty-input"
                      data-testid="pty-input"
                      value={inputLine}
                      disabled={ptyStatus === 'starting'}
                      onChange={(event) => setInputLine(event.target.value)}
                      placeholder={isZh ? '命令 + Enter' : 'command + Enter'}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <Button
                      type="submit"
                      data-testid="pty-send-btn"
                      disabled={ptyStatus === 'starting'}
                    >
                      {isZh ? '发送' : 'Send'}
                    </Button>
                  </form>
                </>
              )}
            </div>
          </div>

          {useInteractivePty && sidebarOpen ? (
            <aside
              className="terminal-sessions-sidebar term-sb"
              data-testid="terminal-sessions-sidebar"
              aria-label={isZh ? '终端会话' : 'Terminal sessions'}
            >
              <div className="terminal-sessions-sidebar-header term-sb-h">
                <span className="terminal-sessions-count">
                  {isZh
                    ? `${sessions.length} 个终端`
                    : `${sessions.length} Terminal${sessions.length > 1 ? 's' : ''}`}
                </span>
                <button
                  type="button"
                  className="terminal-icon-button"
                  data-testid="terminal-session-add"
                  aria-label={isZh ? '新建终端会话' : 'New terminal session'}
                  title={isZh ? '新建终端会话' : 'New terminal session'}
                  onClick={() => {
                    const session = addSession();
                    if (session) {
                      setSessionCapNotice(null);
                      return;
                    }
                    setSessionCapNotice(
                      isZh
                        ? `最多同时打开 ${MAX_TERMINAL_SESSIONS} 个终端会话。`
                        : `At most ${MAX_TERMINAL_SESSIONS} terminal sessions can stay open.`,
                    );
                  }}
                >
                  <IconPlus width={12} height={12} />
                </button>
              </div>
              <div
                className="terminal-sessions-list"
                role="tablist"
                aria-label="Terminal sessions list"
              >
                {sessions.map((session) => {
                  const isActive = session.id === activeSessionId;
                  return (
                    <div
                      key={session.id}
                      className={
                        isActive ? 'terminal-session-item term-item act active' : 'terminal-session-item term-item'
                      }
                      role="tab"
                      aria-selected={isActive}
                      data-testid={`terminal-session-tab-${session.id}`}
                      onClick={() => setActiveSessionId(session.id)}
                    >
                      <span className="terminal-session-item-icon" aria-hidden>
                        <IconTerminal width={12} height={12} />
                      </span>
                      <span className="terminal-session-item-name">{session.name}</span>
                      {session.status === 'error' ? (
                        <span className="terminal-dock-session-dot error term-dot" aria-hidden />
                      ) : session.status === 'starting' ? (
                        <span className="terminal-dock-session-dot term-dot starting" aria-hidden />
                      ) : null}
                      {sessions.length > 1 ? (
                        <button
                          type="button"
                          className="terminal-session-item-close"
                          aria-label={`Close ${session.name}`}
                          data-testid={`terminal-session-close-${session.id}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            closeSession(session.id);
                          }}
                        >
                          <IconClose width={10} height={10} />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    </section>
  );
}
