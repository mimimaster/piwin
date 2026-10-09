import { createWriteStream, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'node:util';
import { ProcessTerminal, TuiMainScreen } from '@earendil-works/pi-tui';
import type { RemoteProjectSummary, RemoteSessionListData } from '@piwin/contracts';
import { getPiwinRoot } from '@piwin/host-runtime';
import { parseMock, readOption } from '../cli-args.js';
import { TuiApp } from './tui-app.js';
import { hostData, openTuiHostLink, type TuiHostLink } from './tui-host-link.js';
import { resolveTuiLaunchScope } from './tui-launch-scope.js';

export const TUI_USAGE =
  'Usage: piwin tui [--session <id>] [--continue] [--project <projectId> | --project-path <dir>] [--embedded] [--mock]';

/**
 * `piwin tui`: the interactive terminal shell. Attaches to `PIWIN_HOST_URL`
 * when set, otherwise runs its own loopback Host for the lifetime of the TUI.
 */
export async function commandTui(argv: string[]): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('piwin tui needs an interactive terminal. Use `piwin chat <text>` for scripts.');
    process.exitCode = 1;
    return;
  }
  const mock = parseMock(argv);
  const embedded = argv.includes('--embedded');
  const restoreConsole = redirectConsoleToLog();
  let link: TuiHostLink;
  try {
    link = await openTuiHostLink({ mock, onHostError: (message) => console.error(message) });
  } catch (error) {
    restoreConsole();
    throw error;
  }

  let app: TuiApp | undefined;
  try {
    const { projects = [] } = hostData<{ projects?: RemoteProjectSummary[] }>(
      await link.request({ type: 'project/list' }),
    );
    const { projectId, notice } = resolveTuiLaunchScope({
      projects,
      explicitProjectId: readOption(argv, '--project'),
      explicitPath: readOption(argv, '--project-path'),
      cwd: process.cwd(),
      canonicalPath,
    });
    const sessionId =
      readOption(argv, '--session') ??
      (argv.includes('--continue') ? await findLatestSessionId(link, projectId) : undefined);
    const tui = new TuiMainScreen(new ProcessTerminal());
    await new Promise<void>((resolve, reject) => {
      app = new TuiApp({
        tui,
        link,
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(projectId === undefined ? {} : { projectId }),
        embedded,
        mock,
        ...(notice === undefined ? {} : { startNotice: notice }),
        onExit: () => {
          tui.stop();
          resolve();
        },
      });
      app.start().catch((error: unknown) => {
        tui.stop();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  } finally {
    app?.dispose();
    await link.dispose();
    restoreConsole();
  }
}

async function findLatestSessionId(link: TuiHostLink, projectId: string | undefined): Promise<string | undefined> {
  const list = hostData<RemoteSessionListData>(
    await link.request({
      type: 'session/list',
      scopeRef: projectId === undefined ? { kind: 'general' } : { kind: 'project', projectId },
      order: 'updated',
      maxItems: 20,
    }),
  );
  return list.sessions.find((session) => session.kind === undefined || session.kind === 'main')?.sessionId;
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    // A registered project whose folder is gone simply never matches the cwd.
    return path;
  }
}

/**
 * The TUI owns the screen. An in-process Host logs through `console`, which
 * would tear the frame, so console output goes to a log file while it runs.
 */
function redirectConsoleToLog(): () => void {
  const logDirectory = join(getPiwinRoot(), 'logs');
  mkdirSync(logDirectory, { recursive: true });
  const stream = createWriteStream(join(logDirectory, 'tui.log'), { flags: 'a' });
  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  const write =
    (level: string) =>
    (...values: unknown[]): void => {
      stream.write(`${new Date().toISOString()} ${level} ${format(...values)}\n`);
    };
  console.log = write('info');
  console.info = write('info');
  console.warn = write('warn');
  console.error = write('error');
  return () => {
    Object.assign(console, original);
    stream.end();
  };
}
