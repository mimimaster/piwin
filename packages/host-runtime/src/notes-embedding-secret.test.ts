import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSecretResolver } from './secret-resolver.js';
import { resolveKnowledgeHttpApiKey } from './notes-embedding-secret.js';

describe('resolveKnowledgeHttpApiKey', () => {
  it('reads a Host-stored embedding key from the file secret store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-notes-secret-'));
    const resolver = createSecretResolver({ piwinRoot: root, preferFileStore: true });
    const apiKeyRef = await resolver.writeProviderSecret('notes-embedding', 'emb-secret');
    const value = await resolveKnowledgeHttpApiKey({ apiKeyRef }, resolver);
    expect(value).toBe('emb-secret');
  });
});
