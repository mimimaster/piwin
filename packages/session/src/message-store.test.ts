import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appendTranscriptMessage,
  createAssistantTranscriptMessage,
  createUserTranscriptMessage,
  listTranscriptMessages,
  patchTranscriptMessage,
  truncateTranscriptFrom,
} from './message-store.js';

describe('message-store', () => {
  it('appends user/assistant messages and patches assistant text', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-transcript-'));
    const filePath = join(dir, 'transcript.json');
    const user = createUserTranscriptMessage({
      id: 'u1',
      text: 'hello',
      attachments: [
        {
          id: 'a1',
          kind: 'media',
          path: '/tmp/media/x.png',
          mimeType: 'image/png',
          byteSize: 10,
          source: 'paste',
        },
      ],
    });
    await appendTranscriptMessage(filePath, 's1', '/tmp/proj', user);
    const assistant = createAssistantTranscriptMessage({ id: 'a1' });
    await appendTranscriptMessage(filePath, 's1', '/tmp/proj', assistant);
    await patchTranscriptMessage(filePath, 's1', '/tmp/proj', 'a1', {
      text: 'hi there',
      status: 'done',
    });
    const messages = await listTranscriptMessages(filePath);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.attachments?.[0]?.path).toContain('x.png');
    expect(messages[1]?.text).toBe('hi there');
    expect(messages[1]?.status).toBe('done');
  });

  it('truncates from a message id inclusive of the tail', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-truncate-'));
    const filePath = join(dir, 'transcript.json');
    await appendTranscriptMessage(
      filePath,
      's1',
      '/tmp/proj',
      createUserTranscriptMessage({ id: 'u1', text: 'one' }),
    );
    await appendTranscriptMessage(
      filePath,
      's1',
      '/tmp/proj',
      createAssistantTranscriptMessage({ id: 'a1' }),
    );
    await appendTranscriptMessage(
      filePath,
      's1',
      '/tmp/proj',
      createUserTranscriptMessage({ id: 'u2', text: 'two' }),
    );
    const result = await truncateTranscriptFrom(filePath, 'u2');
    expect(result.removedCount).toBe(1);
    expect(result.remainingCount).toBe(2);
    const messages = await listTranscriptMessages(filePath);
    expect(messages.map((item) => item.id)).toEqual(['u1', 'a1']);
    expect(result.found).toBe(true);
  });

  it('reports found=false when messageId is missing without rewriting', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-msg-store-miss-'));
    const filePath = join(dir, 'transcript.json');
    await appendTranscriptMessage(
      filePath,
      's1',
      '/tmp/proj',
      createUserTranscriptMessage({ id: 'u1', text: 'one' }),
    );
    const result = await truncateTranscriptFrom(filePath, 'missing-id');
    expect(result.found).toBe(false);
    expect(result.removedCount).toBe(0);
    expect(result.remainingCount).toBe(1);
    const messages = await listTranscriptMessages(filePath);
    expect(messages.map((item) => item.id)).toEqual(['u1']);
  });
});
