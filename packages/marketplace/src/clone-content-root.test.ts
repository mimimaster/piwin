import { describe, expect, it } from 'vitest';
import { resolveCloneContentRoot } from './clone-content-root.js';

describe('resolveCloneContentRoot', () => {
  it('allows the clone root and nested subdirectories', () => {
    expect(resolveCloneContentRoot('/tmp/clone')).toBe('/tmp/clone');
    expect(resolveCloneContentRoot('/tmp/clone', 'skills/review')).toBe(
      '/tmp/clone/skills/review',
    );
  });

  it('rejects parent and absolute path escapes', () => {
    expect(() => resolveCloneContentRoot('/tmp/clone', '../outside')).toThrow(/inside/);
    expect(() => resolveCloneContentRoot('/tmp/clone', '/tmp/outside')).toThrow(/inside/);
  });
});
