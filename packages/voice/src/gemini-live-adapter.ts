import {
  PIWIN_LIVE_DELEGATE_INSTRUCTION_DESCRIPTION,
  PIWIN_LIVE_DELEGATE_TOOL_DESCRIPTION,
  type LiveGeminiThinkingLevel,
  type LiveOwnerBootstrap,
} from '@piwin/contracts';
import {
  GEMINI_LIVE_CONSTRAINED_ENDPOINT,
  GEMINI_LIVE_DEFAULT_MODEL,
  GEMINI_LIVE_DEFAULT_THINKING,
  GEMINI_LIVE_DEFAULT_VOICE,
  GEMINI_LIVE_SYSTEM_INSTRUCTION,
} from './gemini-live-schema.js';

const TOKEN_URL = 'https://generativelanguage.googleapis.com/v1beta/auth_tokens';
const TOKEN_DEADLINE_MS = 12_000;

export type GeminiLiveTokenInput = {
  apiKey: string;
  modelId: string;
  voice: string;
  thinkingLevel: LiveGeminiThinkingLevel;
  signal: AbortSignal;
};

export type GeminiLiveTokenResult = {
  name: string;
  expireTime?: string;
};

export function buildGeminiLiveTokenRequest(input: {
  modelId: string;
  voice: string;
  thinkingLevel: LiveGeminiThinkingLevel;
  now?: Date;
}): Record<string, unknown> {
  const now = input.now ?? new Date();
  const sessionExpire = new Date(now.getTime() + 60_000).toISOString();
  const tokenExpire = new Date(now.getTime() + 30 * 60_000).toISOString();
  // Raw REST AuthToken uses proto names. `liveConnectConstraints` is SDK-only
  // and Google 400s it: Unknown name "liveConnectConstraints".
  return {
    expireTime: tokenExpire,
    newSessionExpireTime: sessionExpire,
    uses: 1,
    bidiGenerateContentSetup: {
      model: `models/${input.modelId}`,
      systemInstruction: {
        parts: [{ text: GEMINI_LIVE_SYSTEM_INSTRUCTION }],
      },
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: input.voice } },
        },
        thinkingConfig: { thinkingLevel: input.thinkingLevel.toUpperCase() },
      },
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: {},
      tools: [
        {
          functionDeclarations: [
            {
              name: 'delegate_to_work_session',
              description: PIWIN_LIVE_DELEGATE_TOOL_DESCRIPTION,
              parameters: {
                type: 'OBJECT',
                properties: {
                  instruction: {
                    type: 'STRING',
                    description: PIWIN_LIVE_DELEGATE_INSTRUCTION_DESCRIPTION,
                  },
                },
                required: ['instruction'],
              },
            },
          ],
        },
      ],
    },
  };
}

export function readGeminiAuthTokenError(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object') return body.slice(0, 240);
    const error = (parsed as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === 'string' && error.message.trim()) {
      return error.message.trim().slice(0, 240);
    }
  } catch {
    // Keep a short raw snippet when Google does not return JSON.
  }
  const trimmed = body.trim();
  return trimmed ? trimmed.slice(0, 240) : 'empty body';
}

export function geminiOwnerBootstrap(input: {
  tokenName: string;
  modelId: string;
  voice: string;
  thinkingLevel: LiveGeminiThinkingLevel;
}): LiveOwnerBootstrap {
  return {
    mediaDriverId: 'gemini-live-v1beta',
    endpoint: GEMINI_LIVE_CONSTRAINED_ENDPOINT,
    ephemeralToken: input.tokenName,
    inputSampleRateHz: 16_000,
    outputSampleRateHz: 24_000,
    modelId: input.modelId,
    voice: input.voice,
    thinkingLevel: input.thinkingLevel,
  };
}

export async function mintGeminiLiveToken(
  input: GeminiLiveTokenInput,
  fetchImpl: typeof fetch = fetch,
): Promise<GeminiLiveTokenResult> {
  if (input.signal.aborted) throw new DOMException('aborted', 'AbortError');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOKEN_DEADLINE_MS);
  const onAbort = (): void => controller.abort();
  input.signal.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': input.apiKey,
      },
      body: JSON.stringify(
        buildGeminiLiveTokenRequest({
          modelId: input.modelId,
          voice: input.voice,
          thinkingLevel: input.thinkingLevel,
        }),
      ),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      const googleMessage = readGeminiAuthTokenError(raw);
      console.error(`[piwin-live] gemini auth_tokens status=${response.status} ${googleMessage}`);
      if (response.status === 401 || response.status === 403) throw new Error('live-provider-auth');
      if (response.status === 404 || response.status === 400 || response.status === 429) {
        throw new Error('live-provider-rejected');
      }
      throw new Error('live-protocol-failed');
    }
    const body: unknown = raw ? JSON.parse(raw) : null;
    if (!body || typeof body !== 'object') throw new Error('live-protocol-failed');
    const record = body as { name?: unknown; expireTime?: unknown };
    if (typeof record.name !== 'string' || !record.name) throw new Error('live-protocol-failed');
    return {
      name: record.name,
      ...(typeof record.expireTime === 'string' ? { expireTime: record.expireTime } : {}),
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('live-')) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('live-protocol-failed');
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener('abort', onAbort);
  }
}

export function defaultGeminiSettings(): {
  model: string;
  voice: string;
  thinkingLevel: LiveGeminiThinkingLevel;
} {
  return {
    model: GEMINI_LIVE_DEFAULT_MODEL,
    voice: GEMINI_LIVE_DEFAULT_VOICE,
    thinkingLevel: GEMINI_LIVE_DEFAULT_THINKING,
  };
}
