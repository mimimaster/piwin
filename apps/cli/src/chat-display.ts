import type { AgentEvent } from '@piwin/contracts';
import { formatCliAgentErrorEvent } from './cli-agent-error.js';
import { formatCliFlashcardToolResult } from './flashcard-tool-result.js';

/** How the human-readable `piwin chat` stream draws agent events. */
export function createAssistantCliDisplay() {
  let thinkingBuffer = '';
  let sawTextDelta = false;
  let composingAnnounced = false;

  return {
    /** Process one AgentEvent, return the string to write (or null for no-op). */
    feed(event: AgentEvent): string | null {
      switch (event.type) {
        case 'message/text_delta':
          // Flush any buffered thinking block before text starts
          if (thinkingBuffer) {
            const block = `\n[thinking]\n${thinkingBuffer.trimEnd()}\n[/thinking]\n`;
            thinkingBuffer = '';
            sawTextDelta = true;
            return block + event.delta;
          }
          sawTextDelta = true;
          return event.delta;

        case 'message/text_snapshot':
          // Snapshot is a full cumulative replacement; only emit if we never
          // streamed deltas for this message (otherwise it would duplicate).
          if (sawTextDelta) return null;
          return event.text;

        case 'message/thinking_delta':
          thinkingBuffer += event.delta;
          return null; // buffer until text starts or message ends

        case 'message/start':
          sawTextDelta = false;
          composingAnnounced = false;
          return '\n';

        case 'message/tool_args_progress':
          if (composingAnnounced) return null;
          composingAnnounced = true;
          return event.toolName ? `\n[composing:${event.toolName}]` : '\n[composing]';

        case 'message/end': {
          // Flush remaining thinking buffer
          let out = '';
          if (thinkingBuffer) {
            out = `\n[thinking]\n${thinkingBuffer.trimEnd()}\n[/thinking]\n`;
            thinkingBuffer = '';
          }
          sawTextDelta = false;
          return out || null;
        }

        case 'tool/start':
          return `\n[tool:${event.toolName}]`;

        case 'tool/update':
          if (!event.delta) return null;
          return event.delta;

        case 'tool/end':
          if (event.isError) {
            return `\n[tool:error] ${event.toolCallId}\n`;
          }
          {
            const flashcardText = formatCliFlashcardToolResult(event.presentation);
            if (flashcardText) return `\n${flashcardText}\n`;
          }
          return '\n';

        case 'error':
          return formatCliAgentErrorEvent(event);

        case 'permission/request':
          return `\n[permission ${event.defaultDecision}] ${event.action}: ${event.detail}\n`;

        case 'usage/update': {
          const usage = event.usage;
          const used = usage.tokensUsed ?? usage.totalTokens;
          const limit = usage.tokensLimit;
          if (typeof used === 'number' && typeof limit === 'number') {
            return `\n[usage] ${used}/${limit} tokens\n`;
          }
          if (typeof used === 'number') {
            return `\n[usage] ${used} tokens\n`;
          }
          return `\n[usage] unknown\n`;
        }

        default:
          return null;
      }
    },
  };
}
