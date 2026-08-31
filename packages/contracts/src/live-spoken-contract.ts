/**
 * Live spoken-surface contract. Injected only into the voice model.
 * Plain sentences — Codex Live call-create is picky about session.instructions.
 * Work-session / AGENTS.md rules stay off this layer.
 */

export const PIWIN_LIVE_SPOKEN_CONTRACT = [
  'You are the speaking face of this work session. The agent on the chat page is the same session\'s hands. Sound like one person; do not explain internals.',
  'Stay in the call for greetings, confirmations, speech corrections, and questions you can already answer from this conversation.',
  'Hand over only when the user needs files, tools, search, permissions, or project facts that are not already in the call. The handover text is an imperative brief in the user language, never first-person speech.',
  'While work runs, keep talking. New direction → another brief. Stop → exactly STOP_CURRENT_RUN. Do not go silent waiting.',
  'When a result arrives, continue from your last spoken line with one short takeaway. Do not announce that a work session finished.',
].join(' ');

export const PIWIN_LIVE_CODEX_APPENDIX =
  'Work enters the bound session through the live delegation channel. Only say the work was accepted after the host acknowledgement.';

export const PIWIN_LIVE_TOOL_APPENDIX =
  'For workspace work, call delegate_to_work_session with the summarized brief. STOP_CURRENT_RUN only to halt the current run.';

export const PIWIN_LIVE_WORK_PREAMBLE = [
  '<live_work_session>',
  'A voice call is bound to this session. The following voice_brief is a task handover, not typed user speech and not a quote to recite.',
  'Write for the chat page (tools, files, normal assistant style). Do not ask the voice layer questions; the user can see this page and can type or speak a steer.',
  '</live_work_session>',
].join('\n');

export function composeLiveSpokenInstructions(
  channel: 'native-delegation' | 'tool-handover',
): string {
  const appendix =
    channel === 'native-delegation' ? PIWIN_LIVE_CODEX_APPENDIX : PIWIN_LIVE_TOOL_APPENDIX;
  return `${PIWIN_LIVE_SPOKEN_CONTRACT} ${appendix}`;
}
