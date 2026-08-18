import type { Dispatch, SetStateAction } from 'react';
import type { HostPush, MediaAttachmentRef, RemoteTranscriptMessage } from '@piwin/contracts';

export type MobileMediaAttachment = MediaAttachmentRef;

export type RemotePermissionRequest = Extract<HostPush, { type: 'permission/request' }>;

export type MobileToolCall = {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  summary?: string | undefined;
  actionVerb?: string | undefined;
  command?: string | undefined;
  targetPaths?: string[] | undefined;
  output?: string | undefined;
  error?: string | undefined;
  durationMs?: number | undefined;
};

export type MobileTranscriptMessage = RemoteTranscriptMessage & {
  thinking?: string | undefined;
  toolCalls?: MobileToolCall[] | undefined;
  attachments?: MobileMediaAttachment[] | undefined;
};

export function readSessionMessages(response: { success: boolean; data?: unknown }): MobileTranscriptMessage[] {
  if (!response.success || !isRecord(response.data) || !Array.isArray(response.data.messages)) {
    return [];
  }
  return response.data.messages.filter(isRemoteTranscriptMessage).map(projectTranscriptMessage);
}

export function handleRemotePush(
  push: HostPush,
  activeSessionRef: { current: string | undefined },
  setMessages: Dispatch<SetStateAction<MobileTranscriptMessage[]>>,
  setRunId: Dispatch<SetStateAction<string | undefined>>,
  setPausedCheckpointId: Dispatch<SetStateAction<string | undefined>>,
  setPermissionRequest: Dispatch<SetStateAction<RemotePermissionRequest | undefined>>,
): void {
  const activeSessionId = activeSessionRef.current;
  if (push.type === 'permission/request') {
    if (activeSessionId === undefined || push.sessionId === activeSessionId) {
      setPermissionRequest(push);
    }
    return;
  }
  if (activeSessionId === undefined) {
    return;
  }

  if (push.type === 'run/terminal' && push.run.sessionId === activeSessionId) {
    setRunId(undefined);
    setPausedCheckpointId(undefined);
    return;
  }

  if (push.type === 'transcript/append' && push.sessionId === activeSessionId) {
    const candidate = push.message as unknown;
    if (isRemoteTranscriptMessage(candidate)) {
      setMessages((current) => upsertMessage(current, candidate));
    }
    return;
  }

  if (push.type !== 'event' || push.sessionId !== activeSessionId) {
    return;
  }

  const event = push.event;
  if (event.type === 'permission/request') {
    setPermissionRequest({
      type: 'permission/request',
      sessionId: activeSessionId,
      requestId: event.requestId,
      action: event.action,
      detail: event.detail,
      defaultDecision: event.defaultDecision,
      ...(event.context === undefined ? {} : { context: event.context }),
      ...(event.runId === undefined ? {} : { runId: event.runId }),
    });
    return;
  }
  if (event.type === 'permission/resolved') {
    setPermissionRequest((current) =>
      current?.requestId === event.requestId ? undefined : current,
    );
  }
  if (event.type === 'message/start') {
    const message: MobileTranscriptMessage = {
      id: event.messageId,
      role: event.role,
      text: '',
      createdAt: new Date().toISOString(),
      status: 'streaming',
    };
    if (event.runId !== undefined) {
      message.runId = event.runId;
      setRunId(event.runId);
    }
    setMessages((current) => upsertMessage(current, message));
  } else if (event.type === 'message/thinking_delta') {
    setMessages((current) =>
      updateMessage(current, event.messageId, (message) => ({
        ...message,
        thinking: `${message.thinking ?? ''}${event.delta}`,
        status: 'streaming',
      })),
    );
  } else if (event.type === 'message/text_delta') {
    setMessages((current) =>
      updateMessage(current, event.messageId, (message) => ({
        ...message,
        text: `${message.text}${event.delta}`,
        status: 'streaming',
      })),
    );
  } else if (event.type === 'message/text_snapshot') {
    setMessages((current) =>
      updateMessage(current, event.messageId, (message) => ({
        ...message,
        text: event.text,
        status: 'streaming',
      })),
    );
  } else if (event.type === 'message/end') {
    setMessages((current) =>
      updateMessage(current, event.messageId, (message) => ({ ...message, status: 'done' })),
    );
    setRunId(undefined);
  } else if (event.type === 'tool/start') {
    const toolCall: MobileToolCall = {
      id: event.toolCallId,
      name: event.toolName,
      status: 'running',
      summary: event.presentation?.summary,
      actionVerb: event.presentation?.actionVerb,
      command: event.presentation?.command,
      targetPaths: event.presentation?.targetPaths,
      durationMs: event.presentation?.durationMs,
    };
    setMessages((current) => {
      const msgId =
        event.responseMessageId ?? current.filter((item) => item.role === 'assistant').slice(-1)[0]?.id;
      if (!msgId) return current;
      return updateMessage(current, msgId, (message) => {
        const existing = message.toolCalls ?? [];
        const index = existing.findIndex((item: MobileToolCall) => item.id === event.toolCallId);
        const updated =
          index === -1
            ? [...existing, toolCall]
            : existing.map((item: MobileToolCall, itemIndex: number) =>
                itemIndex === index ? { ...item, ...toolCall } : item,
              );
        return { ...message, toolCalls: updated };
      });
    });
  } else if (event.type === 'tool/update') {
    setMessages((current) => {
      const msgId =
        event.responseMessageId ?? current.filter((item) => item.role === 'assistant').slice(-1)[0]?.id;
      if (!msgId) return current;
      return updateMessage(current, msgId, (message) => {
        const existing = message.toolCalls ?? [];
        const updated = existing.map((item: MobileToolCall) => {
          if (item.id !== event.toolCallId) return item;
          return {
            ...item,
            summary: event.presentation?.summary ?? item.summary,
            actionVerb: event.presentation?.actionVerb ?? item.actionVerb,
            command: event.presentation?.command ?? item.command,
            output: event.presentation?.output?.text ?? `${item.output ?? ''}${event.delta}`,
          };
        });
        return { ...message, toolCalls: updated };
      });
    });
  } else if (event.type === 'tool/end') {
    setMessages((current) => {
      const msgId =
        event.responseMessageId ?? current.filter((item) => item.role === 'assistant').slice(-1)[0]?.id;
      if (!msgId) return current;
      return updateMessage(current, msgId, (message) => {
        const existing = message.toolCalls ?? [];
        const updated = existing.map((item: MobileToolCall) => {
          if (item.id !== event.toolCallId) return item;
          return {
            ...item,
            status: (event.isError ? 'error' : 'done') as 'done' | 'error',
            summary: event.presentation?.summary ?? item.summary,
            actionVerb: event.presentation?.actionVerb ?? item.actionVerb,
            command: event.presentation?.command ?? item.command,
            targetPaths: event.presentation?.targetPaths ?? item.targetPaths,
            output: event.presentation?.output?.text ?? item.output,
            error: event.presentation?.error?.message ?? (event.isError ? '执行失败' : undefined),
            durationMs: event.presentation?.durationMs ?? item.durationMs,
          };
        });
        return { ...message, toolCalls: updated };
      });
    });
  } else if (event.type === 'session/aborted') {
    setRunId(undefined);
  }
}

function projectTranscriptMessage(raw: unknown): MobileTranscriptMessage {
  const msg = raw as Record<string, unknown>;
  const rawTools = msg.tools ?? msg.toolCalls;
  const toolCalls: MobileToolCall[] | undefined = Array.isArray(rawTools)
    ? rawTools.map((rawTool: unknown) => {
        const tool = rawTool as Record<string, unknown>;
        const pres = isRecord(tool.presentation) ? tool.presentation : undefined;
        const outputPres = pres && isRecord(pres.output) ? (pres.output.text as string) : undefined;
        const errorPres = pres && isRecord(pres.error) ? (pres.error.message as string) : undefined;
        return {
          id: typeof tool.toolCallId === 'string' ? tool.toolCallId : String(tool.id || Math.random()),
          name:
            typeof tool.toolName === 'string'
              ? tool.toolName
              : typeof tool.name === 'string'
                ? tool.name
                : 'tool',
          status: (tool.status === 'running' || tool.status === 'error' ? tool.status : 'done') as
            | 'running'
            | 'done'
            | 'error',
          summary:
            typeof pres?.summary === 'string'
              ? pres.summary
              : typeof tool.summary === 'string'
                ? tool.summary
                : undefined,
          actionVerb:
            typeof pres?.actionVerb === 'string'
              ? pres.actionVerb
              : typeof tool.actionVerb === 'string'
                ? tool.actionVerb
                : undefined,
          command:
            typeof pres?.command === 'string'
              ? pres.command
              : typeof tool.command === 'string'
                ? tool.command
                : undefined,
          targetPaths: Array.isArray(pres?.targetPaths)
            ? (pres.targetPaths as string[])
            : Array.isArray(tool.targetPaths)
              ? (tool.targetPaths as string[])
              : undefined,
          output: outputPres ?? (typeof tool.output === 'string' ? tool.output : undefined),
          error: errorPres ?? (tool.status === 'error' ? '执行失败' : undefined),
          durationMs:
            typeof pres?.durationMs === 'number'
              ? pres.durationMs
              : typeof tool.durationMs === 'number'
                ? tool.durationMs
                : undefined,
        };
      })
    : undefined;

  return {
    ...(msg as unknown as RemoteTranscriptMessage),
    ...(typeof msg.thinking === 'string' ? { thinking: msg.thinking } : {}),
    ...(toolCalls !== undefined ? { toolCalls } : {}),
  };
}

function upsertMessage(
  messages: MobileTranscriptMessage[],
  message: MobileTranscriptMessage,
): MobileTranscriptMessage[] {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index === -1) {
    return [...messages, message];
  }
  return messages.map((item, itemIndex) => (itemIndex === index ? message : item));
}

function updateMessage(
  messages: MobileTranscriptMessage[],
  messageId: string,
  update: (message: MobileTranscriptMessage) => MobileTranscriptMessage,
): MobileTranscriptMessage[] {
  if (!messages.some((message) => message.id === messageId)) {
    const placeholder: MobileTranscriptMessage = {
      id: messageId,
      role: 'assistant',
      text: '',
      createdAt: new Date().toISOString(),
      status: 'streaming',
    };
    return [...messages, placeholder].map((message) =>
      message.id === messageId ? update(message) : message,
    );
  }
  return messages.map((message) => (message.id === messageId ? update(message) : message));
}

function isRemoteTranscriptMessage(value: unknown): value is RemoteTranscriptMessage {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (value.role === 'user' ||
      value.role === 'assistant' ||
      value.role === 'system' ||
      value.role === 'tool') &&
    typeof value.text === 'string' &&
    typeof value.createdAt === 'string' &&
    (value.status === 'streaming' || value.status === 'done' || value.status === 'error')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
