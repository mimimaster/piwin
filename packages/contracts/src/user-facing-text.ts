/**
 * Pull the human-authored text out of a durable user row whose `text` may
 * carry Host/model-facing wrappers (mode contracts, skill wrappers, artifact
 * advisories, plan directives, injected context tags).
 *
 * Pure and dependency-free so every shell (Desktop, iOS, CLI) and the Host's
 * own naming path read user rows the same way. Shells must not keep their
 * own envelope blacklists.
 */

/** `[piwin-…] … [/piwin-…]` blocks; an unterminated block runs to the next section or the end. */
const PIWIN_BRACKET_BLOCK_PATTERN =
  /\[piwin(?:-[^\]]+| [^\]]*)\][\s\S]*?(?:\[\/piwin(?:-[^\]]+)?\]|(?=\n---\n)|(?=\nUser:)|$)/gi;
const PIWIN_TAG_LINE_PATTERN = /\[piwin(?:-[^\]]+| [^\]]*)\][^\n]*/gi;
const PIWIN_PROMPT_META_LINE_PATTERN = /\[piwin-prompt-meta[^\]]*\][^\n]*/gi;
const USER_SECTION_SPLIT_PATTERN = /(?:^|\n)---\s*\n+\s*User:\s*\n?/i;
const CURRENT_USER_MESSAGE_SPLIT_PATTERN = /(?:^|\n)---\s*\n+\s*Current user message:\s*\n?/i;
/** Host-injected XML-ish context blocks (refs, startup, side chat, walkthrough). */
const CONTEXT_TAG_PATTERN =
  /<(context_ref|startup_context|side_chat_context|walkthrough-context)\b[^>]*>[\s\S]*?<\/\1>/gi;
/** Plan context closes with its own terminator, not `[/piwin…]`. */
const PLAN_CONTEXT_BLOCK_PATTERN = /\[piwin plan context v\d+[^\]]*\][\s\S]*?\[end plan context\]/gi;
/** Agent-mode contract appended after the user's words. */
const OPERATING_CONTRACT_PATTERN = /Operating contract for this turn:\s*[\s\S]*$/i;
const PLAN_ACTION_PATTERN = /^\[piwin-plan-execute:(inline|verify) v\d+\] Plan: ([^\n]+)/;

export type PlanActionMarker = {
  kind: 'inline' | 'verify';
  title: string;
};

/**
 * A plan-execution handoff row: its durable input is a Host directive, not
 * words the user typed. Shells render it as an action, not a message bubble.
 */
export function readPlanActionMarker(text: string): PlanActionMarker | undefined {
  const match = PLAN_ACTION_PATTERN.exec(text);
  const kind = match?.[1];
  const title = match?.[2]?.trim();
  if ((kind !== 'inline' && kind !== 'verify') || title === undefined) {
    return undefined;
  }
  return { kind, title };
}

/**
 * Prefer the section after `---\nUser:` / `Current user message:` when
 * present; otherwise strip piwin directive blocks and injected context.
 */
export function extractUserFacingBody(text: string): string {
  if (typeof text !== 'string' || text.length === 0) {
    return '';
  }
  const userSection = text.split(USER_SECTION_SPLIT_PATTERN);
  if (userSection.length > 1) {
    return (userSection[userSection.length - 1] ?? '').trim();
  }
  const currentMessageSection = text.split(CURRENT_USER_MESSAGE_SPLIT_PATTERN);
  if (currentMessageSection.length > 1) {
    return (currentMessageSection[currentMessageSection.length - 1] ?? '').trim();
  }

  // Plan execution is a user-approved action whose durable input contains
  // only a Host directive. Preserve a readable action for old and live rows.
  const planAction = readPlanActionMarker(text);
  if (planAction !== undefined) {
    return `${planAction.kind === 'verify' ? '验证计划' : '执行计划'}：${planAction.title}`;
  }

  let cleaned = text;
  cleaned = cleaned.replace(CONTEXT_TAG_PATTERN, ' ');
  cleaned = cleaned.replace(PLAN_CONTEXT_BLOCK_PATTERN, ' ');
  cleaned = cleaned.replace(PIWIN_BRACKET_BLOCK_PATTERN, ' ');
  cleaned = cleaned.replace(PIWIN_PROMPT_META_LINE_PATTERN, ' ');
  cleaned = cleaned.replace(PIWIN_TAG_LINE_PATTERN, ' ');
  cleaned = cleaned.replace(OPERATING_CONTRACT_PATTERN, ' ');
  // Drop residual section dividers left by mode/skill wrappers.
  cleaned = cleaned.replace(/(?:^|\n)---\s*(?:\n|$)/g, '\n');
  cleaned = cleaned.replace(/^\s*(?:User|Current user message):\s*/i, '');
  return cleaned.trim();
}
