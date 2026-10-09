import { describe, expect, it, vi } from 'vitest';
import { createTuiCommandTable, type TuiCommandTableDeps } from './tui-command-table.js';
import { TUI_SLASH_COMMANDS } from './tui-commands.js';

/** Every collaborator is a recorder: reading any method returns a spy. */
function recorder<T extends object>(): T {
  const spies = new Map<string | symbol, ReturnType<typeof vi.fn>>();
  return new Proxy({} as T, {
    get: (_target, key) => {
      if (!spies.has(key)) spies.set(key, vi.fn());
      return spies.get(key);
    },
  });
}

function createDeps(embedded = false): TuiCommandTableDeps {
  return {
    embedded,
    composer: recorder(),
    attachments: recorder(),
    plans: recorder(),
    queue: recorder(),
    branches: recorder(),
    subagents: recorder(),
    turnChanges: recorder(),
    walkthroughs: recorder(),
    sideChat: recorder(),
    artifacts: recorder(),
    turns: recorder(),
    sessionSwitcher: recorder(),
    sessionExport: recorder(),
    startDraftSession: vi.fn(),
    loadOlderMessages: vi.fn(async () => undefined),
    renameSession: vi.fn(async () => undefined),
    sendReplacingRun: vi.fn(async () => undefined),
    setComposerText: vi.fn(),
    hint: vi.fn(),
    notice: vi.fn(),
    exit: vi.fn(),
  };
}

describe('TUI command table', () => {
  it('handles every command the TUI advertises', async () => {
    const deps = createDeps();
    const run = createTuiCommandTable(deps);
    for (const command of TUI_SLASH_COMMANDS) await run(command.name, '');
    expect(deps.hint).not.toHaveBeenCalledWith(expect.stringContaining('未知命令'));
  });

  it('passes arguments through and reads retry keep', async () => {
    const deps = createDeps();
    const run = createTuiCommandTable(deps);
    await run('steer', '顺便说一句');
    await run('retry', 'keep');
    await run('retry', '');
    expect(deps.turns.steer).toHaveBeenCalledWith('顺便说一句');
    expect(deps.turns.retry).toHaveBeenNthCalledWith(1, true);
    expect(deps.turns.retry).toHaveBeenNthCalledWith(2, false);
  });

  it('leaves session switching to the host application when embedded', async () => {
    const deps = createDeps(true);
    const run = createTuiCommandTable(deps);
    await run('sessions', '');
    await run('new', '');
    expect(deps.sessionSwitcher.open).not.toHaveBeenCalled();
    expect(deps.startDraftSession).not.toHaveBeenCalled();
    expect(deps.hint).toHaveBeenCalledTimes(2);
  });

  it('says so for a name it does not know', async () => {
    const deps = createDeps();
    await createTuiCommandTable(deps)('nope', '');
    expect(deps.hint).toHaveBeenCalledWith('未知命令 /nope，/help 查看可用命令');
  });
});
