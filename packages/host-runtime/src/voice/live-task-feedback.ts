import type { LiveDelegationContext } from '@piwin/contracts';

export type LiveNoWorkReason =
  | 'conversation'
  | 'clarify'
  | 'unavailable'
  | 'hold-empty'
  | 'hold-mismatch';

export function renderLiveNoWorkFeedback(reason: LiveNoWorkReason): string {
  switch (reason) {
    case 'conversation':
      return 'This utterance did not create a new task. It is conversation or a speaking preference. Keep it in voice; respect requests for silence/no confirmation. Do not delegate it again.';
    case 'clarify':
      return 'This utterance did not create a new task because the request is incomplete. Ask one short question in the user language about what action they want; do not invent or re-delegate the fragment.';
    case 'hold-empty':
      return 'This utterance did not create a new task because the user is not in a work session. Ask them to open or focus a session. Do not claim acceptance.';
    case 'hold-mismatch':
      return 'This utterance did not create a new task because the visible session is not the bound Live work session. Do not run it in the previous session or claim acceptance.';
    case 'unavailable':
      return 'This utterance did not create a new task because intent verification was unavailable. Briefly say you could not accept it and the user can retry or type in chat.';
  }
}

/**
 * Re-primes the voice model from Host-owned state at a user-turn boundary.
 * Commentary stays silent; the current utterance decides whether to mention it.
 */
export function renderLiveTaskStatusRefresh(task: LiveDelegationContext): string {
  const state = task.status === 'queued'
    ? 'The most recent delegated task was accepted and queued. It is waiting to run.'
    : task.status === 'working'
      ? 'The most recent delegated task did start and is currently running.'
      : task.status === 'completed'
        ? 'The most recent delegated task did run and is completed.'
        : 'The most recent delegated task did run but is incomplete.';
  const result = task.status === 'queued' || task.status === 'working'
    ? ''
    : `\nAuthoritative Host result:\n${task.result ?? 'No speakable result was recorded.'}`;
  return [
    'Silent authoritative Host task-state refresh for the current user turn.',
    `${state}${result}`,
    'Use this state if the user asks whether that task was accepted, started, its progress, or its result. Do not contradict it.',
    'If the user requests different actionable work, use the normal handover path. Otherwise do not announce this refresh.',
  ].join('\n');
}

export function renderLiveTaskReuseFeedback(input: {
  queued: boolean;
  result?: string;
}): string {
  if (input.result) {
    return `The existing task did run. Use this authoritative result; no duplicate task was created.\n${input.result}`;
  }
  return input.queued
    ? 'The existing task was accepted and queued. It is waiting to run. No duplicate task was created.'
    : 'The existing task was admitted and is currently running. It did start. No duplicate task was created; use its current status.';
}
