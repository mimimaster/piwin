/**
 * Provider-neutral Live adapter ports. Upstream wire stays in adapter impls.
 */

import type { LiveCallErrorCode } from '@piwin/contracts';

export type VoiceDelegationEvent = {
  providerDelegationId: string;
  instruction: string;
};

export type RealtimeVoiceAdapterEvent =
  | { type: 'ready' }
  | { type: 'activity'; activity: 'listening' | 'user-speaking' | 'assistant-speaking' }
  | { type: 'delegation'; delegation: VoiceDelegationEvent }
  | { type: 'failed'; errorCode: LiveCallErrorCode }
  | { type: 'closed' };

export type CreateRealtimeCallInput = {
  /** Stable product session id used by the Codex Live request identity header. */
  sessionId: string;
  sdpOffer: string;
  accessToken: string;
  accountId: string;
  voice?: string;
  instructions: string;
  signal: AbortSignal;
};

export type CreateRealtimeCallResult = {
  sdpAnswer: string;
};

export type RealtimeVoiceAdapter = {
  createCall(input: CreateRealtimeCallInput): Promise<CreateRealtimeCallResult>;
  subscribe(listener: (event: RealtimeVoiceAdapterEvent) => void): () => void;
  /** Send Host admission receipt back upstream when supported. */
  acknowledgeDelegation?(input: {
    providerDelegationId: string;
    ok: boolean;
    runId?: string;
    messageId?: string;
    queueId?: string;
  }): void;
  close(): Promise<void>;
};
