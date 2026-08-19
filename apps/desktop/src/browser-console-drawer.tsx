/**
 * Collapsible console/network drawer for the browser workbench (ADR 0057).
 */
import { useState, type ReactElement } from 'react';

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

export type BrowserConsoleDrawerProps = {
  consoleLines: BrowserConsoleLine[];
  networkLines: BrowserNetworkLine[];
};

export function BrowserConsoleDrawer(props: BrowserConsoleDrawerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const consoleLines = capConsoleLines(props.consoleLines);
  const networkLines = capNetworkLines(props.networkLines);

  return (
    <div className="browser-session-dev">
      <button
        type="button"
        className="browser-session-dev-toggle"
        data-testid="browser-session-dev-toggle"
        onClick={() => setOpen((current) => !current)}
      >
        Console / Network
      </button>
      {open ? (
        <div className="browser-session-dev-body" data-testid="browser-session-dev-body">
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
      ) : null}
    </div>
  );
}
