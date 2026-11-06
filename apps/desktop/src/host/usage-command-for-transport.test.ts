import { describe, expect, it } from 'vitest';
import { usageCommandForTransport } from './usage-command-for-transport.js';

describe('usage command transport projection', () => {
  it('keeps model, date, project and time-zone filters for local aggregate reads', () => {
    expect(usageCommandForTransport({ type: 'usage/get-rollup', modelId: 'route/model', projectPath: '/project',
      window: { from: '2026-01-01' }, timeZone: 'Asia/Shanghai' }, 'sidecar')).toEqual({
      type: 'usage/get-rollup', modelId: 'route/model', projectPath: '/project', window: { from: '2026-01-01' }, timeZone: 'Asia/Shanghai',
    });
  });
  it('keeps model and pagination for remote recent calls while dropping local paths', () => {
    expect(usageCommandForTransport({ type: 'usage/list-recent', modelId: 'route/model', projectPath: '/project',
      windowMinutes: 60, limit: 20, offset: 40 }, 'remote')).toEqual({
      type: 'usage/list-recent', modelId: 'route/model', windowMinutes: 60, limit: 20, offset: 40,
    });
  });
});
