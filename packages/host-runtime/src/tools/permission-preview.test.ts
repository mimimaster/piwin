import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProposedChange, unifiedDiff } from './permission-preview.js';

describe('unifiedDiff', () => {
  it('produces hunks with context and counts', () => {
    const before = Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n') + '\n';
    const after = before.replace('line 3\n', 'line three\n').replace('line 15\n', '');
    const diff = unifiedDiff(before, after, 'a.txt');
    expect(diff?.additions).toBe(1);
    expect(diff?.deletions).toBe(2);
    expect(diff?.patch).toContain('--- a/a.txt\n+++ b/a.txt\n@@ -1,7 +1,7 @@\n line 0');
    expect(diff?.patch).toContain('-line 3\n+line three');
    expect(diff?.patch).toContain('@@ -13,7 +13,6 @@');
    expect(diff?.patch).toContain('-line 15');
  });

  it('returns undefined when nothing changes and marks a new file', () => {
    expect(unifiedDiff('a\n', 'a\n', 'x')).toBeUndefined();
    expect(unifiedDiff('', 'hi\n', 'new.txt', true)?.patch).toBe('--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,1 @@\n+hi\n');
  });
});

describe('buildProposedChange', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'piwin-preview-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('previews an edit against the file on disk', async () => {
    await writeFile(path.join(dir, 'a.ts'), 'const a = 1;\nconst b = 2;\n');
    const change = await buildProposedChange({
      toolName: 'edit',
      arguments: { path: 'a.ts', edits: [{ oldText: 'const b = 2;', newText: 'const b = 3;' }] },
      projectPath: dir,
    });
    expect(change).toMatchObject({ path: 'a.ts', additions: 1, deletions: 1 });
    expect(change?.patch).toContain('-const b = 2;\n+const b = 3;');
  });

  it('previews write_file for a new file, and gives up quietly on bad input', async () => {
    const created = await buildProposedChange({
      toolName: 'write_file',
      arguments: { path: path.join(dir, 'n.txt'), content: 'x\ny\n' },
    });
    expect(created).toMatchObject({ additions: 2, deletions: 0 });
    expect(await buildProposedChange({ toolName: 'edit', arguments: { path: 'missing.ts', edits: [] }, projectPath: dir })).toBeUndefined();
    expect(await buildProposedChange({ toolName: 'bash', arguments: { path: 'a' } })).toBeUndefined();
    await writeFile(path.join(dir, 'a.ts'), 'abc\n');
    expect(
      await buildProposedChange({
        toolName: 'edit',
        arguments: { path: 'a.ts', edits: [{ oldText: 'zzz', newText: 'y' }] },
        projectPath: dir,
      }),
    ).toBeUndefined();
  });
});
