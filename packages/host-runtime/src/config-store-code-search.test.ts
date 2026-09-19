import { describe, expect, it } from 'vitest';
import { normalizePiwinConfig } from './config-store.js';

describe('normalizePiwinConfig codeSearch', () => {
  it('preserves a windsurf backend config through normalize', () => {
    const normalized = normalizePiwinConfig({
      hostMode: 'sdk',
      providers: [],
      media: { maxPasteBytes: 1, allowedMimeTypes: ['image/png'] },
      artifact: {
        enabled: false,
        triggerMode: 'automatic',
        decisionPrompt: { mode: 'default', customPrompt: '' },
        maxBytes: 1,
      },
      codeSearch: {
        enabled: true,
        backend: 'windsurf',
        apiKeyRef: 'keychain:piwin-code-search-windsurf',
        maxTurns: 3,
      },
    });
    expect(normalized.codeSearch).toEqual({
      enabled: true,
      backend: 'windsurf',
      apiKeyRef: 'keychain:piwin-code-search-windsurf',
      maxTurns: 3,
    });
  });

  it('keeps an explicit disabled flag', () => {
    const normalized = normalizePiwinConfig({
      hostMode: 'sdk',
      providers: [],
      media: { maxPasteBytes: 1, allowedMimeTypes: ['image/png'] },
      artifact: {
        enabled: false,
        triggerMode: 'automatic',
        decisionPrompt: { mode: 'default', customPrompt: '' },
        maxBytes: 1,
      },
      codeSearch: { enabled: false },
    });
    expect(normalized.codeSearch).toEqual({ enabled: false });
  });
});
