import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRestrictedExecutor } from './restricted-executor.js';

let root = '';

async function seed(): Promise<void> {
  root = await mkdtemp(join(tmpdir(), 'piwin-code-search-'));
  await mkdir(join(root, 'src/nested'), { recursive: true });
  await mkdir(join(root, 'node_modules/dep'), { recursive: true });
  await mkdir(join(root, 'src/node_modules/nested-dep'), { recursive: true });
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(
    join(root, 'src/app.ts'),
    ['line one', 'const handler = createHandler();', 'line three', 'line four'].join('\n'),
  );
  await writeFile(join(root, 'src/nested/deep.ts'), 'export const deep = 1;\n');
  await writeFile(join(root, 'src/app.test.ts'), 'it("createHandler", () => {});\n');
  await writeFile(join(root, 'node_modules/dep/index.js'), 'const handler = 1;\n');
  await writeFile(join(root, 'src/node_modules/nested-dep/index.js'), 'const handler = 3;\n');
  await writeFile(join(root, 'dist/bundle.js'), 'const handler = 2;\n');
  await writeFile(join(root, 'README.md'), '# readme\n');
}

beforeEach(seed);

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
  }
});

function executor(overrides: Partial<{ resultMaxLines: number; lineMaxChars: number; excludePaths: string[] }> = {}) {
  return createRestrictedExecutor({
    root,
    resultMaxLines: overrides.resultMaxLines ?? 50,
    lineMaxChars: overrides.lineMaxChars ?? 250,
    excludePaths: overrides.excludePaths ?? ['node_modules', 'dist', '.git'],
  });
}

describe('rg', () => {
  it('finds matches with repo-relative paths and line numbers', async () => {
    const [result] = await executor().executeAll([
      { type: 'rg', pattern: 'createHandler', path: '/codebase/src' },
    ]);
    expect(result?.summary).toBe('Grepped createHandler in src');
    expect(result?.output).toContain('src/app.ts:2|const handler = createHandler();');
    expect(result?.output).toContain('src/app.test.ts:1|');
    expect(result?.error).toBeUndefined();
  });

  it('honors the include glob filter', async () => {
    const [result] = await executor().executeAll([
      { type: 'rg', pattern: 'createHandler', path: '/codebase/src', include: ['**/*.test.ts'] },
    ]);
    expect(result?.output).toContain('src/app.test.ts');
    expect(result?.output).not.toContain('src/app.ts:2');
  });

  it('excludes noise directories from the walk, including nested ones', async () => {
    // Both node_modules fixtures declare lowercase `handler`, so a missed prune
    // would surface them here.
    const [result] = await executor().executeAll([
      { type: 'rg', pattern: 'handler', path: '/codebase' },
    ]);
    const matches = (result?.output ?? '').split('\n').filter((line) => line.includes('|'));
    expect(matches).toEqual(['src/app.ts:2|const handler = createHandler();']);
    expect(result?.output).not.toContain('node_modules');
    expect(result?.output).not.toContain('dist');
  });

  it('applies the per-command exclude list on top of the defaults', async () => {
    const [result] = await executor().executeAll([
      { type: 'rg', pattern: 'createHandler', path: '/codebase/src', exclude: ['**/*.test.ts'] },
    ]);
    expect(result?.output).not.toContain('app.test.ts');
    expect(result?.output).toContain('src/app.ts:2|');
  });

  it('reports no matches instead of failing', async () => {
    const [result] = await executor().executeAll([
      { type: 'rg', pattern: 'nothingMatchesThis', path: '/codebase' },
    ]);
    expect(result?.output).toBe('No matches.');
    expect(result?.error).toBeUndefined();
  });

  it('reports an invalid regex without throwing', async () => {
    const [result] = await executor().executeAll([
      { type: 'rg', pattern: '([unclosed', path: '/codebase' },
    ]);
    expect(result?.error).toContain('invalid rg pattern');
  });

  it('refuses paths outside /codebase', async () => {
    const [result] = await executor().executeAll([
      { type: 'rg', pattern: 'x', path: '/etc' },
    ]);
    expect(result?.error).toBe('Error: rg path must be under /codebase: /etc');
  });

  it('records distinct patterns for the grep-keyword feedback, dropping short ones', async () => {
    const exec = executor();
    await exec.executeAll([
      { type: 'rg', pattern: 'createHandler', path: '/codebase/src' },
      { type: 'rg', pattern: 'createHandler', path: '/codebase/src' },
      { type: 'rg', pattern: 'ab', path: '/codebase/src' },
    ]);
    expect(exec.collectedRgPatterns()).toEqual(['createHandler']);
  });
});

describe('readfile', () => {
  it('reads an inclusive line range that matches the file content', async () => {
    const [result] = await executor().executeAll([
      { type: 'readfile', file: '/codebase/src/app.ts', start_line: 2, end_line: 3 },
    ]);
    expect(result?.summary).toBe('Read src/app.ts');
    expect(result?.output).toBe('2|const handler = createHandler();\n3|line three');
  });

  it('reads the whole file when no range is given', async () => {
    const [result] = await executor().executeAll([
      { type: 'readfile', file: '/codebase/src/nested/deep.ts' },
    ]);
    expect(result?.output).toContain('1|export const deep = 1;');
  });

  it('clamps an out-of-range end to the file length', async () => {
    const [result] = await executor().executeAll([
      { type: 'readfile', file: '/codebase/src/nested/deep.ts', start_line: 1, end_line: 999 },
    ]);
    // The file ends with a newline; that must not become a phantom second line.
    expect(result?.output).toBe('1|export const deep = 1;');
  });

  it('does not report a phantom line for a file ending in a newline', async () => {
    const [result] = await executor().executeAll([
      { type: 'readfile', file: '/codebase/src/nested/deep.ts', start_line: 2 },
    ]);
    expect(result?.error).toContain('beyond end of');
  });

  it('normalizes CRLF line endings when reading', async () => {
    await writeFile(join(root, 'src/crlf.ts'), 'first\r\nsecond\r\n');
    const [result] = await executor().executeAll([
      { type: 'readfile', file: '/codebase/src/crlf.ts' },
    ]);
    expect(result?.output).toBe('1|first\n2|second');
  });

  it('errors when the start line is past the end of the file', async () => {
    const [result] = await executor().executeAll([
      { type: 'readfile', file: '/codebase/src/nested/deep.ts', start_line: 500 },
    ]);
    expect(result?.error).toContain('beyond end of');
  });

  it('errors on a missing file rather than throwing', async () => {
    const [result] = await executor().executeAll([
      { type: 'readfile', file: '/codebase/src/missing.ts' },
    ]);
    expect(result?.error).toContain('cannot read');
  });

  it('refuses traversal paths', async () => {
    const [result] = await executor().executeAll([
      { type: 'readfile', file: '/codebase/../../etc/passwd' },
    ]);
    expect(result?.error).toContain('must stay within /codebase');
  });
});

describe('tree', () => {
  it('renders the virtual root with excluded directories removed', async () => {
    const [result] = await executor().executeAll([
      { type: 'tree', path: '/codebase', levels: 2 },
    ]);
    expect(result?.summary).toBe('Analysed .');
    expect(result?.output).toContain('/codebase');
    expect(result?.output).toContain('src');
    expect(result?.output).toContain('README.md');
    expect(result?.output).not.toContain('node_modules');
    expect(result?.output).not.toContain('dist');
  });

  it('caps the rendered depth to the requested levels', async () => {
    const [result] = await executor().executeAll([
      { type: 'tree', path: '/codebase', levels: 1 },
    ]);
    expect(result?.output).toContain('├── src');
    expect(result?.output).not.toContain('nested');
  });
});

describe('ls', () => {
  it('lists a directory with a trailing slash on directories', async () => {
    const [result] = await executor().executeAll([{ type: 'ls', path: '/codebase/src' }]);
    expect(result?.summary).toBe('Listed src');
    expect(result?.output.split('\n')).toEqual(['app.test.ts', 'app.ts', 'nested/']);
  });

  it('lists a long format with sizes', async () => {
    const [result] = await executor().executeAll([
      { type: 'ls', path: '/codebase/src/nested', long_format: true },
    ]);
    expect(result?.output).toMatch(/^\d+\tdeep\.ts$/);
  });
});

describe('glob', () => {
  it('matches files relative to the target directory', async () => {
    const [result] = await executor().executeAll([
      { type: 'glob', pattern: '**/*.ts', path: '/codebase/src' },
    ]);
    expect(result?.summary).toBe('Searched **/*.ts in src');
    expect(result?.output.split('\n')).toEqual([
      'src/app.test.ts',
      'src/app.ts',
      'src/nested/deep.ts',
    ]);
  });

  it('matches directories when asked', async () => {
    const [result] = await executor().executeAll([
      { type: 'glob', pattern: 'nested', path: '/codebase/src', type_filter: 'directory' },
    ]);
    expect(result?.output).toBe('src/nested/');
  });
});

describe('round limits', () => {
  it('truncates output to resultMaxLines with the observed marker', async () => {
    const lines = Array.from({ length: 40 }, (_, index) => `needle line ${index}`);
    await writeFile(join(root, 'src/long.ts'), lines.join('\n'));
    const [result] = await executor({ resultMaxLines: 5 }).executeAll([
      { type: 'rg', pattern: 'needle', path: '/codebase/src/long.ts' },
    ]);
    const outputLines = (result?.output ?? '').split('\n');
    expect(outputLines).toHaveLength(6);
    expect(outputLines.at(-1)).toBe('… (35 lines truncated)');
  });

  it('truncates over-long lines to lineMaxChars, keeping the location prefix', async () => {
    const content = `needle ${'x'.repeat(500)}`;
    const lineMaxChars = 20;
    await writeFile(join(root, 'src/wide.ts'), `${content}\n`);
    const [result] = await executor({ lineMaxChars }).executeAll([
      { type: 'rg', pattern: 'needle', path: '/codebase/src/wide.ts' },
    ]);
    const body = (result?.output ?? '').split('\n')[0] ?? '';
    const separator = body.indexOf('|');
    // The `path:line` prefix is never sacrificed to the character cap.
    expect(body.slice(0, separator)).toBe('src/wide.ts:1');
    const text = body.slice(separator + 1);
    expect(text).toBe(`${content.slice(0, lineMaxChars)}… (${content.length - lineMaxChars} chars truncated)`);
  });
});

describe('executeAll', () => {
  it('runs a mixed round in parallel and preserves order', async () => {
    const results = await executor().executeAll([
      { type: 'rg', pattern: 'deep', path: '/codebase/src' },
      { type: 'readfile', file: '/codebase/README.md' },
      { type: 'tree', path: '/codebase', levels: 1 },
      { type: 'ls', path: '/codebase/src' },
      { type: 'glob', pattern: '*.md', path: '/codebase' },
    ]);
    expect(results.map((result) => result.type)).toEqual([
      'rg',
      'readfile',
      'tree',
      'ls',
      'glob',
    ]);
    expect(results.every((result) => result.error === undefined)).toBe(true);
  });
});
