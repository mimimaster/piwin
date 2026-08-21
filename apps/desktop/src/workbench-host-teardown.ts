const EXACT_TEARDOWN_ERRORS = new Set([
  'Host transport closed',
  'Host transport is not open',
  'Host WebSocket is not open',
  'Host client closed',
  'Host client has been closed',
  'Host connection closed',
  'Host heartbeat timed out',
  'Host WebSocket closed before handshake',
]);

const TEARDOWN_ERROR_PREFIXES = ['Unable to send Host request:', 'WebSocket closed ('] as const;

/** Errors from a socket that is closing, reconnecting, or not open yet. */
export function isWorkbenchHostTeardownError(message: string): boolean {
  if (EXACT_TEARDOWN_ERRORS.has(message)) {
    return true;
  }
  return TEARDOWN_ERROR_PREFIXES.some((prefix) => message.startsWith(prefix));
}
