import { describe, expect, it } from 'vitest';
import { readProjectedHostConfig } from './remote-settings-hydrate.js';

describe('readProjectedHostConfig', () => {
  it('returns undefined when the Host does not expose settings/get', async () => {
    const config = await readProjectedHostConfig({
      supportsCommand: () => false,
      request: async () => {
        throw new Error('should not request');
      },
    });
    expect(config).toBeUndefined();
  });

  it('merges the Host snapshot so a missing preset does not invent Auto', async () => {
    const config = await readProjectedHostConfig({
      supportsCommand: () => true,
      request: async () => ({
        type: 'response',
        command: 'settings/get',
        success: true,
        data: {
          snapshot: {
            config: {
              hostMode: 'sdk',
              permissions: { mode: 'bypass', preset: 'yolo' },
            },
          },
        },
      }),
    });
    expect(config?.permissions).toEqual({ mode: 'bypass', preset: 'yolo' });
  });
});
