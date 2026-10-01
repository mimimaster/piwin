import { expect, it } from 'vitest';
import { replayEventsToRows } from './grok-transcript-replay.js';
it('preserves generated attachment ownership when another assistant has begun', () => {
  const rows = replayEventsToRows([
    { type: 'message/start', messageId: 'owner', role: 'assistant' },
    { type: 'message/start', messageId: 'later', role: 'assistant' },
    { type: 'message/text_delta', messageId: 'later', delta: 'done' },
    { type: 'tool/end', toolCallId: 'image', isError: false, responseMessageId: 'owner', presentation: { kind: 'image', title: 'imagine: portrait', routedToolName: 'image_gen' }, attachments: [{ id: 'asset', kind: 'media', path: '/vault/asset.jpg', mimeType: 'image/jpeg', byteSize: 1, source: 'generated' }] },
  ]);
  expect(rows[0]).toMatchObject({ id: 'owner', tools: [{ toolName: 'image_gen' }], attachments: [{ id: 'asset' }] });
  expect(rows[1]?.attachments).toBeUndefined();
});
