import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from './session-transcript.js';
import {
  displayResourceTarget,
  mergeGeneratedMediaResources,
  projectSessionResources,
  SESSION_RESOURCES_MAX,
} from './session-resource.js';

function userMessage(
  id: string,
  extras: Partial<SessionTranscriptMessage> = {},
): SessionTranscriptMessage {
  return {
    id,
    role: 'user',
    text: extras.text ?? 'hello',
    createdAt: '2026-11-04T00:00:00.000Z',
    status: 'done',
    ...extras,
  };
}

function assistantMessage(
  id: string,
  extras: Partial<SessionTranscriptMessage> = {},
): SessionTranscriptMessage {
  return {
    id,
    role: 'assistant',
    text: extras.text ?? 'ok',
    createdAt: '2026-11-04T00:00:01.000Z',
    status: 'done',
    ...extras,
  };
}

describe('displayResourceTarget', () => {
  it('keeps the address and drops the query', () => {
    expect(displayResourceTarget('https://example.com/a?token=secret')).toBe(
      'https://example.com/a',
    );
    expect(displayResourceTarget('  https://example.com/a#frag  ')).toBe(
      'https://example.com/a',
    );
    expect(displayResourceTarget('docs/api.md')).toBe('docs/api.md');
  });
});

describe('projectSessionResources', () => {
  it('projects attachments, skills, search hits, knowledge, and writes', () => {
    const resources = projectSessionResources('sess-1', [
      userMessage('u1', {
        skillId: 'eli5',
        attachments: [
          {
            id: 'img-1',
            kind: 'media',
            path: '/Users/me/.piwin/media/sess-1/img-1.png',
            mimeType: 'image/png',
            name: 'shot.png',
            byteSize: 12,
            source: 'paste',
          },
        ],
      }),
      assistantMessage('a1', {
        tools: [
          {
            toolCallId: 't-search',
            toolName: 'web_search',
            status: 'done',
            output: JSON.stringify({
              query: 'tauri',
              providerId: 'brave',
              hits: [
                {
                  title: 'Tauri',
                  url: 'https://tauri.app/?utm=1',
                  snippet: '',
                },
              ],
            }),
          },
          {
            toolCallId: 't-know',
            toolName: 'knowledge_search',
            status: 'done',
            output: '',
            presentation: {
              kind: 'other',
              title: 'knowledge_search',
              knowledge: {
                kind: 'knowledge-citations',
                citations: [
                  {
                    ref: 1,
                    baseId: 'notes',
                    baseName: 'Notes',
                    kind: 'notes',
                    title: '登录流程',
                    noteId: 'note-9',
                    text: '…',
                  },
                ],
                degradedBaseIds: [],
              },
            },
          },
        ],
        workspaceWrites: { files: ['src/login.ts', '/tmp/abs.log'], hasUnknownWrites: false },
      }),
    ]);

    expect(resources.map((item) => item.id)).toEqual([
      'att:u1:img-1',
      'skill:u1:eli5',
      'search:a1:t-search:0',
      'knowledge:a1:t-know:1',
      'write:a1:0',
      'write:a1:1',
    ]);
    expect(resources.find((item) => item.id === 'search:a1:t-search:0')?.target).toBe(
      'https://tauri.app/',
    );
    expect(resources.find((item) => item.id === 'write:a1:1')?.title).toBe('abs.log');
    expect(resources.find((item) => item.id === 'write:a1:1')?.target).toBeUndefined();
    expect(resources.find((item) => item.id === 'write:a1:0')?.role).toBe('output');
    expect(resources.find((item) => item.id === 'att:u1:img-1')?.role).toBe('input');
  });

  it('does not invent a source from a URL in the message text', () => {
    const resources = projectSessionResources('sess-1', [
      userMessage('u1', { text: 'see https://evil.example/secret' }),
      assistantMessage('a1', { text: 'I opened https://evil.example/secret' }),
    ]);
    expect(resources).toEqual([]);
  });

  it('projects prompt context files and generated media on the assistant row', () => {
    const resources = projectSessionResources('sess-1', [
      userMessage('u1', {
        contextRefs: [
          {
            kind: 'file',
            projectPath: '/Users/me/repo',
            relativePath: 'src/auth.ts',
            label: 'auth.ts',
          },
        ],
      }),
      assistantMessage('a1', {
        attachments: [
          {
            id: 'out-1',
            kind: 'media',
            path: '/Users/me/.piwin/media/sess-1/out-1.png',
            mimeType: 'image/png',
            name: 'dusk.png',
            byteSize: 20,
            source: 'generated',
          },
        ],
      }),
    ]);
    expect(resources.map((item) => item.id)).toEqual(['ctx:u1:0', 'gen:a1:out-1']);
    expect(resources[0]?.provenance).toBe('prompt-context');
    expect(resources[0]?.role).toBe('input');
    expect(resources[1]?.kind).toBe('media');
    expect(resources[1]?.role).toBe('output');
  });

  it('keeps the most recent resources when over the cap', () => {
    const messages: SessionTranscriptMessage[] = [];
    for (let index = 0; index < SESSION_RESOURCES_MAX + 5; index += 1) {
      messages.push(
        userMessage(`u${String(index)}`, {
          skillId: `skill-${String(index)}`,
        }),
      );
    }
    const resources = projectSessionResources('sess-1', messages);
    expect(resources).toHaveLength(SESSION_RESOURCES_MAX);
    expect(resources[0]?.title).toBe('skill-5');
    expect(resources[resources.length - 1]?.title).toBe(
      `skill-${String(SESSION_RESOURCES_MAX + 4)}`,
    );
  });
});

describe('mergeGeneratedMediaResources', () => {
  it('adds vault assets that are not already on a message', () => {
    const merged = mergeGeneratedMediaResources(
      'sess-1',
      projectSessionResources('sess-1', [
        userMessage('u1', {
          attachments: [
            {
              id: 'paste-1',
              kind: 'media',
              path: '/tmp/paste-1.png',
              mimeType: 'image/png',
              name: 'paste.png',
              byteSize: 4,
              source: 'paste',
            },
          ],
        }),
      ]),
      [
        { assetId: 'paste-1', title: 'ignored duplicate' },
        { assetId: 'gen-9', title: 'dusk.png' },
      ],
    );
    expect(merged.map((item) => item.id)).toEqual(['att:u1:paste-1', 'gen:gen-9']);
    expect(merged[1]?.messageId).toBeUndefined();
  });
});
