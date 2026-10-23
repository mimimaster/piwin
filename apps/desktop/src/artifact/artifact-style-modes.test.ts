import { afterEach, describe, expect, it } from 'vitest';
import { getArtifactStyleModes, setArtifactStyleModes } from './artifact-style-modes';

describe('artifact style modes switch', () => {
  afterEach(() => setArtifactStyleModes(undefined));

  it('defaults to model and accepts only host-only as the alternative', () => {
    expect(getArtifactStyleModes()).toBe('model');
    setArtifactStyleModes('host-only');
    expect(getArtifactStyleModes()).toBe('host-only');
    setArtifactStyleModes('nonsense' as never);
    expect(getArtifactStyleModes()).toBe('model');
  });
});
