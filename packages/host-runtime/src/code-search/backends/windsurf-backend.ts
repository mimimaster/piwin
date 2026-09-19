/**
 * `windsurf` backend (opt-in): run the search subagent on the Windsurf/Devin
 * cloud with the user's own token.
 *
 * Transport is modelled on the working reference client rather than on the
 * single-shot path in `docs/specs/compactor-sdk.md` §9 — see
 * `windsurf-protocol.ts` for the exact divergences (streaming method name,
 * multi-turn message layout, text-marker tool calls).
 *
 * Verified here: protobuf encode/decode, frame decoding, tool-marker parsing,
 * credential resolution, and every error path (missing token, HTTP failure,
 * trailer error, cancellation) via fixtures.
 * **Not verified here**: a real end-to-end call against the live service, which
 * would need a valid token and would spend the user's quota. Treat the first
 * live run as the acceptance test.
 *
 * Credentials never enter config, logs or error text: the token is read per
 * call from the keychain ref or env name and only ever placed in the request
 * metadata.
 */
import { createSecretResolver } from '../../secret-resolver.js';
import { CodeSearchCompletionError, type CodeSearchCompletionPort } from '../completion-port.js';
import { buildWindsurfToolDefinitionsJson } from './windsurf-protocol.js';
import {
  WINDSURF_API_BASE,
  WINDSURF_GET_USER_JWT_PATH,
  buildChatRequestBody,
  buildGetUserJwtBody,
  decodeConnectFrames,
  encodeGzipFrame,
  parseChatFramePayload,
  parseTrailerPayload,
  parseUserJwtResponse,
  parseWindsurfToolCall,
  resolveWindsurfEndpoint,
  type WindsurfClientIdentity,
} from './windsurf-protocol.js';

const LABEL = 'Code search (Windsurf)';

/** Streaming agentic method used by the current client. */
export const WINDSURF_STREAM_PATH = '/exa.api_server_pb.ApiServerService/GetDevstralStream';

/** Single-shot method documented in the spec; kept reachable for diagnostics. */
export const WINDSURF_SINGLE_SHOT_PATH = '/exa.api_server_pb.ApiServerService/GetChatMessage';

/** Refresh the user JWT this long before it actually expires. */
const JWT_EXPIRY_SKEW_MS = 60_000;

export type CodeSearchWindsurfBackendOptions = {
  /** Keychain ref holding the token, e.g. `keychain:piwin-code-search-windsurf`. */
  apiKeyRef?: string;
  /** Env var name fallback for the token. */
  apiKeyEnv?: string;
  identity?: WindsurfClientIdentity;
  /** Override the streaming path (diagnostics only). */
  chatPath?: string;
  fetch?: typeof globalThis.fetch;
  readSecretByRef?: (ref: string) => Promise<string | null>;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
};

/** Read the `exp` claim (seconds) from a JWT without verifying it. */
function readJwtExpiryMs(jwt: string): number | undefined {
  const parts = jwt.split('.');
  const payload = parts[1];
  if (parts.length < 2 || !payload) {
    return undefined;
  }
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as unknown;
    if (typeof decoded === 'object' && decoded !== null && 'exp' in decoded) {
      const exp = (decoded as { exp?: unknown }).exp;
      if (typeof exp === 'number' && Number.isFinite(exp)) {
        return exp * 1000;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Map a token value to a usable api key string (Windsurf keys carry a prefix). */
export function normalizeWindsurfToken(raw: string): string {
  const trimmed = raw.trim();
  return trimmed;
}

export function createWindsurfCompletionPort(
  options: CodeSearchWindsurfBackendOptions,
): CodeSearchCompletionPort {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const clock = options.now ?? Date.now;
  const resolver = options.readSecretByRef ? undefined : createSecretResolver();
  const chatPath = options.chatPath ?? WINDSURF_STREAM_PATH;

  let cachedJwt: { value: string; expiresAt: number } | undefined;

  async function readToken(): Promise<string | undefined> {
    if (options.apiKeyRef) {
      const fromRef = options.readSecretByRef
        ? await options.readSecretByRef(options.apiKeyRef)
        : await resolver?.readSecretByRef(options.apiKeyRef);
      if (fromRef && fromRef.trim()) {
        return normalizeWindsurfToken(fromRef);
      }
    }
    if (options.apiKeyEnv) {
      const env = options.env ?? process.env;
      const fromEnv = env[options.apiKeyEnv];
      if (typeof fromEnv === 'string' && fromEnv.trim()) {
        return normalizeWindsurfToken(fromEnv);
      }
    }
    return undefined;
  }

  async function fetchJwt(apiKey: string, signal: AbortSignal, timeoutMs: number): Promise<string> {
    const endpoint = resolveWindsurfEndpoint(options.identity ?? {}, WINDSURF_GET_USER_JWT_PATH);
    const response = await fetchImplementation(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/proto', 'connect-protocol-version': '1' },
      body: buildGetUserJwtBody(options.identity ?? {}, apiKey),
      signal,
    });
    if (!response.ok) {
      throw new CodeSearchCompletionError(
        'provider-request-failed',
        response.status === 401 || response.status === 403
          ? `${LABEL}: the configured token was rejected (${response.status}). Update it in Settings → Code search.`
          : `${LABEL}: authentication failed (${response.status} ${response.statusText || 'request rejected'})`,
      );
    }
    const payload = Buffer.from(await response.arrayBuffer());
    const jwt = parseUserJwtResponse(payload);
    if (!jwt) {
      throw new CodeSearchCompletionError(
        'provider-request-failed',
        `${LABEL}: authentication response did not contain a user token`,
      );
    }
    void timeoutMs;
    return jwt;
  }

  return async (request) => {
    if (!fetchImplementation) {
      throw new CodeSearchCompletionError(
        'provider-request-failed',
        `${LABEL} is unavailable: fetch is not supported`,
      );
    }
    const apiKey = await readToken();
    if (!apiKey) {
      throw new CodeSearchCompletionError(
        'provider-request-failed',
        `${LABEL}: no token configured. Add a Windsurf/Devin token in Settings → Code search, or set ${
          options.apiKeyEnv ?? 'WINDSURF_API_KEY'
        }.`,
      );
    }
    if (request.signal.aborted) {
      throw new CodeSearchCompletionError('cancelled', `${LABEL} round was cancelled`);
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    request.signal.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), Math.max(1, request.timeoutMs));

    try {
      const cached = cachedJwt;
      const jwt =
        cached && cached.expiresAt - JWT_EXPIRY_SKEW_MS > clock()
          ? cached.value
          : await (async () => {
              const fresh = await fetchJwt(apiKey, controller.signal, request.timeoutMs);
              const expiry = readJwtExpiryMs(fresh);
              cachedJwt = {
                value: fresh,
                expiresAt: expiry ?? clock() + 5 * 60_000,
              };
              return fresh;
            })();

      const body = buildChatRequestBody({
        identity: options.identity ?? {},
        apiKey,
        userJwt: jwt,
        systemPrompt: request.systemPrompt,
        messages: request.messages,
        toolDefinitionsJson: buildWindsurfToolDefinitionsJson(request.tools),
      });

      const endpoint = resolveWindsurfEndpoint(options.identity ?? {}, chatPath);
      const response = await fetchImplementation(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/connect+proto',
          'connect-protocol-version': '1',
          'connect-accept-encoding': 'gzip',
          'connect-content-encoding': 'gzip',
          'connect-timeout-ms': String(Math.max(1, request.timeoutMs)),
          accept: 'application/connect+proto',
          'accept-encoding': 'identity',
        },
        body: encodeGzipFrame(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new CodeSearchCompletionError(
          'provider-request-failed',
          response.status === 401 || response.status === 403
            ? `${LABEL}: the configured token was rejected (${response.status}). Update it in Settings → Code search.`
            : `${LABEL} failed (${response.status} ${response.statusText || 'request rejected'})`,
        );
      }

      const frames = decodeConnectFrames(Buffer.from(await response.arrayBuffer()));
      let text = '';
      let trailerError: { code: string; message: string } | undefined;
      for (const frame of frames) {
        if (frame.endOfStream) {
          trailerError = parseTrailerPayload(frame.payload).error;
          continue;
        }
        text += parseChatFramePayload(frame.payload).deltaText;
      }
      if (trailerError) {
        throw new CodeSearchCompletionError(
          'provider-request-failed',
          `${LABEL} reported ${trailerError.code}: ${trailerError.message}`,
        );
      }
      if (!frames.length) {
        throw new CodeSearchCompletionError(
          'provider-request-failed',
          `${LABEL} returned no response frames`,
        );
      }

      const marker = parseWindsurfToolCall(text);
      if (!marker) {
        return { text: text.trim(), toolCalls: [] };
      }
      return {
        text: marker.thinking,
        toolCalls: [
          {
            // The service returns no call id, so one is synthesized per round.
            id: `windsurf_call_1`,
            name: marker.name,
            arguments: marker.args,
          },
        ],
      };
    } catch (error) {
      if (error instanceof CodeSearchCompletionError) {
        throw error;
      }
      if (request.signal.aborted) {
        throw new CodeSearchCompletionError('cancelled', `${LABEL} round was cancelled`);
      }
      if (controller.signal.aborted) {
        throw new CodeSearchCompletionError(
          'provider-timeout',
          `${LABEL} round timed out after ${Math.round(request.timeoutMs / 1000)} seconds`,
        );
      }
      throw new CodeSearchCompletionError(
        'provider-request-failed',
        `${LABEL} failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener('abort', onAbort);
    }
  };
}

/** Exported so Settings can show the effective base URL. */
export const WINDSURF_DEFAULT_API_BASE = WINDSURF_API_BASE;


export type WindsurfTokenProbeResult = {
  durationMs: number;
  /** Always 1 on success — matches WebSecretEditor's `{ durationMs, resultCount }` shape. */
  resultCount: number;
};

export type WindsurfTokenProbeOptions = {
  /** One-shot token from the settings editor (preferred when the user just pasted). */
  apiKey?: string;
  apiKeyRef?: string;
  apiKeyEnv?: string;
  identity?: WindsurfClientIdentity;
  fetch?: typeof globalThis.fetch;
  readSecretByRef?: (ref: string) => Promise<string | null>;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/**
 * Settings smoke test: exchange the Windsurf/Devin token for a user JWT.
 * Does not run a search round — only proves the credential is accepted.
 */
export async function probeWindsurfToken(
  options: WindsurfTokenProbeOptions,
): Promise<WindsurfTokenProbeResult> {
  const started = Date.now();
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (!fetchImplementation) {
    throw new CodeSearchCompletionError(
      'provider-request-failed',
      `${LABEL} is unavailable: fetch is not supported`,
    );
  }

  let token: string | undefined;
  if (options.apiKey?.trim()) {
    token = normalizeWindsurfToken(options.apiKey);
  } else if (options.apiKeyRef) {
    const resolver = options.readSecretByRef ? undefined : createSecretResolver();
    const fromRef = options.readSecretByRef
      ? await options.readSecretByRef(options.apiKeyRef)
      : await resolver?.readSecretByRef(options.apiKeyRef);
    if (fromRef?.trim()) {
      token = normalizeWindsurfToken(fromRef);
    }
  }
  if (!token && options.apiKeyEnv) {
    const env = options.env ?? process.env;
    const fromEnv = env[options.apiKeyEnv];
    if (typeof fromEnv === 'string' && fromEnv.trim()) {
      token = normalizeWindsurfToken(fromEnv);
    }
  }
  if (!token) {
    throw new CodeSearchCompletionError(
      'provider-request-failed',
      `${LABEL}: no token configured. Paste a Windsurf/Devin token or set ${
        options.apiKeyEnv ?? 'WINDSURF_API_KEY'
      }.`,
    );
  }

  const timeoutMs = options.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const endpoint = resolveWindsurfEndpoint(options.identity ?? {}, WINDSURF_GET_USER_JWT_PATH);
    const response = await fetchImplementation(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/proto', 'connect-protocol-version': '1' },
      body: buildGetUserJwtBody(options.identity ?? {}, token),
      signal: controller.signal,
    });
    if (!response.ok) {
      let detail = '';
      try {
        const text = (await response.text()).trim();
        if (text) {
          detail = text.length > 240 ? `${text.slice(0, 240)}…` : text;
        }
      } catch {
        // ignore body read failures
      }
      const suffix = detail ? `: ${detail}` : '';
      throw new CodeSearchCompletionError(
        'provider-request-failed',
        response.status === 401 || response.status === 403
          ? `${LABEL}: the configured token was rejected (${response.status}). Update it in Settings → Code search.${suffix}`
          : `${LABEL}: authentication failed (${response.status} ${response.statusText || 'request rejected'})${suffix}`,
      );
    }
    const payload = Buffer.from(await response.arrayBuffer());
    const jwt = parseUserJwtResponse(payload);
    if (!jwt) {
      throw new CodeSearchCompletionError(
        'provider-request-failed',
        `${LABEL}: authentication response did not contain a user token`,
      );
    }
    return { durationMs: Math.max(0, Date.now() - started), resultCount: 1 };
  } catch (error) {
    if (error instanceof CodeSearchCompletionError) {
      throw error;
    }
    if (controller.signal.aborted && !options.signal?.aborted) {
      throw new CodeSearchCompletionError(
        'provider-timeout',
        `${LABEL} probe timed out after ${Math.round(timeoutMs / 1000)} seconds`,
      );
    }
    if (options.signal?.aborted) {
      throw new CodeSearchCompletionError('cancelled', `${LABEL} probe was cancelled`);
    }
    throw new CodeSearchCompletionError(
      'provider-request-failed',
      `${LABEL} probe failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
