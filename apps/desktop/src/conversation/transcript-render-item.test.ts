import { describe, expect, it } from 'vitest';
import type { ChatMessageUi } from './chat-reducer';
import {
  flattenTranscriptTurnsToItems,
  indexTranscriptRenderItemsByMessageId,
  TRANSCRIPT_ITEM_ESTIMATED_HEIGHTS,
} from './transcript-render-item';
import { groupTranscriptTurns } from './transcript-turns';

describe('Transcript Render Item Flattening Pipeline', () => {
  it('flattens a simple turn into user-message and assistant-message', () => {
    const messages: ChatMessageUi[] = [
      {
        id: 'user-1',
        role: 'user',
        text: 'Hello',
        thinking: '',
        tools: [],
        attachments: [],
        status: 'done',
      },
      {
        id: 'asst-1',
        role: 'assistant',
        text: 'Hi there!',
        thinking: '',
        tools: [],
        attachments: [],
        status: 'done',
      },
    ];

    const turns = groupTranscriptTurns(messages);
    const items = flattenTranscriptTurnsToItems(turns);

    expect(items).toHaveLength(2);
    expect(items[0]?.type).toBe('user-message');
    expect(items[0]?.id).toBe('user-user-1');
    expect(items[1]?.type).toBe('assistant-message');
    expect(items[1]?.id).toBe('assistant-asst-1');
    if (items[1]?.type === 'assistant-message') {
      expect(items[1].message.tools).toEqual([]);
    }
  });

  it('splits tool calls into a preceding tool-group item and strips tools from assistant-message', () => {
    const messages: ChatMessageUi[] = [
      {
        id: 'user-1',
        role: 'user',
        text: 'Read file',
        thinking: '',
        tools: [],
        attachments: [],
        status: 'done',
      },
      {
        id: 'asst-1',
        role: 'assistant',
        text: 'File content is ...',
        thinking: 'I will use view_file',
        tools: [
          {
            toolCallId: 'call-1',
            toolName: 'view_file',
            status: 'done',
            output: 'content',
          },
        ],
        attachments: [],
        status: 'done',
      },
    ];

    const turns = groupTranscriptTurns(messages);
    const items = flattenTranscriptTurnsToItems(turns);

    expect(items).toHaveLength(3);
    expect(items[0]?.type).toBe('user-message');
    expect(items[1]?.type).toBe('tool-group');
    expect(items[1]?.id).toBe('tools-asst-1');
    if (items[1]?.type === 'tool-group') {
      expect(items[1].tools).toHaveLength(1);
      expect(items[1].tools[0]?.toolCallId).toBe('call-1');
    }

    expect(items[2]?.type).toBe('assistant-message');
    expect(items[2]?.id).toBe('assistant-asst-1');
    if (items[2]?.type === 'assistant-message') {
      // Invariant: tools must be empty array to prevent double-rendering inside TurnWorkDetails
      expect(items[2].message.tools).toEqual([]);
      expect(items[2].message.originalTools).toHaveLength(1);
    }
  });

  it('correctly maps message IDs for outline navigation and scroll targeting', () => {
    const messages: ChatMessageUi[] = [
      {
        id: 'user-1',
        role: 'user',
        text: 'Task 1',
        thinking: '',
        tools: [],
        attachments: [],
        status: 'done',
      },
      {
        id: 'asst-1',
        role: 'assistant',
        text: 'Result 1',
        thinking: '',
        tools: [{ toolCallId: 'c1', toolName: 'run_command', status: 'done', output: 'ok' }],
        attachments: [],
        status: 'done',
      },
    ];

    const turns = groupTranscriptTurns(messages);
    const items = flattenTranscriptTurnsToItems(turns);
    const indexMap = indexTranscriptRenderItemsByMessageId(items);

    expect(indexMap.get('user-1')).toBe(0);
    // asst-1 resolves to index of assistant message or tool group
    expect(indexMap.get('asst-1')).toBeDefined();
  });

  it('provides reasonable baseline height estimates for all item types', () => {
    expect(TRANSCRIPT_ITEM_ESTIMATED_HEIGHTS['user-message']).toBeGreaterThan(0);
    expect(TRANSCRIPT_ITEM_ESTIMATED_HEIGHTS['tool-group']).toBeGreaterThan(0);
    expect(TRANSCRIPT_ITEM_ESTIMATED_HEIGHTS['assistant-message']).toBeGreaterThan(0);
  });
});
