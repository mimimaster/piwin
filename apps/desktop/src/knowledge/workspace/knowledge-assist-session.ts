import type {
  AgentEvent,
  CreateSessionInput,
  HostPush,
  KnowledgeContextRef,
  PromptInput,
  SessionTranscriptMessage,
  WikiSourceRef,
  WikiWriteInput,
} from '@piwin/contracts';

export type KnowledgeAssistMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

export type KnowledgeAssistViewState = {
  messages: KnowledgeAssistMessage[];
  running: boolean;
  runId: string | null;
};

export function emptyKnowledgeAssistState(): KnowledgeAssistViewState {
  return { messages: [], running: false, runId: null };
}

export function buildKnowledgeAssistCreateInput(input: {
  projectPath?: string | null | undefined;
  baseId: string;
  title: string;
  locale: 'zh-CN' | 'en';
}): CreateSessionInput {
  const title = input.title.trim() || 'document';
  const sessionName =
    input.locale === 'zh-CN' ? `助读 · ${title}` : `Reading · ${title}`;
  const projectPath = input.projectPath?.trim();
  const scope = projectPath
    ? { kind: 'project' as const, projectPath }
    : { kind: 'general' as const };
  return {
    scope,
    sessionName,
    knowledgeBaseIds: [input.baseId],
  };
}

export function defaultKnowledgeAssistPrompt(locale: 'zh-CN' | 'en'): string {
  return locale === 'zh-CN' ? '解释这段' : 'Explain this passage';
}

export function buildKnowledgeAssistPromptInput(input: {
  text: string;
  contextRef?: KnowledgeContextRef | null | undefined;
}): PromptInput {
  const text = input.text.trim();
  if (input.contextRef) {
    return { text, contextRefs: [input.contextRef] };
  }
  return { text };
}

export function wikiSourceFromKnowledgeRef(ref: KnowledgeContextRef): WikiSourceRef | null {
  const relativePath = ref.relativePath?.trim();
  if (!relativePath) return null;
  const snapshot = ref.snapshotText.trim();
  return {
    baseId: ref.baseId,
    relativePath,
    ...(ref.lineStart !== undefined ? { lineStart: ref.lineStart } : {}),
    ...(ref.lineEnd !== undefined ? { lineEnd: ref.lineEnd } : {}),
    ...(snapshot.length > 0 ? { snapshotText: snapshot } : {}),
  };
}

export function buildKnowledgeAssistWikiWriteInput(input: {
  documentTitle: string;
  answer: string;
  contextRef?: KnowledgeContextRef | null | undefined;
}): WikiWriteInput {
  const source = input.contextRef ? wikiSourceFromKnowledgeRef(input.contextRef) : null;
  return {
    title: input.documentTitle.trim() || 'Reading note',
    content: input.answer.trim(),
    kind: 'note',
    ...(source ? { sources: [source] } : {}),
  };
}

export function sessionIdFromResponseData(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const sessionId = (data as { sessionId?: unknown }).sessionId;
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null;
}

export function runIdFromResponseData(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const runId = (data as { runId?: unknown }).runId;
  return typeof runId === 'string' && runId.length > 0 ? runId : null;
}

export function messagesFromResume(
  messages: readonly SessionTranscriptMessage[],
): KnowledgeAssistMessage[] {
  return messages.flatMap((message) => {
    const mapped = mapTranscriptMessage(message);
    return mapped ? [mapped] : [];
  });
}

export function applyAssistPush(
  state: KnowledgeAssistViewState,
  push: HostPush,
  sessionId: string,
): KnowledgeAssistViewState {
  if (push.type === 'event' && push.sessionId === sessionId) {
    return applyAssistEvent(state, push.event);
  }
  if (push.type === 'transcript/append' && push.sessionId === sessionId) {
    const mapped = mapTranscriptMessage(push.message);
    if (!mapped) return state;
    return { ...state, messages: upsertMessage(state.messages, mapped) };
  }
  if (push.type === 'session/runtime-updated' && push.status.sessionId === sessionId) {
    const busy = push.status.residency === 'resident-busy';
    return { ...state, running: busy, runId: busy ? state.runId : null };
  }
  return state;
}

export function applyAssistEvent(
  state: KnowledgeAssistViewState,
  event: AgentEvent,
): KnowledgeAssistViewState {
  if (event.type === 'message/start' && event.role === 'assistant') {
    const existing = state.messages.some((message) => message.id === event.messageId);
    const messages = existing
      ? state.messages
      : [...state.messages, { id: event.messageId, role: 'assistant' as const, text: '' }];
    return {
      messages,
      running: true,
      runId: event.runId ?? state.runId,
    };
  }
  if (event.type === 'message/text_delta') {
    return {
      ...state,
      messages: state.messages.map((message) =>
        message.id === event.messageId
          ? { ...message, text: `${message.text}${event.delta}` }
          : message,
      ),
    };
  }
  if (event.type === 'message/text_snapshot') {
    return {
      ...state,
      messages: state.messages.map((message) =>
        message.id === event.messageId ? { ...message, text: event.text } : message,
      ),
    };
  }
  if (event.type === 'message/end' || event.type === 'session/aborted') {
    return { ...state, running: false, runId: event.runId ?? state.runId };
  }
  return state;
}

function mapTranscriptMessage(message: SessionTranscriptMessage): KnowledgeAssistMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null;
  return { id: message.id, role: message.role, text: message.text };
}

function upsertMessage(
  messages: readonly KnowledgeAssistMessage[],
  next: KnowledgeAssistMessage,
): KnowledgeAssistMessage[] {
  const index = messages.findIndex((message) => message.id === next.id);
  if (index < 0) return [...messages, next];
  return messages.map((message, at) => (at === index ? next : message));
}
