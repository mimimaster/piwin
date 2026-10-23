import type { ActiveLoginStatus } from '@piwin/contracts';

/** Local-only prompt id: the Host ticket is gone, Desktop restarts login on submit. */
export const LOCAL_CALLBACK_PROMPT_ID = 'local-callback-retry';

const FALLBACK_CALLBACK_PLACEHOLDER = 'http://localhost:1455/auth/callback?code=...&state=...';

/**
 * Keep a "paste callback URL" field after a failed sign-in — but only for a
 * browser-redirect flow. Pi shows its success page before exchanging the code,
 * so the redirect URL in the address bar can still finish the login. A
 * device-code flow (Grok) or a failure before any authorize URL was opened has
 * no callback to paste; holding the field there only misleads.
 */
export function heldCallbackLogin(
  current: ActiveLoginStatus | undefined,
  result: { loginId: string; providerId: string },
  ownerDeviceId: string,
): ActiveLoginStatus | undefined {
  const authUrl = current?.providerId === result.providerId ? current.authUrl : undefined;
  if (authUrl?.kind !== 'auth_url' || !authUrl.url) return undefined;
  return {
    loginId: result.loginId,
    providerId: result.providerId,
    ownerDeviceId: current?.ownerDeviceId ?? ownerDeviceId,
    ownerConnected: true,
    startedAt: current?.startedAt ?? new Date().toISOString(),
    currentPrompt: {
      loginId: result.loginId,
      promptId: LOCAL_CALLBACK_PROMPT_ID,
      providerId: result.providerId,
      kind: 'text',
      expectsResponse: true,
      message: 'Callback URL',
      placeholder: callbackPlaceholder(authUrl.url),
    },
    authUrl,
  };
}

/** Show the provider's real redirect target instead of Codex's port for everyone. */
export function callbackPlaceholder(authorizeUrl: string): string {
  let redirect: string | null;
  try {
    redirect = new URL(authorizeUrl).searchParams.get('redirect_uri');
  } catch {
    return FALLBACK_CALLBACK_PLACEHOLDER;
  }
  if (!redirect) return FALLBACK_CALLBACK_PLACEHOLDER;
  return `${redirect}?code=...&state=...`;
}
