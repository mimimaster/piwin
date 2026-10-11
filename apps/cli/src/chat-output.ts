import type { AgentEvent, ContextUsageSnapshot } from '@piwin/contracts';
import { createAssistantCliDisplay } from './chat-display.js';

export type CliOutputFormat = 'text' | 'json' | 'stream-json';

const FORMATS: readonly CliOutputFormat[] = ['text', 'json', 'stream-json'];

/** `--output-format`, or an error naming the choices. */
export function parseOutputFormat(argv: readonly string[]): CliOutputFormat | { error: string } {
  const index = argv.indexOf('--output-format');
  if (index === -1) return 'text';
  const value = argv[index + 1];
  const format = FORMATS.find((candidate) => candidate === value);
  return format ?? { error: `--output-format must be one of ${FORMATS.join(', ')}` };
}

export type ChatResult = {
  sessionId: string;
  runId?: string;
};

export type ChatOutput = {
  event: (event: AgentEvent) => void;
  /** The run ended: print what the format ends with. */
  finish: (result: ChatResult) => void;
  /** An error event was seen; scripts read this as the exit status. */
  readonly failed: boolean;
};

/**
 * How a chat run reaches stdout. `text` is the human stream; `stream-json`
 * prints every agent event as one JSON line and a closing result line; `json`
 * prints only that result. The closing line is what a script reads: the final
 * answer, the last usage the Host reported, and whether the run errored.
 */
export function createChatOutput(
  format: CliOutputFormat,
  write: (data: string) => void = (data) => process.stdout.write(data),
): ChatOutput {
  const display = createAssistantCliDisplay();
  let answer = '';
  let usage: ContextUsageSnapshot | undefined;
  let failed = false;
  return {
    get failed() {
      return failed;
    },
    event(event) {
      if (event.type === 'message/start') answer = '';
      else if (event.type === 'message/text_delta') answer += event.delta;
      else if (event.type === 'message/text_snapshot') answer = event.text;
      else if (event.type === 'usage/update') usage = event.usage;
      else if (event.type === 'error') failed = true;
      if (format === 'text') {
        const line = display.feed(event);
        if (line !== null) write(line);
      } else if (format === 'stream-json') {
        write(`${JSON.stringify({ type: 'event', event })}\n`);
      }
    },
    finish(result) {
      if (format === 'text') {
        write('\n');
        return;
      }
      const closing = {
        type: 'result',
        sessionId: result.sessionId,
        ...(result.runId === undefined ? {} : { runId: result.runId }),
        isError: failed,
        text: answer,
        ...(usage === undefined ? {} : { usage }),
      };
      write(`${JSON.stringify(closing)}\n`);
    },
  };
}
