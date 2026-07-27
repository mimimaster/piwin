/**
 * Bottom dock: Activity (host logs) + Terminal/Shell.
 * - Tauri desktop: interactive PTY via Rust portable-pty + xterm.js (ADR 0013)
 * - Browser mock / non-Tauri: host pty/* line-oriented Shell preview
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { HostResponse } from '@piwin/contracts';
import type { HostLogEntry } from './HostLogPanel';
import { IconClose } from './shell-icons';
import { Button, Notice } from '@piwin/ui-kit';
import { isTauriPtyAvailable, tauriPtyCloseAll } from './tauri-pty';
import { XtermSurface } from './xterm-surface';

export type PtyOutputLine = {
  id: string;
  data: string;
  at: string;
};

export type TerminalDockProps = {
  entries: HostLogEntry[];
  onClearLogs: () => void;
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

type DockTab = 'activity' | 'terminal';
type PtyStatus = 'idle' | 'starting' | 'open' | 'error' | 'exited';

export function TerminalDock(props: TerminalDockProps): ReactElement {
  const useInteractivePty = isTauriPtyAvailable();
  const [tab, setTab] = useState<DockTab>('terminal');
  const [ptyId, setPtyId] = useState<string | null>(null);
  const [ptyStatus, setPtyStatus] = useState<PtyStatus>('idle');
  const [ptyError, setPtyError] = useState<string | null>(null);
  const [inputLine, setInputLine] = useState('');
  /** Bump to remount xterm after restart. */
  const [xtermGeneration, setXtermGeneration] = useState(0);
  const [xtermActive, setXtermActive] = useState(false);
  const outputEndRef = useRef<HTMLDivElement | null>(null);
  const ptyEndRef = useRef<HTMLDivElement | null>(null);

  // Prefer interactive/shell tab and auto-start when project is trusted.
  useEffect(() => {
    if (tab !== 'terminal') {
      setTab('terminal');
    }
    if (props.projectPath && props.projectTrusted) {
      if (useInteractivePty) {
        setXtermActive(true);
        setPtyStatus((current) => (current === 'idle' ? 'starting' : current));
      }
    }
  }, [props.projectPath, props.projectTrusted, tab, useInteractivePty]);

  useEffect(() => {
    if (tab === 'activity') {
      outputEndRef.current?.scrollIntoView({ block: 'end' });
    } else if (!useInteractivePty) {
      ptyEndRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [props.entries, props.ptyOutput, tab, useInteractivePty]);

  const closeHostPty = useCallback(async () => {
    if (!ptyId) return;
    await props.request({ type: 'pty/close', ptyId });
    setPtyId(null);
    setPtyStatus('idle');
  }, [ptyId, props]);

  const closeInteractivePty = useCallback(async () => {
    setXtermActive(false);
    setPtyStatus('idle');
    setPtyError(null);
    try {
      await tauriPtyCloseAll();
    } catch {
      /* ignore if not in Tauri */
    }
  }, []);

  // Close PTY when project changes or becomes untrusted
  useEffect(() => {
    if (!props.projectPath || !props.projectTrusted) {
      if (useInteractivePty) {
        void closeInteractivePty();
      } else {
        void closeHostPty();
      }
      props.onClearPtyOutput();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.projectPath, props.projectTrusted, useInteractivePty]);

  async function ensureHostPtyOpen(): Promise<string | null> {
    if (ptyId && ptyStatus === 'open') return ptyId;
    if (!props.projectPath) {
      setPtyError('Open a project first');
      setPtyStatus('error');
      return null;
    }
    if (!props.projectTrusted) {
      setPtyError('Trust the project to open a terminal');
      setPtyStatus('error');
      return null;
    }
    setPtyStatus('starting');
    setPtyError(null);
    props.onClearPtyOutput();
    const response = await props.request({
      type: 'pty/open',
      input: { projectPath: props.projectPath },
    });
    if (!response.success) {
      setPtyError(response.error);
      setPtyStatus('error');
      return null;
    }
    const data = response.data as { pty: { id: string } };
    setPtyId(data.pty.id);
    setPtyStatus('open');
    return data.pty.id;
  }

  async function handleSelectTerminal(): Promise<void> {
    setTab('terminal');
    if (!props.projectPath || !props.projectTrusted) {
      setXtermActive(false);
      return;
    }
    if (useInteractivePty) {
      setPtyError(null);
      setXtermActive(true);
      setPtyStatus('starting');
      return;
    }
    await ensureHostPtyOpen();
  }

  async function handleRestart(): Promise<void> {
    if (useInteractivePty) {
      await closeInteractivePty();
      setXtermGeneration((value) => value + 1);
      if (props.projectPath && props.projectTrusted) {
        setXtermActive(true);
        setPtyStatus('starting');
      }
      return;
    }
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

  const errorCount = props.entries.filter((entry) => entry.level === 'error').length;
  const warnCount = props.entries.filter((entry) => entry.level === 'warn').length;
  const terminalLabel = useInteractivePty ? 'Terminal' : 'Shell';
  const terminalBadge =
    ptyStatus === 'open'
      ? useInteractivePty
        ? 'live'
        : 'preview'
      : null;

  return (
    <section
      className="terminal-dock terminal-dock-panel open"
      data-testid="terminal-dock"
      data-variant="panel"
      data-pty-mode={useInteractivePty ? 'tauri' : 'shell-preview'}
      aria-label="Activity and Terminal"
    >
      <header className="terminal-dock-header">
        <div className="terminal-dock-tabs" role="tablist">
          <button
            type="button"
            className={tab === 'activity' ? 'terminal-tab active' : 'terminal-tab'}
            role="tab"
            aria-selected={tab === 'activity'}
            data-testid="dock-tab-activity"
            onClick={() => {
              setTab('activity');
            }}
          >
            Activity
            {props.entries.length > 0 ? (
              <span className="terminal-tab-count">{props.entries.length}</span>
            ) : null}
            {errorCount > 0 ? (
              <span className="terminal-tab-badge err">{errorCount}</span>
            ) : warnCount > 0 ? (
              <span className="terminal-tab-badge warn">{warnCount}</span>
            ) : null}
          </button>
          <button
            type="button"
            className={tab === 'terminal' ? 'terminal-tab active' : 'terminal-tab'}
            role="tab"
            aria-selected={tab === 'terminal'}
            data-testid="dock-tab-terminal"
            onClick={() => void handleSelectTerminal()}
          >
            {terminalLabel}
            {terminalBadge ? <span className="terminal-tab-count">{terminalBadge}</span> : null}
          </button>
        </div>
        <div className="terminal-dock-actions">
          {tab === 'activity' ? (
            <button
              type="button"
              className="terminal-icon-button"
              onClick={props.onClearLogs}
              title="Clear activity"
              aria-label="Clear activity"
            >
              <IconClose />
            </button>
          ) : (
            <button
              type="button"
              className="terminal-icon-button"
              data-testid="pty-restart-btn"
              title={useInteractivePty ? 'Restart terminal' : 'Restart shell'}
              aria-label={useInteractivePty ? 'Restart terminal' : 'Restart shell'}
              onClick={() => {
                void handleRestart();
              }}
            >
              ↻
            </button>
          )}
          
        </div>
      </header>

      {true ? (
        <div className="terminal-dock-body">
          {tab === 'activity' ? (
            <div className="terminal-stream" data-testid="terminal-output">
              {props.entries.length === 0 ? (
                <div className="muted terminal-empty">No host activity yet.</div>
              ) : (
                props.entries.map((entry) => (
                  <div key={entry.id} className={`terminal-line level-${entry.level}`}>
                    <span className="terminal-time muted">{entry.at.slice(11, 19)}</span>
                    <span className="terminal-level">{entry.level}</span>
                    <span className="terminal-text">{entry.message}</span>
                  </div>
                ))
              )}
              <div ref={outputEndRef} />
            </div>
          ) : (
            <div className="pty-panel" data-testid="pty-panel">
              {!props.projectPath ? (
                <div className="muted terminal-empty">Open a project to use the terminal.</div>
              ) : !props.projectTrusted ? (
                <div className="muted terminal-empty" data-testid="pty-untrusted">
                  Trust this project to open a shell (PTY requires trusted cwd).
                </div>
              ) : useInteractivePty ? (
                <div className="pty-xterm-wrap" data-testid="pty-xterm-wrap">
                  {ptyError ? <Notice tone="error">{ptyError}</Notice> : null}
                  {ptyStatus === 'starting' ? (
                    <div className="muted terminal-empty">Starting interactive terminal…</div>
                  ) : null}
                  <XtermSurface
                    key={`${props.projectPath}:${xtermGeneration}`}
                    projectPath={props.projectPath}
                    active={xtermActive && tab === 'terminal'}
                    onStatus={(status, message) => {
                      setPtyStatus(status);
                      if (status === 'error') {
                        setPtyError(message ?? 'PTY open failed');
                      } else if (status === 'open') {
                        setPtyError(null);
                      }
                    }}
                  />
                </div>
              ) : (
                <>
                  <div className="pty-stream" data-testid="pty-output" aria-live="polite">
                    {ptyStatus === 'starting' ? (
                      <div className="muted">Starting shell…</div>
                    ) : null}
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
          )}
        </div>
      ) : null}
    </section>
  );
}
