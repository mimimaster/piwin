import { describe, expect, it, vi } from 'vitest';
import { createDefaultWebConfig } from '@piwin/contracts';
import type { SecretResolver } from './secret-resolver.js';
import { resolveWebRuntimeCredentials, withDraftSearchSource } from './web-credentials.js';

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

describe('withDraftSearchSource', () => {
  it('lets a test resolve the key of a source that is switched on but not saved', async () => {
    const saved = createDefaultWebConfig();
    const draft = { id: 'devin', kind: 'devin' as const, enabled: true, apiKeyRef: 'oauth:devin' };
    const readSecretByRef = vi.fn(async (ref: string) =>
      ref === 'oauth:devin' ? 'devin-session-token$jwt' : null,
    );
    const credentials = await resolveWebRuntimeCredentials(withDraftSearchSource(saved, draft), {
      readSecretByRef,
    } as unknown as SecretResolver);
    expect(credentials.searchApiKeysBySourceId?.devin).toBe('devin-session-token$jwt');
    expect(withDraftSearchSource(saved, undefined)).toBe(saved);
  });

  it('replaces a saved source of the same id with the draft', () => {
    const saved = {
      ...createDefaultWebConfig(),
      searchSources: [{ id: 'devin', kind: 'devin' as const, enabled: false }],
    };
    const merged = withDraftSearchSource(saved, { id: 'devin', kind: 'devin', enabled: true, apiKeyRef: 'oauth:devin' });
    expect(merged.searchSources).toEqual([{ id: 'devin', kind: 'devin', enabled: true, apiKeyRef: 'oauth:devin' }]);
  });
});
