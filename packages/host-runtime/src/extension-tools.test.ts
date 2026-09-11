import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostToolRegistration, ToolResult } from '@piwin/contracts';
import { createExtensionRevisionStore } from '@piwin/extensions';
import { buildExtensionTools, type ExtensionApplyOutcome } from './extension-tools.js';

const run = promisify(execFile);

let piwinRoot: string;

async function makeGitRepo(files: Record<string, string>): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'piwin-ext-tool-repo-'));
  await run('git', ['init', '-q'], { cwd: repo });
  await run('git', ['config', 'user.email', 't@t.test'], { cwd: repo });
  await run('git', ['config', 'user.name', 'Test'], { cwd: repo });
  for (const [name, content] of Object.entries(files)) {
    const target = join(repo, name);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
  await run('git', ['add', '.'], { cwd: repo });
  await run('git', ['commit', '-q', '-m', 'init'], { cwd: repo });
  return repo;
}

function execute(tool: HostToolRegistration, args: Record<string, unknown>): Promise<ToolResult> {
  return tool.execute(args, new AbortController().signal, {
    sessionId: 'session-1',
    runtimeGenerationId: 'generation-1',
    runId: 'run-1',
    toolName: tool.descriptor.name,
  });
}

function toolNamed(tools: HostToolRegistration[], name: string): HostToolRegistration {
  const tool = tools.find((entry) => entry.descriptor.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool;
}

const applyOk = async (): Promise<ExtensionApplyOutcome> => ({ ok: true, phase: 'scheduled' });

beforeEach(async () => {
  piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-ext-tool-'));
});

afterEach(async () => {
  await rm(piwinRoot, { recursive: true, force: true });
});

describe('buildExtensionTools', () => {
  it('returns nothing when disabled', () => {
    expect(
      buildExtensionTools({
        enabled: false,
        piwinRoot,
        sessionId: 's',
        applyExtensions: applyOk,
      }),
    ).toEqual([]);
  });

  it('registers extension_list and extension_install', () => {
    const names = buildExtensionTools({
      enabled: true,
      piwinRoot,
      sessionId: 's',
      applyExtensions: applyOk,
    })
      .map((tool) => tool.descriptor.name)
      .sort();
    expect(names).toEqual(['extension_install', 'extension_list']);
  });

  it('tells the model that Pi TUI plugins are not a piwin surface', () => {
    const install = buildExtensionTools({
      enabled: true,
      piwinRoot,
      sessionId: 's',
      applyExtensions: applyOk,
    }).find((tool) => tool.descriptor.name === 'extension_install');
    expect(install?.descriptor.description).toMatch(/Pi TUI plugins/);
    expect(install?.descriptor.description).toMatch(/do not work/);
  });

  it('extension_install stages, enables, and schedules apply for a self-contained repo', async () => {
    const repo = await makeGitRepo({ 'index.ts': 'export default function () {}\n' });
    const applyExtensions = vi.fn(applyOk);
    const tools = buildExtensionTools({
      enabled: true,
      piwinRoot,
      sessionId: 'session-1',
      applyExtensions,
    });

    const result = await execute(toolNamed(tools, 'extension_install'), {
      kind: 'git',
      url: repo,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toMatch(/Installed and enabled/);
      expect(result.details).toMatchObject({ activated: true });
    }
    expect(applyExtensions).toHaveBeenCalledWith('after-current-run');

    const records = await createExtensionRevisionStore(piwinRoot).listRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.configuredEnabled).toBe(true);
  });

  it('extension_install rejects a non-git url without cloning', async () => {
    const tools = buildExtensionTools({
      enabled: true,
      piwinRoot,
      sessionId: 's',
      applyExtensions: applyOk,
    });
    const result = await execute(toolNamed(tools, 'extension_install'), {
      kind: 'git',
      url: '@injaneity/pi-computer-use',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid-input');
      expect(result.message).toMatch(/pi install npm:/);
    }
  });

  it('extension_install surfaces the friendly "npm package" error for a repo with deps', async () => {
    const repo = await makeGitRepo({
      'package.json': JSON.stringify({
        name: '@acme/needs-npm',
        dependencies: { leftpad: '^1.0.0' },
      }),
      'README.md': '# needs npm\n',
    });
    const tools = buildExtensionTools({
      enabled: true,
      piwinRoot,
      sessionId: 's',
      applyExtensions: applyOk,
    });
    const result = await execute(toolNamed(tools, 'extension_install'), {
      kind: 'git',
      url: repo,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('execution-failed');
      expect(result.message).toMatch(/pi install npm:@acme\/needs-npm/);
    }
  });

  it('extension_list reports installed extensions with enabled state', async () => {
    const repo = await makeGitRepo({ 'index.ts': 'export default function () {}\n' });
    const tools = buildExtensionTools({
      enabled: true,
      piwinRoot,
      sessionId: 's',
      applyExtensions: applyOk,
    });
    await execute(toolNamed(tools, 'extension_install'), { kind: 'git', url: repo, name: 'demo' });

    const listed = await execute(toolNamed(tools, 'extension_list'), {});
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      const parsed = JSON.parse(listed.output) as Array<{ id: string; enabled: boolean }>;
      expect(parsed.some((entry) => entry.id === 'demo' && entry.enabled)).toBe(true);
    }
  });

  it('reports a scheduling failure without claiming activation', async () => {
    const repo = await makeGitRepo({ 'index.ts': 'export default function () {}\n' });
    const tools = buildExtensionTools({
      enabled: true,
      piwinRoot,
      sessionId: 's',
      applyExtensions: async () => ({ ok: false, error: 'runtime busy' }),
    });
    const result = await execute(toolNamed(tools, 'extension_install'), { kind: 'git', url: repo });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toMatch(/scheduling activation failed: runtime busy/);
      expect(result.details).toMatchObject({ activated: false });
    }
  });
});
