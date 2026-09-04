import type { HostCommand, HostResponse, ModelRef, ThinkingLevel } from '@piwin/contracts';
import { requestPromptWithForeground } from './prompt-foreground.js';

export type SideChatHostRequest = (
  command: HostCommand,
  options?: { idempotencyKey?: string },
) => Promise<HostResponse>;

export async function sendSideChatPrompt(args: {
  request: SideChatHostRequest;
  sessionId: string;
  text: string;
  createIdempotencyKey: () => string;
  remoteForegroundAdmission?: boolean;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
}): Promise<HostResponse> {
  return requestPromptWithForeground({
    request: args.request,
    sessionId: args.sessionId,
    input: {
      text: args.text,
      ...(args.model ? { model: args.model } : {}),
      ...(args.thinkingLevel !== undefined ? { thinkingLevel: args.thinkingLevel } : {}),
    },
    allowReplaceConfirm: false,
    createIdempotencyKey: args.createIdempotencyKey,
    ...(args.remoteForegroundAdmission === undefined
      ? {}
      : { remoteForegroundAdmission: args.remoteForegroundAdmission }),
  });
}

export async function abortSideChatRun(args: {
  request: SideChatHostRequest;
  sessionId: string;
  runId: string | null;
  createIdempotencyKey: () => string;
}): Promise<HostResponse | undefined> {
  const runId = args.runId?.trim() ?? '';
  if (runId.length === 0) {
    return undefined;
  }
  return args.request(
    { type: 'session/abort', sessionId: args.sessionId, runId },
    { idempotencyKey: args.createIdempotencyKey() },
  );
}
