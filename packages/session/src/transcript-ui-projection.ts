/**
 * Slim product transcript for Desktop hydrate over IPC.
 *
 * Full tool output + presentation.output dominate multi-MB transcripts; the
 * chat list only needs head-row fields until a tool card is expanded (and even
 * then historical cards usually stay collapsed).
 */
import type {
  SessionToolCardView,
  SessionTranscriptMessage,
  ToolPresentation,
} from '@piwin/contracts';

function isPreservedToolOutput(
  toolName?: string,
  routedToolName?: string,
  title?: string,
  kind?: string,
): boolean {
  if (kind === 'mcp') {
    return true;
  }
  const names = [toolName, routedToolName, title].filter(Boolean) as string[];
  return names.some((n) => {
    const lower = n.toLowerCase();
    return (
      lower.includes('flashcard_create') ||
      lower.includes('flashcard_batch_create') ||
      lower.includes('piwin_plan_create') ||
      lower.includes('piwin_plan_present') ||
      lower === 'plan_create' ||
      lower === 'plan_present' ||
      lower.startsWith('mcp__') ||
      lower.startsWith('mcp:') ||
      lower === 'mcp_gateway'
    );
  });
}

/**
 * Drop only the bulk tool body (`presentation.output`); keep every structured
 * field. This used to be an allowlist, and each field added later without a
 * line here silently vanished on reload — Goal cards fell back to "Goal
 * execution is blocked", and knowledge citations, web-search diagnostics and
 * subagent control cards lost their data the same way. Structured fields are
 * bounded where they are produced; `output` is the only unbounded one.
 */
export function slimToolPresentation(
  presentation: ToolPresentation | undefined,
): ToolPresentation | undefined {
  if (!presentation) {
    return undefined;
  }
  const { output, ...structured } = presentation;
  const slim: ToolPresentation = { ...structured };
  if (
    isPreservedToolOutput(
      presentation.title,
      presentation.routedToolName,
      undefined,
      presentation.kind,
    )
  ) {
    if (output !== undefined) {
      slim.output = output;
    }
  } else if (output?.truncation !== undefined) {
    // Keep the small status payload so a historical card can explain why its
    // bulk output was omitted from the hydrate projection.
    slim.output = {
      text: '',
      truncated: true,
      truncation: output.truncation,
    };
  }
  // Bulk tools lose presentation.output here (often hundreds of KB of web/bash text).
  return slim;
}

export function slimToolCardForUi(tool: SessionToolCardView): SessionToolCardView {
  const presentation = slimToolPresentation(tool.presentation);
  const isPreserved = isPreservedToolOutput(
    tool.toolName,
    tool.presentation?.routedToolName,
    tool.presentation?.title,
    tool.presentation?.kind,
  );
  const card: SessionToolCardView = {
    toolCallId: tool.toolCallId,
    toolName: tool.toolName,
    status: tool.status,
    // Empty output on hydrate: expanded cards show presentation/head only.
    // Flashcard tool outputs are preserved so historical JSON without
    // presentation.flashcard can still project structured cards.
    output: isPreserved ? tool.output : '',
  };
  if (tool.runId !== undefined) card.runId = tool.runId;
  if (tool.responseMessageId !== undefined) card.responseMessageId = tool.responseMessageId;
  if (presentation !== undefined) card.presentation = presentation;
  return card;
}

function withoutPhaseHistory(message: SessionTranscriptMessage): SessionTranscriptMessage {
  if (!message.phaseHistory) {
    return message;
  }
  const { phaseHistory: _phaseHistory, ...rest } = message;
  return rest;
}

/**
 * Project transcript messages for session/resume and session/messages UI paths.
 * Keeps text/thinking/attachments; strips heavy tool body payloads.
 * phaseHistory stays — Desktop rebuilds runRecords from it on hydrate.
 */
export function projectTranscriptMessagesForUi(
  messages: readonly SessionTranscriptMessage[],
): SessionTranscriptMessage[] {
  return messages.map((message) => {
    if (!message.tools || message.tools.length === 0) {
      return message;
    }
    return {
      ...message,
      tools: message.tools.map(slimToolCardForUi),
    };
  });
}

/** Test helper: strip phaseHistory when measuring pure tool payload size. */
export function projectTranscriptMessagesForUiWithoutPhaseHistory(
  messages: readonly SessionTranscriptMessage[],
): SessionTranscriptMessage[] {
  return projectTranscriptMessagesForUi(messages).map(withoutPhaseHistory);
}
