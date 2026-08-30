import { describe, expect, it, vi } from 'vitest';
import type { FlashcardStudySnapshot, HostCommand, HostResponse } from '@piwin/contracts';
import {
  createFlashcardStudyController,
  type FlashcardStudyClock,
  type FlashcardStudyVisibility,
} from './flashcard-study-controller.js';
import { createMemoryFlashcardStudyPendingStore } from './flashcard-study-pending.js';
import { studyTransitionId } from './flashcard-study-view-model.js';

function snapshot(revision: number, extras?: Partial<FlashcardStudySnapshot>): FlashcardStudySnapshot {
  return {
    round: {
      roundId: 'round-1',
      schemaVersion: 1,
      mode: 'sequence',
      scope: { kind: 'item', itemId: 'item-1' },
      status: 'active',
      revision,
      controlEpoch: 1,
      controllerIdentity: 'device-a',
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
      currentEntryId: 'entry-1',
      face: 'question',
      lastAdvanceOperationId: revision > 0 ? 'next-1' : null,
    },
    current: {
      entryId: 'entry-1',
      itemId: 'item-1',
      contentVersion: 'cv-1',
      model: 'basic',
      deck: 'srs',
      face: 'question',
      front: 'Q',
      back: 'A',
      needsReview: false,
    },
    counts: { total: 2, processed: revision, invalidated: 0, remaining: 2 - revision },
    canUndo: revision > 0,
    access: { hasControl: true, controllerIdentity: 'device-a', controlEpoch: 1 },
    ...extras,
  };
}

function clock(): FlashcardStudyClock & { timers: Map<number, () => void> } {
  let nextId = 1;
  const timers = new Map<number, () => void>();
  return {
    timers,
    now: () => 0,
    setTimeout: (handler) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, handler);
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
  };
}

function visibility(): FlashcardStudyVisibility & { hide: () => void } {
  const listeners = new Set<(visible: boolean) => void>();
  return {
    isVisible: () => true,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hide: () => {
      for (const listener of listeners) listener(false);
    },
  };
}

describe('flashcard study controller', () => {
  it('submits next once when double-clicked', async () => {
    const pending = createMemoryFlashcardStudyPendingStore();
    const requests: HostCommand[] = [];
    const controller = createFlashcardStudyController({
      request: async (command) => {
        requests.push(command);
        if (command.type === 'flashcards/study/start') {
          return { type: 'response', command: command.type, success: true, data: snapshot(0) };
        }
        if (command.type === 'flashcards/study/next') {
          return { type: 'response', command: command.type, success: true, data: snapshot(1) };
        }
        return { type: 'response', command: command.type, success: true, data: snapshot(0) };
      },
      pending,
      clock: clock(),
      visibility: visibility(),
      createIdempotencyKey: () => 'key-1',
    });
    await controller.start({ mode: 'sequence', scope: { kind: 'item', itemId: 'item-1' } });
    await Promise.all([controller.next(), controller.next()]);
    expect(requests.filter((command) => command.type === 'flashcards/study/next')).toHaveLength(1);
    expect(controller.getViewModel().phase).toBe('transitioning');
    expect(controller.getViewModel().transitionId).toBe(studyTransitionId('round-1', 1));
  });

  it('persists pending before the mutation is sent', async () => {
    const pending = createMemoryFlashcardStudyPendingStore();
    let loadedDuringRequest: string | undefined;
    const controller = createFlashcardStudyController({
      request: async (command) => {
        if (command.type === 'flashcards/study/start') {
          return { type: 'response', command: command.type, success: true, data: snapshot(0) };
        }
        loadedDuringRequest = (await pending.load())?.idempotencyKey;
        return { type: 'response', command: command.type, success: true, data: snapshot(1) };
      },
      pending,
      clock: clock(),
      visibility: visibility(),
      createIdempotencyKey: () => 'frozen-key',
    });
    await controller.start({ mode: 'sequence', scope: { kind: 'item', itemId: 'item-1' } });
    await controller.next();
    expect(loadedDuringRequest).toBe('frozen-key');
    expect(await pending.load()).toBeNull();
  });

  it('reconnects by looking up the operation before retrying', async () => {
    const pending = createMemoryFlashcardStudyPendingStore();
    await pending.save({
      roundId: 'round-1',
      idempotencyKey: 'in-flight',
      command: {
        type: 'flashcards/study/next',
        roundId: 'round-1',
        expectedRevision: 0,
        controlEpoch: 1,
        entryId: 'entry-1',
        contentVersion: 'cv-1',
      },
      expectedRevision: 0,
      controlEpoch: 1,
      contentVersion: 'cv-1',
    });
    const requests: HostCommand[] = [];
    const controller = createFlashcardStudyController({
      request: async (command) => {
        requests.push(command);
        if (command.type === 'flashcards/study/operation') {
          return {
            type: 'response',
            command: command.type,
            success: true,
            data: { status: 'success', snapshot: snapshot(1) },
          };
        }
        return { type: 'response', command: command.type, success: true, data: snapshot(1) };
      },
      pending,
      clock: clock(),
      visibility: visibility(),
    });
    await controller.open('round-1');
    expect(requests[0]?.type).toBe('flashcards/study/operation');
    expect(requests.some((command) => command.type === 'flashcards/study/next')).toBe(false);
    expect(controller.getViewModel().snapshot?.round.revision).toBe(1);
  });

  it('does not replay a transitionId from a duplicate push', async () => {
    const pending = createMemoryFlashcardStudyPendingStore();
    let gets = 0;
    const controller = createFlashcardStudyController({
      request: async (command) => {
        if (command.type === 'flashcards/study/start') {
          return { type: 'response', command: command.type, success: true, data: snapshot(1) };
        }
        if (command.type === 'flashcards/study/get') {
          gets += 1;
          return { type: 'response', command: command.type, success: true, data: snapshot(1) };
        }
        return { type: 'response', command: command.type, success: true, data: snapshot(1) };
      },
      pending,
      clock: clock(),
      visibility: visibility(),
    });
    await controller.start({ mode: 'sequence', scope: { kind: 'item', itemId: 'item-1' } });
    controller.handlePush({
      type: 'flashcards/study/changed',
      roundId: 'round-1',
      revision: 1,
      reason: 'next',
    });
    controller.handlePush({
      type: 'flashcards/study/changed',
      roundId: 'round-1',
      revision: 1,
      reason: 'next',
    });
    expect(gets).toBe(0);
    controller.noteTransitionEnd(studyTransitionId('round-1', 1));
    controller.noteTransitionEnd(studyTransitionId('round-1', 1));
    expect(controller.getViewModel().phase).not.toBe('transitioning');
  });

  it('clears visual timers on unsubscribe', async () => {
    const pending = createMemoryFlashcardStudyPendingStore();
    const time = clock();
    const vis = visibility();
    const controller = createFlashcardStudyController({
      request: async (command): Promise<HostResponse> => ({
        type: 'response',
        command: command.type,
        success: true,
        data: command.type === 'flashcards/study/next' ? snapshot(1) : snapshot(0),
      }),
      pending,
      clock: time,
      visibility: vis,
    });
    const unsubscribe = controller.subscribe(() => undefined);
    await controller.start({ mode: 'sequence', scope: { kind: 'item', itemId: 'item-1' } });
    await controller.next();
    expect(time.timers.size).toBe(1);
    unsubscribe();
    expect(time.timers.size).toBe(0);
  });

  it('does not blindly replay pending with a stale controlEpoch', async () => {
    const pending = createMemoryFlashcardStudyPendingStore();
    const requests: HostCommand[] = [];
    const controller = createFlashcardStudyController({
      request: async (command) => {
        requests.push(command);
        if (command.type === 'flashcards/study/start') {
          return { type: 'response', command: command.type, success: true, data: snapshot(0) };
        }
        if (command.type === 'flashcards/study/operation') {
          return {
            type: 'response',
            command: command.type,
            success: true,
            data: { status: 'not-found' },
          };
        }
        return { type: 'response', command: command.type, success: true, data: snapshot(0) };
      },
      pending,
      clock: clock(),
      visibility: visibility(),
    });
    await controller.start({ mode: 'sequence', scope: { kind: 'item', itemId: 'item-1' } });
    await pending.save({
      roundId: 'round-1',
      idempotencyKey: 'old-epoch',
      command: {
        type: 'flashcards/study/next',
        roundId: 'round-1',
        expectedRevision: 0,
        controlEpoch: 0,
        entryId: 'entry-1',
        contentVersion: 'cv-1',
      },
      expectedRevision: 0,
      controlEpoch: 0,
      contentVersion: 'cv-1',
    });
    controller.setConnected(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(requests.some((command) => command.type === 'flashcards/study/next')).toBe(false);
  });

  it('open() does not replay pending after operation not-found when epoch is stale', async () => {
    const pending = createMemoryFlashcardStudyPendingStore();
    const requests: HostCommand[] = [];
    const controller = createFlashcardStudyController({
      request: async (command) => {
        requests.push(command);
        if (command.type === 'flashcards/study/operation') {
          return {
            type: 'response',
            command: command.type,
            success: true,
            data: { status: 'not-found' },
          };
        }
        return { type: 'response', command: command.type, success: true, data: snapshot(0) };
      },
      pending,
      clock: clock(),
      visibility: visibility(),
    });
    await controller.start({ mode: 'sequence', scope: { kind: 'item', itemId: 'item-1' } });
    await pending.save({
      roundId: 'round-1',
      idempotencyKey: 'stale-open',
      command: {
        type: 'flashcards/study/next',
        roundId: 'round-1',
        expectedRevision: 0,
        controlEpoch: 0,
        entryId: 'entry-1',
        contentVersion: 'cv-1',
      },
      expectedRevision: 0,
      controlEpoch: 0,
      contentVersion: 'cv-1',
    });
    await controller.open('round-1');
    expect(requests.some((command) => command.type === 'flashcards/study/next')).toBe(false);
  });

  it('handlePush refreshes without flashing loading or skipping tear', async () => {
    const pending = createMemoryFlashcardStudyPendingStore();
    const phases: string[] = [];
    const controller = createFlashcardStudyController({
      request: async (command) => {
        if (command.type === 'flashcards/study/start') {
          return { type: 'response', command: command.type, success: true, data: snapshot(0) };
        }
        if (command.type === 'flashcards/study/get') {
          return { type: 'response', command: command.type, success: true, data: snapshot(2) };
        }
        return { type: 'response', command: command.type, success: true, data: snapshot(0) };
      },
      pending,
      clock: clock(),
      visibility: visibility(),
    });
    controller.subscribe((view) => phases.push(view.phase));
    await controller.start({ mode: 'sequence', scope: { kind: 'item', itemId: 'item-1' } });
    phases.length = 0;
    controller.handlePush({
      type: 'flashcards/study/changed',
      roundId: 'round-1',
      revision: 2,
      reason: 'next',
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(phases).not.toContain('loading');
    expect(controller.getViewModel().phase).toBe('transitioning');
    expect(controller.getViewModel().snapshot?.round.revision).toBe(2);
  });

  it('settles a tearing card when the last subscriber unsubscribes', async () => {
    const pending = createMemoryFlashcardStudyPendingStore();
    const controller = createFlashcardStudyController({
      request: async (command): Promise<HostResponse> => ({
        type: 'response',
        command: command.type,
        success: true,
        data: command.type === 'flashcards/study/next' ? snapshot(1) : snapshot(0),
      }),
      pending,
      clock: clock(),
      visibility: visibility(),
    });
    const unsubscribe = controller.subscribe(() => undefined);
    await controller.start({ mode: 'sequence', scope: { kind: 'item', itemId: 'item-1' } });
    await controller.next();
    expect(controller.getViewModel().phase).toBe('transitioning');
    unsubscribe();
    expect(controller.getViewModel().phase).not.toBe('transitioning');
    const again = controller.subscribe(() => undefined);
    expect(controller.getViewModel().phase).not.toBe('transitioning');
    again();
  });

  it('does not next, rate, or flip while paused or completed', async () => {
    const pending = createMemoryFlashcardStudyPendingStore();
    const requests: HostCommand[] = [];
    const controller = createFlashcardStudyController({
      request: async (command) => {
        requests.push(command);
        if (command.type === 'flashcards/study/start') {
          return { type: 'response', command: command.type, success: true, data: snapshot(0) };
        }
        if (command.type === 'flashcards/study/pause') {
          return {
            type: 'response',
            command: command.type,
            success: true,
            data: snapshot(1, { round: { ...snapshot(1).round, status: 'paused', face: 'answer' } }),
          };
        }
        if (command.type === 'flashcards/study/end') {
          return {
            type: 'response',
            command: command.type,
            success: true,
            data: snapshot(2, {
              round: { ...snapshot(2).round, status: 'completed' },
              canUndo: true,
            }),
          };
        }
        return { type: 'response', command: command.type, success: true, data: snapshot(0) };
      },
      pending,
      clock: clock(),
      visibility: visibility(),
    });
    await controller.start({ mode: 'sequence', scope: { kind: 'item', itemId: 'item-1' } });
    await controller.pause();
    expect(controller.getViewModel().phase).toBe('paused');
    requests.length = 0;
    await controller.next();
    await controller.rate('good');
    await controller.flip();
    expect(requests).toEqual([]);
    await controller.end();
    expect(controller.getViewModel().phase).toBe('completed');
    requests.length = 0;
    await controller.next();
    await controller.rate('good');
    await controller.flip();
    expect(requests).toEqual([]);
  });

  it('checkpoints needsReview without tearing', async () => {
    const pending = createMemoryFlashcardStudyPendingStore();
    const requests: HostCommand[] = [];
    const controller = createFlashcardStudyController({
      request: async (command) => {
        requests.push(command);
        if (command.type === 'flashcards/study/checkpoint') {
          const next = snapshot(1);
          const current = next.current;
          return {
            type: 'response',
            command: command.type,
            success: true,
            data: current
              ? snapshot(1, { current: { ...current, needsReview: true } })
              : next,
          };
        }
        return { type: 'response', command: command.type, success: true, data: snapshot(0) };
      },
      pending,
      clock: clock(),
      visibility: visibility(),
    });
    await controller.start({ mode: 'sequence', scope: { kind: 'item', itemId: 'item-1' } });
    await controller.setNeedsReview(true);
    expect(requests.some((command) => command.type === 'flashcards/study/checkpoint')).toBe(true);
    expect(controller.getViewModel().phase).not.toBe('transitioning');
    expect(controller.getViewModel().snapshot?.current?.needsReview).toBe(true);
  });

  it('keeps the answer body on optimistic flip before checkpoint returns', async () => {
    const pending = createMemoryFlashcardStudyPendingStore();
    let releaseCheckpoint: (() => void) | undefined;
    const hold = new Promise<void>((resolve) => {
      releaseCheckpoint = resolve;
    });
    const controller = createFlashcardStudyController({
      request: async (command) => {
        if (command.type === 'flashcards/study/checkpoint') {
          await hold;
          const current = snapshot(1).current;
          return {
            type: 'response',
            command: command.type,
            success: true,
            data: snapshot(1, {
              round: { ...snapshot(1).round, face: 'answer', lastAdvanceOperationId: null },
              current: current ? { ...current, face: 'answer', back: 'A' } : current,
            }),
          };
        }
        return { type: 'response', command: command.type, success: true, data: snapshot(0) };
      },
      pending,
      clock: clock(),
      visibility: visibility(),
    });
    await controller.start({ mode: 'sequence', scope: { kind: 'item', itemId: 'item-1' } });
    expect(controller.getViewModel().snapshot?.current?.back).toBe('A');
    const flip = controller.flip();
    expect(controller.getViewModel().snapshot?.round.face).toBe('answer');
    expect(controller.getViewModel().snapshot?.current?.face).toBe('answer');
    expect(controller.getViewModel().snapshot?.current?.back).toBe('A');
    releaseCheckpoint?.();
    await flip;
    expect(controller.getViewModel().snapshot?.current?.back).toBe('A');
  });

  it('checkpoints the answer face before a racing rate', async () => {
    const pending = createMemoryFlashcardStudyPendingStore();
    const requests: HostCommand[] = [];
    let releaseCheckpoint: (() => void) | undefined;
    const hold = new Promise<void>((resolve) => {
      releaseCheckpoint = resolve;
    });
    const scheduled = (revision: number, face: 'question' | 'answer'): FlashcardStudySnapshot => {
      const base = snapshot(revision);
      const current = base.current;
      return snapshot(revision, {
        round: {
          ...base.round,
          mode: 'scheduled',
          scope: { kind: 'all' },
          face,
          lastAdvanceOperationId: revision > 1 ? 'rate-1' : null,
        },
        current: current
          ? {
              ...current,
              face,
              back: 'A',
              reviewStateRevision: 0,
            }
          : undefined,
      });
    };
    const controller = createFlashcardStudyController({
      request: async (command) => {
        requests.push(command);
        if (command.type === 'flashcards/study/start') {
          return { type: 'response', command: command.type, success: true, data: scheduled(0, 'question') };
        }
        if (command.type === 'flashcards/study/checkpoint') {
          await hold;
          return { type: 'response', command: command.type, success: true, data: scheduled(1, 'answer') };
        }
        if (command.type === 'flashcards/study/rate') {
          return { type: 'response', command: command.type, success: true, data: scheduled(2, 'question') };
        }
        return { type: 'response', command: command.type, success: true, data: scheduled(0, 'question') };
      },
      pending,
      clock: clock(),
      visibility: visibility(),
    });
    await controller.start({ mode: 'scheduled', scope: { kind: 'all' } });
    const flip = controller.flip();
    const rate = controller.rate('good');
    for (let i = 0; i < 20; i += 1) {
      if (requests.some((command) => command.type === 'flashcards/study/checkpoint')) break;
      await Promise.resolve();
    }
    expect(requests.some((command) => command.type === 'flashcards/study/checkpoint')).toBe(true);
    expect(requests.some((command) => command.type === 'flashcards/study/rate')).toBe(false);
    releaseCheckpoint?.();
    await Promise.all([flip, rate]);
    const types = requests.map((command) => command.type);
    expect(types.indexOf('flashcards/study/checkpoint')).toBeGreaterThan(-1);
    expect(types.indexOf('flashcards/study/rate')).toBeGreaterThan(
      types.indexOf('flashcards/study/checkpoint'),
    );
    expect(requests.find((command) => command.type === 'flashcards/study/checkpoint')).toMatchObject({
      face: 'answer',
    });
  });
});
