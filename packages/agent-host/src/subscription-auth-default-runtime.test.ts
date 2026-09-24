import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createSubscriptionAuthPort } from './subscription-auth.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('createSubscriptionAuthPort with the real Pi ModelRuntime', () => {
  it("registers the Devin provider without detaching Pi's registerProvider from its runtime", async () => {
    // Regression: passing `runtime.registerProvider` on its own dropped `this`,
    // and Pi threw "Cannot read properties of undefined (reading 'get')".
    const root = await mkdtemp(join(tmpdir(), 'piwin-subscription-runtime-'));
    roots.push(root);
    const port = await createSubscriptionAuthPort({ authPath: join(root, 'auth.json') });
    await expect(port.listCredentials()).resolves.toEqual([]);
  });
});
