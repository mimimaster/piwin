/**
 * Low-frequency session-chain diagnostics. Never log prompt text, API keys,
 * or attachment bytes — only ids, scope keys, generations, and error codes.
 */
export type SessionChainLogFields = {
  event: string;
  operationId?: string;
  owner?: string;
  scopeKey?: string;
  queryGeneration?: number;
  mutationEpoch?: number;
  elapsedMs?: number;
  errorCode?: string;
  hostInstanceId?: string | null;
};

export function logSessionChain(fields: SessionChainLogFields): void {
  if (typeof process !== 'undefined' && process.env['VITEST']) {
    return;
  }
  if (typeof console === 'undefined' || typeof console.debug !== 'function') {
    return;
  }
  console.debug('[piwin.session-chain]', fields);
}

export function sessionChainErrorCode(error: unknown): string {
  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim().slice(0, 120);
  }
  if (error instanceof Error && error.name) {
    return error.name;
  }
  return 'unknown';
}
