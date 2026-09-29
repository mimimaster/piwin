import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  anchorGrepGlob,
  createCwdAnchoredPiGrepToolDefinition,
  mergeCwdAnchoredGrepTool,
} from './cwd-anchored-grep-tool.js';

describe('anchorGrepGlob', () => {
  it('floats slash-containing globs so ripgrep cwd does not matter', () => {
    expect(anchorGrepGlob('packages/host-runtime/src/**/*.ts')).toBe(
      '**/packages/host-runtime/src/**/*.ts',
    );
    expect(anchorGrepGlob('packages/x/build-session-host-tools.ts')).toBe(
      '**/packages/x/build-session-host-tools.ts',
    );
    expect(anchorGrepGlob('./apps/desktop/src/**/*.{ts,tsx}')).toBe(
      '**/apps/desktop/src/**/*.{ts,tsx}',
    );
    expect(anchorGrepGlob('!node_modules/**')).toBe('!**/node_modules/**');
  });

  it('leaves basename, floating, and absolute globs alone', () => {
    expect(anchorGrepGlob(undefined)).toBeUndefined();
    expect(anchorGrepGlob('*.ts')).toBe('*.ts');
    expect(anchorGrepGlob('**/*.spec.ts')).toBe('**/*.spec.ts');
    expect(anchorGrepGlob('**')).toBe('**');
    expect(anchorGrepGlob('/abs/**/*.ts')).toBe('/abs/**/*.ts');
  });
});

describe('mergeCwdAnchoredGrepTool', () => {
  it('appends the wrapped grep and keeps a Host-owned grep', () => {
    const createGrepToolDefinition = vi.fn(() => ({ name: 'grep', execute: vi.fn() }));
    const piModule = { createGrepToolDefinition };
    expect(mergeCwdAnchoredGrepTool([{ name: 'bash' }], { cwd: '/w', piModule })).toHaveLength(2);
    const hostGrep = { name: 'grep' };
    expect(mergeCwdAnchoredGrepTool([hostGrep], { cwd: '/w', piModule })).toEqual([hostGrep]);
    expect(mergeCwdAnchoredGrepTool(undefined, { cwd: '/w', piModule: {} })).toBeUndefined();
  });
});

// Real Pi grep + real ripgrep. Reproduces the packaged Host: the process cwd
// is outside the project, and the model passes a path-prefixed glob.
describe('Pi grep from a foreign process cwd', () => {
  let project: string;
  let foreignCwd: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    project = await mkdtemp(join(tmpdir(), 'piwin-grep-project-'));
    foreignCwd = await mkdtemp(join(tmpdir(), 'piwin-grep-host-cwd-'));
    await mkdir(join(project, 'packages', 'host-runtime', 'src', 'tools'), { recursive: true });
    await writeFile(
      join(project, 'packages', 'host-runtime', 'src', 'tools', 'build-session-host-tools.ts'),
      'export const secretResolver = true;\n',
      'utf8',
    );
    process.chdir(foreignCwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  async function runGrep(useOverride: boolean, params: Record<string, unknown>): Promise<string> {
    const piModule = (await import('@earendil-works/pi-coding-agent')) as unknown as Record<
      string,
      unknown
    >;
    const definition = useOverride
      ? createCwdAnchoredPiGrepToolDefinition({ cwd: project, piModule })
      : (piModule.createGrepToolDefinition as (cwd: string) => unknown)(project);
    const tool = definition as {
      execute: (
        id: string,
        params: Record<string, unknown>,
        signal: AbortSignal | undefined,
        onUpdate: undefined,
        ctx: undefined,
      ) => Promise<{ content: Array<{ type: string; text?: string }> }>;
    };
    const result = await tool.execute('call-1', params, undefined, undefined, undefined);
    return result.content.map((part) => part.text ?? '').join('');
  }

  const params = {
    pattern: 'secretResolver',
    glob: 'packages/host-runtime/src/**/*.ts',
  };

  it('reproduces the silent empty result without the override', async () => {
    expect(await runGrep(false, params)).toContain('No matches found');
  });

  it('finds the match with the override', async () => {
    const text = await runGrep(true, params);
    expect(text).toContain('build-session-host-tools.ts');
    expect(text).toContain('secretResolver');
  });

  it('finds a single-file glob and still honors basename globs', async () => {
    expect(
      await runGrep(true, {
        pattern: 'secretResolver',
        glob: 'packages/host-runtime/src/tools/build-session-host-tools.ts',
      }),
    ).toContain('secretResolver');
    expect(await runGrep(true, { pattern: 'secretResolver', glob: '*.ts' })).toContain(
      'secretResolver',
    );
  });
});
