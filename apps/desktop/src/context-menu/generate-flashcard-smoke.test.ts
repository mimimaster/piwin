/**
 * Narrow PR1 smoke: menu dispatch issues the preset turn text, and a
 * flashcard_create tool result still projects via FlashcardDisplayPayload.
 * Not a full Mock Host roundtrip / workbench harness.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessageUi } from '../chat-reducer.js';
import { extractFlashcardRecords } from '../flashcard-result-extract.js';
import type { HostClient } from '../host-client.js';
import {
  createDesktopContextMenuValue,
  type DesktopContextMenuValueDeps,
} from './desktop-context-menu-value.js';
import { dispatchContextMenuAction } from './dispatch.js';
import { PRESET_TEMPLATES } from './presets.js';
import type { ContextMenuTarget } from './types.js';

function fakeHost(): HostClient {
  return {
    supportsCommand: () => true,
    sideChatOpen: vi.fn(async () => ({ success: true as const, data: {} })),
  } as unknown as HostClient;
}

describe('generate-flashcard smoke', () => {
  it('menu action sends the flashcard preset; tool display payload projects a card', () => {
    const handleSend = vi.fn();
    const addContextRef = vi.fn(() => ({
      ok: true as const,
      item: {
        token: 't',
        key: 'k',
        ref: {
          kind: 'selection' as const,
          snapshotText: '依赖数组',
          label: 'sel',
        },
        label: 'sel',
      },
      deduped: false,
    }));
    const deps: DesktopContextMenuValueDeps = {
      projectPath: '/repo',
      activeSessionId: 'sess-1',
      hostReady: true,
      locale: 'zh-CN',
      hostClient: fakeHost(),
      addContextRef,
      dispatchNotification: vi.fn(),
      handleOpenDocument: vi.fn(),
      handleRetryMessage: vi.fn(),
      requestTruncateAfter: vi.fn(),
      handleSend,
      handleForkSession: vi.fn(),
      setComposer: vi.fn(),
      openInspector: vi.fn(),
    };
    const { dispatchers } = createDesktopContextMenuValue(deps);
    const target: ContextMenuTarget = {
      surface: 'selection',
      projectPath: '/repo',
      relativePath: 'docs/react.md',
      lineStart: 12,
      lineEnd: 12,
      selectedText: '依赖数组',
      label: 'react.md:12',
    };

    dispatchContextMenuAction('generate-flashcard', target, dispatchers);

    expect(handleSend).toHaveBeenCalledTimes(1);
    expect(handleSend.mock.calls[0]?.[0]).toBe(PRESET_TEMPLATES['generate-flashcard']);
    expect(addContextRef).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'selection', snapshotText: '依赖数组' }),
    );

    const toolMessage: ChatMessageUi = {
      id: 'm-flash',
      role: 'assistant',
      text: '已创建闪卡',
      thinking: '',
      tools: [
        {
          toolCallId: 'tc-1',
          toolName: 'flashcard_create',
          status: 'done',
          output: JSON.stringify({
            card: { id: 'card-1', front: '什么是依赖数组？', back: '控制 effect 重跑的值列表。' },
            display: {
              cards: [
                {
                  cardId: 'card-1',
                  itemId: 'card-1',
                  model: 'basic',
                  ordinal: 1,
                  deck: 'default',
                  front: '什么是依赖数组？',
                  back: '控制 effect 重跑的值列表。',
                  createdAt: '2026-08-30T00:00:00.000Z',
                },
              ],
            },
          }),
        },
      ],
      attachments: [],
      status: 'done',
    };
    const cards = extractFlashcardRecords(toolMessage);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.front).toBe('什么是依赖数组？');
  });
});
