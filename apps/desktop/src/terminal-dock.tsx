/**
 * Bottom activity dock for host events. A terminal is intentionally not exposed
 * until piwin can provide a real PTY rather than a misleading local echo stub.
 */

import { useEffect, useRef, type ReactElement } from 'react';
import type { HostLogEntry } from './HostLogPanel';
import { IconChevronDown, IconClose } from './shell-icons';

export type TerminalDockProps = {
  open: boolean;
  onToggle: () => void;
  entries: HostLogEntry[];
  onClearLogs: () => void;
  projectPath: string | null;
};

export function TerminalDock(props: TerminalDockProps): ReactElement {
  const outputEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    outputEndRef.current?.scrollIntoView({ block: 'end' });
  }, [props.entries, props.open]);

  const errorCount = props.entries.filter((entry) => entry.level === 'error').length;
  const warnCount = props.entries.filter((entry) => entry.level === 'warn').length;

  return (
    <section
      className={`terminal-dock${props.open ? ' open' : ' collapsed'}`}
      data-testid="terminal-dock"
      aria-label="Activity dock"
    >
      <header className="terminal-dock-header">
        <div className="terminal-dock-tabs" role="tablist">
          <button
            type="button"
            className="terminal-tab active"
            role="tab"
            aria-selected
            onClick={() => {
              if (!props.open) props.onToggle();
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
        </div>
        <div className="terminal-dock-actions">
          <button
            type="button"
            className="terminal-icon-button"
            onClick={props.onClearLogs}
            title="Clear activity"
            aria-label="Clear activity"
          >
            <IconClose />
          </button>
          <button
            type="button"
            className="terminal-icon-button"
            data-testid="terminal-dock-toggle"
            onClick={props.onToggle}
            title={props.open ? 'Hide activity dock' : 'Show activity dock'}
            aria-label={props.open ? 'Hide activity dock' : 'Show activity dock'}
          >
            <IconChevronDown
              className={props.open ? 'terminal-toggle-chevron expanded' : 'terminal-toggle-chevron'}
            />
          </button>
        </div>
      </header>

      {props.open ? (
        <div className="terminal-dock-body">
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
        </div>
      ) : null}
    </section>
  );
}
