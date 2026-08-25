import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCliClientPrincipalId } from './cli-client-principal.js';

describe('readCliClientPrincipalId', () => {
  it('reuses the same principal for one Host target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-cli-principal-'));
    const first = await readCliClientPrincipalId(root, 'ws://127.0.0.1:8787');
    const second = await readCliClientPrincipalId(root, 'ws://127.0.0.1:8787');
    const other = await readCliClientPrincipalId(root, 'ws://127.0.0.1:9000');
    expect(first).toBe(second);
    expect(other).not.toBe(first);
  });
});
