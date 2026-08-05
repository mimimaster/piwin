import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent, PromptInput, SessionHandle } from '@piwin/contracts';
import { createProductShellSession } from './product-shell-session.js';

function createFakeLiveSession(): SessionHandle & {
  emit: (event: AgentEvent) => void;
  subscriberCount: () => number;
} {
  const listeners = new Set<(event: AgentEvent) => void>();
  return {
    id: 'live-inner',
    async prompt(_input: PromptInput): Promise<void> {
      // no-op
    },
    async steer(): Promise<void> {},
    async followUp(): Promise<void> {},
    async abort(): Promise<void> {},
    async getMessages() {
      return [];
    },
    async getTree() {
      return { root: null, activeLeafId: null };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(event: AgentEvent) {
      for (const listener of listeners) {
        listener(event);
      }
    },
    subscriberCount() {
      return listeners.size;
    },
  };
}

describe('createProductShellSession', () => {
  it('keeps live event pipe after product listener rebind', async () => {
    const live = createFakeLiveSession();
    const createLiveSession = vi.fn(async () => live);
    const shell = createProductShellSession({
      sessionId: 'product-1',
      projectPath: '',
      createLiveSession,
    });

    const firstEvents: AgentEvent[] = [];
    const unsubFirst = shell.subscribe((event) => {
      firstEvents.push(event);
    });

    await shell.prompt({ text: 'hello' });
    expect(createLiveSession).toHaveBeenCalledTimes(1);
    expect(live.subscriberCount()).toBe(1);

    // Host rebind: drop the only product listener (old bug also tore down live pipe).
    unsubFirst();

    const secondEvents: AgentEvent[] = [];
    shell.subscribe((event) => {
      secondEvents.push(event);
    });

    // Live handle still exists; events must still reach product listeners.
    live.emit({ type: 'message/start', messageId: 'a1', role: 'assistant' });
    live.emit({ type: 'message/text_delta', messageId: 'a1', delta: 'world' });
    live.emit({ type: 'message/end', messageId: 'a1' });

    expect(secondEvents.map((event) => event.type)).toEqual([
      'message/start',
      'message/text_delta',
      'message/end',
    ]);
    expect(firstEvents).toHaveLength(0);
  });
});
