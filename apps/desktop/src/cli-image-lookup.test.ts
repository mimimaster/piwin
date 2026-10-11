import { describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse, MediaAttachmentRef, SessionTranscriptMessage } from '@piwin/contracts';
import { findGeneratedImage, lookupCliImage } from './cli-image-lookup.js';

const image = (id: string, name: string): MediaAttachmentRef =>
  ({ id, kind: 'media', path: `/vault/${id}`, mimeType: 'image/jpeg', name, byteSize: 1, source: 'generated' });
const message = (id: string, attachments: MediaAttachmentRef[]): SessionTranscriptMessage =>
  ({ id, role: 'assistant', text: '', status: 'done', createdAt: '', attachments }) as unknown as SessionTranscriptMessage;
const ok = (command: string, data: unknown): HostResponse => ({ type: 'response', command, success: true, data }) as HostResponse;

describe('findGeneratedImage', () => {
  it('matches the file name and prefers the newest turn', () => {
    const messages = [message('a', [image('old', '1.jpg')]), message('b', [image('other', '2.jpg')]), message('c', [image('new', '1.jpg')])];
    expect(findGeneratedImage(messages, '1.jpg')?.id).toBe('new');
    expect(findGeneratedImage(messages, '2.jpg')?.id).toBe('other');
    expect(findGeneratedImage(messages, '3.jpg')).toBeUndefined();
  });
});

describe('lookupCliImage', () => {
  it('replays the agent history before reading attachments', async () => {
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> =>
      command.type === 'agents/cli-sync' ? ok(command.type, {}) : ok(command.type, { messages: [message('a', [image('x', '1.jpg')])] }));
    await expect(lookupCliImage({ request }, 's1', '1.jpg')).resolves.toMatchObject({ status: 'found', attachment: { id: 'x' } });
    expect(request.mock.calls.map(([command]) => command.type)).toEqual(['agents/cli-sync', 'session/messages']);
  });

  it('distinguishes an unknown file from a failed sync', async () => {
    const empty = vi.fn(async (command: HostCommand) => ok(command.type, { messages: [] }));
    await expect(lookupCliImage({ request: empty }, 's1', '1.jpg')).resolves.toEqual({ status: 'missing' });
    const refused = vi.fn(async (command: HostCommand) => ({ type: 'response', command: command.type, success: false, error: 'history unavailable' }) as HostResponse);
    await expect(lookupCliImage({ request: refused }, 's1', '1.jpg')).resolves.toEqual({ status: 'failed', error: 'history unavailable' });
    const thrown = vi.fn(async () => { throw new Error('timed out'); });
    await expect(lookupCliImage({ request: thrown }, 's1', '1.jpg')).resolves.toEqual({ status: 'failed', error: 'timed out' });
  });
});
