/**
 * After a completed foreground run, optionally rewrite the visible assistant
 * reply with the configured writer model (spec: reply-writer).
 */
import type {
  ModelRef,
  ReplyWriterAttribution,
  ReplyWriterLanguage,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import { formatError, isReplyWriterLanguage, shouldRewriteReply } from '@piwin/contracts';
import { getSessionRecord } from '@piwin/session';
import type { TranscriptStoreMessageInput } from '@piwin/session';
import { findEnabledProvider } from '../provider-helpers.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from '../paths.js';
import {
  assembleReplyWriterSystemPrompt,
  assembleReplyWriterUserPrompt,
  boundReplyWriterSourceText,
  completeReplyWriter,
} from '../reply-writer.js';
import type { StructuredCompletionDependencies } from '../structured-completion.js';
import type { SessionLiveContext } from './session-live-context.js';

export type ReplyWriterLiveDependencies = StructuredCompletionDependencies;

export async function scheduleReplyWriterAfterRun(
  context: SessionLiveContext,
  input: { sessionId: string; runId: string },
  dependencies: ReplyWriterLiveDependencies = {},
): Promise<void> {
  try {
    await rewriteCompletedReply(context, input, dependencies);
  } catch (error) {
    context.push({
      type: 'host/log',
      level: 'warn',
      message: `reply writer failed: ${formatError(error)}`,
    });
  }
}

async function rewriteCompletedReply(
  context: SessionLiveContext,
  input: { sessionId: string; runId: string },
  dependencies: ReplyWriterLiveDependencies,
): Promise<void> {
  const config = await context.loadConfig();
  if (!config.replyWriter?.enabled || !config.replyWriter.model) {
    return;
  }
  let sessionKind: 'main' | 'subagent' | 'side-chat' | undefined;
  try {
    const record = await getSessionRecord(
      getPiwinSessionIndexPath(getPiwinRoot(context.piwinRoot)),
      input.sessionId,
    );
    sessionKind = record?.kind;
  } catch {
    sessionKind = undefined;
  }
  const store = await context.getTranscriptStore(input.sessionId);
  const assistant = await store.lastMessageByRole('assistant');
  if (!assistant || assistant.runId !== input.runId) {
    return;
  }
  const writerModel = config.replyWriter.model;
  if (
    !shouldRewriteReply({
      config: config.replyWriter,
      assistantText: assistant.text,
      ...(assistant.model ? { workerModel: assistant.model } : {}),
      ...(sessionKind ? { sessionKind } : {}),
    })
  ) {
    return;
  }
  const provider = findEnabledProvider(config, writerModel.providerId);
  if (!provider || !provider.models.some((model) => model.id === writerModel.modelId)) {
    context.push({
      type: 'host/log',
      level: 'warn',
      message: `reply writer skipped: writer model ${writerModel.providerId}/${writerModel.modelId} is not available`,
    });
    return;
  }

  context.push({
    type: 'reply-writer/updated',
    sessionId: input.sessionId,
    messageId: assistant.id,
    status: 'started',
  });

  const language: ReplyWriterLanguage = isReplyWriterLanguage(config.replyWriter?.language)
    ? config.replyWriter.language
    : 'zh-CN';
  const user = await store.lastMessageByRole('user');
  const timeout = new AbortController();
  try {
    const rewritten = await completeReplyWriter({
      provider,
      model: writerModel,
      systemPrompt: assembleReplyWriterSystemPrompt(config.replyWriter),
      userPrompt: assembleReplyWriterUserPrompt({
        language,
        evidence: {
          userText: user?.text ?? '',
          draftText: assistant.text,
          tools: (assistant.tools ?? []).map((tool) => ({
            name: tool.toolName,
            output: tool.output,
          })),
        },
      }),
      ...(config.replyWriter?.timeoutMs !== undefined
        ? { timeoutMs: config.replyWriter.timeoutMs }
        : {}),
      signal: timeout.signal,
      dependencies,
    });
    if (await store.hasLaterAssistant(assistant.id)) {
      context.push({
        type: 'reply-writer/updated',
        sessionId: input.sessionId,
        messageId: assistant.id,
        status: 'failed',
      });
      return;
    }
    const latest = await store.getMessage(assistant.id);
    if (!latest) {
      context.push({
        type: 'reply-writer/updated',
        sessionId: input.sessionId,
        messageId: assistant.id,
        status: 'failed',
      });
      return;
    }
    const attribution: ReplyWriterAttribution = {
      model: writerModel,
      language,
      sourceText: boundReplyWriterSourceText(latest.text),
    };
    const updated = await store.updateMessage(assistant.id, {
      text: rewritten,
      metadata: mergeTranscriptMetadata(latest, attribution),
    });
    if (!updated) {
      context.push({
        type: 'reply-writer/updated',
        sessionId: input.sessionId,
        messageId: assistant.id,
        status: 'failed',
      });
      return;
    }
    context.push({
      type: 'event',
      sessionId: input.sessionId,
      event: {
        type: 'message/text_snapshot',
        messageId: assistant.id,
        text: rewritten,
        runId: input.runId,
      },
    });
    context.push({
      type: 'reply-writer/updated',
      sessionId: input.sessionId,
      messageId: assistant.id,
      status: 'applied',
      model: writerModel,
      language,
    });
  } catch (error) {
    context.push({
      type: 'reply-writer/updated',
      sessionId: input.sessionId,
      messageId: assistant.id,
      status: 'failed',
    });
    throw error;
  } finally {
    timeout.abort();
  }
}

export function mergeTranscriptMetadata(
  message: SessionTranscriptMessage,
  replyWriter: ReplyWriterAttribution,
): NonNullable<TranscriptStoreMessageInput['metadata']> {
  const metadata: NonNullable<TranscriptStoreMessageInput['metadata']> = { replyWriter };
  if (message.phaseHistory) metadata.phaseHistory = message.phaseHistory;
  if (message.startedAt) metadata.startedAt = message.startedAt;
  if (message.endedAt) metadata.endedAt = message.endedAt;
  if (message.thinkingStartedAt) metadata.thinkingStartedAt = message.thinkingStartedAt;
  if (message.thinkingEndedAt) metadata.thinkingEndedAt = message.thinkingEndedAt;
  if (message.outcome) metadata.outcome = message.outcome;
  if (message.terminalMessage) metadata.terminalMessage = message.terminalMessage;
  if (message.subagentActivity) metadata.subagentActivity = message.subagentActivity;
  if (message.searchEvidence) metadata.searchEvidence = message.searchEvidence;
  if (message.instructionDelivery) metadata.instructionDelivery = message.instructionDelivery;
  if (message.docCardSequence) metadata.docCardSequence = message.docCardSequence;
  return metadata;
}
