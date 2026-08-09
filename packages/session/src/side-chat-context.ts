/**
 * Pure Side Chat context snapshot builder + model-facing formatter
 * (SIDE spec §7.2, §7.4, §9.2).
 *
 * The snapshot captures a bounded view of the source session's transcript
 * at open/sync time. The formatter wraps that inherited context in an
 * explicit context block so the model never mistakes it for a Side Chat
 * user message.
 */

import type {
  SessionTranscriptMessage,
  SideChatContextRef,
  SideChatContextSnapshot,
} from '@piwin/contracts';

const DEFAULT_MAX_CHARS = 24_000;
const DEFAULT_MAX_MESSAGES = 40;

export type SideChatSnapshotInput = {
  /** Bumped by the host for each explicit sync (SIDE §7.5). */
  version: number;
  sourceSessionId: string;
  /** Last persisted completed message boundary (exclusive of streaming tail). */
  throughMessageId?: string;
  workspace: SideChatContextSnapshot['workspace'];
  refs?: SideChatContextRef[];
  messages: SessionTranscriptMessage[];
  maxChars?: number;
  maxMessages?: number;
};

/**
 * Build a bounded context snapshot from the source session's product
 * transcript. Only persisted user/assistant/system rows with text are
 * included; the window is capped to keep prompt cost predictable.
 */
export function buildSideChatContextSnapshot(
  input: SideChatSnapshotInput,
): SideChatContextSnapshot {
  const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
  const maxMessages = input.maxMessages ?? DEFAULT_MAX_MESSAGES;

  const eligible = input.messages.filter(
    (message) =>
      (message.role === 'user' || message.role === 'assistant' || message.role === 'system') &&
      message.text.trim().length > 0,
  );
  const windowed = eligible.slice(-maxMessages);

  const lines: string[] = [
    '[piwin-side-chat-context]',
    'Inherited conversation from the main session (product transcript; not Pi JSONL):',
  ];
  let used = lines.join('\n').length;
  const bodyLines: string[] = [];

  for (const message of windowed) {
    const roleLabel =
      message.role === 'user' ? 'User' : message.role === 'assistant' ? 'Assistant' : 'System';
    const text = message.text.trim().slice(0, 4000);
    const block = `${roleLabel}: ${text}`;
    if (used + block.length + 1 > maxChars) {
      break;
    }
    bodyLines.push(block);
    used += block.length + 1;
  }

  const truncated = windowed.length > bodyLines.length || eligible.length > windowed.length;
  const formattedText = [...lines, ...bodyLines, '[/piwin-side-chat-context]'].join('\n');

  const snapshot: SideChatContextSnapshot = {
    version: input.version,
    capturedAt: new Date().toISOString(),
    sourceSessionId: input.sourceSessionId,
    conversation: {
      messageIds: windowed.map((message) => message.id),
      formattedText,
      truncated,
    },
    workspace: input.workspace,
    refs: input.refs ?? [],
  };
  if (input.throughMessageId) {
    snapshot.throughMessageId = input.throughMessageId;
  }
  return snapshot;
}

/**
 * Format a stored snapshot into a prompt-ready context block. Uses the
 * persisted `formattedText` so a synced snapshot injects deterministically.
 */
export function formatSideChatContextBlock(snapshot: SideChatContextSnapshot): string {
  const workspaceLabel =
    snapshot.workspace.scope === 'project'
      ? `project ${snapshot.workspace.projectPath ?? snapshot.workspace.workingDirectory}`
      : 'general workspace';
  const header = `Side Chat discussion context (source session ${snapshot.sourceSessionId}, context v${snapshot.version}, captured ${snapshot.capturedAt}, workspace: live ${workspaceLabel}).`;
  const parts = [header, snapshot.conversation.formattedText];
  // SIDE §7.2: render refs metadata so the model knows which additional
  // context items were shared. Inline-text refs (diff, terminal-output,
  // error) include their content; message/file refs show their label only
  // (content is resolved at prompt time by the host).
  if (snapshot.refs.length > 0) {
    const refLines = snapshot.refs.map((ref) => formatContextRefLine(ref));
    parts.push('[piwin-side-chat-refs]', ...refLines, '[/piwin-side-chat-refs]');
  }
  return parts.join('\n');
}

function formatContextRefLine(ref: SideChatContextRef): string {
  switch (ref.kind) {
    case 'main-message':
      return `- main-message: ${ref.label} (message ${ref.messageId})`;
    case 'side-chat-message':
      return `- side-chat-message: ${ref.label} (message ${ref.messageId})`;
    case 'file':
      return `- file: ${ref.label} (${ref.relativePath})`;
    case 'diff': {
      const text = ref.snapshotText.slice(0, 2000);
      return `- diff: ${ref.label}\n${text}`;
    }
    case 'terminal-output': {
      const text = ref.snapshotText.slice(0, 2000);
      return `- terminal-output: ${ref.label}\n${text}`;
    }
    case 'error': {
      const text = ref.detail.slice(0, 2000);
      return `- error: ${ref.label} (${ref.title})\n${text}`;
    }
    case 'selection': {
      const text = ref.snapshotText.slice(0, 2000);
      const loc =
        ref.relativePath != null
          ? `${ref.relativePath}${
              ref.lineStart != null
                ? `:${ref.lineStart}${ref.lineEnd != null ? `-${ref.lineEnd}` : ''}`
                : ''
            }`
          : ref.label;
      return `- selection: ${loc}\n${text}`;
    }
    case 'folder':
      return `- folder: ${ref.label} (${ref.relativePath === '' ? '.' : ref.relativePath})`;
  }
}

/**
 * Prepend the inherited-context block to the side chat user prompt. Unlike
 * product-history injection this is not "prior turns of this session" — it is
 * a labeled inherited block that must stay visually distinct.
 */
export function mergeSideChatContextIntoPrompt(
  contextBlock: string,
  userPromptText: string,
): string {
  const block = contextBlock.trim();
  const userText = userPromptText.trim();
  if (!block) {
    return userPromptText;
  }
  if (!userText) {
    return block;
  }
  return `${block}\n\n---\nCurrent side chat question:\n${userText}`;
}
