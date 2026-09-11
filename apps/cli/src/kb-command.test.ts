import { describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { runKbCommandWithClient } from './kb-command.js';

function ok(command: string, data: unknown): HostResponse {
  return { type: 'response', command, success: true, data };
}

describe('runKbCommandWithClient', () => {
  it('lists bases from the Host', async () => {
    const handleCommand = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'host/status') {
        return ok('host/status', { capabilities: { knowledgeBases: true } });
      }
      if (command.type === 'knowledge/bases/list') {
        return ok('knowledge/bases/list', {
          bases: [
            {
              id: 'notes',
              kind: 'notes',
              name: 'Notes',
              state: 'ready',
              degraded: false,
              documentCount: 2,
            },
          ],
        });
      }
      throw new Error(`unexpected ${command.type}`);
    });
    const lines: string[] = [];
    await runKbCommandWithClient(['kb', 'list'], { handleCommand, dispose: async () => undefined }, (line) =>
      lines.push(line),
    );
    expect(lines[0]).toContain('notes');
    expect(lines[0]).toContain('Notes');
  });

  it('passes --kb and --limit through to knowledge/search', async () => {
    const handleCommand = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'host/status') {
        return ok('host/status', { capabilities: { knowledgeBases: true } });
      }
      if (command.type === 'knowledge/search') {
        expect(command.query).toBe('fsrs schedule');
        expect(command.baseIds).toEqual(['notes', 'folder:0123456789abcdef']);
        expect(command.limit).toBe(5);
        return ok('knowledge/search', { citations: [], degradedBaseIds: [], skipped: [] });
      }
      throw new Error(`unexpected ${command.type}`);
    });
    await runKbCommandWithClient(
      ['kb', 'search', 'fsrs', 'schedule', '--kb', 'notes', '--kb', 'folder:0123456789abcdef', '--limit', '5'],
      { handleCommand, dispose: async () => undefined },
    );
    expect(handleCommand).toHaveBeenCalled();
  });
});
