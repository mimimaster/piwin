/**
 * Open a general review session after Doc Cards persist.
 * The transcript stores ids only — never front/back.
 */
import type { CreateSessionInput, SessionHandle, SessionTranscriptMessage } from '@piwin/contracts';
import type { SessionTranscriptStore } from '@piwin/session';

export type OpenDoccardReviewSessionInput = {
  workspaceName: string;
  topic: string;
  sequenceId: string;
  generationId: string;
  cardIds: string[];
};

export function buildDoccardPointerMessage(input: OpenDoccardReviewSessionInput): {
  text: string;
  docCardSequence: NonNullable<SessionTranscriptMessage['docCardSequence']>;
} {
  const topicLabel = input.topic.trim();
  const text = `Generated ${input.cardIds.length} cards from ${input.workspaceName}${
    topicLabel ? ` on “${topicLabel}”` : ''
  }. Use prev/next to review.`;
  return {
    text,
    docCardSequence: {
      sequenceId: input.sequenceId,
      generationId: input.generationId,
      workspaceName: input.workspaceName,
      cardIds: [...input.cardIds],
    },
  };
}

export async function openDoccardReviewSession(input: OpenDoccardReviewSessionInput & {
  createSession: (createInput: CreateSessionInput) => Promise<SessionHandle>;
  bindSession: (
    session: SessionHandle,
    projectPath: string,
    sessionName: string,
    lineage: { kind: 'main'; depth: number; presentation: CreateSessionInput['presentation'] },
  ) => Promise<void>;
  getTranscriptStore: (sessionId: string, projectPath: string) => Promise<SessionTranscriptStore>;
}): Promise<{ sessionId: string }> {
  if (input.cardIds.length === 0) {
    throw new Error('DOC_CARD_SESSION_REQUIRES_CARDS');
  }
  const presentation = {
    kind: 'doccard-sequence' as const,
    sequenceId: input.sequenceId,
    generationId: input.generationId,
    workspaceName: input.workspaceName,
    cardIds: [...input.cardIds],
  };
  const session = await input.createSession({
    scope: { kind: 'general' },
    sessionName: `Doc cards: ${input.workspaceName}`,
    presentation,
  });
  await input.bindSession(session, '', `Doc cards: ${input.workspaceName}`, {
    kind: 'main',
    depth: 0,
    presentation,
  });
  const store = await input.getTranscriptStore(session.id, '');
  const pointer = buildDoccardPointerMessage(input);
  const now = new Date().toISOString();
  await store.appendMessage({
    id: `msg-doccards-${input.generationId}`,
    runtimeGenerationId: `doccards-${input.generationId}`,
    backendMessageId: `msg-doccards-${input.generationId}`,
    role: 'assistant',
    text: pointer.text,
    status: 'done',
    createdAt: now,
    metadata: { docCardSequence: pointer.docCardSequence },
  });
  return { sessionId: session.id };
}


