/**
 * Turn EADDRINUSE into an actionable Host start error.
 * 8787 is often a leftover browser/app, not a second piwin Host.
 */

import { execFileSync } from 'node:child_process';

export type ListenOccupant = {
  pid: number;
  command: string;
};

export function isAddressInUseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return 'code' in error && (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
}

export function isLikelyPiwinHostCommand(command: string): boolean {
  return /piwin[/-]host|@piwin\/host-app|apps\/host|host-serve\.mjs|piwin host serve/i.test(
    command,
  );
}

export function formatHostListenBusyError(input: {
  host: string;
  port: number;
  occupant?: ListenOccupant | null;
}): Error {
  const nextPort = input.port >= 65_535 ? 8788 : input.port + 1;
  const address = `${input.host}:${input.port}`;
  const occupant = input.occupant;
  const lines = [`listen EADDRINUSE: ${address} is already in use.`];
  if (occupant) {
    lines.push(`Occupant: pid ${occupant.pid} (${occupant.command}).`);
    if (isLikelyPiwinHostCommand(occupant.command)) {
      lines.push('That is already a piwin Host. Stop it first, then start this one.');
    } else {
      lines.push(
        `That process is not a piwin Host. Start this Host on a free port:`,
        `  PIWIN_HOST_PORT=${nextPort} pnpm --filter @piwin/host-app dev`,
        `Then point Desktop Shell at ws://127.0.0.1:${nextPort}`,
      );
    }
  } else {
    lines.push(
      `Stop whoever holds the port, or start on a free one: PIWIN_HOST_PORT=${nextPort}`,
    );
  }
  const error = new Error(lines.join('\n'));
  error.name = 'HostListenBusyError';
  (error as NodeJS.ErrnoException).code = 'EADDRINUSE';
  return error;
}

export function enrichHostListenError(error: unknown, host: string, port: number): Error {
  if (error instanceof Error && error.name === 'HostListenBusyError') return error;
  if (!isAddressInUseError(error)) {
    return error instanceof Error ? error : new Error('Unable to start Host server');
  }
  return formatHostListenBusyError({
    host,
    port,
    occupant: lookupListenOccupant(port),
  });
}

export function parseLsofDashF(stdout: string): { pid: number; command: string } | null {
  let pid: number | undefined;
  let command: string | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('p')) {
      const parsed = Number(line.slice(1));
      if (Number.isInteger(parsed) && parsed > 0) pid = parsed;
    } else if (line.startsWith('c') && line.length > 1) {
      command = line.slice(1).trim();
    }
  }
  if (pid === undefined || !command) return null;
  return { pid, command };
}

export function lookupListenOccupant(port: number): ListenOccupant | null {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  if (process.platform === 'win32') return null;
  try {
    const stdout = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-F', 'pc'], {
      encoding: 'utf8',
      timeout: 2_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const parsed = parseLsofDashF(stdout);
    if (!parsed) return null;
    const full = readProcessCommand(parsed.pid);
    return { pid: parsed.pid, command: full ?? parsed.command };
  } catch {
    return null;
  }
}

function readProcessCommand(pid: number): string | null {
  try {
    const stdout = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      timeout: 2_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return stdout.length > 0 ? stdout : null;
  } catch {
    return null;
  }
}
