/**
 * Redaction helpers for piwin Live spike logs.
 * Never log Authorization, Cookie, SDP bodies, or provider JSON payloads.
 */

const SECRET_KEY = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i;
const SECRET_VALUE =
  /\b(sk-[a-z0-9_-]{8,}|ek_[a-z0-9_-]{8,}|Bearer\s+[a-z0-9._\-]+)\b/gi;

export type MappedSpikeErrorCode =
  | 'ok'
  | 'missing-api-key'
  | 'aborted'
  | 'timeout'
  | 'unauthorized'
  | 'rate-limited'
  | 'network'
  | 'protocol'
  | 'unknown';

export function redactString(value: string): string {
  return value.replace(SECRET_VALUE, '[redacted]');
}

export function redactHeaders(headers: Headers | Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const entries =
    headers instanceof Headers ? [...headers.entries()] : Object.entries(headers);
  for (const [key, value] of entries) {
    if (SECRET_KEY.test(key)) {
      out[key.toLowerCase()] = '[redacted]';
      continue;
    }
    out[key.toLowerCase()] = redactString(value);
  }
  return out;
}

export function mapHttpStatus(status: number): MappedSpikeErrorCode {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate-limited';
  if (status >= 400 && status < 500) return 'protocol';
  if (status >= 500) return 'network';
  return 'unknown';
}

export function mapCaughtError(error: unknown): MappedSpikeErrorCode {
  if (error instanceof DOMException && error.name === 'AbortError') return 'aborted';
  if (error instanceof Error) {
    if (error.name === 'AbortError' || /aborted/i.test(error.message)) return 'aborted';
    if (/timeout/i.test(error.message)) return 'timeout';
    if (/fetch failed|ECONNRESET|ENOTFOUND|network/i.test(error.message)) return 'network';
  }
  return 'unknown';
}

export type SpikeLogEvent = {
  event: string;
  phase?: string;
  durationMs?: number;
  mappedErrorCode?: MappedSpikeErrorCode;
  httpStatus?: number;
  hasAnswerSdp?: boolean;
  hasLocation?: boolean;
  callIdHint?: string;
};

export function formatSpikeLog(entry: SpikeLogEvent): string {
  return JSON.stringify({
    ...entry,
    ...(entry.callIdHint ? { callIdHint: redactString(entry.callIdHint) } : {}),
  });
}
