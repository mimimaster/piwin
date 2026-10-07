import { describe, expect, it } from 'vitest';
import { deviceToolsGainedSinceBuild } from './device-tool-surface-staleness.js';

describe('deviceToolsGainedSinceBuild', () => {
  it('rebuilds a session built before the first device offered the tool', () => {
    expect(deviceToolsGainedSinceBuild(false, true)).toBe(true);
  });

  it('leaves a session alone when nothing changed', () => {
    expect(deviceToolsGainedSinceBuild(false, false)).toBe(false);
    expect(deviceToolsGainedSinceBuild(true, true)).toBe(false);
  });

  it('does not rebuild when the device withdrew its offer', () => {
    expect(deviceToolsGainedSinceBuild(true, false)).toBe(false);
  });

  it('never rebuilds a generation that carries no device tools', () => {
    expect(deviceToolsGainedSinceBuild(undefined, true)).toBe(false);
  });
});
