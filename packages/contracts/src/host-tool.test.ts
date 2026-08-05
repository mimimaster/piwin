import { describe, expect, it } from 'vitest';
import type {
  HostToolDescriptor,
  HostToolExecutionResult,
} from './host-tool.js';

describe('Host tool contracts', () => {
  it('preserves a descriptor parameter schema through JSON', () => {
    const descriptor: HostToolDescriptor = {
      name: 'example_tool',
      description: 'An example Host-owned tool.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1 },
        },
        required: ['query'],
      },
    };

    const roundTripped = JSON.parse(JSON.stringify(descriptor)) as unknown;

    expect(roundTripped).toEqual(descriptor);
    expect(descriptor.parameters).toEqual({
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
      },
      required: ['query'],
    });
  });

  it('includes execution-failed as a stable failure code', () => {
    const result: HostToolExecutionResult = {
      ok: false,
      code: 'execution-failed',
      message: 'tool process exited unexpectedly',
    };

    expect(result).toEqual({
      ok: false,
      code: 'execution-failed',
      message: 'tool process exited unexpectedly',
    });
  });
});
