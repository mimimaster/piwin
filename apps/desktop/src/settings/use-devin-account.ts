/**
 * Devin account state for the settings surfaces that reuse its token
 * (code_search, the Devin web-search source).
 *
 * Both features read `oauth:devin` from the Host's auth.json, so what the user
 * needs to see where they configure them is simply "is Devin connected", with
 * a way to connect in place. This mirrors the OAuth page's login flow for one
 * provider: start `auth/login`, open the browser on the first auth URL, and
 * follow `auth/updated` / `auth/login-finished` pushes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  remoteCommandRequiresIdempotencyKey,
  type AuthStatusData,
  type SubscriptionAccountState,
} from '@piwin/contracts';

import { readAuthPromptOpenUrl } from '../auth-prompt-form.js';
import { readDesktopClientPrincipalId } from '../desktop-client-principal.js';
import { createGestureIdempotencyKey } from '../gesture-idempotency.js';
import { openExternalUrl } from '../open-external-url.js';
import { useSettings } from './settings-context.js';

export const DEVIN_PROVIDER_ID = 'devin';

export type DevinAccountView = {
  /** `unknown` until the first status read (or when this Host has no auth surface). */
  state: SubscriptionAccountState | 'unknown';
  connected: boolean;
  /** Last login failure, cleared on the next attempt. */
  error: string | null;
  connect: () => Promise<void>;
};

export function useDevinAccount(): DevinAccountView {
  const { hostClient } = useSettings();
  const [state, setState] = useState<DevinAccountView['state']>('unknown');
  const [error, setError] = useState<string | null>(null);
  const openedPromptId = useRef<string | null>(null);

  const readState = useCallback(
    (accounts: AuthStatusData['accounts']): DevinAccountView['state'] =>
      accounts.find(
        (account) => account.providerId === DEVIN_PROVIDER_ID && account.surface === 'v1',
      )?.state ?? 'logged-out',
    [],
  );

  const refresh = useCallback(async () => {
    if (!hostClient?.request) return;
    const response = await hostClient.request({ type: 'auth/status' });
    if (!response.success || !response.data || typeof response.data !== 'object') return;
    setState(readState((response.data as AuthStatusData).accounts));
  }, [hostClient, readState]);

  useEffect(() => {
    void refresh();
    return hostClient?.subscribe((message) => {
      if (message.type === 'auth/updated') {
        setState(readState(message.accounts));
      }
      if (message.type === 'auth/prompt' && message.prompt.providerId === DEVIN_PROVIDER_ID) {
        const prompt = message.prompt;
        const url = readAuthPromptOpenUrl(prompt);
        // Open the browser once per prompt, like the OAuth page does.
        if (url && openedPromptId.current !== prompt.promptId) {
          openedPromptId.current = prompt.promptId;
          void openExternalUrl(url);
        }
      }
      if (
        message.type === 'auth/login-finished' &&
        message.result.providerId === DEVIN_PROVIDER_ID
      ) {
        if (!message.result.ok) {
          setError(message.result.errorCode ?? 'login-failed');
        }
        void refresh();
      }
    });
  }, [hostClient, readState, refresh]);

  const connect = useCallback(async () => {
    if (!hostClient?.request) return;
    setError(null);
    setState('logging-in');
    const command = {
      type: 'auth/login' as const,
      input: {
        providerId: DEVIN_PROVIDER_ID,
        ownerDeviceId: readDesktopClientPrincipalId(),
        preferLoopback: true,
        openAuthUrlOnHost: false,
      },
    };
    const idempotencyKey = remoteCommandRequiresIdempotencyKey(command.type)
      ? createGestureIdempotencyKey()
      : undefined;
    const response = await hostClient.request(command, idempotencyKey ? { idempotencyKey } : undefined);
    if (!response.success) {
      setError(response.error ?? 'login-failed');
      await refresh();
    }
  }, [hostClient, refresh]);

  return { state, connected: state === 'logged-in', error, connect };
}
