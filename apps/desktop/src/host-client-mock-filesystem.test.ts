import { describe, expect, it } from 'vitest';
import { MockHostFileSystem } from './host-client-mock-filesystem.js';

describe('preview Host file picker', () => {
  it('persists entries per backend, supports hidden files, and rejects collisions', () => {
    const filesystem = new MockHostFileSystem();
    const input = { parentPath: '/Users/mock', name: '.new', kind: 'file' } as const;
    expect(filesystem.handle({ type: 'host/create-entry', input }, '1')?.success).toBe(true);
    expect(filesystem.handle({ type: 'host/create-entry', input }, '2')).toMatchObject({
      success: false,
      problem: { code: 'host-entry-already-exists' },
    });
    const visible = filesystem.handle({ type: 'host/list-dir' }, '3');
    const hidden = filesystem.handle({ type: 'host/list-dir', includeHidden: true }, '4');
    if (!visible?.success || !hidden?.success) throw new Error('Expected listings');
    expect(JSON.stringify(visible.data)).not.toContain('.new');
    expect(JSON.stringify(hidden.data)).toContain('.new');
    const fresh = new MockHostFileSystem().handle(
      { type: 'host/list-dir', includeHidden: true },
      '5',
    );
    expect(JSON.stringify(fresh)).not.toContain('.new');
  });
});
