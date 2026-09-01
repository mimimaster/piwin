/**
 * Max length for a text-derived default session name. Kept titlebar-friendly:
 * the Desktop chrome shows it next to the project name in a single line.
 */
const MAX_DEFAULT_NAME_CHARS = 32;

/**
 * Minimum length for the first sentence to stand alone; when the opening
 * sentence is shorter we append following sentences so short instructions
 * like "修复 bug" do not collapse into a bare fragment.
 */
const MIN_FIRST_SENTENCE_CHARS = 8;

/**
 * Polite/instructional openers that carry no identifying content for a
 * session title. Stripped once from the front (never in the middle).
 * Chinese forms cover stacked openers ("请帮我") and English forms tolerate
 * `please fix` and `please, fix` alike.
 */
const NOISE_PREFIX_PATTERN =
  /^(?:请帮我|请你帮我|请(?:你|您)?|麻烦(?:你|您)?|帮我|拜托(?:你)?|please(?:\s|,)+|plz(?:\s|,)+|could\s+(?:you|u)(?:\s|,)+|can\s+(?:you|u)(?:\s|,)+|would\s+(?:you|u)(?:\s|,)+|do\s+(?:you|u)(?:\s|,)+)\s*/i;

/**
 * Host/model-facing directive wrappers that must never become a session title.
 * Desktop historically prefixed agent-mode / skill contracts into `input.text`;
 * even after that is fixed, strip them so transcripts and older clients stay safe.
 */
const PIWIN_BRACKET_BLOCK_PATTERN =
  /\[piwin(?:-[^\]]+| [^\]]*)\][\s\S]*?(?:\[\/piwin(?:-[^\]]+)?\]|(?=\n---\n)|(?=\nUser:)|$)/gi;
const PIWIN_TAG_LINE_PATTERN = /\[piwin(?:-[^\]]+| [^\]]*)\][^\n]*/gi;
const PIWIN_PROMPT_META_LINE_PATTERN = /\[piwin-prompt-meta[^\]]*\][^\n]*/gi;
const USER_SECTION_SPLIT_PATTERN = /(?:^|\n)---\s*\n+\s*User:\s*\n?/i;
const CURRENT_USER_MESSAGE_SPLIT_PATTERN =
  /(?:^|\n)---\s*\n+\s*Current user message:\s*\n?/i;

/** Split into sentences on CJK/Latin sentence terminators and newlines. */
function splitSentences(text: string): string[] {
  return text
    .split(/[。！？!?\n.]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** First sentence, extended with following sentences when it is too short. */
function takeLeadingSentence(text: string): string {
  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    return '';
  }
  let result = sentences[0] ?? '';
  for (let index = 1; index < sentences.length && result.length < MIN_FIRST_SENTENCE_CHARS; index += 1) {
    const nextSentence = sentences[index];
    if (nextSentence === undefined) {
      break;
    }
    result = `${result} ${nextSentence}`;
  }
  return result;
}

/**
 * Truncate on word boundaries via `Intl.Segmenter` so CJK and Latin both cut
 * cleanly. A single over-long word/run hard-cuts as a last resort.
 */
function truncateAtWordBoundary(text: string): string {
  if (text.length <= MAX_DEFAULT_NAME_CHARS) {
    return text;
  }
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  const limit = MAX_DEFAULT_NAME_CHARS - 1; // room for the ellipsis
  let result = '';
  for (const segment of segmenter.segment(text)) {
    if ((result + segment.segment).length > limit) {
      break;
    }
    result += segment.segment;
  }
  const trimmed = result.trimEnd();
  if (trimmed.length === 0) {
    return `${text.slice(0, limit)}…`;
  }
  return `${trimmed}…`;
}

/**
 * Pull the human-authored body out of host/model prompt wrappers.
 * Prefer the section after `---\nUser:` / `Current user message:` when present;
 * otherwise strip piwin directive blocks and keep remaining prose.
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

  let cleaned = text;
  cleaned = cleaned.replace(PIWIN_BRACKET_BLOCK_PATTERN, ' ');
  cleaned = cleaned.replace(PIWIN_PROMPT_META_LINE_PATTERN, ' ');
  cleaned = cleaned.replace(PIWIN_TAG_LINE_PATTERN, ' ');
  // Drop residual section dividers left by mode/skill wrappers.
  cleaned = cleaned.replace(/(?:^|\n)---\s*(?:\n|$)/g, '\n');
  cleaned = cleaned.replace(/^(?:User|Current user message):\s*/i, '');
  return cleaned.trim();
}

/**
 * Derive a human-readable fallback session name from the first user message.
 * Pure: no FS, no network. Cleans markdown/URLs/injected walkthrough context,
 * takes the leading sentence (extended when short), strips polite openers,
 * and truncates on a word boundary (CJK-aware) with an ellipsis.
 * Returns '' when nothing meaningful remains (caller keeps placeholder).
 */
export function deriveDefaultNameFromMessage(text: string): string {
  let cleaned = extractUserFacingBody(text);
  const urlHosts = [
    ...cleaned.matchAll(/https?:\/\/([^/\s]+)/gi),
  ].map((match) => (match[1] ?? '').replace(/^www\./i, ''));
  const fenceBodies = [...cleaned.matchAll(/```(?:[^\n`]*)\n?([\s\S]*?)```/g)].map(
    (match) => match[1] ?? '',
  );
  // Strip injected walkthrough context directives (both XML and bracket formats).
  cleaned = cleaned.replace(/<walkthrough-context[\s\S]*?<\/walkthrough-context>/gi, '');
  cleaned = cleaned.replace(
    /\[piwin walkthrough context\][\s\S]*?\[end walkthrough context\]/gi,
    '',
  );
  // Strip markdown headers, bold, italic, inline code, code fences.
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');
  cleaned = cleaned.replace(/\*\*(.+?)\*\*/g, '$1');
  cleaned = cleaned.replace(/__(.+?)__/g, '$1');
  cleaned = cleaned.replace(/\*(.+?)\*/g, '$1');
  cleaned = cleaned.replace(/_(.+?)_/g, '$1');
  // Inline code: keep content, strip backticks. Code fences (```...```) removed entirely.
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
  // Strip URLs.
  cleaned = cleaned.replace(/https?:\/\/\S+/g, '');
  // Collapse whitespace.
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) {
    const host = urlHosts.find((value) => value.length > 0);
    if (host) {
      return truncateAtWordBoundary(host);
    }
    const codeLine = fenceBodies
      .flatMap((body) => body.split('\n'))
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (codeLine) {
      return truncateAtWordBoundary(codeLine);
    }
    return '';
  }

  const leading = takeLeadingSentence(cleaned);
  let strippedOpener = false;
  const deNoised = leading.replace(NOISE_PREFIX_PATTERN, () => {
    strippedOpener = true;
    return '';
  }).trim();
  if (deNoised.length === 0) {
    return '';
  }
  // Stripping an opener ("please fix…") leaves a lowercase verb; restore a
  // title-like initial capital only then, so untouched messages keep their
  // original casing. CJK is unaffected either way.
  const restoredCase = strippedOpener
    ? deNoised.charAt(0).toUpperCase() + deNoised.slice(1)
    : deNoised;
  return truncateAtWordBoundary(restoredCase);
}

/** Listable fallback when text and attachments yield no title. Not a placeholder. */
export const SESSION_LIST_NAME_FALLBACK = 'Conversation';

function safeAttachmentDisplayName(raw: string): string {
  const trimmed = raw.trim().replace(/\\/g, '/');
  const base = (trimmed.split('/').pop() ?? '').replace(/^\.+/, '').trim();
  return base;
}

/**
 * Name that may appear in the session list immediately on first send.
 * Prefers the text title, then a safe attachment basename, then a fixed fallback.
 */
export function deriveSessionListName(input: {
  text?: string;
  attachmentNames?: readonly string[];
}): string {
  const fromText = deriveDefaultNameFromMessage(input.text ?? '');
  if (fromText.length > 0) {
    return fromText;
  }
  const attachment = (input.attachmentNames ?? [])
    .map(safeAttachmentDisplayName)
    .find((name) => name.length > 0);
  if (attachment) {
    return truncateAtWordBoundary(attachment);
  }
  return SESSION_LIST_NAME_FALLBACK;
}
