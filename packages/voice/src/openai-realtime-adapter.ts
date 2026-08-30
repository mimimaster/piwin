import type { LiveOwnerBootstrap } from '@piwin/contracts';
import {
  OPENAI_REALTIME_MEDIA_DRIVER_ID,
  httpBaseUrlToRealtimeWs,
} from './openai-realtime-schema.js';

export function openaiRealtimeOwnerBootstrap(input: {
  baseUrl: string;
  bearerToken: string;
  modelId: string;
  voice: string;
}): LiveOwnerBootstrap {
  return {
    mediaDriverId: OPENAI_REALTIME_MEDIA_DRIVER_ID,
    endpoint: httpBaseUrlToRealtimeWs(input.baseUrl, input.modelId),
    bearerToken: input.bearerToken,
    inputSampleRateHz: 24_000,
    outputSampleRateHz: 24_000,
    modelId: input.modelId,
    voice: input.voice,
  };
}

/**
 * Prefer ephemeral client secrets when the gateway supports them (official xAI).
 * xgrok and many OpenAI-compatible proxies return 404 — caller falls back to the API key.
 */
export async function tryMintOpenaiRealtimeClientSecret(
  input: {
    baseUrl: string;
    apiKey: string;
    modelId: string;
    signal: AbortSignal;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const trimmed = input.baseUrl.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(`${trimmed}/realtime/client_secrets`);
  } catch {
    return null;
  }
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        expires_after: { seconds: 600 },
        session: { model: input.modelId },
      }),
      signal: input.signal,
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') return null;
    const record = body as { value?: unknown; client_secret?: { value?: unknown } };
    if (typeof record.value === 'string' && record.value.trim()) return record.value.trim();
    if (typeof record.client_secret?.value === 'string' && record.client_secret.value.trim()) {
      return record.client_secret.value.trim();
    }
    return null;
  } catch {
    return null;
  }
}
