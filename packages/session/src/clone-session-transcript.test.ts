import { describe, it, expect } from 'vitest';
import { cloneTranscript, rewriteAttachmentPaths, collectAttachmentPaths } from './clone-session-transcript.js';
import type { SessionTranscriptDocument, SessionTranscriptMessage } from '@piwin/contracts';

function makeTestTranscript(): SessionTranscriptDocument {
  return {
    version: 1,
    sessionId: 'source-1',
    projectPath: '/test',
    messages: [
      { id: 'msg-1', role: 'user', text: 'Hello', createdAt: '2026-01-01T00:00:00Z', status: 'done' },
      { id: 'msg-2', role: 'assistant', text: 'Hi there', createdAt: '2026-01-01T00:00:01Z', status: 'done' },
      { id: 'msg-3', role: 'user', text: 'Second question', createdAt: '2026-01-01T00:00:02Z', status: 'done' },
      { id: 'msg-4', role: 'assistant', text: 'Second answer', createdAt: '2026-01-01T00:00:03Z', status: 'done' },
    ],
    updatedAt: '2026-01-01T00:00:03Z',
  };
}

describe('cloneTranscript', () => {
  it('clones all messages by default', () => {
    const source = makeTestTranscript();
    const { transcript, idMap } = cloneTranscript({ source, targetSessionId: 'target-1' });
    expect(transcript.messages).toHaveLength(4);
    expect(transcript.sessionId).toBe('target-1');
    expect(idMap.size).toBe(4);
    // IDs should be regenerated
    for (const oldId of ['msg-1', 'msg-2', 'msg-3', 'msg-4']) {
      const newId = idMap.get(oldId);
      expect(newId).toBeDefined();
      expect(newId).not.toBe(oldId);
    }
  });

  it('clones only prefix when upToIndex is set', () => {
    const source = makeTestTranscript();
    const { transcript, idMap } = cloneTranscript({ source, targetSessionId: 'target-1', upToIndex: 1 });
    expect(transcript.messages).toHaveLength(2);
    expect(transcript.messages[0]!.role).toBe('user');
    expect(transcript.messages[1]!.role).toBe('assistant');
    expect(idMap.size).toBe(2);
  });

  it('normalizes streaming status to done', () => {
    const source: SessionTranscriptDocument = {
      version: 1,
      sessionId: 'source-1',
      projectPath: '/test',
      messages: [
        { id: 'msg-1', role: 'assistant', text: 'partial', createdAt: '2026-01-01T00:00:00Z', status: 'streaming' },
      ],
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const { transcript } = cloneTranscript({ source, targetSessionId: 'target-1' });
    expect(transcript.messages[0]!.status).toBe('done');
  });

  it('preserves terminal metadata on cloned assistant rows', () => {
    const sourceMessage: SessionTranscriptMessage = {
      id: 'msg-terminal',
      role: 'assistant',
      text: 'Completed answer',
      createdAt: '2026-01-01T00:00:00Z',
      status: 'done',
      outcome: 'completed',
      endedAt: '2026-01-01T00:00:01Z',
      agentStopReason: 'stop',
      source: 'continuation',
      voiceCallId: 'call-1',
      skillId: 'writing-plans',
      workspaceWrites: { files: ['src/main.ts'], hasUnknownWrites: false },
    };
    const source: SessionTranscriptDocument = {
      ...makeTestTranscript(),
      messages: [sourceMessage],
    };

    const { transcript } = cloneTranscript({ source, targetSessionId: 'target-1' });
    expect(transcript.messages[0]).toMatchObject({
      outcome: 'completed',
      endedAt: '2026-01-01T00:00:01Z',
      agentStopReason: 'stop',
      source: 'continuation',
      voiceCallId: 'call-1',
      skillId: 'writing-plans',
      workspaceWrites: { files: ['src/main.ts'], hasUnknownWrites: false },
    });
  });

  it('preserves scope and workingDirectory', () => {
    const source = makeTestTranscript();
    source.scope = { kind: 'project', projectPath: '/test' };
    source.workingDirectory = '/test';
    const { transcript } = cloneTranscript({ source, targetSessionId: 'target-1' });
    expect(transcript.scope).toEqual({ kind: 'project', projectPath: '/test' });
    expect(transcript.workingDirectory).toBe('/test');
  });
});

describe('rewriteAttachmentPaths', () => {
  it('rewrites media attachment paths', () => {
    const source: SessionTranscriptDocument = {
      version: 1,
      sessionId: 'source-1',
      projectPath: '/test',
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          text: 'See image',
          createdAt: '2026-01-01T00:00:00Z',
          status: 'done',
          attachments: [
            { id: 'att-1', kind: 'media', path: '/old/media/source-1/img.png', mimeType: 'image/png', byteSize: 100, source: 'paste' },
          ],
        },
      ],
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const { transcript } = cloneTranscript({ source, targetSessionId: 'target-1' });
    rewriteAttachmentPaths(transcript, (oldPath) => oldPath.replace('source-1', 'target-1'));
    expect(transcript.messages[0]!.attachments![0]!.path).toBe('/old/media/target-1/img.png');
  });
});

describe('collectAttachmentPaths', () => {
  it('collects media attachment paths', () => {
    const source = makeTestTranscript();
    source.messages[0]!.attachments = [
      { id: 'att-1', kind: 'media', path: '/media/a.png', mimeType: 'image/png', byteSize: 100, source: 'paste' },
    ];
    source.messages[2]!.attachments = [
      { id: 'att-2', kind: 'media', path: '/media/b.png', mimeType: 'image/png', byteSize: 200, source: 'drop' },
    ];
    const paths = collectAttachmentPaths(source.messages);
    expect(paths).toHaveLength(2);
    expect(paths[0]!.path).toBe('/media/a.png');
    expect(paths[1]!.path).toBe('/media/b.png');
  });
});
