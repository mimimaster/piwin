import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handlePreviewCommand } from './preview-commands.js';

describe('handlePreviewCommand preview/read-trusted-text', () => {
  it('returns ready read-only text for a config-root file', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-preview-cmd-'));
    await writeFile(join(rootDir, 'notes.md'), '# hello\n', 'utf8');

    const response = await handlePreviewCommand(
      { type: 'preview/read-trusted-text', input: { relativePath: 'notes.md' } },
      'preview-ok',
      rootDir,
    );
    expect(response).toMatchObject({
      id: 'preview-ok',
      success: true,
      command: 'preview/read-trusted-text',
      data: {
        status: 'ready',
        relativePath: 'notes.md',
        content: '# hello\n',
        readOnly: true,
      },
    });
  });

  it('maps traversal input to an unavailable payload, not a transport error', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-preview-deny-'));
    const response = await handlePreviewCommand(
      { type: 'preview/read-trusted-text', input: { relativePath: '../passwd' } },
      'preview-deny',
      rootDir,
    );
    expect(response).toMatchObject({
      success: true,
      data: { status: 'unavailable', reason: 'invalid-request' },
    });
  });
});
