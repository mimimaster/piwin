import type { HostCommand, HostResponse } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import { isSafeRemoteCommand } from './remote-command-validation.js';
import { createRemoteCapabilities, projectRemoteResponse } from './remote-projection.js';

describe('remote Host entry creation', () => {
  it('accepts a bounded single name and rejects traversal and malformed input', () => {
    const command: HostCommand = {
      type: 'host/create-entry',
      input: {
        parentPath: '/Users/host',
        name: '项目资料',
        kind: 'directory',
      },
    };
    expect(isSafeRemoteCommand(command)).toBe(true);
    for (const input of [
      undefined,
      null,
      {},
      { ...command.input, name: '../escape' },
      { ...command.input, kind: 'symlink' },
      { ...command.input, parentPath: 'x'.repeat(4097) },
      { ...command.input, parentPath: 'a\0b' },
      { ...command.input, name: 123 },
    ]) {
      expect(isSafeRemoteCommand({ type: 'host/create-entry', input } as HostCommand)).toBe(false);
    }
  });
  it('preserves the created path for the picker and advertises creation capability', () => {
    const capabilities = createRemoteCapabilities();
    expect(capabilities.hostCreateEntry).toBe(true);
    const response: HostResponse = {
      type: 'response',
      command: 'host/create-entry',
      success: true,
      data: { name: 'new', kind: 'directory', path: '/Users/host/new' },
    };
    expect(
      projectRemoteResponse(
        {
          type: 'host/create-entry',
          input: {
            parentPath: '/Users/host',
            name: 'new',
            kind: 'directory',
          },
        },
        response,
        { hostInstanceId: 'host-1', mode: 'sdk', capabilities },
      ),
    ).toEqual(response);
  });
});
