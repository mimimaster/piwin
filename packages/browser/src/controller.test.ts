import { describe, expect, it } from 'vitest';
import { BROWSER_USER_HAS_CONTROL } from '@piwin/contracts';
import { createBrowserController } from './controller.js';

describe('createBrowserController', () => {
  it('starts idle without an agent lock claim', () => {
    expect(createBrowserController().snapshot()).toEqual({
      owner: 'idle',
      agentWantsLock: false,
    });
  });

  it('promotes idle to user on user acquire', () => {
    const controller = createBrowserController();
    const result = controller.acquire('user');
    expect(result).toEqual({
      ok: true,
      changed: true,
      state: { owner: 'user', agentWantsLock: false },
    });
    expect(controller.acquire('user')).toMatchObject({ ok: true, changed: false });
  });

  it('promotes idle to agent and records agentWantsLock', () => {
    const controller = createBrowserController();
    const result = controller.acquire('agent');
    expect(result).toEqual({
      ok: true,
      changed: true,
      state: { owner: 'agent', agentWantsLock: true },
    });
    expect(controller.acquire('agent')).toMatchObject({ ok: true, changed: false });
  });

  it('does not let user chrome steal from agent', () => {
    const controller = createBrowserController();
    controller.acquire('agent');
    const result = controller.acquire('user');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected acquire to fail');
    expect(result.code).toBe('browser-agent-has-control');
    expect(controller.snapshot()).toEqual({ owner: 'agent', agentWantsLock: true });
  });

  it('does not let agent acquire while the user owns the page', () => {
    const controller = createBrowserController();
    controller.acquire('user');
    const result = controller.acquire('agent');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected acquire to fail');
    expect(result.code).toBe(BROWSER_USER_HAS_CONTROL);
    expect(controller.snapshot()).toEqual({ owner: 'user', agentWantsLock: false });
  });

  it('takeOver from agent keeps agentWantsLock', () => {
    const controller = createBrowserController();
    controller.acquire('agent');
    expect(controller.takeOver()).toEqual({ owner: 'user', agentWantsLock: true });
  });

  it('giveBack returns the page to the agent when a run still wants the lock', () => {
    const controller = createBrowserController();
    controller.acquire('agent');
    controller.takeOver();
    expect(controller.giveBack()).toEqual({ owner: 'agent', agentWantsLock: true });
  });

  it('giveBack goes idle when the agent no longer wants the lock', () => {
    const controller = createBrowserController();
    controller.acquire('user');
    expect(controller.giveBack()).toEqual({ owner: 'idle', agentWantsLock: false });
  });

  it('giveBack is a no-op when the user does not own the page', () => {
    const controller = createBrowserController();
    controller.acquire('agent');
    expect(controller.giveBack()).toEqual({ owner: 'agent', agentWantsLock: true });
  });

  it('releaseAgentControl from agent returns idle and clears the claim', () => {
    const controller = createBrowserController();
    controller.acquire('agent');
    expect(controller.releaseAgentControl()).toEqual({
      owner: 'idle',
      agentWantsLock: false,
    });
  });

  it('releaseAgentControl while user keeps owner and clears agentWantsLock', () => {
    const controller = createBrowserController();
    controller.acquire('agent');
    controller.takeOver();
    expect(controller.releaseAgentControl()).toEqual({
      owner: 'user',
      agentWantsLock: false,
    });
    expect(controller.giveBack()).toEqual({ owner: 'idle', agentWantsLock: false });
  });

  it('release(agent) matches releaseAgentControl', () => {
    const controller = createBrowserController();
    controller.acquire('agent');
    expect(controller.release('agent')).toEqual({ owner: 'idle', agentWantsLock: false });
  });

  it('release(user) yields to agent when agentWantsLock', () => {
    const controller = createBrowserController();
    controller.acquire('agent');
    controller.takeOver();
    expect(controller.release('user')).toEqual({ owner: 'agent', agentWantsLock: true });
  });
});
