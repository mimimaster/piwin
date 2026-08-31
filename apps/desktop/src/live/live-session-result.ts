/**
 * Desktop already has the finished assistant bubble. Feed that to Live
 * instead of waiting for a Host-only handoff the sidecar may not be running.
 */

export type LiveSessionAssistant = {
  messageId: string;
  text: string;
  done: boolean;
  toolsRunning: boolean;
};

export function readDelegatedTurnResult(messages: readonly {
  id: string;
  role: string;
  text: string;
  status: string;
  tools?: readonly { status: string }[];
}[]): LiveSessionAssistant | null {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') {
      lastUserIndex = index;
      break;
    }
  }
  if (lastUserIndex < 0) return null;
  for (let index = messages.length - 1; index > lastUserIndex; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') continue;
    return {
      messageId: message.id,
      text: message.text,
      done: message.status === 'done' || message.status === 'error',
      toolsRunning: (message.tools ?? []).some((tool) => tool.status === 'running'),
    };
  }
  return null;
}

export function canFeedLiveSessionResult(input: {
  activity: string | undefined;
  sessionStreaming: boolean;
  assistant: LiveSessionAssistant | null;
  viewedSessionId?: string | null;
  boundSessionId?: string | null;
}): boolean {
  if (input.boundSessionId && input.viewedSessionId !== input.boundSessionId) return false;
  if (input.activity !== 'agent-working') return false;
  if (input.sessionStreaming) return false;
  if (!input.assistant?.text.trim()) return false;
  if (!input.assistant.done || input.assistant.toolsRunning) return false;
  return true;
}
