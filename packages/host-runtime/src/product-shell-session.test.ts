import { describe, expect, it, vi } from 'vitest';
import type {
  AgentEvent,
  BackendRunIntervention,
  BackendRunInterventionEvent,
  BackendRunInterventionEventResult,
  PromptInput,
  SessionHandle,
} from '@piwin/contracts';
import { createProductShellSession } from './product-shell-session.js';

function createFakeLiveSession(): SessionHandle & {
  emit: (event: AgentEvent) => void;
  subscriberCount: () => number;
  emitIntervention: (event: BackendRunInterventionEvent) => Promise<boolean>;
  interventionSubscriberCount: () => number;
} {
  const listeners = new Set<(event: AgentEvent) => void>();
  const interventionListeners = new Set<
    (event: BackendRunInterventionEvent) => Promise<BackendRunInterventionEventResult>
  >();
  return {
    id: 'live-inner',
    async prompt(_input: PromptInput): Promise<void> {
      // no-op
    },
    async steer(): Promise<void> {},
    async followUp(): Promise<void> {},
    async armRunIntervention(_intervention: BackendRunIntervention): Promise<void> {},
    subscribeRunInterventions(listener) {
      interventionListeners.add(listener);
      return () => interventionListeners.delete(listener);
    },
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
    async emitIntervention(event) {
      for (const listener of interventionListeners) {
        if (!(await listener(event)).accepted) return false;
      }
      return interventionListeners.size > 0;
    },
    interventionSubscriberCount() {
      return interventionListeners.size;
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

  it('attaches intervention listeners when a lazy live session is activated', async () => {
    const live = createFakeLiveSession();
    const shell = createProductShellSession({
      sessionId: 'product-1',
      projectPath: '',
      createLiveSession: async () => live,
    });
    const claims: BackendRunInterventionEvent[] = [];
    shell.subscribeRunInterventions?.(async (event) => {
      claims.push(event);
      return { accepted: true };
    });

    expect(live.interventionSubscriberCount()).toBe(0);
    await shell.armRunIntervention?.({
      interventionId: 'intervention-1',
      revision: 1,
      sessionId: 'product-1',
      runId: 'run-1',
      runtimeGenerationId: 'generation-1',
      sequence: 1,
      text: 'change direction',
    });
    expect(live.interventionSubscriberCount()).toBe(1);

    await expect(
      live.emitIntervention({
        type: 'claim',
        interventionId: 'intervention-1',
        revision: 1,
        runId: 'run-1',
        runtimeGenerationId: 'generation-1',
      }),
    ).resolves.toBe(true);
    expect(claims).toHaveLength(1);
  });
});
