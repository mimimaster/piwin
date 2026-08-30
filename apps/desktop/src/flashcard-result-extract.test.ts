import { describe, expect, it } from 'vitest';
import type { ChatMessageUi, ToolCardUi } from './chat-reducer';
import {
  extractFlashcardRecords,
  isFlashcardCreateTool,
  messageHasFlashcardToolResult,
} from './flashcard-result-extract.js';

const CLOZE_SCHEMA_SNIPPET = `{
  "name": "flashcard_create",
  "parameters": {
    "properties": {
      "model": { "type": "string", "enum": ["basic", "cloze"] },
      "text": {
        "type": "string",
        "description": "Cloze passage with {{c1::answer}} markers. Required for cloze."
      }
    }
  }
}`;

function assistant(tools: ToolCardUi[], text = ''): ChatMessageUi {
  return {
    id: 'msg-1',
    role: 'assistant',
    text,
    thinking: 'planning',
    tools,
    attachments: [],
    status: 'done',
  };
}

describe('flashcard result extract — name matching only', () => {
  it('does not treat plan_create as a flashcard when a search in the same turn quotes cloze schema', () => {
    const message = assistant([
      {
        toolCallId: 'tc-search',
        toolName: 'grep',
        status: 'done',
        output: `"model": "cloze"\nflashcard_batch_create\n${CLOZE_SCHEMA_SNIPPET}`,
      },
      {
        toolCallId: 'tc-plan',
        toolName: 'piwin_toolbox',
        status: 'done',
        output: '{"planId":"plan-1","title":"SessionPlan"}',
        presentation: {
          kind: 'other',
          title: 'piwin plan create SessionPlan',
          routedToolName: 'plan_create',
          output: { text: '{"planId":"plan-1","title":"SessionPlan"}', truncated: false },
        },
      },
    ]);

    expect(message.tools.every((tool) => !isFlashcardCreateTool(tool))).toBe(true);
    expect(messageHasFlashcardToolResult(message)).toBe(false);
    expect(extractFlashcardRecords(message)).toEqual([]);
  });

  it('does not scrape {{cN::}} out of a read/search of flashcard tool source', () => {
    const blob = [
      'export function buildFlashcardTools() {',
      '  // flashcard_batch_create',
      '  return { model: "cloze", text: "Cloze passage with {{c1::answer}} markers. Required for cloze." };',
      '}',
    ].join('\n');
    const message = assistant(
      [
        {
          toolCallId: 'tc-read',
          toolName: 'read',
          status: 'done',
          output: blob,
        },
        {
          toolCallId: 'tc-search',
          toolName: 'grep',
          status: 'done',
          output: `"model": "cloze"\nflashcard_batch_create\n${blob}`,
        },
      ],
      'I looked at the flashcard tool schema.',
    );

    expect(message.tools.every((tool) => !isFlashcardCreateTool(tool))).toBe(true);
    expect(extractFlashcardRecords(message)).toEqual([]);
  });

  it('still projects a routed toolbox flashcard_create by name', () => {
    const output = JSON.stringify({
      card: {
        id: 'card-1',
        model: 'cloze',
        deck: 'default',
        text: '线粒体是{{c1::细胞}}的能量工厂。',
        createdAt: '2026-08-18T05:43:48.281Z',
      },
    });
    const message = assistant([
      {
        toolCallId: 'tc-create',
        toolName: 'piwin_toolbox',
        status: 'done',
        output,
        presentation: {
          kind: 'other',
          title: 'flashcard_create',
          routedToolName: 'flashcard_create',
          output: { text: output, truncated: false },
        },
      },
    ]);

    expect(isFlashcardCreateTool(message.tools[0]!)).toBe(true);
    const cards = extractFlashcardRecords(message);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.front).toBe('线粒体是[…]的能量工厂。');
  });
});
