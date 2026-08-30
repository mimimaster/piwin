import { SidebandToolLedger } from './sideband-tool-ledger.js';
import { normalizeDelegationCreatedEvent } from './delegation-normalize.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function delegationEvent(id: string, text: string): unknown {
  return {
    type: 'delegation.created',
    item: {
      type: 'delegation',
      target: 'client',
      id,
      content: [{ type: 'input_text', text }],
    },
  };
}

assert(normalizeDelegationCreatedEvent(null) === null, 'null');
assert(
  normalizeDelegationCreatedEvent(delegationEvent('d1', 'fix the bug'))?.instruction ===
    'fix the bug',
  'valid',
);

const ledger = new SidebandToolLedger();
const first = ledger.admitFromUpstreamEvent('call-1', delegationEvent('d1', 'fix the bug'));
assert(first.status === 'accepted', 'first');
const replay = ledger.admitFromUpstreamEvent('call-1', delegationEvent('d1', 'fix again'));
assert(replay.status === 'accepted' && first.status === 'accepted', 'shapes');
if (first.status === 'accepted' && replay.status === 'accepted') {
  assert(first.runId === replay.runId, 'idempotent');
}

ledger.close();
const after = ledger.admitFromUpstreamEvent('call-1', delegationEvent('d2', 'late'));
assert(after.status === 'rejected' && after.reason === 'call-closed', 'closed');

console.log(JSON.stringify({ event: 'sideband-ledger-test', phase: 'ok' }));
