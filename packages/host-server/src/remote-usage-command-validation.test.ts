import { describe, expect, it } from 'vitest';
import type { HostCommand } from '@piwin/contracts';
import { isSafeRemoteCommand } from './remote-command-validation.js';

describe('remote usage model filters', () => {
  it.each(['usage/get-rollup', 'usage/list-recent'] as const)('validates %s', (type) => {
    expect(isSafeRemoteCommand({ type, modelId: 'route/provider/model' })).toBe(true);
    expect(isSafeRemoteCommand({ type })).toBe(true);
    for (const modelId of ['', 'a'.repeat(513), 42, null, ['model']]) {
      expect(isSafeRemoteCommand({ type, modelId } as unknown as HostCommand)).toBe(false);
    }
    expect(isSafeRemoteCommand({ type, projectPath: '/private' })).toBe(false);
  });
});
