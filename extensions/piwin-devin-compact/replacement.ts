import {
  DEVIN_EDITED_FILES_HEADER,
  DEVIN_EDITED_FILE_LINE_PREFIX,
  DEVIN_REPLACEMENT_PREFIX,
  DEVIN_REPLACEMENT_SUMMARY_JOIN,
} from './prompt.js';

export type ReplacementInput = {
  /** Absolute path of the archived full transcript. */
  historyPath: string;
  /** Raw summarizer output; Devin stores it verbatim, `<summary>` tags included. */
  summary: string;
  editedPaths: readonly string[];
  /** Inlined stand-ins for the nodes Devin keeps verbatim (todo list, skills). */
  preservedBlocks?: readonly string[];
};

/**
 * Rebuilds the message Devin writes back into the chain after compaction:
 *
 *   You are continuing work from a previous conversation thread. ...
 *   Full conversation history saved at <abs path>.
 *   Summary:
 *   <model output>
 *
 *   Here are some files that you edited (...):
 *    - <path>
 */
export function renderReplacementMessage(input: ReplacementInput): string {
  const parts: string[] = [];
  for (const block of input.preservedBlocks ?? []) {
    const trimmed = block.trim();
    if (trimmed) parts.push(trimmed);
  }
  const head = `${DEVIN_REPLACEMENT_PREFIX}${input.historyPath}${DEVIN_REPLACEMENT_SUMMARY_JOIN}${input.summary}`;
  let body = head;
  if (input.editedPaths.length > 0) {
    const lines = input.editedPaths.map((path) => `${DEVIN_EDITED_FILE_LINE_PREFIX}${path}\n`);
    body = `${head}${DEVIN_EDITED_FILES_HEADER}${lines.join('')}`;
  }
  parts.push(body);
  return parts.join('\n\n');
}
