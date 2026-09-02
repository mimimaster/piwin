import { describe, expect, it } from 'vitest';
import type { ChatMessageUi } from './chat-reducer';
import {
  conversationAssistantHasVisibleBody,
  resolveConversationTurnChrome,
  shouldHideConversationAssistantRow,
} from './conversation-turn-chrome';

function assistant(partial: Partial<ChatMessageUi> & Pick<ChatMessageUi, 'id'>): ChatMessageUi {
  return {
    role: 'assistant',
    text: '',
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
    ...partial,
  };
}

describe('conversationAssistantHasVisibleBody', () => {
  it('treats text, attachments, citations, and tools as visible', () => {
    expect(conversationAssistantHasVisibleBody(assistant({ id: 'empty' }))).toBe(false);
    expect(
      conversationAssistantHasVisibleBody(assistant({ id: 'think', thinking: 'plan the fetch' })),
    ).toBe(false);
    expect(conversationAssistantHasVisibleBody(assistant({ id: 'text', text: 'Hello' }))).toBe(true);
    expect(
      conversationAssistantHasVisibleBody(
        assistant({
          id: 'file',
          attachments: [
            {
              id: 'att-1',
              kind: 'media',
              path: '/tmp/a.png',
              mimeType: 'image/png',
              name: 'a.png',
              byteSize: 12,
              source: 'generated',
            },
          ],
        }),
      ),
    ).toBe(true);
    expect(
      conversationAssistantHasVisibleBody(
        assistant({
          id: 'cite',
          searchEvidence: {
            query: 'http',
            provenance: 'external',
            citations: [{ title: 'HTTP', url: 'https://example.com', provenance: 'external' }],
          },
        }),
      ),
    ).toBe(true);
    expect(
      conversationAssistantHasVisibleBody(
        assistant({
          id: 'image',
          tools: [{ toolCallId: 'g1', toolName: 'image_gen', status: 'running', output: '' }],
        }),
      ),
    ).toBe(true);
  });

  it('treats Conversation tool calls as visible body', () => {
    expect(
      conversationAssistantHasVisibleBody(
        assistant({
          id: 'fetch',
          thinking: 'read the page',
          tools: [{ toolCallId: 't1', toolName: 'web_fetch', status: 'done', output: 'ok' }],
        }),
      ),
    ).toBe(true);
    expect(
      conversationAssistantHasVisibleBody(
        assistant({
          id: 'search',
          tools: [{ toolCallId: 't2', toolName: 'web_search', status: 'running', output: '' }],
        }),
      ),
    ).toBe(true);
  });
});

describe('shouldHideConversationAssistantRow', () => {
  it('hides thinking-only intermediate completions', () => {
    expect(
      shouldHideConversationAssistantRow({
        message: assistant({ id: 'mid', thinking: 'I will fetch it' }),
        isLastAssistantInTurn: false,
        isActivelyStreaming: false,
      }),
    ).toBe(true);
  });

  it('keeps tool-only intermediate completions on screen', () => {
    expect(
      shouldHideConversationAssistantRow({
        message: assistant({
          id: 'search',
          thinking: 'look it up',
          tools: [{ toolCallId: 't-web', toolName: 'web_search', status: 'done', output: 'hits' }],
        }),
        isLastAssistantInTurn: false,
        isActivelyStreaming: false,
      }),
    ).toBe(false);
  });

  it('keeps the last thinking-only reply and any streaming row', () => {
    expect(
      shouldHideConversationAssistantRow({
        message: assistant({ id: 'last', thinking: 'still reasoning' }),
        isLastAssistantInTurn: true,
        isActivelyStreaming: false,
      }),
    ).toBe(false);
    expect(
      shouldHideConversationAssistantRow({
        message: assistant({ id: 'live', thinking: '…', status: 'streaming' }),
        isLastAssistantInTurn: false,
        isActivelyStreaming: true,
      }),
    ).toBe(false);
  });

  it('keeps failed empty assistant rows so TurnErrorCard has a home', () => {
    expect(
      shouldHideConversationAssistantRow({
        message: assistant({
          id: 'failed',
          status: 'error',
          error: 'The model produced no response.',
        }),
        isLastAssistantInTurn: true,
        isActivelyStreaming: false,
      }),
    ).toBe(false);
  });
});

describe('resolveConversationTurnChrome', () => {
  it('pins identity and usage to the first visible assistant of the latest turn', () => {
    const thinking = assistant({ id: 'a-think', thinking: 'fetch first' });
    const final = assistant({ id: 'a-final', text: 'Here is the page.' });
    const chrome = resolveConversationTurnChrome({
      messages: [
        { id: 'u1', role: 'user', text: 'fetch', thinking: '', tools: [], attachments: [], status: 'done' },
        thinking,
        final,
      ],
      lastAssistantMessageId: 'a-final',
      latestAssistantMessageId: 'a-final',
    });

    expect(chrome.hiddenAssistantIds.has('a-think')).toBe(true);
    expect(chrome.hiddenAssistantIds.has('a-final')).toBe(false);
    expect(chrome.identityMessageId).toBe('a-final');
    expect(chrome.showUsageOnIdentity).toBe(true);
  });

  it('keeps identity on the first visible assistant after tool-loop work and a later conclusion', () => {
    const process = assistant({
      id: 'a-work',
      text: 'I will fetch the page.',
      tools: [{ toolCallId: 't1', toolName: 'web_fetch', status: 'done', output: 'ok' }],
    });
    const final = assistant({ id: 'a-final', text: 'Here is the page.' });
    const chrome = resolveConversationTurnChrome({
      messages: [process, final],
      lastAssistantMessageId: 'a-final',
      latestAssistantMessageId: 'a-final',
    });

    expect(chrome.identityMessageId).toBe('a-work');
    expect(chrome.hiddenAssistantIds.size).toBe(0);
  });

  it('keeps identity on the first toolbox completion when a later caption arrives', () => {
    const process = assistant({
      id: 'a-gen-1',
      text: '先看一下生图接口，再随便出一张。',
      tools: [
        {
          toolCallId: 'tb-1',
          toolName: 'piwin_toolbox',
          status: 'done',
          output: 'ok',
          presentation: { kind: 'other', title: 'image_gen', actionVerb: 'Toolbox' },
        },
      ],
    });
    const image = assistant({
      id: 'a-gen-2',
      attachments: [
        {
          id: 'att-1',
          kind: 'media',
          path: '/tmp/a.png',
          mimeType: 'image/png',
          name: 'a.png',
          byteSize: 12,
          source: 'generated',
        },
      ],
    });
    const caption = assistant({ id: 'a-gen-3', text: '随手出了一张：黄昏乡间小路。' });
    const chrome = resolveConversationTurnChrome({
      messages: [process, image, caption],
      lastAssistantMessageId: 'a-gen-3',
      latestAssistantMessageId: 'a-gen-3',
    });

    expect(chrome.identityMessageId).toBe('a-gen-1');
    expect(chrome.hiddenAssistantIds.size).toBe(0);
  });

  it('keeps identity on the first visible completion when two replies both have text', () => {
    const first = assistant({ id: 'a-1', text: 'I will look that up.' });
    const second = assistant({ id: 'a-2', text: 'Done.' });
    const chrome = resolveConversationTurnChrome({
      messages: [first, second],
      lastAssistantMessageId: 'a-2',
      latestAssistantMessageId: 'a-2',
    });

    expect(chrome.identityMessageId).toBe('a-1');
    expect(chrome.hiddenAssistantIds.size).toBe(0);
    expect(chrome.showUsageOnIdentity).toBe(true);
  });

  it('does not put usage on an older turn', () => {
    const chrome = resolveConversationTurnChrome({
      messages: [assistant({ id: 'a-old', text: 'earlier' })],
      lastAssistantMessageId: 'a-old',
      latestAssistantMessageId: 'a-new',
    });
    expect(chrome.identityMessageId).toBe('a-old');
    expect(chrome.showUsageOnIdentity).toBe(false);
  });
});
