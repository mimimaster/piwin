import { describe, expect, it } from 'vitest';
import {
  getPiAgentDir,
  getPiwinConfigPath,
  getPiwinRoot,
  getPiwinSessionDir,
  getPiwinSessionMediaDir,
} from './paths.js';

describe('paths', () => {
  it('uses override root', () => {
    expect(getPiwinRoot('/tmp/piwin-test')).toBe('/tmp/piwin-test');
  });

  it('uses override Pi agent dir', () => {
    expect(getPiAgentDir('/tmp/pi-agent')).toBe('/tmp/pi-agent');
  });

  it('builds config path', () => {
    expect(getPiwinConfigPath('/tmp/piwin-test')).toBe('/tmp/piwin-test/config.json');
  });

  it.each(['', '.', '..', '../escape', 'nested/session', 'nested\\session', 'nul\0id'])(
    'rejects unsafe session path segment %j',
    (sessionId) => {
      expect(() => getPiwinSessionDir('/tmp/piwin-test', sessionId)).toThrow(/Invalid sessionId/);
      expect(() => getPiwinSessionMediaDir('/tmp/piwin-test', sessionId)).toThrow(
        /Invalid sessionId/,
      );
    },
  );
});
