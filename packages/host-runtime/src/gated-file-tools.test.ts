import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat, writeFile as rawWriteFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createEmptyRuleSet, type PermissionRuleSet } from '@piwin/contracts';
import { addFileWriteAllowRule } from '@piwin/project';
import { buildGatedFileToolsDefinition } from './gated-file-tools.js';
import { createBundledRuleSet } from './permission-defaults.js';

type PiToolDefinition = {
  name: string;
  execute: (
    toolCallId: string,
    input: { path: string; content?: string; edits?: unknown },
    signal?: AbortSignal,
  ) => Promise<{ content: Array<{ type: string; text: string }> }>;
};

async function buildTools(options: {
  cwd: string;
  mode?: 'auto' | 'ask-all' | 'bypass';
  rules?: PermissionRuleSet;
  projectsFilePath?: string;
  projectPath?: string;
  requestPermission?: (req: {
    action: string;
    detail: string;
    defaultDecision: 'allow' | 'deny' | 'ask';
    signal?: AbortSignal;
  }) => Promise<'allow' | 'deny' | 'ask'>;
}): Promise<{ write: PiToolDefinition; edit: PiToolDefinition }> {
  const tools = (await buildGatedFileToolsDefinition({
    cwd: options.cwd,
    mode: options.mode ?? 'auto',
    rules: options.rules ?? createBundledRuleSet(),
    projectRoot: options.cwd,
    projectsFilePath: options.projectsFilePath ?? join(options.cwd, 'projects.json'),
    ...(options.projectPath ? { projectPath: options.projectPath } : {}),
    ...(options.requestPermission ? { requestPermission: options.requestPermission } : {}),
  })) as PiToolDefinition[];
  const write = tools.find((t) => t.name === 'write');
  const edit = tools.find((t) => t.name === 'edit');
  if (!write || !edit) {
    throw new Error('expected write + edit tool definitions');
  }
  return { write, edit };
}

describe('buildGatedFileToolsDefinition', () => {
  let projectRoot: string;
  let outsideRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'piwin-gated-file-'));
    outsideRoot = await mkdtemp(join(tmpdir(), 'piwin-gated-file-out-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  });

  it('denies writes to .env without touching the filesystem', async () => {
    const { write } = await buildTools({ cwd: projectRoot });
    const envPath = join(projectRoot, '.env');
    await expect(write.execute('t', { path: envPath, content: 'SECRET=1' })).rejects.toThrow(
      /blocked file-write/,
    );
    await expect(stat(envPath)).rejects.toThrow();
  });

  it('denies writes under ~/.ssh', async () => {
    const { write } = await buildTools({ cwd: projectRoot });
    const sshPath = join(homedir(), '.ssh', 'authorized_keys');
    await expect(write.execute('t', { path: sshPath, content: 'ssh-rsa AAA' })).rejects.toThrow(
      /blocked file-write/,
    );
  });

  it('asks via requestPermission for out-of-project writes', async () => {
    let asked = 0;
    const { write } = await buildTools({
      cwd: projectRoot,
      requestPermission: async () => {
        asked += 1;
        return 'deny';
      },
    });
    const outsidePath = join(outsideRoot, 'file.txt');
    await expect(write.execute('t', { path: outsidePath, content: 'x' })).rejects.toThrow(
      /blocked file-write/,
    );
    expect(asked).toBe(1);
  });

  it('allows out-of-project write when requestPermission returns allow', async () => {
    const { write } = await buildTools({
      cwd: projectRoot,
      requestPermission: async () => 'allow',
    });
    const outsidePath = join(outsideRoot, 'allowed.txt');
    await write.execute('t', { path: outsidePath, content: 'ok' });
    await expect(readFile(outsidePath, 'utf8')).resolves.toBe('ok');
  });

  it('allows in-project writes in auto mode without prompting', async () => {
    let asked = 0;
    const { write } = await buildTools({
      cwd: projectRoot,
      requestPermission: async () => {
        asked += 1;
        return 'allow';
      },
    });
    const inProjectPath = join(projectRoot, 'src', 'new-file.ts');
    await write.execute('t', { path: inProjectPath, content: 'export const x = 1;' });
    expect(asked).toBe(0);
    await expect(readFile(inProjectPath, 'utf8')).resolves.toBe('export const x = 1;');
  });

  it('gates mkdir outside project (not only writeFile)', async () => {
    let asked = 0;
    const { write } = await buildTools({
      cwd: projectRoot,
      requestPermission: async () => {
        asked += 1;
        return 'deny';
      },
    });
    // A write whose parent dir is outside the project triggers mkdir gate.
    const outsidePath = join(outsideRoot, 'subdir', 'file.txt');
    await expect(write.execute('t', { path: outsidePath, content: 'x' })).rejects.toThrow(
      /blocked file-write/,
    );
    expect(asked).toBe(1);
    await expect(stat(join(outsideRoot, 'subdir'))).rejects.toThrow();
  });

  it('uses pre-realpath absolute path for new files (ENOENT)', async () => {
    const { write } = await buildTools({ cwd: projectRoot });
    // New file does not exist yet -> realpath ENOENT -> gate uses abs path, still allowed in-project.
    const newPath = join(projectRoot, 'brand-new.txt');
    await write.execute('t', { path: newPath, content: 'fresh' });
    await expect(readFile(newPath, 'utf8')).resolves.toBe('fresh');
  });

  it('auto-allows via remembered fileWriteAllowlist (skips prompt)', async () => {
    const projectsFile = join(projectRoot, 'projects.json');
    // Remember an outside path as allowed for this project.
    const rememberedPath = join(outsideRoot, 'remembered.txt');
    await addFileWriteAllowRule(projectsFile, projectRoot, rememberedPath);

    let asked = 0;
    const { write } = await buildTools({
      cwd: projectRoot,
      projectsFilePath: projectsFile,
      projectPath: projectRoot,
      requestPermission: async () => {
        asked += 1;
        return 'allow';
      },
    });
    await write.execute('t', { path: rememberedPath, content: 'r' });
    expect(asked).toBe(0);
    await expect(readFile(rememberedPath, 'utf8')).resolves.toBe('r');
  });

  it('gates edit tool writeFile path', async () => {
    const { edit } = await buildTools({ cwd: projectRoot });
    // First create a file inside the project (allowed).
    const { write } = await buildTools({ cwd: projectRoot });
    const filePath = join(projectRoot, 'edit-target.txt');
    await write.execute('t', { path: filePath, content: 'hello world' });

    // Edit inside project -> allowed.
    await edit.execute('t', {
      path: filePath,
      edits: [{ oldText: 'hello', newText: 'goodbye' }],
    });
    await expect(readFile(filePath, 'utf8')).resolves.toBe('goodbye world');

    // Edit to .env -> denied. Create .env first (bypassing gate) so edit reaches writeFile.
    const envPath = join(projectRoot, '.env');
    await rawWriteFile(envPath, 'ORIGINAL=value');
    await expect(
      edit.execute('t', {
        path: envPath,
        edits: [{ oldText: 'ORIGINAL', newText: 'CHANGED' }],
      }),
    ).rejects.toThrow(/blocked file-write/);
  });

  it('denies in non-interactive mode when evaluation is ask', async () => {
    // No requestPermission -> ask must resolve to deny.
    const { write } = await buildTools({ cwd: projectRoot });
    const outsidePath = join(outsideRoot, 'no-interact.txt');
    await expect(write.execute('t', { path: outsidePath, content: 'x' })).rejects.toThrow(
      /blocked file-write/,
    );
  });

  it('asks for every in-project write under ask-all mode', async () => {
    let asked = 0;
    const { write } = await buildTools({
      cwd: projectRoot,
      mode: 'ask-all',
      rules: createEmptyRuleSet(),
      requestPermission: async () => {
        asked += 1;
        return 'allow';
      },
    });
    const inProjectPath = join(projectRoot, 'asked.txt');
    await write.execute('t', { path: inProjectPath, content: 'a' });
    expect(asked).toBe(1);
  });
});
