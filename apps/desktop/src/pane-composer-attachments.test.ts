import { describe, expect, it, vi } from 'vitest';
import { attachmentsFromFiles } from './pane-composer-attachments.js';

describe('pane composer attachments', () => {
  it('saves allowed files through Host and returns prompt attachments', async () => {
    const request = vi.fn(async (command: { type: string }) => {
      if (command.type === 'media/save-begin') {
        return { success: true, data: { uploadId: 'u1', chunkMaxBytes: 1024 } };
      }
      if (command.type === 'media/save-chunk') {
        return { success: true, data: {} };
      }
      if (command.type === 'media/save-finish') {
        return {
          success: true,
          data: {
            asset: {
              id: 'm1',
              mimeType: 'text/plain',
              byteSize: 5,
              absolutePath: '/tmp/note.txt',
              name: 'note.txt',
            },
          },
        };
      }
      return { success: false, error: command.type };
    });
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
    const attachments = await attachmentsFromFiles({
      files: [file],
      source: 'file-picker',
      sessionId: 's1',
      request: request as never,
    });
    expect(attachments).toEqual([
      expect.objectContaining({ id: 'm1', kind: 'media', name: 'note.txt', source: 'file-picker' }),
    ]);
  });

  it('skips empty files', async () => {
    const request = vi.fn();
    const file = new File([], 'empty.txt', { type: 'text/plain' });
    await expect(
      attachmentsFromFiles({
        files: [file],
        source: 'drop',
        sessionId: 's1',
        request: request as never,
      }),
    ).resolves.toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
});
