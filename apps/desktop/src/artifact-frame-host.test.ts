import { describe, expect, it } from 'vitest';
import { shouldForceKeepArtifactHost } from './artifact-frame-host';

describe('shouldForceKeepArtifactHost', () => {
  it('keeps the canvas surface pinned so the open preview cannot be evicted', () => {
    expect(shouldForceKeepArtifactHost('canvas', false)).toBe(true);
    expect(shouldForceKeepArtifactHost('canvas', true)).toBe(true);
  });

  it('does not pin completed or streaming inline artifacts above the live cap', () => {
    expect(shouldForceKeepArtifactHost('inline', false)).toBe(false);
    expect(shouldForceKeepArtifactHost('inline', true)).toBe(false);
  });
});
