import type { MediaAttachmentRef, PromptInput } from '@piwin/contracts';
import { USER_AUTHORED_GENERATION } from '@piwin/contracts';
import type { SessionTranscriptStore, TranscriptStoreAppendResult } from '@piwin/session';

export function appendUserPromptToTranscriptStore(options: {
  store: SessionTranscriptStore;
  input: PromptInput;
  messageId: string;
  createdAt: string;
}): Promise<TranscriptStoreAppendResult> {
  const attachments = options.input.attachments?.filter(
    (attachment): attachment is MediaAttachmentRef => attachment.kind === 'media',
  );
  const contextRefs =
    options.input.contextRefs && options.input.contextRefs.length > 0
      ? options.input.contextRefs.map((ref) => ({ ...ref }))
      : undefined;
  return options.store.appendMessage({
    id: options.messageId,
    runtimeGenerationId: USER_AUTHORED_GENERATION,
    backendMessageId: options.messageId,
    role: 'user',
    text: options.input.text,
    status: 'done',
    createdAt: options.createdAt,
    ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
    ...(contextRefs !== undefined ? { contextRefs } : {}),
    ...(options.input.source === 'voice-delegation' || options.input.skillId
      ? {
          metadata: {
            ...(options.input.source === 'voice-delegation'
              ? {
                  promptSource: 'voice-delegation' as const,
                  ...(options.input.voiceCallId ? { voiceCallId: options.input.voiceCallId } : {}),
                }
              : {}),
            ...(options.input.skillId ? { skillId: options.input.skillId } : {}),
          },
        }
      : {}),
  });
}
