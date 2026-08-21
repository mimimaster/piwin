// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkbenchHostClient } from './use-workbench-host-client.js';
import { saveDesktopRemoteHostTarget } from './remote-host-session.js';

describe('createWorkbenchHostClient', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('uses the remote transport when a Host target is saved', () => {
    saveDesktopRemoteHostTarget({ endpoint: 'ws://127.0.0.1:8787' });
    const client = createWorkbenchHostClient();
    expect(client.getTransport()).toBe('remote');
  });
});
