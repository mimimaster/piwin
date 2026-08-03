import { describe, expect, it, vi } from 'vitest';
import { createDefaultWebConfig } from '@piwin/contracts';
import type { SecretResolver } from './secret-resolver.js';
import { resolveWebRuntimeCredentials } from './web-credentials.js';

describe('resolveWebRuntimeCredentials', () => {
  it('loads keychain references without placing secrets in config', async () => {
    const readSecretByRef = vi.fn(async (reference: string) => {
      if (reference.includes('brave')) return 'brave-secret\nbackup-secret';
      if (reference.includes('firecrawl')) return 'firecrawl-secret';
      return null;
    });
    const secretResolver = { readSecretByRef } as unknown as SecretResolver;
    const config = createDefaultWebConfig();
    config.searchSources = [
      {
        id: 'brave',
        kind: 'brave',
        enabled: true,
        apiKeyRef: 'keychain:piwin-web-brave',
      },
    ];
    config.fetchProvider = 'firecrawl';
    config.fetchApiKeyRef = 'keychain:piwin-web-fetch-firecrawl';

    await expect(resolveWebRuntimeCredentials(config, secretResolver)).resolves.toEqual({
      searchApiKeysBySourceId: { brave: 'brave-secret' },
      fetchApiKey: 'firecrawl-secret',
    });
    expect(JSON.stringify(config)).not.toContain('brave-secret');
  });
});
