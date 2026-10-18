import { describe, expect, it } from 'vitest';
import type { CodeSearchConfig } from '@piwin/contracts';

import {
  DEFAULT_WINDSURF_KEY_ENV,
  DEVIN_ACCOUNT_REF,
  applyCodeSearchEngine,
  codeSearchEngine,
  hasStoredWindsurfToken,
} from './code-search-engine';

const KEYCHAIN_REF = 'keychain:piwin-code-search-windsurf';

describe('codeSearchEngine', () => {
  it('maps the model backend (and a missing backend) to the model engine', () => {
    expect(codeSearchEngine({ enabled: false })).toBe('model');
    expect(codeSearchEngine({ enabled: true, backend: 'model', apiKeyRef: KEYCHAIN_REF })).toBe('model');
  });

  it('treats an empty Windsurf config and the OAuth marker as the Devin account', () => {
    expect(codeSearchEngine({ enabled: true, backend: 'windsurf' })).toBe('devin');
    expect(
      codeSearchEngine({ enabled: true, backend: 'windsurf', apiKeyRef: DEVIN_ACCOUNT_REF, apiKeyEnv: '[stored-secret]' }),
    ).toBe('devin');
  });

  it('treats a keychain ref or an env name as a manual token', () => {
    expect(codeSearchEngine({ enabled: true, backend: 'windsurf', apiKeyRef: KEYCHAIN_REF })).toBe('token');
    expect(codeSearchEngine({ enabled: true, backend: 'windsurf', apiKeyEnv: 'MY_KEY' })).toBe('token');
  });
});

describe('hasStoredWindsurfToken', () => {
  it('ignores the Devin marker and env-only configs', () => {
    expect(hasStoredWindsurfToken({ enabled: true, apiKeyRef: KEYCHAIN_REF })).toBe(true);
    expect(hasStoredWindsurfToken({ enabled: true, apiKeyRef: DEVIN_ACCOUNT_REF })).toBe(false);
    expect(hasStoredWindsurfToken({ enabled: true, apiKeyEnv: DEFAULT_WINDSURF_KEY_ENV })).toBe(false);
  });
});

describe('applyCodeSearchEngine', () => {
  const off: CodeSearchConfig = { enabled: false, backend: 'model' };

  it('enables the model engine only when a model is already picked', () => {
    expect(applyCodeSearchEngine(off, 'model', false).enabled).toBe(false);
    const withModel = { ...off, backend: 'windsurf' as const, model: { providerId: 'p', modelId: 'm' } };
    expect(applyCodeSearchEngine(withModel, 'model', false)).toMatchObject({ backend: 'model', enabled: true });
  });

  it('points the Devin engine at the OAuth marker and enables it once connected', () => {
    const fromToken = { ...off, backend: 'windsurf' as const, apiKeyRef: KEYCHAIN_REF, apiKeyEnv: 'MY_KEY' };
    const disconnected = applyCodeSearchEngine(fromToken, 'devin', false);
    expect(disconnected).toMatchObject({ backend: 'windsurf', apiKeyRef: DEVIN_ACCOUNT_REF, enabled: false });
    expect(disconnected.apiKeyEnv).toBeUndefined();
    expect(codeSearchEngine(disconnected)).toBe('devin');
    expect(applyCodeSearchEngine(fromToken, 'devin', true).enabled).toBe(true);
  });

  it('drops the Devin marker for the token engine and enables only with a stored token', () => {
    const fromDevin = {
      ...off,
      backend: 'windsurf' as const,
      apiKeyRef: DEVIN_ACCOUNT_REF,
      apiKeyEnv: '[stored-secret]',
    };
    const token = applyCodeSearchEngine(fromDevin, 'token', true);
    expect(token.apiKeyRef).toBeUndefined();
    expect(token.apiKeyEnv).toBe(DEFAULT_WINDSURF_KEY_ENV);
    expect(token.enabled).toBe(false);
    expect(codeSearchEngine(token)).toBe('token');

    const stored = applyCodeSearchEngine({ ...off, apiKeyRef: KEYCHAIN_REF }, 'token', false);
    expect(stored).toMatchObject({ backend: 'windsurf', apiKeyRef: KEYCHAIN_REF, enabled: true });
  });
});
