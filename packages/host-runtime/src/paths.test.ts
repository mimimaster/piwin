import { describe, expect, it } from 'vitest';
import {
  getPiAgentDir,
  getPiwinPiAgentDir,
  getPiwinConfigPath,
  getPiwinRoot,
  getPiwinSessionDir,
  getPiwinSessionMediaDir,
  resolveHostPiAgentDir,
} from './paths.js';

describe('paths', () => {
  it('uses override root', () => {
    expect(getPiwinRoot('/tmp/piwin-test')).toBe('/tmp/piwin-test');
  });

  it('uses override Pi agent dir', () => {
    expect(getPiAgentDir('/tmp/pi-agent')).toBe('/tmp/pi-agent');
  });

  it('hosts Pi auth under the product root', () => {
    expect(getPiwinPiAgentDir('/tmp/piwin-test')).toBe('/tmp/piwin-test/pi-agent');
    expect(resolveHostPiAgentDir({ piwinRoot: '/tmp/piwin-test' })).toBe('/tmp/piwin-test/pi-agent');
    expect(resolveHostPiAgentDir({ piwinRoot: '/tmp/piwin-test', piAgentDir: '/tmp/explicit' })).toBe(
      '/tmp/explicit',
    );
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
