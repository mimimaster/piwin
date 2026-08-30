import { randomUUID } from 'node:crypto';
import {
  ABORTED_PROMPT_OUTCOME,
  COMPLETED_STOP_OUTCOME,
  type AgentEvent,
  type AgentMessageView,
  BackendRunIntervention,
  BackendRunInterventionEvent,
  BackendRunInterventionEventResult,
  CreateSessionInput,
  PromptInput,
  SessionCompactResult,
  SessionHandle,
  SessionSeedMessage,
  SessionTranscriptMessage,
  SessionTreeView,
} from '@piwin/contracts';
import { estimateMockUsage } from '@piwin/agent-host';

type Listener = (event: AgentEvent) => void;
type InterventionListener = (
  event: BackendRunInterventionEvent,
) => Promise<BackendRunInterventionEventResult>;

export type CreateMockSessionOptions = CreateSessionInput & {
  /** Stable product session id for cross-process resume. */
  sessionId?: string;
  /** Seed messages shown after resume (not re-emitted as events). */
  seedMessages?: readonly (SessionTranscriptMessage | SessionSeedMessage)[];
};

/**
 * Offline SessionHandle for CLI --mock and unit tests.
 * Emits a deterministic text stream without calling Pi or network.
 */
export function createMockSessionHandle(input: CreateMockSessionOptions): SessionHandle {
  const sessionId = input.sessionId ?? randomUUID();
  const listeners = new Set<Listener>();
  const interventionListeners = new Set<InterventionListener>();
  const stagedInterventions = new Map<string, BackendRunIntervention>();
  const messages: AgentMessageView[] = (input.seedMessages ?? []).map(seedMessageToView);
  let aborted = false;
  let autoCompactionEnabled = true;
  let compacting = false;

  const emit = (event: AgentEvent): void => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  const notifyIntervention = async (
    event: BackendRunInterventionEvent,
  ): Promise<BackendRunInterventionEventResult> => {
    if (interventionListeners.size === 0) return { accepted: false };
    for (const listener of interventionListeners) {
      try {
        const result = await listener(event);
        if (!result.accepted) return result;
      } catch {
        return { accepted: false };
      }
    }
    return { accepted: true };
  };

  const expireStagedInterventions = async (): Promise<void> => {
    const pending = [...stagedInterventions.values()];
    stagedInterventions.clear();
    for (const intervention of pending) {
      await notifyIntervention({
        type: 'expired',
        interventionId: intervention.interventionId,
        revision: intervention.revision,
        runId: intervention.runId,
        runtimeGenerationId: intervention.runtimeGenerationId,
        reason: 'run-ended',
      });
    }
  };

  const emitInterventionReply = async (intervention: BackendRunIntervention): Promise<boolean> => {
    const userMessageId = randomUUID();
    const assistantMessageId = randomUUID();
    const reply = buildMockReply(intervention.text, resolveMockLocationLabel(input));
    const startedAt = Date.now();
    messages.push(
      {
        id: userMessageId,
        role: 'user',
        text: intervention.text,
        createdAt: new Date().toISOString(),
      },
      {
        id: assistantMessageId,
        role: 'assistant',
        text: reply,
        createdAt: new Date().toISOString(),
      },
    );
    emit({ type: 'message/start', messageId: userMessageId, role: 'user' });
    const applied = await notifyIntervention({
      type: 'applied',
      interventionId: intervention.interventionId,
      revision: intervention.revision + 1,
      runId: intervention.runId,
      runtimeGenerationId: intervention.runtimeGenerationId,
    });
    emit({ type: 'message/end', messageId: userMessageId });
    if (!applied.accepted || aborted) return false;

    emit({ type: 'message/start', messageId: assistantMessageId, role: 'assistant' });
    let assembled = '';
    for (const chunk of chunkText(reply, 24)) {
      if (aborted) {
        emit({ type: 'session/aborted', sessionId, messageId: assistantMessageId });
        return false;
      }
      assembled += chunk;
      emit({ type: 'message/text_delta', messageId: assistantMessageId, delta: chunk });
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 8);
      });
    }
    emit({ type: 'message/end', messageId: assistantMessageId });
    const nativePayload = JSON.stringify({
      role: 'assistant',
      content: [{ type: 'text', text: assembled }],
      timestamp: Date.now(),
    });
    emit({
      type: 'message/native_context',
      messageId: assistantMessageId,
      role: 'assistant',
      entry: {
        format: 'pi-message-v1',
        payload: nativePayload,
        byteLength: Buffer.byteLength(nativePayload, 'utf8'),
      },
    });
    const interventionUsage = estimateMockUsage(
      sessionId,
      intervention.text,
      reply,
      Math.max(1, Date.now() - startedAt),
    );
    emit({
      type: 'usage/finalized',
      measurement: {
        measurementId: `${sessionId}:mock:${assistantMessageId}`,
        sessionId,
        messageId: assistantMessageId,
        totalTokens: interventionUsage.totalTokens ?? interventionUsage.tokensUsed ?? 0,
        recordedAt: interventionUsage.updatedAt,
        ...(interventionUsage.promptTokens !== undefined
          ? { promptTokens: interventionUsage.promptTokens }
          : {}),
        ...(interventionUsage.completionTokens !== undefined
          ? { completionTokens: interventionUsage.completionTokens }
          : {}),
        ...(interventionUsage.durationMs !== undefined
          ? { durationMs: interventionUsage.durationMs }
          : {}),
      },
    });
    return true;
  };

  const drainRunInterventions = async (): Promise<void> => {
    while (!aborted) {
      const candidate = [...stagedInterventions.values()].sort(
        (left, right) => left.sequence - right.sequence,
      )[0];
      if (candidate === undefined) return;
      const claim = await notifyIntervention({
        type: 'claim',
        interventionId: candidate.interventionId,
        revision: candidate.revision,
        runId: candidate.runId,
        runtimeGenerationId: candidate.runtimeGenerationId,
      });
      if (!claim.accepted) {
        if (stagedInterventions.get(candidate.interventionId) === candidate) {
          stagedInterventions.delete(candidate.interventionId);
          await notifyIntervention({
            type: 'failed',
            interventionId: candidate.interventionId,
            revision: candidate.revision,
            runId: candidate.runId,
            runtimeGenerationId: candidate.runtimeGenerationId,
            reason: 'claim-rejected',
          });
        }
        return;
      }
      if (stagedInterventions.get(candidate.interventionId) !== candidate) {
        await notifyIntervention({
          type: 'failed',
          interventionId: candidate.interventionId,
          revision: candidate.revision + 1,
          runId: candidate.runId,
          runtimeGenerationId: candidate.runtimeGenerationId,
          reason: 'staging-changed-after-claim',
        });
        return;
      }
      stagedInterventions.delete(candidate.interventionId);
      if (!(await emitInterventionReply(candidate))) return;
    }
  };

  return {
    id: sessionId,
    async prompt(promptInput: PromptInput) {
      aborted = false;
      try {
        const userMessageId = randomUUID();
        const assistantMessageId = randomUUID();
        const userText = promptInput.text.trim() || '(empty)';
        const startedAt = Date.now();

        const userMessage: AgentMessageView = {
          id: userMessageId,
          role: 'user',
          text: userText,
          createdAt: new Date().toISOString(),
        };
        if (promptInput.attachments && promptInput.attachments.length > 0) {
          userMessage.attachments = promptInput.attachments;
        }
        messages.push(userMessage);

        emit({ type: 'message/start', messageId: userMessageId, role: 'user' });
        emit({ type: 'message/end', messageId: userMessageId });

        if (aborted) {
          return ABORTED_PROMPT_OUTCOME;
        }

        const locationLabel = resolveMockLocationLabel(input);
        const reply = buildMockReply(userText, locationLabel);
        messages.push({
          id: assistantMessageId,
          role: 'assistant',
          text: reply,
          createdAt: new Date().toISOString(),
        });

        emit({ type: 'message/start', messageId: assistantMessageId, role: 'assistant' });

        const toolCallId = randomUUID();
        emit({ type: 'tool/start', toolCallId, toolName: 'mock_echo' });
        emit({ type: 'tool/update', toolCallId, delta: `echo: ${userText.slice(0, 80)}` });
        emit({ type: 'tool/end', toolCallId, isError: false });

        let assembled = '';
        for (const chunk of chunkText(reply, 24)) {
          if (aborted) {
            const existing = messages.find((message) => message.id === assistantMessageId);
            if (existing) {
              existing.text = assembled;
            }
            emit({
              type: 'session/aborted',
              sessionId,
              messageId: assistantMessageId,
            });
            return ABORTED_PROMPT_OUTCOME;
          }
          assembled += chunk;
          emit({ type: 'message/text_delta', messageId: assistantMessageId, delta: chunk });
          // Yield so concurrent abort() can land between chunks.
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 8);
          });
        }

        if (aborted) {
          const existing = messages.find((message) => message.id === assistantMessageId);
          if (existing) {
            existing.text = assembled;
          }
          emit({ type: 'session/aborted', sessionId, messageId: assistantMessageId });
          return ABORTED_PROMPT_OUTCOME;
        }

        emit({ type: 'message/end', messageId: assistantMessageId });
        // Mirror the real backend's native context copy so mock mode exercises
        // the host-internal persistence path and the client egress filter.
        const nativePayload = JSON.stringify({
          role: 'assistant',
          content: [{ type: 'text', text: assembled }],
          timestamp: Date.now(),
        });
        emit({
          type: 'message/native_context',
          messageId: assistantMessageId,
          role: 'assistant',
          entry: {
            format: 'pi-message-v1',
            payload: nativePayload,
            byteLength: Buffer.byteLength(nativePayload, 'utf8'),
          },
        });
        const usage = estimateMockUsage(
          sessionId,
          userText,
          reply,
          Math.max(1, Date.now() - startedAt),
        );
        emit({
          type: 'context/measurement',
          measurement: {
            sessionId,
            messageId: assistantMessageId,
            sampleSequence: 1,
            occupancy: {
              kind: 'known',
              tokensUsed: usage.tokensUsed ?? usage.totalTokens ?? 0,
              ...(usage.tokensLimit !== undefined ? { tokensLimit: usage.tokensLimit } : {}),
              quality: 'estimated',
              coverage: 'partial',
              basis: 'mock-estimate',
              sampledAt: usage.updatedAt,
            },
            contextBoundary: { activeLeafMessageId: assistantMessageId },
            sampledAt: usage.updatedAt,
          },
        });
        emit({
          type: 'usage/finalized',
          measurement: {
            measurementId: `${sessionId}:mock:${assistantMessageId}`,
            sessionId,
            messageId: assistantMessageId,
            totalTokens: usage.totalTokens ?? usage.tokensUsed ?? 0,
            recordedAt: usage.updatedAt,
            ...(usage.promptTokens !== undefined ? { promptTokens: usage.promptTokens } : {}),
            ...(usage.completionTokens !== undefined
              ? { completionTokens: usage.completionTokens }
              : {}),
            ...(usage.durationMs !== undefined ? { durationMs: usage.durationMs } : {}),
          },
        });
        await drainRunInterventions();
      } finally {
        await expireStagedInterventions();
      }
      return COMPLETED_STOP_OUTCOME;
    },
    async steer(message: string): Promise<void> {
      emit({
        type: 'error',
        message: `mock steer ignored: ${message}`,
        retriable: false,
      });
    },
    async followUp(message: string): Promise<void> {
      await this.prompt({ text: message, streamingBehavior: 'followUp' });
    },
    async armRunIntervention(intervention): Promise<void> {
      if (intervention.sessionId !== sessionId) {
        throw new Error('run-intervention-backend-mismatch');
      }
      const existing = stagedInterventions.get(intervention.interventionId);
      if (existing !== undefined && existing.revision > intervention.revision) {
        throw new Error('run-intervention-stale-revision');
      }
      if (existing !== undefined && existing.revision === intervention.revision) {
        if (
          existing.runId !== intervention.runId ||
          existing.runtimeGenerationId !== intervention.runtimeGenerationId ||
          existing.sequence !== intervention.sequence ||
          existing.text !== intervention.text
        ) {
          throw new Error('run-intervention-revision-payload-mismatch');
        }
        return;
      }
      stagedInterventions.set(intervention.interventionId, intervention);
    },
    async cancelRunIntervention(interventionId, expectedRevision): Promise<boolean> {
      const existing = stagedInterventions.get(interventionId);
      if (existing === undefined || existing.revision !== expectedRevision) return false;
      stagedInterventions.delete(interventionId);
      return true;
    },
    subscribeRunInterventions(listener): () => void {
      interventionListeners.add(listener);
      return () => interventionListeners.delete(listener);
    },
    async abort(): Promise<void> {
      aborted = true;
    },
    async compact(customInstructions?: string): Promise<SessionCompactResult> {
      if (compacting) {
        return { ok: false, message: 'compaction already running' };
      }
      compacting = true;
      const startedAt = Date.now();
      emit({ type: 'compaction/start' });
      await new Promise((resolve) => setTimeout(resolve, 30));
      compacting = false;
      const detail =
        typeof customInstructions === 'string' && customInstructions.trim()
          ? `mock compacted (${customInstructions.trim().slice(0, 80)})`
          : 'mock compacted';
      const durationMs = Date.now() - startedAt;
      const result: SessionCompactResult = {
        ok: true,
        message: detail,
        summary: 'Mock summary of prior turns for UI testing.',
        tokensBefore: 8000,
        tokensAfter: 2500,
        durationMs,
      };
      emit({
        type: 'compaction/end',
        ok: true,
        message: detail,
        summary: 'Mock summary of prior turns for UI testing.',
        tokensBefore: 8000,
        tokensAfter: 2500,
        durationMs,
      });
      return result;
    },
    abortCompaction(): void {
      compacting = false;
      emit({ type: 'compaction/end', ok: false, message: 'compaction aborted' });
    },
    getAutoCompactionEnabled(): boolean {
      return autoCompactionEnabled;
    },
    setAutoCompactionEnabled(enabled: boolean): void {
      autoCompactionEnabled = enabled;
    },
    async getMessages(): Promise<AgentMessageView[]> {
      return [...messages];
    },
    async getTree(): Promise<SessionTreeView> {
      return { root: null, activeLeafId: null };
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function seedMessageToView(
  message: SessionTranscriptMessage | SessionSeedMessage,
): AgentMessageView {
  const view: AgentMessageView = {
    id: 'id' in message ? message.id : randomUUID(),
    role: message.role,
    text: message.text,
    createdAt:
      'createdAt' in message ? message.createdAt : new Date(message.timestamp).toISOString(),
  };
  if ('attachments' in message && message.attachments && message.attachments.length > 0) {
    view.attachments = message.attachments;
  }
  return view;
}

function resolveMockLocationLabel(input: CreateMockSessionOptions): string {
  if (input.scope?.kind === 'general') {
    return 'general';
  }
  if (input.scope?.kind === 'project') {
    return input.scope.projectPath;
  }
  if (input.projectPath && input.projectPath.trim().length > 0) {
    return input.projectPath;
  }
  return 'general';
}

function buildMockReply(userText: string, projectPath: string): string {
  return [
    'piwin mock host reply.',
    `project: ${projectPath}`,
    `you said: ${userText}`,
    'event pipeline: message/start → tool/* → text_delta → message/end',
  ].join('\n');
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks.length > 0 ? chunks : [''];
}
