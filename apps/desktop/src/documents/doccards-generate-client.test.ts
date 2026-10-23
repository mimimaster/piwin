import { describe, expect, it, vi } from 'vitest';
import { runDoccardsGenerate } from './doccards-generate-client';

describe('runDoccardsGenerate', () => {
  it('generate path never calls indexFolder', async () => {
    const indexFolder = vi.fn();
    const request = vi.fn(async (command: { type: string }) => {
      if (command.type === 'doccards/index-folder') {
        indexFolder();
      }
      if (command.type === 'doccards/generate') {
        return {
          type: 'response' as const,
          command: command.type,
          success: true as const,
          data: { generationId: 'gen_1', status: 'RUNNING' },
        };
      }
      return {
        type: 'response' as const,
        command: command.type,
        success: true as const,
        data: {
          job: { status: 'COMPLETED', created: 1, createdCardIds: ['c1'] },
        },
      };
    });
    const job = await runDoccardsGenerate(request, { folderPath: '/docs', topic: 'srs' });
    expect(job.status).toBe('COMPLETED');
    expect(indexFolder).toHaveBeenCalledTimes(0);
    expect(request.mock.calls.every((call) => call[0]?.type !== 'doccards/index-folder')).toBe(
      true,
    );
  });

  it('reports live job progress before completing', async () => {
    const seen: string[] = [];
    const request = vi.fn(async (command: { type: string }) => {
      if (command.type === 'doccards/generate') {
        return {
          type: 'response' as const,
          command: command.type,
          success: true as const,
          data: { generationId: 'gen_1', status: 'RUNNING' },
        };
      }
      const status = seen.length === 0 ? 'EXTRACTING_KNOWLEDGE' : 'COMPLETED';
      return {
        type: 'response' as const,
        command: command.type,
        success: true as const,
        data: { job: { status, created: 1, createdCardIds: ['c1'], sessionId: 'sess-1' } },
      };
    });
    const job = await runDoccardsGenerate(request, {
      folderPath: '/docs',
      onProgress: (current) => {
        seen.push(current.status);
      },
    });
    expect(seen).toContain('EXTRACTING_KNOWLEDGE');
    expect(job.sessionId).toBe('sess-1');
  });

  it('returns a FAILED job so the result page can render it', async () => {
    const request = vi.fn(async (command: { type: string }) => {
      if (command.type === 'doccards/generate') {
        return {
          type: 'response' as const,
          command: command.type,
          success: true as const,
          data: { generationId: 'gen_1', status: 'RUNNING' },
        };
      }
      return {
        type: 'response' as const,
        command: command.type,
        success: true as const,
        data: { job: { id: 'gen_1', status: 'FAILED', error: 'NO_VALID_FLASHCARDS' } },
      };
    });
    const job = await runDoccardsGenerate(request, { folderPath: '/docs' });
    expect(job.status).toBe('FAILED');
    expect(job.error).toBe('NO_VALID_FLASHCARDS');
  });
});
