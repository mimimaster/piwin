/**
 * Live handover sanitizers. Host peels spoken wrappers; it does not guess work intent.
 */

import {
  composeLiveSpokenInstructions,
  PIWIN_LIVE_SPOKEN_CONTRACT,
  PIWIN_LIVE_WORK_PREAMBLE,
} from './live-spoken-contract.js';

export {
  composeLiveSpokenInstructions,
  PIWIN_LIVE_CODEX_APPENDIX,
  PIWIN_LIVE_SPOKEN_CONTRACT,
  PIWIN_LIVE_TOOL_APPENDIX,
  PIWIN_LIVE_WORK_PREAMBLE,
} from './live-spoken-contract.js';

export const PIWIN_LIVE_STOP_INSTRUCTION = 'STOP_CURRENT_RUN';

/** Codex Live `session.instructions`. Tool channels use `composeLiveSpokenInstructions('tool-handover')`. */
export const PIWIN_LIVE_INSTRUCTIONS = composeLiveSpokenInstructions('native-delegation');

/** @deprecated Use PIWIN_LIVE_SPOKEN_CONTRACT + a channel appendix. */
export const PIWIN_LIVE_POLICY = PIWIN_LIVE_SPOKEN_CONTRACT;

export const PIWIN_LIVE_DELEGATE_TOOL_HINT =
  ' For work requiring files, code, tools, or chat page presence, call `delegate_to_work_session` with the summarized brief.';

export const PIWIN_LIVE_DELEGATE_TOOL_DESCRIPTION =
  'Summarized work brief for the coding agent. Compress spoken intent; never a verbatim transcript, filler, or ASR tags. STOP_CURRENT_RUN only to halt the current run.';

export const PIWIN_LIVE_DELEGATE_INSTRUCTION_DESCRIPTION =
  'A concise summarized task in the user language. Never a verbatim transcript.';

const NON_SPEECH_TAG = /\[[^[\]]{1,40}\]/g;
const FILLER_ONLY =
  /^(?:[。．，,、!！?？.~…\s]|噢|哦|嗯|啊|呃|额|哈|嘿|唔|唉|uh+|um+|ah+|oh+|hmm+|huh+|mhm+|mm+|ya+|yeah|yes|ok|okay|好|对)+$/iu;

const SPOKEN_LEAD = /^(?:没有|不是|对啊|对的|好的|嗯|噢|哦|呃|额|那个|就是|然后)[，,。.!?！？\s]*/u;
const SPOKEN_META =
  /^(?:我是让你|我让你|我想让你|请你|麻烦你|你给我|你帮我|帮我)(?:先|再)?/u;
const SPOKEN_LEAD_EN = /^(?:no|nah|yeah|ok|okay|um+|uh+)[,.\s]+/i;
const SPOKEN_META_EN =
  /^(?:i(?:'m| am) (?:asking|telling) you to|i (?:need|want) you to|can you|could you|please)\s+/i;
const SPOKEN_TRAIL = /(?:吧|啊|呀|呢)+$/u;

/** Strip ASR event tags and reject filler-only leftover text. */
export function sanitizeLiveDelegationInstruction(raw: string): string | null {
  const withoutTags = raw.replace(NON_SPEECH_TAG, ' ');
  const collapsed = withoutTags.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  if (FILLER_ONLY.test(collapsed)) return null;
  return collapsed;
}

/**
 * Drop spoken wrappers the Live model forgot to summarize.
 * Does not guess new intent — only peels "没有,我是让你…" off the leftover task.
 */
export function compressLiveDelegationInstruction(raw: string): string | null {
  const sanitized = sanitizeLiveDelegationInstruction(raw);
  if (!sanitized) return null;
  if (isLiveStopInstruction(sanitized)) {
    return PIWIN_LIVE_STOP_INSTRUCTION;
  }
  let text = sanitized;
  for (let step = 0; step < 8; step += 1) {
    const next = text
      .replace(SPOKEN_LEAD, '')
      .replace(SPOKEN_LEAD_EN, '')
      .replace(SPOKEN_META, '')
      .replace(SPOKEN_META_EN, '')
      .replace(SPOKEN_TRAIL, '')
      .replace(/^[，,。.!?！？\s]+|[，,。.!?！？\s]+$/u, '')
      .trim();
    if (next === text) break;
    text = next;
  }
  if (!text) return null;
  if (FILLER_ONLY.test(text)) return null;
  return text;
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
