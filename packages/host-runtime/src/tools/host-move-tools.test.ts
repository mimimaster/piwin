import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostToolRegistration, PermissionMode, ToolResult } from '@piwin/contracts';
import { createBundledRuleSet } from '../permission-defaults.js';
import { createWorkspaceWriteGate } from '../turn-changes/workspace-write-gate.js';
import { buildHostFilesystemTools } from './host-filesystem-tools.js';
import { HostToolExecutionRouter } from './host-tool-execution-router.js';
import { createHostToolAdmission } from './tool-admission.js';

const context = (toolName: string) => ({
  sessionId: 'session-1',
  runtimeGenerationId: 'generation-1',
  runId: 'run-1',
  toolName,
});

let cwd: string;
let tools: HostToolRegistration[];

function requireTool(name: string): HostToolRegistration {
  const tool = tools.find((candidate) => candidate.descriptor.name === name);
  if (!tool) throw new Error(`${name} was not registered`);
  return tool;
}

/** Through prepareArgs and admission, the way the router runs a model's call. */
async function call(
  name: string,
  args: Record<string, unknown>,
  options: {
    mode?: PermissionMode;
    requestPermission?: (input: { action: string; detail: string }) => Promise<'allow' | 'deny'>;
  } = {},
): Promise<ToolResult> {
  const admission = createHostToolAdmission({
    rules: createBundledRuleSet(),
    getPermissionMode: () => options.mode ?? 'auto',
    ...(options.requestPermission
      ? {
          requestPermission: async (input: { action: string; detail: string }) =>
            options.requestPermission?.(input) ?? 'deny',
        }
      : {}),
    projectRoot: cwd,
  });
  const router = new HostToolExecutionRouter({ tools: [requireTool(name)], admission });
  return router.execute(name, args, new AbortController().signal, context(name));
}

const output = (result: ToolResult): string => {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.output;
};

const message = (result: ToolResult): string => (result.ok ? '' : result.message);
const read = (path: string): Promise<string> => readFile(join(cwd, path), 'utf8');

describe('move_file', () => {
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'piwin-move-'));
    tools = buildHostFilesystemTools({ cwd });
  });
  afterEach(() => rm(cwd, { recursive: true, force: true }));

  it('moves a file, creating the destination folder and keeping its mode', async () => {
    await writeFile(join(cwd, 'run.sh'), '#!/bin/sh\necho hi\n');
    await chmod(join(cwd, 'run.sh'), 0o755);
    expect(output(await call('move_file', { from: 'run.sh', to: 'bin/run.sh' }))).toContain('Moved');
    expect(await read('bin/run.sh')).toBe('#!/bin/sh\necho hi\n');
    expect((await stat(join(cwd, 'bin/run.sh'))).mode & 0o777).toBe(0o755);
    await expect(read('run.sh')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses an existing destination and a missing source without changing anything', async () => {
    await writeFile(join(cwd, 'a.txt'), 'a');
    await writeFile(join(cwd, 'b.txt'), 'b');
    const exists = await call('move_file', { from: 'a.txt', to: 'b.txt' });
    expect(message(exists)).toContain('already exists');
    expect(await read('a.txt')).toBe('a');
    expect(await read('b.txt')).toBe('b');
    expect(message(await call('move_file', { from: 'nope.txt', to: 'c.txt' }))).toContain('does not exist');
  });

  it('asks for both paths, and refuses when either end is a secret path', async () => {
    await writeFile(join(cwd, '.env'), 'TOKEN=1');
    await writeFile(join(cwd, 'notes.txt'), 'n');
    const requestPermission = vi.fn(async (_input: { action: string; detail: string }) => 'allow' as const);
    const fromSecret = await call('move_file', { from: '.env', to: 'copy.txt' }, { requestPermission });
    expect(message(fromSecret)).toContain('Permission denied');
    const toSecret = await call('move_file', { from: 'notes.txt', to: '.env.local' }, { requestPermission });
    expect(message(toSecret)).toContain('Permission denied');
    expect(await read('.env')).toBe('TOKEN=1');
    await expect(read('copy.txt')).rejects.toMatchObject({ code: 'ENOENT' });

    const ask = await call('move_file', { from: 'notes.txt', to: 'moved.txt' }, { mode: 'ask-all', requestPermission });
    expect(ask.ok).toBe(true);
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(requestPermission.mock.calls[0]?.[0]).toMatchObject({ action: 'file-write' });
  });

  it('waits for an exclusive lease, and locks both ends while it runs', async () => {
    const gate = createWorkspaceWriteGate();
    const held = await gate.tryAcquire({
      workspaceId: 'ws',
      rootPath: cwd,
      kind: 'git',
      mode: 'exclusive',
      wait: true,
    });
    tools = buildHostFilesystemTools({ cwd, workspaceWrite: { gate, workspaceId: 'ws', rootPath: cwd } });
    await writeFile(join(cwd, 'a.txt'), 'a');
    let finished = false;
    const pending = requireToolExecute('move_file', { from: join(cwd, 'a.txt'), to: join(cwd, 'b.txt') }).then(
      (result) => {
        finished = true;
        return result;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(finished).toBe(false);
    if (held.ok) held.lease.release();
    expect((await pending).ok).toBe(true);
    expect(await read('b.txt')).toBe('a');
  });
});

function requireToolExecute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return requireTool(name).execute(args, new AbortController().signal, context(name));
}

describe('move_lines', () => {
  const SOURCE = ['import a', '', 'export function one() {', '  return 1;', '}', '', 'export function two() {', '  return 2;', '}', ''].join('\n');

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'piwin-lines-'));
    tools = buildHostFilesystemTools({ cwd });
    await writeFile(join(cwd, 'big.ts'), SOURCE);
  });
  afterEach(() => rm(cwd, { recursive: true, force: true }));

  const args = {
    from: 'big.ts',
    startLine: 3,
    endLine: 5,
    startText: 'export function one() {',
    endText: '}',
  };

  it('moves a range into a new file with a prefix, leaving a replacement behind', async () => {
    const result = await call('move_lines', {
      ...args,
      to: 'one.ts',
      prefix: '// split from big.ts\n',
      replacement: "export { one } from './one.js';",
    });
    expect(output(result)).toBe('Moved lines 3-5 (3 lines) from ' + join(cwd, 'big.ts') + ' to ' + join(cwd, 'one.ts') + ' (created).');
    expect(await read('one.ts')).toBe('// split from big.ts\nexport function one() {\n  return 1;\n}\n');
    expect(await read('big.ts')).toBe(
      ['import a', '', "export { one } from './one.js';", '', 'export function two() {', '  return 2;', '}', ''].join('\n'),
    );
  });

  it('appends to an existing file and ignores the prefix', async () => {
    await writeFile(join(cwd, 'more.ts'), 'existing');
    output(await call('move_lines', { ...args, to: 'more.ts', prefix: 'IGNORED\n' }));
    expect(await read('more.ts')).toBe('existing\nexport function one() {\n  return 1;\n}\n');
  });

  it('removes the range when there is no destination', async () => {
    expect(output(await call('move_lines', args))).toContain('Removed lines 3-5');
    expect(await read('big.ts')).toBe(['import a', '', '', 'export function two() {', '  return 2;', '}', ''].join('\n'));
  });

  it('changes nothing when a quoted line does not match', async () => {
    const result = await call('move_lines', { ...args, to: 'one.ts', startLine: 2 });
    expect(message(result)).toContain('startText does not match line 2');
    expect(message(result)).toContain('it appears at line 3');
    expect(await read('big.ts')).toBe(SOURCE);
    await expect(read('one.ts')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects malformed arguments before touching anything', async () => {
    expect((await call('move_lines', { from: 'big.ts', startLine: '3', endLine: 5 })).ok).toBe(false);
    expect(message(await call('move_lines', { from: 'big.ts', startLine: 3, endLine: 5 }))).toContain('startText and endText');
    expect(message(await call('move_lines', { ...args, to: 'big.ts' }))).toContain('to must differ from from');
    expect(await read('big.ts')).toBe(SOURCE);
  });

  it('asks about the range file alone when nothing is moved out, and refuses a secret destination', async () => {
    const requestPermission = vi.fn(async (_input: { action: string; detail: string }) => 'allow' as const);
    expect(message(await call('move_lines', { ...args, to: '.env' }, { requestPermission }))).toContain(
      'Permission denied',
    );
    expect(await read('big.ts')).toBe(SOURCE);
    await call('move_lines', args, { mode: 'ask-all', requestPermission });
    expect(requestPermission).toHaveBeenCalledOnce();
  });
});
