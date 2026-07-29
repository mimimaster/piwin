/**
 * Terminal panel body (right-panel tab).
 * - Tauri desktop: interactive multi-session PTY via Rust portable-pty + xterm.js (ADR 0013)
 * - Browser mock / non-Tauri: host pty/* line-oriented Shell preview
 *
 * The Tauri path now supports multiple zsh sessions inside the Terminal side tool.
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { HostResponse } from '@piwin/contracts';
import { Button, Notice } from '@piwin/ui-kit';
import { isTauriPtyAvailable } from './tauri-pty';
import { XtermSurface } from './xterm-surface';
import { IconClose, IconPlus, IconRefresh } from './shell-icons';
import { useTerminalSessions, type TerminalSession } from './use-terminal-sessions';

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
  request: (command: {
    type: 'pty/open' | 'pty/write' | 'pty/resize' | 'pty/close' | 'pty/list';
    input?: { projectPath: string; cwd?: string; cols?: number; rows?: number };
    ptyId?: string;
    data?: string;
    cols?: number;
    rows?: number;
    projectPath?: string;
  }) => Promise<HostResponse>;
};

export function TerminalDock(props: TerminalDockProps): ReactElement {
  const useInteractivePty = isTauriPtyAvailable();
  const [inputLine, setInputLine] = useState('');
  const [ptyId, setPtyId] = useState<string | null>(null);
  const [ptyStatus, setPtyStatus] = useState<TerminalSession['status']>('idle');
  const [ptyError, setPtyError] = useState<string | null>(null);
  const ptyEndRef = useRef<HTMLDivElement | null>(null);

  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    addSession,
    closeSession,
    restartSession,
    onSessionStatus,
  } = useTerminalSessions(props.projectPath, props.projectTrusted, useInteractivePty);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  // Keep the single-host (browser preview) pty scroll pinned to the bottom.
  useEffect(() => {
    if (!useInteractivePty) {
      ptyEndRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [props.ptyOutput, useInteractivePty]);

  // Single-host (browser mock) helpers.
  async function ensureHostPtyOpen(): Promise<string | null> {
    if (ptyId) return ptyId;
    if (!props.projectPath || !props.projectTrusted) return null;
    setPtyStatus('starting');
    setPtyError(null);
    const response = await props.request({
      type: 'pty/open',
      input: { projectPath: props.projectPath },
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

  async function closeHostPty(): Promise<void> {
    if (!ptyId) return;
    await props.request({ type: 'pty/close', ptyId });
    setPtyId(null);
    setPtyStatus('idle');
  }

  async function handleRestartHostPty(): Promise<void> {
    await closeHostPty();
    props.onClearPtyOutput();
    await ensureHostPtyOpen();
  }

  async function handleSubmitLine(): Promise<void> {
    const text = inputLine;
    if (!text) return;
    const id = await ensureHostPtyOpen();
    if (!id) return;
    setInputLine('');
    await props.request({ type: 'pty/write', ptyId: id, data: `${text}\n` });
  }

  const liveBadge =
    useInteractivePty && activeSession?.status === 'open'
      ? 'live'
      : !useInteractivePty && ptyStatus === 'open'
        ? 'preview'
        : null;

  const sessionCount = sessions.length;

  return (
    <section
      className="terminal-dock terminal-dock-panel open"
      data-testid="terminal-dock"
      data-variant="panel"
      data-pty-mode={useInteractivePty ? 'tauri' : 'shell-preview'}
      aria-label="Terminal"
    >
      <header className="terminal-dock-header terminal-dock-header--minimal">
        <div className="terminal-dock-title muted">
          {useInteractivePty ? 'Terminal' : 'Shell'}
          {liveBadge ? <span className="terminal-tab-count">{liveBadge}</span> : null}
          {useInteractivePty && sessionCount > 1 ? (
            <span className="terminal-tab-count" aria-label={`${sessionCount} sessions`}>
              {sessionCount}
            </span>
          ) : null}
        </div>
        <div className="terminal-dock-actions">
          {useInteractivePty ? (
            <button
              type="button"
              className="terminal-icon-button"
              data-testid="pty-restart-btn"
              title="Restart active terminal"
              aria-label="Restart active terminal"
              onClick={() => {
                if (activeSession) {
                  restartSession(activeSession.id);
                }
              }}
            >
              <IconRefresh width={14} height={14} />
            </button>
          ) : (
            <button
              type="button"
              className="terminal-icon-button"
              data-testid="pty-restart-btn"
              title="Restart shell"
              aria-label="Restart shell"
              onClick={() => {
                void handleRestartHostPty();
              }}
            >
              <IconRefresh width={14} height={14} />
            </button>
          )}
        </div>
      </header>

      <div className="terminal-dock-body">
        <div className="pty-panel" data-testid="pty-panel">
          {!props.projectPath ? (
            <div className="muted terminal-empty">Open a project to use the terminal.</div>
          ) : !props.projectTrusted ? (
            <div className="muted terminal-empty" data-testid="pty-untrusted">
              Trust this project to open a shell (PTY requires trusted cwd).
            </div>
          ) : useInteractivePty ? (
            <div className="pty-xterm-wrap" data-testid="pty-xterm-wrap">
              {sessions.length > 0 ? (
                <>
                  <div className="terminal-dock-session-strip" role="tablist" aria-label="Terminal sessions">
                    {sessions.map((session) => {
                      const isActive = session.id === activeSessionId;
                      return (
                        <div
                          key={session.id}
                          className={isActive ? 'terminal-dock-session active' : 'terminal-dock-session'}
                          role="tab"
                          aria-selected={isActive}
                          data-testid={`terminal-session-tab-${session.id}`}
                        >
                          <button
                            type="button"
                            className="terminal-dock-session-main"
                            onClick={() => setActiveSessionId(session.id)}
                            title={session.name}
                          >
                            <span className="terminal-dock-session-name">{session.name}</span>
                            {session.status === 'error' ? (
                              <span className="terminal-dock-session-dot error" aria-hidden />
                            ) : session.status === 'starting' ? (
                              <span className="terminal-dock-session-dot" aria-hidden />
                            ) : null}
                          </button>
                          <button
                            type="button"
                            className="terminal-dock-session-close"
                            aria-label={`Close ${session.name}`}
                            data-testid={`terminal-session-close-${session.id}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              closeSession(session.id);
                            }}
                          >
                            <IconClose width={10} height={10} />
                          </button>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      className="terminal-dock-session-add"
                      data-testid="terminal-session-add"
                      aria-label="New terminal session"
                      title="New terminal session"
                      onClick={() => addSession()}
                    >
                      <IconPlus width={12} height={12} />
                    </button>
                  </div>

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
                          projectPath={session.projectPath}
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
                    Line-oriented shell preview — interactive/TUI programs are unsupported.
                    Desktop (Tauri) uses a real PTY + xterm.
                  </div>
                ) : null}
                <pre className="pty-pre">
                  {props.ptyOutput.map((line) => line.data).join('')}
                </pre>
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
                  disabled={ptyStatus === 'starting' || !props.projectTrusted}
                  onChange={(event) => setInputLine(event.target.value)}
                  placeholder="command + Enter"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  type="submit"
                  data-testid="pty-send-btn"
                  disabled={ptyStatus === 'starting' || !props.projectTrusted}
                >
                  Send
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
