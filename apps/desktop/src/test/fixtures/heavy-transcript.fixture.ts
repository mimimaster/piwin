/**
 * Heavy transcript fixture reproducing the exact production incident conditions:
 * - 3 historical turns
 * - 1 turn containing 12 tool calls (file view, diff, shell, etc.)
 * - Assistant messages containing 900-line Markdown code blocks
 * - Long streaming assistant message with large thinking text (10,000+ chars)
 */
import type { ChatMessageUi, ToolCardUi } from '../../chat-reducer';

export function create900LineCodeBlock(lang = 'tsx'): string {
  const lines: string[] = [];
  lines.push('// Auto-generated heavy code block simulating blueprint-compiler.ts');
  lines.push('import React, { useState, useEffect, useMemo, useCallback } from "react";');
  for (let i = 1; i <= 900; i++) {
    lines.push(
      `export function calculateNodeMetrics_${i}(input: { id: string; weight: number }): number { const factor = ${i} * 1.5; return input.weight * factor + Math.sin(${i}); }`,
    );
  }
  return `\`\`\`${lang}\n${lines.join('\n')}\n\`\`\``;
}

export function createHeavyTranscriptMessages(): ChatMessageUi[] {
  const code900 = create900LineCodeBlock('tsx');

  // Turn 1: User prompt & initial assistant response with 900 lines of code
  const turn1User: ChatMessageUi = {
    id: 'msg-user-1',
    role: 'user',
    text: 'Please review and refactor blueprint-compiler.ts',
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
  };

  const turn1Assistant: ChatMessageUi = {
    id: 'msg-assistant-1',
    role: 'assistant',
    text: `Here is the current implementation of blueprint-compiler.ts:\n\n${code900}\n\nLet me inspect the dependencies now.`,
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
  };

  // Turn 2: User follow-up and an agent turn containing 12 continuous tool calls
  const turn2User: ChatMessageUi = {
    id: 'msg-user-2',
    role: 'user',
    text: 'Go ahead and search all references and inspect chunk 1 to 12.',
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
  };

  const tools12: ToolCardUi[] = [];
  for (let i = 1; i <= 12; i++) {
    tools12.push({
      toolCallId: `tool-call-${i}`,
      toolName: i % 3 === 0 ? 'run_command' : 'view_file',
      status: 'done',
      output: `// Chunk ${i} output preview\n${'const chunkLine = "data";\n'.repeat(50)}`,
      presentation: {
        kind: 'other',
        title: `Chunk ${i} of blueprint-compiler.ts`,
        ...(i % 3 === 0 ? { command: `git grep "calculateNodeMetrics_${i}"` } : {}),
        durationMs: 120 + i * 15,
        targetPaths: [`/Users/yorickjue/Developer/piwin/packages/blueprint/src/chunk_${i}.ts`],
      },
    });
  }

  const turn2Assistant: ChatMessageUi = {
    id: 'msg-assistant-2',
    role: 'assistant',
    text: `I have examined all 12 chunks. Here is the refactored code:\n\n${code900}`,
    thinking: '',
    tools: tools12,
    attachments: [],
    status: 'done',
  };

  // Turn 3: User request and an actively streaming assistant message with large thinking
  const turn3User: ChatMessageUi = {
    id: 'msg-user-3',
    role: 'user',
    text: 'Now explain the architectural memory improvements in detail.',
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
  };

  const turn3AssistantStreaming: ChatMessageUi = {
    id: 'msg-assistant-3',
    role: 'assistant',
    text: 'The architectural improvements are categorized into four defense layers: '.repeat(100),
    thinking: 'Thinking through the entire WebKit memory architecture and WebProcess lifecycle... '.repeat(300),
    tools: [
      {
        toolCallId: 'tool-call-live',
        toolName: 'view_file',
        status: 'running',
        output: 'Reading memory-governor.ts in progress...',
      },
    ],
    attachments: [],
    status: 'streaming',
  };

  return [
    turn1User,
    turn1Assistant,
    turn2User,
    turn2Assistant,
    turn3User,
    turn3AssistantStreaming,
  ];
}
