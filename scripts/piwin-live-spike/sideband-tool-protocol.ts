import { SidebandToolLedger } from './sideband-tool-ledger.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export type SpokenClaimGate =
  | { mayClaimSuccess: false; reason: 'awaiting-host' | 'rejected' }
  | { mayClaimSuccess: true; runId: string; messageId: string };

export function spokenClaimBeforeAck(): SpokenClaimGate {
  return { mayClaimSuccess: false, reason: 'awaiting-host' };
}

export function admitAndGate(
  ledger: SidebandToolLedger,
  callId: string,
  event: unknown,
): { spoken: SpokenClaimGate } {
  const admission = ledger.admitFromUpstreamEvent(callId, event);
  if (admission.status === 'accepted') {
    return {
      spoken: {
        mayClaimSuccess: true,
        runId: admission.runId,
        messageId: admission.messageId,
      },
    };
  }
  return { spoken: { mayClaimSuccess: false, reason: 'rejected' } };
}

function main(): void {
  const ledger = new SidebandToolLedger();
  assert(spokenClaimBeforeAck().mayClaimSuccess === false, 'before');

  const event = {
    type: 'delegation.created',
    item: {
      type: 'delegation',
      target: 'client',
      id: 'del-1',
      content: [{ type: 'input_text', text: 'run tests' }],
    },
  };

  const first = admitAndGate(ledger, 'call-1', event);
  assert(first.spoken.mayClaimSuccess === true, 'after ack');

  const wrong = admitAndGate(ledger, 'call-1', { type: 'noise' });
  assert(wrong.spoken.mayClaimSuccess === false, 'reject');

  console.log(JSON.stringify({ event: 'sideband-protocol-test', phase: 'ok' }));
}

main();
