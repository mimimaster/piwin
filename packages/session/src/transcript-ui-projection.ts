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
      lower === 'plan_create' ||
      lower.startsWith('mcp__') ||
      lower.startsWith('mcp:') ||
      lower === 'mcp_gateway'
    );
  });
}

/** Keep presentation fields needed for collapsed tool rows / FilesChangedBar. */
export function slimToolPresentation(
  presentation: ToolPresentation | undefined,
): ToolPresentation | undefined {
  if (!presentation) {
    return undefined;
  }
  const slim: ToolPresentation = {
    kind: presentation.kind,
    title: presentation.title,
  };
  if (presentation.routedToolName !== undefined) {
    slim.routedToolName = presentation.routedToolName;
  }
  if (presentation.summary !== undefined) slim.summary = presentation.summary;
  if (presentation.inputPreview !== undefined) slim.inputPreview = presentation.inputPreview;
  if (presentation.command !== undefined) slim.command = presentation.command;
  if (presentation.targetPaths !== undefined) slim.targetPaths = presentation.targetPaths;
  if (presentation.documentTargets !== undefined) {
    slim.documentTargets = presentation.documentTargets;
  }
  if (presentation.startedAt !== undefined) slim.startedAt = presentation.startedAt;
  if (presentation.endedAt !== undefined) slim.endedAt = presentation.endedAt;
  if (presentation.durationMs !== undefined) slim.durationMs = presentation.durationMs;
  if (presentation.exitCode !== undefined) slim.exitCode = presentation.exitCode;
  if (presentation.changedPaths !== undefined) slim.changedPaths = presentation.changedPaths;
  if (presentation.error !== undefined) slim.error = presentation.error;
  if (presentation.actionVerb !== undefined) slim.actionVerb = presentation.actionVerb;
  if (presentation.lineRange !== undefined) slim.lineRange = presentation.lineRange;
  if (presentation.countTag !== undefined) slim.countTag = presentation.countTag;
  if (presentation.flashcard !== undefined) slim.flashcard = presentation.flashcard;
  if (presentation.health !== undefined) slim.health = presentation.health;
  if (presentation.plan !== undefined) slim.plan = presentation.plan;
  if (presentation.sensitivity !== undefined) slim.sensitivity = presentation.sensitivity;
  if (
    isPreservedToolOutput(
      presentation.title,
      presentation.routedToolName,
      undefined,
      presentation.kind,
    )
  ) {
    if (presentation.output !== undefined) {
      slim.output = presentation.output;
    }
  } else if (presentation.output?.truncation !== undefined) {
    // Keep the small status payload so a historical card can explain why its
    // bulk output was omitted from the hydrate projection.
    slim.output = {
      text: '',
      truncated: true,
      truncation: presentation.output.truncation,
    };
  }
  // Intentionally drop presentation.output for bulk tools (often hundreds of KB of web/bash text).
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
