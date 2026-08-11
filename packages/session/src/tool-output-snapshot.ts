/**
 * Read-only persisted tool output snapshot recovery (plan Slice 5).
 *
 * Historical transcripts slim UI tool output to '' on hydrate, so Doc
 * Preview cannot recover "what the agent read" by scanning state.messages.
 * This module extracts the bounded persisted output for one tool call and
 * gates it to filesystem read tools only.
 */
import type {
  SessionToolCardView,
  SessionToolOutputData,
  SessionTranscriptMessage,
} from '@piwin/contracts';

export const TOOL_SNAPSHOT_DEFAULT_MAX_BYTES = 256 * 1024;
export const TOOL_SNAPSHOT_HARD_MAX_BYTES = 512 * 1024;
const TRUNCATION_MARKER = '\n[output truncated]';

/** Tool name / action-verb shapes that represent a filesystem read. */
const READ_TOOL_NAME_PATTERNS: ReadonlyArray<{ test: (name: string) => boolean }> = [
  { test: (name) => name === 'read' },
  { test: (name) => name === 'read_file' },
  { test: (name) => name === 'view' },
  { test: (name) => name === 'view_file' },
  { test: (name) => name === 'open_file' },
  { test: (name) => name.startsWith('read_') },
  { test: (name) => name.endsWith('_read') },
];

export type ToolOutputSnapshotInput = {
  message: SessionTranscriptMessage;
  toolCallId: string;
  maxBytes?: number;
};

/**
 * Extract the persisted output of one tool call for Doc Preview.
 * Never throws for expected missing / policy failures.
 */
export function readToolOutputSnapshot(
  input: ToolOutputSnapshotInput,
): SessionToolOutputData {
  const { message, toolCallId } = input;
  const tool = findToolCard(message, toolCallId);
  if (!tool) {
    return { status: 'unavailable', reason: 'not-found' };
  }
  if (!isReadFamilyTool(tool)) {
    return { status: 'unavailable', reason: 'not-readable-tool' };
  }

  const output = tool.presentation?.output?.text ?? tool.output ?? '';
  if (!output.trim()) {
    return { status: 'unavailable', reason: 'snapshot-unavailable' };
  }

  const maxBytes = Math.min(
    TOOL_SNAPSHOT_HARD_MAX_BYTES,
    Math.max(1024, input.maxBytes ?? TOOL_SNAPSHOT_DEFAULT_MAX_BYTES),
  );
  const bounded = boundUtf8(output, maxBytes);
  return {
    status: 'ready',
    output: bounded.text,
    truncated: bounded.truncated,
    redacted: tool.presentation?.output?.redacted === true,
    provenance: 'tool-snapshot',
  };
}

export function findToolCard(
  message: SessionTranscriptMessage,
  toolCallId: string,
): SessionToolCardView | null {
  for (const tool of message.tools ?? []) {
    if (tool.toolCallId === toolCallId) {
      return tool;
    }
  }
  return null;
}

/** Filesystem read tools only — never shell/web/bash/edit output for doc preview. */
export function isReadFamilyTool(
  tool: Pick<SessionToolCardView, 'toolName' | 'presentation'>,
): boolean {
  const name = (tool.toolName ?? '').toLowerCase();
  for (const pattern of READ_TOOL_NAME_PATTERNS) {
    if (pattern.test(name)) {
      return true;
    }
  }
  const actionVerb = (tool.presentation?.actionVerb ?? '').toLowerCase();
  return (
    actionVerb.startsWith('read') ||
    actionVerb.startsWith('opened') ||
    actionVerb.startsWith('viewed')
  );
}

function boundUtf8(
  value: string,
  maximumBytes: number,
): { text: string; truncated: boolean } {
  if (Buffer.byteLength(value, 'utf8') <= maximumBytes) {
    return { text: value, truncated: false };
  }
  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, 'utf8');
  let end = Buffer.from(value, 'utf8').subarray(0, maximumBytes - markerBytes);
  while (end.length > 0) {
    try {
      const decoded = end.toString('utf8');
      if (decoded.length > 0) {
        return { text: `${decoded}${TRUNCATION_MARKER}`, truncated: true };
      }
      break;
    } catch {
      // Invalid UTF-8 tail: drop one byte and retry.
      end = end.subarray(0, end.length - 1);
    }
  }
  return { text: TRUNCATION_MARKER, truncated: true };
}
