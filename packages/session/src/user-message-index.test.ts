import { describe, expect, it } from 'vitest';
import { SESSION_USER_MESSAGE_INDEX_MAX_BYTES } from '@piwin/contracts';
import { createUserMessageIndexData } from './user-message-index.js';

describe('createUserMessageIndexData byte budget', () => {
  it('never exceeds the hard encoded-anchor ceiling for hostile message ids', () => {
    const hostileId = `hostile-${'x'.repeat(8_000)}`;
    const rows = Array.from({ length: 64 }, (_, index) => ({
      messageId: `${hostileId}-${index}`,
      createdAt: '2026-08-12T00:00:00.000Z',
      ordinal: index,
      spanStartOrdinal: index,
      spanEndOrdinal: index,
      preview: 'preview text that is long enough to matter in aggregate',
    }));
    const index = createUserMessageIndexData({
      sessionId: 'session-hostile',
      revision: 'rev-1',
      totalUserMessages: rows.length,
      maximumTicks: 64,
      rows,
    });
    expect(index.anchorBytes).toBeLessThanOrEqual(SESSION_USER_MESSAGE_INDEX_MAX_BYTES);
    expect(index.anchorBytes).toBe(Buffer.byteLength(JSON.stringify(index.anchors), 'utf8'));
  });
});
