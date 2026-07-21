import { useMemo, useState, type ReactElement } from 'react';

export type HostLogLevel = 'info' | 'warn' | 'error';

export type HostLogEntry = {
  id: number;
  level: HostLogLevel;
  message: string;
  at: string;
};

export type HostLogPanelProps = {
  entries: HostLogEntry[];
  onClear: () => void;
  open: boolean;
  onToggle: () => void;
};

const LEVEL_FILTERS: Array<HostLogLevel | 'all'> = ['all', 'info', 'warn', 'error'];

/**
 * Collapsible host/log ring-buffer panel (D-M2-07).
 * Lets users see MCP / permission diagnostics without DevTools.
 */
export function HostLogPanel({
  entries,
  onClear,
  open,
  onToggle,
}: HostLogPanelProps): ReactElement {
  const [levelFilter, setLevelFilter] = useState<HostLogLevel | 'all'>('all');

  const visible = useMemo(() => {
    if (levelFilter === 'all') {
      return entries;
    }
    return entries.filter((entry) => entry.level === levelFilter);
  }, [entries, levelFilter]);

  const errorCount = entries.filter((entry) => entry.level === 'error').length;
  const warnCount = entries.filter((entry) => entry.level === 'warn').length;

  async function handleCopy(): Promise<void> {
    const text = visible
      .map((entry) => `[${entry.at}] ${entry.level.toUpperCase()} ${entry.message}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard may be denied; ignore.
    }
  }

  return (
    <section className={`host-log-panel ${open ? 'open' : 'collapsed'}`}>
      <header className="host-log-header">
        <button type="button" className="btn ghost host-log-toggle" onClick={onToggle}>
          {open ? '▾' : '▸'} Host log
          <span className="muted host-log-counts">
            {entries.length}
            {warnCount > 0 ? ` · ${warnCount} warn` : ''}
            {errorCount > 0 ? ` · ${errorCount} err` : ''}
          </span>
        </button>
        {open ? (
          <div className="host-log-actions">
            <select
              className="select"
              value={levelFilter}
              onChange={(event) => {
                const next = event.target.value as HostLogLevel | 'all';
                setLevelFilter(next);
              }}
              aria-label="Filter host log level"
            >
              {LEVEL_FILTERS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
            <button type="button" className="btn" onClick={() => void handleCopy()}>
              Copy
            </button>
            <button type="button" className="btn" onClick={onClear}>
              Clear
            </button>
          </div>
        ) : null}
      </header>
      {open ? (
        <div className="host-log-body" role="log" aria-live="polite">
          {visible.length === 0 ? (
            <p className="muted">No host log lines yet.</p>
          ) : (
            <ul className="host-log-list">
              {visible.map((entry) => (
                <li key={entry.id} className={`host-log-line level-${entry.level}`}>
                  <span className="host-log-time">{formatTime(entry.at)}</span>
                  <span className="host-log-level">{entry.level}</span>
                  <span className="host-log-message">{entry.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

function formatTime(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString();
  } catch {
    return iso;
  }
}

/** Append to a ring buffer, keeping at most maxEntries (newest last). */
export function appendHostLogEntry(
  current: HostLogEntry[],
  next: Omit<HostLogEntry, 'id'>,
  maxEntries = 200,
): HostLogEntry[] {
  const id =
    current.length === 0 ? 1 : (current[current.length - 1]?.id ?? 0) + 1;
  const entry: HostLogEntry = { ...next, id };
  const merged = [...current, entry];
  if (merged.length <= maxEntries) {
    return merged;
  }
  return merged.slice(merged.length - maxEntries);
}
