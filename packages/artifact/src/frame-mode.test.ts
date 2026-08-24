import { describe, expect, it } from 'vitest';
import { advanceArtifactFrameMode } from './frame-mode.js';

describe('advanceArtifactFrameMode', () => {
  it('allows one-way flow upgrades to viewport or overflow', () => {
    expect(advanceArtifactFrameMode('inline-flow', 'inline-viewport')).toBe('inline-viewport');
    expect(advanceArtifactFrameMode('inline-flow', 'inline-overflow')).toBe('inline-overflow');
  });

  it('rejects downgrades and cross-mode jitter', () => {
    expect(advanceArtifactFrameMode('inline-viewport', 'inline-flow')).toBe('inline-viewport');
    expect(advanceArtifactFrameMode('inline-overflow', 'inline-flow')).toBe('inline-overflow');
    expect(advanceArtifactFrameMode('inline-viewport', 'inline-overflow')).toBe('inline-viewport');
    expect(advanceArtifactFrameMode('inline-overflow', 'inline-viewport')).toBe('inline-overflow');
  });

  it('keeps canvas isolated from inline modes', () => {
    expect(advanceArtifactFrameMode('canvas', 'inline-flow')).toBe('canvas');
    expect(advanceArtifactFrameMode('inline-flow', 'canvas')).toBe('inline-flow');
    expect(advanceArtifactFrameMode('canvas', 'canvas')).toBe('canvas');
  });
});
