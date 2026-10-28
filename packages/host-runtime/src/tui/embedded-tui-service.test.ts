import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatTuiSessionAnnouncement, type HostPush, type HostResponse } from '@piwin/contracts';
import type { InteractiveTerminalInput, InteractiveTerminalSpawn } from '@piwin/process';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import { HostTerminalRegistry } from '../terminal/host-terminal-registry.js';
import {
  embeddedTuiArguments,
  embeddedTuiEnvironment,
  handleEmbeddedTuiCommand,
  MAX_EMBEDDED_TUIS,
} from './embedded-tui-service.js';

type Spawned = {
  input: InteractiveTerminalInput;
  emit: (data: string) => void;
  resized: Array<[number, number]>;
  killed: boolean;
};

let root: string;
let spawned: Spawned[];
let deps: HostRuntimeKernel;

function fakeSpawn(): InteractiveTerminalSpawn {
  return (input) => {
    let onData: (data: string) => void = () => undefined;
    let onExit: (event: { exitCode: number }) => void = () => undefined;
    const record: Spawned = { input, emit: (data) => onData(data), resized: [], killed: false };
    spawned.push(record);
    return {
      write: () => undefined,
      resize: (cols: number, rows: number) => { record.resized.push([cols, rows]); },
      kill: () => { record.killed = true; onExit({ exitCode: 0 }); },
      onData: (listener: (data: string) => void) => { onData = listener; return { dispose: () => undefined }; },
      onExit: (listener: (event: { exitCode: number }) => void) => { onExit = listener; return { dispose: () => undefined }; },
    } as unknown as ReturnType<InteractiveTerminalSpawn>;
  };
}

async function open(input: Record<string, unknown>): Promise<HostResponse> {
  const response = await handleEmbeddedTuiCommand(deps, { type: 'tui/open', input: { cols: 48, rows: 30, ...input } } as never, 'r');
  if (response === null) throw new Error('not handled');
  return response;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'piwin-embedded-tui-'));
  spawned = [];
  const pushes: HostPush[] = [];
  const kernel = {
    options: {
      mode: 'sdk',
      piwinRoot: root,
      embeddedTui: {
        openLoopbackEntrance: vi.fn(async () => ({ endpoint: 'ws://127.0.0.1:4321', authToken: 'door' })),
        invocation: { program: '/usr/bin/node', args: ['/opt/piwin/cli.js'] },
      },
    },
    hostTerminals: undefined,
    embeddedTuiService: undefined,
    push: (push: HostPush) => pushes.push(push),
  };
  kernel.hostTerminals = new HostTerminalRegistry(kernel.push, fakeSpawn()) as never;
  deps = kernel as unknown as HostRuntimeKernel;
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

describe('embedded TUI launch', () => {
  it('builds the same subcommand as the Desktop launcher', () => {
    expect(embeddedTuiArguments({})).toEqual(['tui', '--embedded']);
    expect(embeddedTuiArguments({ sessionId: 's1', projectPath: '/p' })).toEqual(['tui', '--embedded', '--session', 's1']);
    expect(embeddedTuiArguments({ projectPath: '/p' })).toEqual(['tui', '--embedded', '--project-path', '/p']);
  });

  it('admits the child to this Host only and disables the external editor', () => {
    expect(embeddedTuiEnvironment({ endpoint: 'ws://127.0.0.1:1', authToken: 't' }, undefined)).toEqual({
      PIWIN_HOST_URL: 'ws://127.0.0.1:1',
      PIWIN_HOST_TOKEN: 't',
      PIWIN_HOST: null,
      PIWIN_HOST_DEVICE_ID: null,
      PIWIN_HOST_DEVICE_SECRET: null,
      VISUAL: '',
      EDITOR: '',
      PIWIN_IMAGES: 'iterm2',
    });
    expect(embeddedTuiEnvironment({ endpoint: 'e', authToken: 't' }, 'off').PIWIN_IMAGES).toBe('off');
  });
});

describe('tui/open', () => {
  it('starts the CLI with fixed arguments in the general workspace', async () => {
    const response = await open({});
    expect(response.success).toBe(true);
    const launch = spawned[0]?.input;
    expect(launch?.executable).toBe('/usr/bin/node');
    expect(launch?.args).toEqual(['/opt/piwin/cli.js', 'tui', '--embedded']);
    expect(launch?.environment?.PIWIN_HOST_TOKEN).toBe('door');
    expect(launch?.cwd.startsWith(root)).toBe(true);
  });

  it('hands back the running terminal for the session it announced, with a redraw instead of replay', async () => {
    vi.useFakeTimers();
    const first = await open({});
    spawned[0]?.emit(`frame${formatTuiSessionAnnouncement('session-1')}`);
    const again = await open({ sessionId: 'session-1', cols: 50, rows: 30 });
    expect(again.success && again.data).toEqual({ ptyId: first.success && (first.data as { ptyId: string }).ptyId, reattached: true });
    expect(spawned).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(spawned[0]?.resized).toEqual([[49, 30], [50, 30]]);
  });

  it('refuses sessions and projects the Host does not know', async () => {
    expect((await open({ sessionId: 'missing' })).success).toBe(false);
    expect((await open({ projectPath: 'prj_unknown' })).success).toBe(false);
    expect(spawned).toHaveLength(0);
  });

  it('closes the least recently used terminal to stay under the limit', async () => {
    for (let index = 0; index <= MAX_EMBEDDED_TUIS; index += 1) await open({});
    expect(spawned).toHaveLength(MAX_EMBEDDED_TUIS + 1);
    expect(spawned.map((record) => record.killed)).toEqual([true, false, false, false, false]);
  });

  it('is unavailable without the ports only host serve provides', async () => {
    (deps.options as { embeddedTui?: unknown }).embeddedTui = undefined;
    const response = await open({});
    expect(response.success).toBe(false);
  });
});
