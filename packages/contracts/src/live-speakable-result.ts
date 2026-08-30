/**
 * DEL-8: Live only hears a short sanitized takeaway, never raw tools/diffs.
 */

export const LIVE_SPEAKABLE_RESULT_MAX_CHARS = 600;

export function sanitizeLiveSpeakableResult(input: {
  assistantText: string;
  completed: boolean;
}): string {
  if (!input.completed) {
    return 'The work session did not finish. Tell the user briefly that they can check the chat or try again. Do not invent results.';
  }
  const body = clipSpeakableText(input.assistantText);
  if (!body) {
    return 'The work session finished. Tell the user the result is already in the current chat. Do not invent details.';
  }
  return [
    'The work session finished. Speak a short takeaway from this result.',
    'Do not read tables, lists, diffs, or tool output aloud.',
    'Result:',
    body,
  ].join('\n');
}

function clipSpeakableText(raw: string): string {
  const withoutFences = raw.replace(/```[\s\S]*?```/g, ' ');
  const collapsed = withoutFences.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  if (collapsed.length <= LIVE_SPEAKABLE_RESULT_MAX_CHARS) return collapsed;
  return `${collapsed.slice(0, LIVE_SPEAKABLE_RESULT_MAX_CHARS).trimEnd()}…`;
}
