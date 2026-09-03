/**
 * Live handover sanitizers. Intent review precedes mechanical Session admission.
 */

import {
  composeLiveSpokenInstructions,
  PIWIN_LIVE_WORK_PREAMBLE,
} from './live-spoken-contract.js';

export {
  composeLiveSpokenInstructions,
  piwinLiveRetargetContext,
  PIWIN_LIVE_CODEX_APPENDIX,
  PIWIN_LIVE_SPOKEN_CONTRACT,
  PIWIN_LIVE_TOOL_APPENDIX,
  PIWIN_LIVE_WORK_PREAMBLE,
} from './live-spoken-contract.js';

export const PIWIN_LIVE_STOP_INSTRUCTION = 'STOP_CURRENT_RUN';

/** Codex Live `session.instructions`. Tool channels use `composeLiveSpokenInstructions('tool-handover')`. */
export const PIWIN_LIVE_INSTRUCTIONS = composeLiveSpokenInstructions('native-delegation');

export const PIWIN_LIVE_DELEGATE_TOOL_DESCRIPTION =
  'Candidate work request for Host intent review, not permission to execute. Only for clear work intent; preserve the user wording, negations and constraints. Never turn reactions, confirmations or fragments into work. STOP_CURRENT_RUN only to halt current work, not speech.';

export const PIWIN_LIVE_DELEGATE_INSTRUCTION_DESCRIPTION =
  'The actionable user request in the user language, preserving negations and uncertainty. No filler or ASR tags; do not invent missing intent.';

// Only known non-speech annotations; bracketed filenames/constraints are data.
const NON_SPEECH_TAG = /\[(?:clear throat|clearing throat|throat clearing|laughter|laughing|laughs|cough|coughing|sigh|sighing|breathing|background noise|noise|inaudible|silence|music|咳嗽|清嗓|笑声|叹气|噪音)\]/giu;
const FILLER_ONLY =
  /^(?:[。．，,、!！?？.~…\s]|噢|哦|嗯|啊|呃|额|哈|嘿|唔|唉|uh+|um+|ah+|oh+|hmm+|huh+|mhm+|mm+|ya+|yeah|yes|ok|okay|好|对)+$/iu;

/** Strip ASR event tags and reject filler-only leftover text. */
export function sanitizeLiveDelegationInstruction(raw: string): string | null {
  const withoutTags = raw.replace(NON_SPEECH_TAG, ' ');
  const collapsed = withoutTags.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  if (FILLER_ONLY.test(collapsed)) return null;
  return collapsed;
}

export function isLiveStopInstruction(instruction: string): boolean {
  return instruction.replace(/[。.!！]+$/u, '').trim() === PIWIN_LIVE_STOP_INSTRUCTION;
}

export function wrapLiveDelegationForAgent(
  instruction: string,
  options?: { firstForCall?: boolean },
): string {
  const brief = instruction.trim();
  if (!brief || isLiveStopInstruction(brief)) return brief;
  const body = `<voice_brief>\n${brief}\n</voice_brief>`;
  if (options?.firstForCall !== true) return body;
  return `${PIWIN_LIVE_WORK_PREAMBLE}\n${body}`;
}
