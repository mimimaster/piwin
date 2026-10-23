import { describe, expect, it } from 'vitest';
import type { ActiveLoginStatus } from '@piwin/contracts';
import {
  LOCAL_CALLBACK_PROMPT_ID,
  callbackPlaceholder,
  heldCallbackLogin,
} from './subscription-callback-retry.js';

const CODEX_AUTHORIZE =
  'https://auth.openai.com/oauth/authorize?response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=s';

function login(overrides: Partial<ActiveLoginStatus>): ActiveLoginStatus {
  return {
    loginId: 'login-1',
    providerId: 'openai-codex',
    ownerDeviceId: 'device-1',
    ownerConnected: true,
    startedAt: '2026-10-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('heldCallbackLogin', () => {
  it('holds the paste field after a browser-redirect flow opened its authorize URL', () => {
    const current = login({
      authUrl: {
        loginId: 'login-1',
        promptId: 'p1',
        providerId: 'openai-codex',
        kind: 'auth_url',
        url: CODEX_AUTHORIZE,
      },
    });
    const held = heldCallbackLogin(
      current,
      { loginId: 'login-1', providerId: 'openai-codex' },
      'device-2',
    );
    expect(held?.currentPrompt).toMatchObject({
      promptId: LOCAL_CALLBACK_PROMPT_ID,
      kind: 'text',
      placeholder: 'http://localhost:1455/auth/callback?code=...&state=...',
    });
    expect(held?.ownerDeviceId).toBe('device-1');
  });

  it('closes a device-code flow: there is no callback URL to paste', () => {
    const current = login({
      providerId: 'xai',
      currentPrompt: {
        loginId: 'login-1',
        promptId: 'p1',
        providerId: 'xai',
        kind: 'device_code',
        userCode: 'ABCD-1234',
      },
    });
    expect(
      heldCallbackLogin(current, { loginId: 'login-1', providerId: 'xai' }, 'device-1'),
    ).toBeUndefined();
  });

  it('closes when the failure came before any authorize URL', () => {
    expect(
      heldCallbackLogin(undefined, { loginId: 'login-1', providerId: 'xai' }, 'device-1'),
    ).toBeUndefined();
  });
});

describe('callbackPlaceholder', () => {
  it('uses the provider redirect target', () => {
    expect(
      callbackPlaceholder(
        'https://example.test/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A53692%2Fcallback',
      ),
    ).toBe('http://localhost:53692/callback?code=...&state=...');
  });
});
