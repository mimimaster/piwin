/**
 * Devin CLI compaction strings, recovered verbatim from `devin` 3000.2.17.
 *
 * Sources (binary module paths):
 * - `agent-ext/src/compactor/file_compactor.rs` - summarizer system prompt,
 *   the "Conversation to summarize" wrapper, history file naming, the
 *   middle-elision marker and the post-compaction replacement message.
 * - `agent-ext/src/compactor/summarize.rs` - `apply_summary`, prior node ids.
 *
 * Do not "improve" these strings: the whole point of this extension is byte
 * fidelity with Devin. `{historyFile}` is the only interpolation the binary
 * performs (it is passed as a bare file name, not an absolute path).
 */

export const DEVIN_SUMMARIZER_SYSTEM = `
            You are a Summarizer that summarizes conversation history.
You will be shown a conversation between the user and the assistant, a coding agent. You should summarize the conversation + work done for future work to be continued by the coding agent.

Structure your summary as follows:

<summary>
## Overview
A high-level summary of what was being worked on and the overall goal (1-2 sentences).

## Key Details & Breadcrumbs
Important details that may be needed later (key findings, decisions, constraints, error messages, progress or modified files, etc).
For each item, note:
- What it is and why it matters
- If it would be helpful to look at the original source, include citations to message ids or search terms to find the details in the history file

## Current State
What the agent was actively working on when this summary was created:
- The immediate task or step in progress
- Any pending actions or next steps that were planned
- Blockers or questions that need resolution
</summary>

IMPORTANT: Do NOT reproduce or recite any rules, instructions, or guidelines that were included verbatim in the conversation (e.g., content inside <rules> or <rule> tags). Rules will be re-discovered and re-injected as needed when the agent accesses relevant files. Focus on summarizing the work done and decisions made, not the instructions themselves.

Note, the full conversation will be saved to a history file ({historyFile}). The full path will be provided alongside the summary you create.
Be concise but ensure someone could resume work using only your summary plus the reference file.`;

/** Final user turn appended after the transcript. 140 bytes in the binary. */
export const DEVIN_SUMMARIZE_INSTRUCTION = `Now summarize the conversation above as per the format given. Remember, do NOT take any actions. Just provide the summary in <summary> tags.`;

/** `\nConversation to summarize:\n` - the user turn that carries the transcript. */
export const DEVIN_CONVERSATION_PREFIX = "\nConversation to summarize:\n";

/** Separator used when joining rendered messages (asc_1043C9A6E). */
export const DEVIN_TRANSCRIPT_SEPARATOR = "\n\n";

/**
 * Elision only kicks in at or above this joined byte length (0x30D41 in
 * `agent-ext/src/compactor/file_compactor.rs`).
 */
export const DEVIN_TRANSCRIPT_LIMIT_BYTES = 200001;

/** Replacement message written back into the chain after a compaction. */
export const DEVIN_REPLACEMENT_PREFIX =
  "You are continuing work from a previous conversation thread. Below is a summary of the previous conversation thread:\nFull conversation history saved at ";

export const DEVIN_REPLACEMENT_SUMMARY_JOIN = ".\nSummary:\n";

export const DEVIN_EDITED_FILES_HEADER =
  "\nHere are some files that you edited (and perhaps there were others which were touched via shell script):\n";

export const DEVIN_EDITED_FILE_LINE_PREFIX = " - ";

/**
 * Per-message cap applied before the transcript is assembled
 * (`sub_100450BA8`): content above 8000 bytes keeps the first and last 4000
 * bytes and reports the difference. Verified: `...[1968 chars truncated]...`.
 */
export const DEVIN_MESSAGE_LIMIT_BYTES = 8000;
export const DEVIN_MESSAGE_KEEP_BYTES = 4000;

export function devinTruncatedMarker(count: number): string {
  return `...[${count} chars truncated]...`;
}

/** `[... {n} messages omitted due to length ...]` */
export function devinOmittedMarker(count: number): string {
  return `[... ${count} messages omitted due to length ...]`;
}

/** `=== MESSAGE {index} - {Role} ===` */
export function devinMessageHeader(index: number, role: string): string {
  return `=== MESSAGE ${index} - ${role} ===`;
}
