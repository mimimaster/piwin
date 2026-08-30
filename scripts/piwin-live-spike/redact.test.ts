/**
 * Redaction unit checks for spike logging.
 */
import {
  formatSpikeLog,
  mapCaughtError,
  mapHttpStatus,
  redactHeaders,
  redactString,
} from './redact.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(!redactString('Bearer sk-abc1234567890xyz').includes('sk-'), 'bearer redacted');
assert(redactHeaders({ Authorization: 'Bearer secret' }).authorization === '[redacted]', 'auth header');
assert(mapHttpStatus(401) === 'unauthorized', '401');
assert(mapHttpStatus(429) === 'rate-limited', '429');
assert(mapCaughtError(new DOMException('aborted', 'AbortError')) === 'aborted', 'abort');

const line = formatSpikeLog({
  event: 'create-call',
  phase: 'ok',
  durationMs: 12,
  mappedErrorCode: 'ok',
});
assert(!line.toLowerCase().includes('bearer'), 'log line clean');
assert(line.includes('"event":"create-call"'), 'event present');

console.log(JSON.stringify({ event: 'redact-test', phase: 'ok' }));
