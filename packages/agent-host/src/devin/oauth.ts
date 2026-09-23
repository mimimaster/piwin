import type { OAuthCredentials, OAuthLoginCallbacks } from '@earendil-works/pi-ai';

export const DEVIN_WEBAPP_URL = 'https://app.devin.ai';
export const DEVIN_API_URL = 'https://api.devin.ai';
export const DEVIN_OAUTH_CALLBACK_PORT = 59653;

const CALLBACK_PATH = '/callback';
const TOKEN_PATH = '/auth/cli/token';
const FALLBACK_EXPIRES_MS = 365 * 24 * 60 * 60 * 1000;

export type DevinCallbackServer = { port: number; stop: () => Promise<void> };

export async function startDevinCallbackServer(
  requestedPort: number,
  expectedState: string,
  onSuccess: (result: { code: string; state: string }) => void,
  onFailure: (error: Error) => void,
): Promise<DevinCallbackServer> {
  const { createServer } = await import('node:http');
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== CALLBACK_PATH) {
      response.writeHead(404).end('Not found');
      return;
    }
    const receivedState = url.searchParams.get('state') ?? '';
    const code = url.searchParams.get('code') ?? '';
    if (!code || receivedState !== expectedState) {
      onFailure(new Error('Invalid Devin OAuth callback state or code'));
      response.writeHead(400, { 'content-type': 'text/plain' }).end(
        'Invalid OAuth callback. You can close this tab.',
      );
      return;
    }
    onSuccess({ code, state: receivedState });
    response.writeHead(200, { 'content-type': 'text/plain' }).end(
      'Devin login completed. You can close this tab.',
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Devin OAuth callback did not bind a TCP port');
  }
  return {
    port: address.port,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export function buildDevinAuthUrl(state: string, redirectUri: string, challenge: string): string {
  const params = new URLSearchParams({
    redirect_uri: redirectUri,
    state,
    prompt: 'select_account',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${DEVIN_WEBAPP_URL}/auth/cli/continue?${params.toString()}`;
}

export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const bytes = new Uint8Array(96);
  crypto.getRandomValues(bytes);
  const verifier = Buffer.from(bytes).toString('base64url');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: Buffer.from(digest).toString('base64url') };
}

export async function exchangeDevinCliToken(
  authorizationCode: string,
  codeVerifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(`${DEVIN_API_URL}${TOKEN_PATH}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: authorizationCode, code_verifier: codeVerifier }),
  });
  if (!response.ok) {
    throw new Error(`Devin token exchange failed: ${response.status} ${await response.text()}`);
  }
  const data = (await response.json()) as { token?: unknown };
  if (typeof data.token !== 'string' || data.token.length === 0) {
    throw new Error('Devin token exchange returned no token');
  }
  return data.token;
}

export async function loginDevin(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const state = crypto.randomUUID();
  const { verifier, challenge } = await generatePKCE();
  const result = await waitForDevinCallback(state, callbacks, challenge);
  const token = await exchangeDevinCliToken(result.code, verifier);
  return {
    access: token,
    refresh: token,
    expires: tokenExpiry(token),
    apiEndpoint: DEVIN_API_URL,
    enterpriseUrl: DEVIN_WEBAPP_URL,
  };
}

async function waitForDevinCallback(
  state: string,
  callbacks: OAuthLoginCallbacks,
  challenge: string,
): Promise<{ code: string; state: string }> {
  let server: DevinCallbackServer | undefined;
  let resolveCallback: ((value: { code: string; state: string }) => void) | undefined;
  let rejectCallback: ((reason?: unknown) => void) | undefined;
  const callback = new Promise<{ code: string; state: string }>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  try {
    try {
      server = await startDevinCallbackServer(
        DEVIN_OAUTH_CALLBACK_PORT,
        state,
        (value) => resolveCallback?.(value),
        (error) => rejectCallback?.(error),
      );
    } catch {
      server = await startDevinCallbackServer(
        0,
        state,
        (value) => resolveCallback?.(value),
        (error) => rejectCallback?.(error),
      );
    }
    const redirectUri = `http://127.0.0.1:${server.port}${CALLBACK_PATH}`;
    callbacks.onAuth({ url: buildDevinAuthUrl(state, redirectUri, challenge) });
    callbacks.onProgress?.('Waiting for Devin browser authentication...');
    const timeout = AbortSignal.timeout(5 * 60 * 1000);
    const signal = callbacks.signal ? AbortSignal.any([callbacks.signal, timeout]) : timeout;
    return await Promise.race([
      callback,
      new Promise<never>((_, reject) =>
        signal.addEventListener(
          'abort',
          () => reject(new Error('Devin OAuth login cancelled or timed out')),
          { once: true },
        ),
      ),
    ]);
  } finally {
    await server?.stop();
  }
}

function tokenExpiry(token: string): number {
  try {
    const payload = token.split('.')[1];
    if (payload) {
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        exp?: unknown;
      };
      if (typeof parsed.exp === 'number' && Number.isFinite(parsed.exp)) {
        return parsed.exp * 1000 - 5 * 60 * 1000;
      }
    }
  } catch {
    // Opaque session tokens use the conservative fallback.
  }
  return Date.now() + FALLBACK_EXPIRES_MS;
}
