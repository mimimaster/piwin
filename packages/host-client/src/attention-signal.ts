import type { ExecutionRunRecord, HostPush } from '@piwin/contracts';

export type AttentionKind = 'needs-input' | 'turn-complete' | 'turn-failed';
export type AttentionSource = 'permission' | 'question' | 'run';

export type AttentionRaise = {
  type: 'raise';
  kind: AttentionKind;
  key: string;
  sessionId: string;
  source: AttentionSource;
  runId?: string;
  permissionAction?: string;
  endedAt?: string;
};

export type AttentionSignal =
  | AttentionRaise
  | { type: 'settle'; sessionId: string; key: string }
  | { type: 'settle-questions'; sessionId: string };

export function classifyRunTerminalAttention(
  run: ExecutionRunRecord,
): 'turn-complete' | 'turn-failed' | 'silent' | null {
  void run;
  throw new Error('AN-S1 not implemented');
}

export function readAttentionSignals(push: HostPush): AttentionSignal[] {
  void push;
  throw new Error('AN-S1 not implemented');
}
