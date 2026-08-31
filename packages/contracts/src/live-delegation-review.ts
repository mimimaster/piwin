/** A provider delegation is a candidate, never proof of executable intent. */
export type LiveDelegationDecision =
  | { kind: 'work' | 'repeat'; brief: string }
  | { kind: 'reuse'; delegationId: string }
  | { kind: 'conversation' }
  | { kind: 'clarify' }
  | { kind: 'stop' };

export type LiveDelegationContext = {
  delegationId: string;
  brief: string;
  status: 'working' | 'completed' | 'incomplete';
  result?: string;
};

export type LiveDelegationReviewInput = {
  sessionId: string;
  instruction: string;
  tasks: readonly LiveDelegationContext[];
  signal: AbortSignal;
};

export type LiveDelegationReviewer = (
  input: LiveDelegationReviewInput,
) => Promise<LiveDelegationDecision>;

/** Separate completion, not a Session prompt: no tools, transcript or Run. */
export type ModelTextCompletionInput = {
  model: import('./host.js').ModelRef;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
  signal: AbortSignal;
};
