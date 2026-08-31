/**
 * Host-side Codex Live call create. Events arrive from Desktop (data channel).
 */

import type { LiveCallErrorCode } from '@piwin/contracts';
import type {
  CreateRealtimeCallInput,
  CreateRealtimeCallResult,
  RealtimeVoiceAdapter,
  RealtimeVoiceAdapterEvent,
} from './realtime-voice-adapter.js';
import { mapCaughtToLiveError, mapHttpStatusToLiveError } from './codex-delegation.js';

const DEFAULT_BASE = 'https://chatgpt.com/backend-api/codex';
const DEFAULT_MODEL = 'gpt-live-1-codex';
const DEFAULT_DEADLINE_MS = 15_000;

export const CODEX_LIVE_VOICES = [
  'juniper',
  'maple',
  'spruce',
  'ember',
  'vale',
  'breeze',
  'arbor',
  'sol',
  'cove',
] as const;
export type CodexLiveVoice = (typeof CODEX_LIVE_VOICES)[number];
export const DEFAULT_CODEX_LIVE_VOICE: CodexLiveVoice = 'cove';

/**
 * Wire identity copied from `@howaboua/pi-codex-conversion` voice auth
 * (`resolveCodexVoiceAuth` + `CodexRealtimeConversation.start`).
 * ChatGPT Codex Live allowlists this client fingerprint.
 */
export const CODEX_LIVE_ORIGINATOR = 'pi';
export const CODEX_LIVE_USER_AGENT = 'pi-codex-conversion';

export function buildCodexLiveRequestHeaders(input: {
  accessToken: string;
  accountId: string;
  sessionId: string;
}): Record<string, string> {
  return {
    Authorization: `Bearer ${input.accessToken}`,
    'chatgpt-account-id': input.accountId,
    originator: CODEX_LIVE_ORIGINATOR,
    'x-session-id': input.sessionId,
    'user-agent': CODEX_LIVE_USER_AGENT,
    'openai-alpha': 'quicksilver=v2',
    'content-type': 'application/json',
  };
}

export function buildCodexLiveCallUrl(baseUrl = DEFAULT_BASE): string {
  return `${baseUrl.replace(/\/+$/, '')}/realtime/calls?intent=quicksilver&architecture=avas`;
}

export function resolveCodexLiveVoice(value: string | undefined): CodexLiveVoice {
  const normalized = value?.trim().toLowerCase();
  return CODEX_LIVE_VOICES.find((voice) => voice === normalized) ?? DEFAULT_CODEX_LIVE_VOICE;
}

export const CODEX_LIVE_INTELLIGENCES = ['instant', 'medium', 'high'] as const;
export type CodexLiveIntelligence = (typeof CODEX_LIVE_INTELLIGENCES)[number];
export const DEFAULT_CODEX_LIVE_INTELLIGENCE: CodexLiveIntelligence = 'medium';

/**
 * 2026-08-31: AVAS call-create returns 400
 * `Unknown parameter: 'intelligence'`. Hide the setting and never send it.
 */
export const CODEX_LIVE_INTELLIGENCE_ENABLED = false;

export function resolveCodexLiveIntelligence(
  value: string | undefined,
): CodexLiveIntelligence {
  const normalized = value?.trim().toLowerCase();
  return (
    CODEX_LIVE_INTELLIGENCES.find((level) => level === normalized) ??
    DEFAULT_CODEX_LIVE_INTELLIGENCE
  );
}

export function buildCodexLiveCallBody(input: {
  sdp: string;
  instructions: string;
  voice?: string;
  intelligence?: string;
}): {
  sdp: string;
  session: {
    model: string;
    instructions: string;
    audio: { output: { voice: CodexLiveVoice } };
    intelligence?: CodexLiveIntelligence;
    delegation: { type: 'client'; ack_filler: false };
  };
} {
  return {
    sdp: input.sdp,
    session: {
      model: DEFAULT_MODEL,
      instructions: input.instructions,
      // The v3 Codex Live lane has its own voice catalog. Sending the
      // older Realtime voice `alloy` returns a misleading HTTP 403.
      audio: { output: { voice: resolveCodexLiveVoice(input.voice) } },
      ...(CODEX_LIVE_INTELLIGENCE_ENABLED
        ? { intelligence: resolveCodexLiveIntelligence(input.intelligence) }
        : {}),
      delegation: { type: 'client', ack_filler: false },
    },
  };
}

export class CodexLiveAdapter implements RealtimeVoiceAdapter {
  private readonly listeners = new Set<(event: RealtimeVoiceAdapterEvent) => void>();
  private closed = false;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(options?: { fetchImpl?: typeof fetch; baseUrl?: string }) {
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.baseUrl = options?.baseUrl ?? DEFAULT_BASE;
  }

  async createCall(input: CreateRealtimeCallInput): Promise<CreateRealtimeCallResult> {
    if (this.closed) throw new Error('live-protocol-failed');
    if (input.signal.aborted) throw new DOMException('aborted', 'AbortError');

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    input.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), DEFAULT_DEADLINE_MS);

    try {
      const response = await this.fetchImpl(buildCodexLiveCallUrl(this.baseUrl), {
        method: 'POST',
        headers: buildCodexLiveRequestHeaders({
          accessToken: input.accessToken,
          accountId: input.accountId,
          sessionId: input.sessionId,
        }),
        body: JSON.stringify(
          buildCodexLiveCallBody({
            sdp: input.sdpOffer,
            instructions: input.instructions,
            ...(input.voice ? { voice: input.voice } : {}),
            ...(input.intelligence ? { intelligence: input.intelligence } : {}),
          }),
        ),
        signal: controller.signal,
      });
      if (response.status !== 201) {
        const raw = await response.text().catch(() => '');
        console.error(`[piwin-live] codex createCall status=${response.status} ${redactLiveLog(raw)}`);
        const code = mapHttpStatusToLiveError(response.status);
        this.emit({ type: 'failed', errorCode: code });
        throw new Error(code);
      }
      const answerSdp = extractSdpAnswer(await response.text());
      if (!answerSdp.startsWith('v=')) {
        this.emit({ type: 'failed', errorCode: 'live-protocol-failed' });
        throw new Error('live-protocol-failed');
      }
      queueMicrotask(() => {
        if (!this.closed) this.emit({ type: 'ready' });
      });
      return { sdpAnswer: answerSdp };
    } catch (error: unknown) {
      if (error instanceof Error && isLiveErrorCode(error.message)) throw error;
      const code = mapCaughtToLiveError(error);
      this.emit({ type: 'failed', errorCode: code });
      throw new Error(code);
    } finally {
      clearTimeout(timer);
      input.signal.removeEventListener('abort', onAbort);
    }
  }

  subscribe(listener: (event: RealtimeVoiceAdapterEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.emit({ type: 'closed' });
    this.listeners.clear();
  }

  private emit(event: RealtimeVoiceAdapterEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export function extractSdpAnswer(raw: string): string {
  const trimmed = raw.trim();
  let candidate = trimmed;
  if (trimmed.startsWith('v=')) return normalizeSdpLineEndings(trimmed);
  try {
    const parsed = JSON.parse(trimmed) as { sdp?: unknown };
    if (typeof parsed.sdp === 'string' && parsed.sdp.trim().startsWith('v=')) {
      candidate = parsed.sdp.trim();
    }
  } catch {
    const start = trimmed.indexOf('v=');
    if (start >= 0) candidate = trimmed.slice(start);
  }
  return candidate.startsWith('v=') ? normalizeSdpLineEndings(candidate) : candidate;
}

/**
 * WebKit's SDP parser requires every line, including the last one, to be
 * terminated. The upstream answer already uses CRLF, but `trim()` previously
 * removed the final terminator and caused `Invalid SDP line` on macOS.
 */
function normalizeSdpLineEndings(sdp: string): string {
  const lines = sdp.replace(/\r\n?/g, '\n').split('\n');
  while (lines.at(-1) === '') lines.pop();
  return `${lines.join('\r\n')}\r\n`;
}

function isLiveErrorCode(value: string): value is LiveCallErrorCode {
  return value.startsWith('live-');
}

/** Host toast says "check logs"; never print tokens or SDP. */
export function redactLiveLog(raw: string): string {
  return raw
    .replace(/sk-[A-Za-z0-9._-]{8,}/g, 'sk-…')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer …')
    .replace(/v=0[\s\S]{0,400}/g, '[sdp]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
}
