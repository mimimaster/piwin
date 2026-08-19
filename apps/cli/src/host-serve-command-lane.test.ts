import { describe, expect, it } from 'vitest';
import type { HostCommand } from '@piwin/contracts';
import { classifyHostServeCommand, isControlLaneCommand } from './host-serve-command-lane.js';

describe('classifyHostServeCommand', () => {
  it('classifies abort and permission resolve as control', () => {
    const abort: HostCommand = { type: 'session/abort', sessionId: 's1' };
    const permission: HostCommand = {
      type: 'permission/resolve',
      requestId: 'r1',
      decision: 'allow',
    };
    expect(classifyHostServeCommand(abort)).toBe('control');
    expect(classifyHostServeCommand(permission)).toBe('control');
    expect(isControlLaneCommand(abort)).toBe(true);
  });

  it('classifies settings/apply as serialized', () => {
    const command: HostCommand = {
      type: 'settings/apply',
      input: { mutations: [] },
    };
    expect(classifyHostServeCommand(command)).toBe('serialized');
  });

  it('classifies settings/get as concurrent', () => {
    const command: HostCommand = { type: 'settings/get' };
    expect(classifyHostServeCommand(command)).toBe('concurrent');
  });

  it('classifies session/prompt as concurrent (quick-ack path)', () => {
    const command: HostCommand = {
      type: 'session/prompt',
      sessionId: 's1',
      input: { text: 'hi' },
    };
    expect(classifyHostServeCommand(command)).toBe('concurrent');
  });

  it('classifies cold-storage mutations as serialized', () => {
    expect(
      classifyHostServeCommand({
        type: 'session/cold-storage-execute',
        planId: 'cold-1',
        confirmationDigest: 'abc',
      }),
    ).toBe('serialized');
    expect(classifyHostServeCommand({ type: 'session/cold-storage-status' })).toBe('concurrent');
  });

  it('classifies session/list as concurrent', () => {
    const command: HostCommand = {
      type: 'session/list',
      projectPath: '/tmp/p',
    };
    expect(classifyHostServeCommand(command)).toBe('concurrent');
  });
});
