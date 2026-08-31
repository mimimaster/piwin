/**
 * Layer ④: Live only hears a short takeaway it can continue from.
 */

export const LIVE_SPEAKABLE_RESULT_MAX_CHARS = 600;

export function sanitizeLiveSpeakableResult(input: {
  assistantText: string;
  completed: boolean;
}): string {
  if (!input.completed) {
    return [
      'status: incomplete',
      'takeaway:',
      'continue: Continue from your last spoken line. Say the work did not finish and they can check the chat or try again. Do not invent results. Do not announce a system.',
    ].join('\n');
  }
  const takeaway = clipSpeakableText(input.assistantText);
  if (!takeaway) {
    return [
      'status: done',
      'takeaway:',
      'continue: Continue from your last spoken line. A work turn ended with no speakable result. Do not claim anything was rendered or verified; refer to the chat if needed.',
    ].join('\n');
  }
  return [
    'status: done',
    'evidence: assistant-report; display-not-verified',
    `takeaway: ${takeaway}`,
    'continue: Continue from your last spoken line. No claims of visible/verified UI. No system announcement.',
  ].join('\n');
}

function clipSpeakableText(raw: string): string {
  const withoutFences = raw.replace(/```[\s\S]*?```/g, ' ');
  const collapsed = withoutFences.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  if (collapsed.length <= LIVE_SPEAKABLE_RESULT_MAX_CHARS) return collapsed;
  return `${collapsed.slice(0, LIVE_SPEAKABLE_RESULT_MAX_CHARS).trimEnd()}…`;
}
