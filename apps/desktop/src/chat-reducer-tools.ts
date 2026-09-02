import type { MediaAttachmentRef, ToolPresentation } from '@piwin/contracts';
import {
  appendBoundedText,
  createBoundedTextAccumulator,
  type BoundedTextAccumulator,
} from './bounded-text-accumulator';
import type { ChatMessageUi, ChatUiState, ToolCardUi } from './chat-ui-types';

const MAX_RETAINED_TOOL_OUTPUT_BYTES = 256 * 1024;
const TOOL_OUTPUT_TRUNCATION_MARKER = '\n[output truncated: retention limit reached]';
const TOOL_OUTPUT_RETENTION_OPTIONS = {
  maximumBytes: MAX_RETAINED_TOOL_OUTPUT_BYTES,
  truncationMarker: TOOL_OUTPUT_TRUNCATION_MARKER,
} as const;

export function updateMessage(
  state: ChatUiState,
  messageId: string,
  updater: (message: ChatMessageUi) => ChatMessageUi,
): ChatUiState {
  return {
    ...state,
    messages: state.messages.map((message) =>
      message.id === messageId ? updater(message) : message,
    ),
  };
}

export function startMessageThinking(message: ChatMessageUi, startedAt: number): ChatMessageUi {
  if (message.thinkingStartedAt !== undefined) {
    return message;
  }
  return { ...message, thinkingStartedAt: startedAt };
}

export function finishMessageThinking(message: ChatMessageUi, endedAt: number): ChatMessageUi {
  if (message.thinkingStartedAt === undefined || message.thinkingEndedAt !== undefined) {
    return message;
  }
  return {
    ...message,
    thinkingEndedAt: Math.max(message.thinkingStartedAt, endedAt),
  };
}

/**
 * Prefer the assistant message that owns this run; fall back only for legacy
 * events without runId to the latest assistant bubble still streaming/open.
 */
export function findAssistantMessageForToolStart(
  state: ChatUiState,
  runId: string | undefined,
  responseMessageId: string | undefined,
): ChatMessageUi | undefined {
  if (responseMessageId !== undefined) {
    return state.messages.find(
      (message) => message.role === 'assistant' && message.id === responseMessageId,
    );
  }
  if (runId !== undefined) {
    const byRun = [...state.messages]
      .reverse()
      .find((message) => message.role === 'assistant' && message.runId === runId);
    if (byRun) {
      return byRun;
    }
    // Active run may have started before message/start linked runId — use the
    // latest assistant that is still streaming when it matches the active run.
    if (state.activeRunId === runId) {
      return [...state.messages]
        .reverse()
        .find(
          (message) =>
            message.role === 'assistant' &&
            message.runId === undefined &&
            message.status === 'streaming',
        );
    }
    return undefined;
  }
  return [...state.messages].reverse().find((message) => message.role === 'assistant');
}

/** Update a tool only on the owning message/run, never the first global match. */
export function updateOwnedTool(
  state: ChatUiState,
  toolCallId: string,
  runId: string | undefined,
  responseMessageId: string | undefined,
  updater: (tool: ToolCardUi) => ToolCardUi,
): ChatUiState {
  let matched = false;
  const nextMessages = state.messages.map((message) => {
    if (matched) {
      return message;
    }
    if (responseMessageId !== undefined && message.id !== responseMessageId) {
      return message;
    }
    const toolIndex = message.tools.findIndex((tool) => {
      if (tool.toolCallId !== toolCallId) {
        return false;
      }
      if (runId === undefined) {
        return true;
      }
      // Prefer tools that recorded the same run; also allow tools that predate run tagging.
      return tool.runId === undefined || tool.runId === runId;
    });
    if (toolIndex < 0) {
      return message;
    }
    if (runId !== undefined && message.runId !== undefined && message.runId !== runId) {
      return message;
    }
    if (
      runId !== undefined &&
      message.runId === undefined &&
      (state.activeRunId !== runId || message.status !== 'streaming')
    ) {
      return message;
    }
    matched = true;
    return {
      ...message,
      tools: message.tools.map((tool, index) => (index === toolIndex ? updater(tool) : tool)),
    };
  });
  if (!matched) {
    return state;
  }
  return { ...state, messages: nextMessages };
}

/** Add generated media to the assistant message that owns the tool call. */
export function appendGeneratedAttachmentsToToolOwner(
  state: ChatUiState,
  toolCallId: string,
  runId: string | undefined,
  responseMessageId: string | undefined,
  attachments: readonly MediaAttachmentRef[],
): ChatUiState {
  let matched = false;
  const nextMessages = state.messages.map((message) => {
    if (matched) {
      return message;
    }
    if (responseMessageId !== undefined && message.id !== responseMessageId) {
      return message;
    }
    const toolMatches = message.tools.some(
      (tool) =>
        tool.toolCallId === toolCallId &&
        (runId === undefined || tool.runId === undefined || tool.runId === runId),
    );
    if (!toolMatches) {
      return message;
    }
    if (runId !== undefined && message.runId !== undefined && message.runId !== runId) {
      return message;
    }
    if (
      runId !== undefined &&
      message.runId === undefined &&
      (state.activeRunId !== runId || message.status !== 'streaming')
    ) {
      return message;
    }

    matched = true;
    const existingIds = new Set(message.attachments.map((attachment) => attachment.id));
    const nextAttachments = [...message.attachments];
    for (const attachment of attachments) {
      if (!existingIds.has(attachment.id)) {
        existingIds.add(attachment.id);
        nextAttachments.push(attachment);
      }
    }
    return { ...message, attachments: nextAttachments };
  });

  return matched ? { ...state, messages: nextMessages } : state;
}

/**
 * True when a tool presentation summary is a raw JSON/args dump (including
 * clipSummary-truncated dumps that no longer end with `}` / `]`).
 */
export function isJsonishToolSummary(text: string | undefined): boolean {
  if (!text) {
    return false;
  }
  const trimmed = text.trim();
  if (trimmed.length < 2) {
    return false;
  }
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

export function mergeToolPresentation(
  existing: ToolPresentation | undefined,
  incoming: ToolPresentation,
): ToolPresentation {
  if (!existing) {
    return incoming;
  }
  const outputTruncation = incoming.output?.truncation ?? existing.output?.truncation;
  const merged: ToolPresentation = {
    ...existing,
    ...incoming,
    ...(incoming.output || existing.output
      ? {
          output: {
            text: incoming.output?.text ?? existing.output?.text ?? '',
            ...(incoming.output?.truncated || existing.output?.truncated
              ? { truncated: true as const }
              : {}),
            ...(incoming.output?.redacted || existing.output?.redacted
              ? { redacted: true as const }
              : {}),
            ...(outputTruncation !== undefined ? { truncation: outputTruncation } : {}),
          },
        }
      : {}),
    ...(incoming.error || existing.error ? { error: incoming.error ?? existing.error } : {}),
  };
  const targetPaths = incoming.targetPaths ?? existing.targetPaths;
  const changedPaths =
    incoming.error !== undefined
      ? incoming.changedPaths
      : (incoming.changedPaths ?? existing.changedPaths);
  if (targetPaths !== undefined) {
    merged.targetPaths = targetPaths;
  }
  if (changedPaths !== undefined) {
    merged.changedPaths = changedPaths;
  }
  // tool/end often rebuilds presentation without args (image_gen → paths JSON).
  // Keep the start-time human summary and inputPreview instead of the dump.
  if (
    existing.summary &&
    incoming.summary &&
    isJsonishToolSummary(incoming.summary) &&
    !isJsonishToolSummary(existing.summary)
  ) {
    merged.summary = existing.summary;
  } else if (existing.summary && !incoming.summary) {
    merged.summary = existing.summary;
  }
  if (existing.inputPreview && !incoming.inputPreview) {
    merged.inputPreview = existing.inputPreview;
  }
  return merged;
}

const SECRET_DISPLAY_PATTERNS: RegExp[] = [
  /\b(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*['"]?[^\s'"]+/gi,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\bsk-[A-Za-z0-9]{16,}\b/g,
];

/** Best-effort display redaction for tool deltas that reach the Desktop path. */
export function redactDisplayText(text: string): string {
  let next = text;
  for (const pattern of SECRET_DISPLAY_PATTERNS) {
    next = next.replace(pattern, '[redacted]');
  }
  return next;
}

export function createBoundedToolOutput(value: string): BoundedTextAccumulator {
  return createBoundedTextAccumulator(redactDisplayText(value), TOOL_OUTPUT_RETENTION_OPTIONS);
}

/** Keep structured presentation from retaining an uncapped duplicate output string. */
export function projectBoundedToolPresentation(
  presentation: ToolPresentation,
  output: BoundedTextAccumulator,
): ToolPresentation {
  if (!presentation.output) {
    return presentation;
  }
  return {
    ...presentation,
    output: {
      ...presentation.output,
      text: output.text,
      ...(output.truncated ? { truncated: true } : {}),
    },
  };
}

export function appendBoundedToolOutput(
  tool: Pick<ToolCardUi, 'output' | 'outputRetainedBytes' | 'outputTruncated'>,
  nextDelta: string,
): BoundedTextAccumulator {
  const accumulator =
    tool.outputRetainedBytes === undefined || tool.outputTruncated === undefined
      ? createBoundedToolOutput(tool.output)
      : {
          text: tool.output,
          retainedBytes: tool.outputRetainedBytes,
          truncated: tool.outputTruncated,
        };
  return appendBoundedText(
    accumulator,
    redactDisplayText(nextDelta),
    TOOL_OUTPUT_RETENTION_OPTIONS,
  );
}
