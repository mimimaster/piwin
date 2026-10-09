/**
 * Test harness: a real `TuiApp` on a fake terminal, attached over the remote
 * protocol to a real mock Host. It is what a person at a terminal exercises,
 * minus the terminal emulator: tests type keys and read what was drawn.
 *
 * The screen is read as text that has been written since a mark, with escape
 * sequences removed. pi-tui redraws changed lines whole, so anything newly
 * visible shows up in that text.
 */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TuiMainScreen, type Terminal } from '@earendil-works/pi-tui';
import type { HostCommand, HostPush, HostResponse } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { HostRuntime } from '@piwin/host-runtime';
import { HostServer } from '@piwin/host-server';
import { connectCliAttachedHost } from '../attach-existing-host.js';
import { TuiApp } from './tui-app.js';
import { hostData, type TuiHostLink } from './tui-host-link.js';

export const KEY = {
  enter: '\r',
  escape: '\x1b',
  up: '\x1b[A',
  down: '\x1b[B',
  tab: '\t',
  shiftTab: '\x1b[Z',
  ctrlC: '\x03',
  ctrlD: '\x04',
  ctrlS: '\x13',
  ctrlR: '\x12',
  ctrlP: '\x10',
  ctrlT: '\x14',
  ctrlX: '\x18',
} as const;

const ANSI_PATTERN = /\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[_P^][^\x1b]*\x1b\\|\x1b[@-Z\\-_]/g;
const WAIT_TIMEOUT_MS = 4_000;
const POLL_MS = 15;

class FakeTerminal implements Terminal {
  public readonly kittyProtocolActive = false;
  public title = '';
  private output = '';
  private onInput: ((data: string) => void) | undefined;

  public constructor(
    public readonly columns: number,
    public readonly rows: number,
  ) {}

  public start(onInput: (data: string) => void): void {
    this.onInput = onInput;
  }
  public stop(): void {
    this.onInput = undefined;
  }
  public async drainInput(): Promise<void> {}
  public write(data: string): void {
    this.output += data;
  }
  public moveBy(): void {}
  public hideCursor(): void {}
  public showCursor(): void {}
  public clearLine(): void {}
  public clearFromCursor(): void {}
  public clearScreen(): void {}
  public setTitle(title: string): void {
    this.title = title;
  }
  public setProgress(): void {}

  public type(data: string): void {
    this.onInput?.(data);
  }
  public get length(): number {
    return this.output.length;
  }
  public textSince(mark: number): string {
    return this.output.slice(mark).replace(ANSI_PATTERN, '');
  }
}

export type TuiHarnessOptions = {
  /** Register a throwaway project and start the TUI inside it. */
  project?: boolean;
  /** Mock runs that never finish until interrupted. */
  hangingRuns?: boolean;
  embedded?: boolean;
  /** Open the session picker once after start (bare `--resume`). */
  openSessionPicker?: boolean;
  /** What the launch tells the user once, e.g. a scope it could not honour. */
  startNotice?: string;
};

export type TuiHarness = {
  /** Absolute path of the registered project, when one was asked for. */
  projectPath: string | undefined;
  /** Type characters or keys, one terminal read each, as a person would. */
  press: (...keys: string[]) => Promise<void>;
  /** Type text and press Enter. */
  submit: (text: string) => Promise<void>;
  /** Paste text as one bracketed paste (newlines stay newlines). */
  paste: (text: string) => Promise<void>;
  /** Forget what has been drawn so far; `waitFor` and `seen` look only after this. */
  mark: () => void;
  /** Resolve once `text` has been drawn since the last mark. */
  waitFor: (text: string) => Promise<void>;
  /** Everything drawn since the last mark, without escape sequences. */
  seen: () => string;
  /**
   * Hold the Host's pushes to the TUI, as a slow link would; they arrive in
   * order when the returned release is called. Opens timing windows exactly.
   */
  holdPushes: () => () => void;
  /**
   * Hold the TUI's requests of one command type until the returned gate
   * passes them on or fails them, as a slow or failing Host would.
   */
  holdRequests: (type: HostCommand['type']) => RequestGate;
  /** Send a command as another shell attached to the same Host would. */
  asOtherShell: (command: HostCommand) => Promise<HostResponse>;
  /** Id of the session the TUI shows; throws while it has none. */
  sessionId: () => string;
  /** Whether a turn is running in the TUI's view right now. */
  isRunning: () => boolean;
  /** Resolve once no turn is running in the TUI's view. */
  waitForIdle: () => Promise<void>;
  /** Files the TUI handed to a browser. Nothing is ever really opened in a test. */
  openedFiles: () => string[];
  exited: () => boolean;
  dispose: () => Promise<void>;
};

export type RequestGate = {
  /** Send the held requests to the Host. */
  release: () => void;
  /** Answer the held requests with this failure instead. */
  fail: (error: string) => void;
};

export async function startTuiHarness(options: TuiHarnessOptions = {}): Promise<TuiHarness> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'piwin-tui-e2e-'));
  const piwinRoot = path.join(sandbox, 'root');
  const projectPath = options.project === true ? createProjectFixture(sandbox) : undefined;

  const runtime = new HostRuntime({
    mode: 'sdk',
    mock: true,
    mockSubagents: true,
    mockFileChanges: true,
    piwinRoot,
    ...(options.hangingRuns === true ? { testFixture: 'hang-until-abort' as const } : {}),
  });
  let projectId: string | undefined;
  if (projectPath !== undefined) {
    await runtime.handleCommand({ type: 'project/open', path: projectPath });
    await runtime.handleCommand({ type: 'project/trust', path: projectPath });
  }
  const authToken = randomUUID();
  const server = new HostServer({
    runtime,
    mode: 'sdk',
    host: '127.0.0.1',
    port: 0,
    instanceId: runtime.getHostInstanceId(),
    authToken,
    piwinRoot,
    pairingEnabled: false,
  });
  const address = await server.start();
  const target = { endpoint: address.url, authToken };
  const client = await connectCliAttachedHost(target, piwinRoot, { liveSubscriptions: true });
  const other = await connectCliAttachedHost(target, path.join(sandbox, 'other-shell'));

  const request = (shell: HostClient) => (command: HostCommand) =>
    shell.request(command, { idempotencyKey: randomUUID() });
  // Pushes reach the TUI through this gate so a test can hold them back.
  let heldPushes: HostPush[] | undefined;
  const pushListeners = new Set<(push: HostPush) => void>();
  client.subscribePush((push) => {
    if (heldPushes !== undefined) heldPushes.push(push);
    else for (const listener of pushListeners) listener(push);
  });
  const gatedClient = new Proxy(client, {
    get(target, property, receiver) {
      if (property === 'subscribePush') {
        return (listener: (push: HostPush) => void) => {
          pushListeners.add(listener);
          return () => pushListeners.delete(listener);
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  // Requests leave through this gate so a test can hold or fail one type.
  const heldRequests = new Map<HostCommand['type'], Promise<string | undefined>>();
  const gatedRequest = async (command: HostCommand): Promise<HostResponse> => {
    const failure = await heldRequests.get(command.type);
    if (failure !== undefined) {
      return { type: 'response', command: command.type, success: false, error: failure };
    }
    return request(client)(command);
  };
  const link: TuiHostLink = {
    client: gatedClient,
    kind: 'attached',
    endpoint: address.url,
    request: gatedRequest,
    dispose: () => client.close(),
  };
  if (projectPath !== undefined) {
    const listed = hostData<{ projects: Array<{ projectId: string }> }>(await link.request({ type: 'project/list' }));
    projectId = listed.projects[0]?.projectId;
  }

  const terminal = new FakeTerminal(110, 40);
  const tui = new TuiMainScreen(terminal);
  let exited = false;
  const openedFiles: string[] = [];
  const app = new TuiApp({
    tui,
    link,
    ...(projectId === undefined ? {} : { projectId }),
    embedded: options.embedded === true,
    mock: true,
    ...(options.openSessionPicker === true ? { openSessionPicker: true } : {}),
    ...(options.startNotice === undefined ? {} : { startNotice: options.startNotice }),
    openFile: async (filePath) => {
      openedFiles.push(filePath);
    },
    onExit: () => {
      exited = true;
      tui.stop();
    },
  });
  await app.start();

  let markAt = 0;
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, POLL_MS));
  const harness: TuiHarness = {
    projectPath,
    press: async (...keys) => {
      for (const key of keys) {
        terminal.type(key);
        await settle();
      }
    },
    submit: async (text) => {
      // Characters one by one: completion popups react to typing, not to a blob.
      for (const character of text) terminal.type(character);
      await settle();
      // An open slash-command popup takes the first Enter to accept its selection.
      terminal.type(KEY.enter);
      await settle();
    },
    paste: async (text) => {
      terminal.type(`\x1b[200~${text}\x1b[201~`);
      await settle();
    },
    mark: () => {
      markAt = terminal.length;
    },
    waitFor: async (text) => {
      const deadline = Date.now() + WAIT_TIMEOUT_MS;
      while (!terminal.textSince(markAt).includes(text)) {
        if (Date.now() > deadline) {
          // Spinner frames repeat many times a second and would crowd out what matters.
          const tail = terminal
            .textSince(markAt)
            .replace(/ *[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] [^·\n]* · Esc 中断 */g, '')
            .slice(-1500);
          throw new Error(`Timed out waiting for "${text}". Drawn since the mark:\n${tail}`);
        }
        await settle();
      }
    },
    seen: () => terminal.textSince(markAt),
    holdPushes: () => {
      heldPushes ??= [];
      return () => {
        const pending = heldPushes ?? [];
        heldPushes = undefined;
        for (const push of pending) for (const listener of pushListeners) listener(push);
      };
    },
    holdRequests: (type) => {
      let open: (failure: string | undefined) => void = () => undefined;
      heldRequests.set(type, new Promise((resolve) => (open = resolve)));
      const settle = (failure: string | undefined): void => {
        heldRequests.delete(type);
        open(failure);
      };
      return { release: () => settle(undefined), fail: (error) => settle(error) };
    },
    asOtherShell: request(other),
    sessionId: () => {
      // Read from the TUI itself: a session stopped before its first message
      // was stored has no name yet and is not listed by the Host.
      const sessionId = app.currentSessionId();
      if (sessionId === undefined) throw new Error('The TUI has no session yet');
      return sessionId;
    },
    isRunning: () => app.isRunning(),
    waitForIdle: async () => {
      const deadline = Date.now() + WAIT_TIMEOUT_MS;
      while (app.isRunning()) {
        if (Date.now() > deadline) throw new Error('Timed out waiting for the turn to finish');
        await settle();
      }
    },
    openedFiles: () => [...openedFiles],
    exited: () => exited,
    dispose: async () => {
      app.dispose();
      tui.stop();
      await client.close().catch(() => undefined);
      await other.close().catch(() => undefined);
      await server.stop().catch(() => undefined);
      await runtime.dispose().catch(() => undefined);
      // Exported artifact pages live in their own temp directories.
      for (const filePath of openedFiles) rmSync(path.dirname(filePath), { recursive: true, force: true });
      rmSync(sandbox, { recursive: true, force: true, maxRetries: 3 });
    },
  };
  return harness;
}

/** A small git repository: project features (file refs, changes) need a real one. */
function createProjectFixture(sandbox: string): string {
  const projectPath = path.join(sandbox, 'fixture');
  mkdirSync(path.join(projectPath, 'src', 'ui'), { recursive: true });
  mkdirSync(path.join(projectPath, 'docs'), { recursive: true });
  writeFileSync(path.join(projectPath, 'README.md'), '# fixture\n');
  writeFileSync(path.join(projectPath, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(path.join(projectPath, 'src', 'ui', 'button.tsx'), 'export const Button = null;\n');
  writeFileSync(path.join(projectPath, 'docs', 'user guide.md'), 'guide\n');
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: projectPath, stdio: 'ignore' });
  };
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=piwin-test', '-c', 'user.email=test@piwin.invalid', 'commit', '-q', '-m', 'fixture');
  return projectPath;
}
