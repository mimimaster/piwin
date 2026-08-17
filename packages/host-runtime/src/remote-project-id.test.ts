import { describe, expect, it } from 'vitest';
import { createRemoteProjectId, isRemoteProjectId } from './remote-project-id.js';

describe('createRemoteProjectId', () => {
  it('hashes a path into a stable opaque id', () => {
    const first = createRemoteProjectId('/Users/private/Projects/piwin');
    const second = createRemoteProjectId('/Users/private/Projects/piwin');
    expect(first).toBe(second);
    expect(isRemoteProjectId(first)).toBe(true);
    expect(first).not.toContain('/Users');
    expect(first).not.toContain('piwin');
  });
});
