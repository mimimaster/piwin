/**
 * Collapsible console/network drawer for the browser workbench (ADR 0057).
 */
import type { ReactElement } from 'react';

export type BrowserConsoleLine = {
  level: 'log' | 'warning' | 'error';
  text: string;
  ts: number;
};

export type BrowserNetworkLine = {
  method: string;
  url: string;
  status: number;
  duration: number;
  ts: number;
};

export const MAX_CONSOLE_LINES = 100;
export const MAX_NETWORK_LINES = 50;

export function capConsoleLines(lines: BrowserConsoleLine[]): BrowserConsoleLine[] {
  return lines.length > MAX_CONSOLE_LINES ? lines.slice(lines.length - MAX_CONSOLE_LINES) : lines;
}

export function capNetworkLines(lines: BrowserNetworkLine[]): BrowserNetworkLine[] {
  return lines.length > MAX_NETWORK_LINES ? lines.slice(lines.length - MAX_NETWORK_LINES) : lines;
}

export type BrowserDevDrawerRow = {
  label: string;
  value: string;
};

export type BrowserConsoleDrawerProps = {
  /** The chrome's developer button owns this state (spec §4.2). */
  open: boolean;
  consoleLines: BrowserConsoleLine[];
  networkLines: BrowserNetworkLine[];
  diagnosticRows?: BrowserDevDrawerRow[] | undefined;
};

export function BrowserConsoleDrawer(props: BrowserConsoleDrawerProps): ReactElement {
  const consoleLines = capConsoleLines(props.consoleLines);
  const networkLines = capNetworkLines(props.networkLines);

  if (!props.open) return <></>;

  const rows = props.diagnosticRows ?? [];

  return (
    <div className="browser-session-dev">
      <div className="browser-session-dev-body" data-testid="browser-session-dev-body">
          {rows.length > 0 ? (
            <dl className="browser-session-dev-metrics" data-testid="browser-session-dev-metrics">
              {rows.map((row) => (
                <div key={row.label} className="browser-session-dev-metric">
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <ul className="browser-session-dev-list">
            {consoleLines.map((line) => (
              <li key={`c-${line.ts}-${line.text}`} className={`browser-session-dev-${line.level}`}>
                {line.text}
              </li>
            ))}
            {networkLines.map((line) => (
              <li key={`n-${line.ts}-${line.method}-${line.url}`}>
                {line.method} {line.status} {line.url} ({line.duration}ms)
              </li>
            ))}
          </ul>
      </div>
    </div>
  );
}
