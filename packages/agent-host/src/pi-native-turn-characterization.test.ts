import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@piwin/contracts';
import type { BackendSessionHandle } from './backends/pi-session-backend.js';
import { createPiSessionEventMapper } from './event-map.js';
import {
  PiStreamProgressTimeoutError,
  runPiPromptWithProgressTimeout,
} from './pi-stream-progress-timeout.js';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/model-stream');

type PromptReturn = ReturnType<BackendSessionHandle['prompt']>;
type CurrentPromptIsVoid = PromptReturn extends Promise<void> ? true : false;
const currentPromptIsVoid: CurrentPromptIsVoid = true;

describe('Pi native turn characterization (current 0.84.2 mapping)', () => {
  it('keeps SessionHandle.prompt as Promise<void>', () => {
    expect(currentPromptIsVoid).toBe(true);
  });

  it('maps a clean text stop without inventing an error', () => {
    const events = replayFixture('text-stop.json');
    expect(events.some((event) => event.type === 'error')).toBe(false);
    expect(events).toEqual(
      expect.arrayContaining([
        { type: 'message/text_delta', messageId: 'm-text', delta: 'Done.' },
        { type: 'message/end', messageId: 'm-text' },
      ]),
    );
  });

  it('maps a thinking-only stop as a successful empty-text turn', () => {
    const events = replayFixture('thinking-only-stop.json');
    expect(events.some((event) => event.type === 'error')).toBe(false);
    expect(events).toEqual(
      expect.arrayContaining([
        {
          type: 'message/thinking_delta',
          messageId: 'm-think',
          delta: 'weighing a short plan',
        },
        { type: 'message/end', messageId: 'm-think' },
      ]),
    );
    expect(events.some((event) => event.type === 'message/text_delta')).toBe(false);
    expect(events.some((event) => event.type === 'message/text_snapshot')).toBe(false);
  });

  it('keeps tool execution inside one native loop before the final stop', () => {
    const events = replayFixture('tool-then-stop.json');
    expect(events.some((event) => event.type === 'error')).toBe(false);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tool/start', toolCallId: 'tool-1' }),
        expect.objectContaining({ type: 'tool/end', toolCallId: 'tool-1' }),
        { type: 'message/text_delta', messageId: 'm-final', delta: 'Read complete.' },
        { type: 'message/end', messageId: 'm-final' },
      ]),
    );
  });

  it('surfaces missing finish as a mapped error event, not a throw', () => {
    const events = replayFixture('missing-finish.json');
    expect(events.filter((event) => event.type === 'error')).toEqual([
      { type: 'error', message: 'Stream ended without finish_reason' },
    ]);
  });

  it('surfaces a provider stopReason error without throwing from the mapper', () => {
    const events = replayFixture('provider-error.json');
    expect(events.filter((event) => event.type === 'error')).toEqual([
      { type: 'error', message: '401: Invalid Authentication' },
    ]);
  });

  it('surfaces an aborted assistant with the native abort detail', () => {
    const events = replayFixture('aborted.json');
    expect(events.filter((event) => event.type === 'error')).toEqual([
      { type: 'error', message: 'Request was aborted' },
    ]);
  });

  it('lets the current prompt wrapper resolve after a mapped stopReason error', async () => {
    const mapper = createPiSessionEventMapper();
    const events: AgentEvent[] = [];
    let promptResolved = false;

    await runPiPromptWithProgressTimeout({
      timeoutMs: 0,
      prompt: async () => {
        for (const raw of loadFixture('provider-error.json')) {
          for (const wrapped of mapper.map(raw)) {
            events.push(wrapped.event);
          }
        }
        promptResolved = true;
      },
      abort: async () => undefined,
      subscribe: () => () => undefined,
    });

    expect(promptResolved).toBe(true);
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1);
  });

  it('current parsed-progress watchdog rejects the prompt race instead of returning a result', async () => {
    let listener: ((event: unknown) => void) | undefined;
    const pending = runPiPromptWithProgressTimeout({
      timeoutMs: 20,
      prompt: () => new Promise<void>(() => undefined),
      abort: async () => undefined,
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
    });
    listener?.({ type: 'message_start' });
    await expect(pending).rejects.toBeInstanceOf(PiStreamProgressTimeoutError);
  });
});

function replayFixture(name: string): AgentEvent[] {
  const mapper = createPiSessionEventMapper();
  return loadFixture(name).flatMap((raw) => mapper.map(raw).map((wrapped) => wrapped.event));
}

function loadFixture(name: string): unknown[] {
  const parsed: unknown = JSON.parse(readFileSync(join(fixtureDir, name), 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`fixture ${name} must be a JSON array`);
  }
  return parsed;
}
