import { describe, expect, it } from 'vitest';
import type { AuthPromptPayload } from '@piwin/contracts';
import { readAuthPromptOpenUrl } from './auth-prompt-form.js';

const base = {
  loginId: 'login-1',
  promptId: 'prompt-1',
  providerId: 'openai-codex',
  expectsResponse: false as const,
};

describe('readAuthPromptOpenUrl', () => {
  it('reads auth_url and device verification URIs', () => {
    const authUrl: AuthPromptPayload = {
      ...base,
      kind: 'auth_url',
      url: 'https://chatgpt.com/connect',
    };
    const device: AuthPromptPayload = {
      ...base,
      kind: 'device_code',
      userCode: 'ABCD',
      verificationUri: 'https://github.com/login/device',
    };
    expect(readAuthPromptOpenUrl(authUrl)).toBe('https://chatgpt.com/connect');
    expect(readAuthPromptOpenUrl(device)).toBe('https://github.com/login/device');
    expect(readAuthPromptOpenUrl({ ...base, kind: 'progress', message: 'wait' })).toBeUndefined();
  });
});
