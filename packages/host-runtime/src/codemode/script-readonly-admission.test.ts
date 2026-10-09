import { describe, expect, it } from 'vitest';
import type { HostToolRegistration } from '@piwin/contracts';
import {
  compileAdmittedScriptTools,
  scriptReadonlyDenial,
} from './script-readonly-admission.js';

function tool(overrides: Partial<HostToolRegistration> = {}): HostToolRegistration {
  return {
    descriptor: { name: 'read_file', description: 'read', parameters: { type: 'object' } },
    family: 'filesystem-read',
    permissionSpec: {
      action: 'filesystem:read',
      risk: 'unknown',
      rememberable: false,
      readOnly: true,
    },
    fileEffect: { kind: 'none' },
    execute: async () => ({ ok: true, output: 'ok' }),
    ...overrides,
  };
}

describe('scriptReadonlyDenial', () => {
  it('denies shell even when the registration says readOnly', () => {
    expect(
      scriptReadonlyDenial(
        tool({
          descriptor: { name: 'bash', description: 'sh', parameters: {} },
          family: 'shell',
          permissionSpec: { action: 'bash', risk: 'command', rememberable: false, readOnly: true },
        }),
      )?.code,
    ).toBe('permission-denied');
  });

  it('caps the admitted set in name order', () => {
    const compiled = compileAdmittedScriptTools(
      [
        tool({ descriptor: { name: 'b', description: 'b', parameters: {} } }),
        tool({ descriptor: { name: 'a', description: 'a', parameters: {} } }),
      ],
      1,
    );
    expect(compiled.admitted.map((item) => item.descriptor.name)).toEqual(['a']);
    expect(compiled.omittedNames).toEqual(['b']);
  });
});
