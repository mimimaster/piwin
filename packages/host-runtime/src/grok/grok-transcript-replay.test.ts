import { describe, expect, it } from 'vitest';
import { replayAddsConversation, replayEventsToRows } from './grok-transcript-replay.js';
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

describe('replayAddsConversation', () => {
  const history = [
    { role: 'user' as const, text: 'fix the sidebar' },
    { role: 'assistant' as const, text: 'Done.\n' },
  ];

  it('is false when a resume replays the conversation already shown', () => {
    expect(replayAddsConversation(history, [{ role: 'user', text: 'fix the sidebar' }, { role: 'assistant', text: 'Done.' }])).toBe(false);
  });

  it('is false for a first import into an empty projection', () => {
    expect(replayAddsConversation([], history)).toBe(false);
  });

  it('is true when the agent holds a turn the projection did not show', () => {
    expect(replayAddsConversation(history, [...history, { role: 'user', text: 'and the header' }])).toBe(true);
  });
});
