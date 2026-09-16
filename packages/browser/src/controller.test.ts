import { describe, expect, it } from 'vitest';
import { createBrowserController } from './controller.js';

describe('createBrowserController', () => {
  it('starts idle without an agent claim', () => {
    expect(createBrowserController().snapshot()).toEqual({
      owner: 'idle',
      agentWantsLock: false,
    });
  });

  it('marks the page agent on an agent write', () => {
    const controller = createBrowserController();
    expect(controller.acquire('agent')).toEqual({
      ok: true,
      changed: true,
      state: { owner: 'agent', agentWantsLock: true },
    });
    expect(controller.acquire('agent')).toMatchObject({ ok: true, changed: false });
  });

  it('always accepts human input without changing the indicator', () => {
    const controller = createBrowserController();
    expect(controller.acquire('user')).toEqual({
      ok: true,
      changed: false,
      state: { owner: 'idle', agentWantsLock: false },
    });
    controller.acquire('agent');
    expect(controller.acquire('user')).toMatchObject({
      ok: true,
      changed: false,
      state: { owner: 'agent' },
    });
  });

  it('never blocks the agent after human input', () => {
    const controller = createBrowserController();
    controller.acquire('user');
    expect(controller.acquire('agent', 'run-1')).toMatchObject({ ok: true, state: { owner: 'agent' } });
  });

  it('keeps takeOver and giveBack as no-ops', () => {
    const controller = createBrowserController();
    controller.acquire('agent');
    expect(controller.takeOver()).toEqual({ owner: 'agent', agentWantsLock: true });
    expect(controller.giveBack()).toEqual({ owner: 'agent', agentWantsLock: true });
  });

  it('releaseAgentControl returns idle and clears the claim', () => {
    const controller = createBrowserController();
    controller.acquire('agent', 'run-1');
    expect(controller.releaseAgentControl()).toEqual({ owner: 'idle', agentWantsLock: false });
    expect(controller.holderRunId()).toBeUndefined();
    expect(controller.release('agent')).toEqual({ owner: 'idle', agentWantsLock: false });
  });

  it('lets a later run take the indicator so its terminal clears it', () => {
    const controller = createBrowserController();
    controller.acquire('agent', 'run-1');
    expect(controller.acquire('agent', 'run-2')).toMatchObject({ ok: true });
    expect(controller.holderRunId()).toBe('run-2');
    expect(controller.releaseAgentControlIfHeldBy('run-1')).toEqual({ owner: 'agent', agentWantsLock: true });
    expect(controller.releaseAgentControlIfHeldBy('run-2')).toEqual({ owner: 'idle', agentWantsLock: false });
  });

  it('keeps the holder for writes that omit runId', () => {
    const controller = createBrowserController();
    controller.acquire('agent', 'run-1');
    controller.acquire('agent');
    expect(controller.holderRunId()).toBe('run-1');
  });
});
