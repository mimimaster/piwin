import { describe, expect, it } from 'vitest';
import { buildCompactionSeedMessages } from './build-compaction-seed.js';

describe('buildCompactionSeedMessages', () => {
  it('keeps user/assistant context and folds product-only cards into text', () => {
    const result = buildCompactionSeedMessages([
      {
        id: 'u1',
        role: 'user',
        text: 'Implement the fix',
        createdAt: '2026-07-21T10:00:00.000Z',
        status: 'done',
      },
      {
        id: 'a1',
        role: 'assistant',
        text: 'I changed the parser.',
        createdAt: '2026-07-21T10:00:01.000Z',
        status: 'done',
        tools: [
          {
            toolCallId: 't1',
            toolName: 'read',
            status: 'done',
            output: 'src/parser.ts',
          },
        ],
      },
      {
        id: 's1',
        role: 'system',
        text: 'The project uses strict TypeScript.',
        createdAt: '2026-07-21T10:00:02.000Z',
        status: 'done',
      },
    ]);

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      role: 'user',
      text: 'Implement the fix',
      timestamp: Date.parse('2026-07-21T10:00:00.000Z'),
    });
    expect(result[1]).toMatchObject({ role: 'assistant' });
    expect(result[1]?.text).toContain('Tool read (done) output:\nsrc/parser.ts');
    expect(result[2]).toMatchObject({ role: 'user' });
    expect(result[2]?.text).toContain('[Original system context]');
  });
});
