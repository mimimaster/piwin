import { useMemo, useState, type ReactElement } from 'react';
import { Button, Select, StatusBadge, showSuccessNotification } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context.js';

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
};

const LEVEL_FILTERS: Array<HostLogLevel | 'all'> = ['all', 'info', 'warn', 'error'];

function isLevelFilter(value: string): value is HostLogLevel | 'all' {
  return LEVEL_FILTERS.includes(value as HostLogLevel | 'all');
}

function levelTone(level: HostLogLevel): 'danger' | 'warning' | 'neutral' {
  if (level === 'error') return 'danger';
  if (level === 'warn') return 'warning';
  return 'neutral';
}

/**
 * Settings Host log viewer. Uses ui-kit Select/Button/StatusBadge so it
 * matches the rest of the settings surface instead of inspector chrome.
 */
export function HostLogPanel({ entries, onClear }: HostLogPanelProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const [levelFilter, setLevelFilter] = useState<HostLogLevel | 'all'>('all');

  const visible = useMemo(() => {
    if (levelFilter === 'all') {
      return entries;
    }
    return entries.filter((entry) => entry.level === levelFilter);
  }, [entries, levelFilter]);

  async function handleCopy(): Promise<void> {
    const text = visible
      .map((entry) => `[${entry.at}] ${entry.level.toUpperCase()} ${entry.message}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showSuccessNotification(isZh ? '已复制 Host 日志' : 'Host log copied');
    } catch {
      // Clipboard may be denied; ignore.
    }
  }

  return (
    <div className="settings-host-log" data-testid="host-log-panel">
      <div className="settings-host-log-toolbar">
        <div className="settings-host-log-filter">
          <Select
            testId="settings-host-log-level"
            aria-label={isZh ? '筛选日志级别' : 'Filter host log level'}
            value={levelFilter}
            data={[
              { value: 'all', label: isZh ? '全部' : 'All' },
              { value: 'info', label: 'Info' },
              { value: 'warn', label: isZh ? '警告' : 'Warn' },
              { value: 'error', label: isZh ? '错误' : 'Error' },
            ]}
            onChange={(event) => {
              const next = event.currentTarget.value;
              if (isLevelFilter(next)) {
                setLevelFilter(next);
              }
            }}
          />
        </div>
        <Button
          size="compact"
          data-testid="settings-host-log-copy"
          disabled={visible.length === 0}
          onClick={() => void handleCopy()}
        >
          {isZh ? '复制' : 'Copy'}
        </Button>
        <Button
          size="compact"
          data-testid="settings-host-log-clear"
          disabled={entries.length === 0}
          onClick={onClear}
        >
          {isZh ? '清空' : 'Clear'}
        </Button>
      </div>
      <div className="settings-host-log-body" role="log" aria-live="polite">
        {visible.length === 0 ? (
          <p className="settings-host-log-empty" data-testid="settings-host-log-empty">
            {isZh ? '暂无 Host 日志。' : 'No host log lines yet.'}
          </p>
        ) : (
          <ul className="settings-host-log-list" data-testid="settings-host-log-list">
            {visible.map((entry) => (
              <li key={entry.id} className="settings-host-log-line">
                <span className="settings-host-log-time">{formatTime(entry.at)}</span>
                <StatusBadge tone={levelTone(entry.level)} label={entry.level} showDot />
                <span className="settings-host-log-message">{entry.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
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
  const id = current.length === 0 ? 1 : (current[current.length - 1]?.id ?? 0) + 1;
  const entry: HostLogEntry = { ...next, id };
  const merged = [...current, entry];
  if (merged.length <= maxEntries) {
    return merged;
  }
  return merged.slice(merged.length - maxEntries);
}
