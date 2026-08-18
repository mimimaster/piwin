export const HOLD_TO_TALK_LONG_PRESS_MS = 220;
export const HOLD_TO_TALK_CANCEL_DISTANCE_PX = 64;
export const HOLD_TO_TALK_FINAL_TIMEOUT_MS = 1_200;
export const HOLD_TO_TALK_TAP_HINT = '按住说话';
export const HOLD_TO_TALK_EMPTY_HINT = '没听清，请再按住说一次';

export type HoldToTalkPhase = 'idle' | 'listening' | 'finalizing';
export type HoldToTalkReleaseKind = 'tap-hint' | 'abort' | 'stop-and-finalize';

export type SpeechResultSlice = {
  isFinal: boolean;
  transcript: string;
};

export function classifyHoldToTalkRelease(input: {
  heldMs: number;
  startedListening: boolean;
  cancelled: boolean;
}): HoldToTalkReleaseKind {
  if (input.cancelled) {
    return 'abort';
  }
  if (!input.startedListening || input.heldMs < HOLD_TO_TALK_LONG_PRESS_MS) {
    return 'tap-hint';
  }
  return 'stop-and-finalize';
}

export function isHoldToTalkSlideCancel(startY: number, currentY: number): boolean {
  return startY - currentY >= HOLD_TO_TALK_CANCEL_DISTANCE_PX;
}

export function accumulateSpeechSlices(slices: readonly SpeechResultSlice[]): {
  finals: string;
  interim: string;
} {
  let finals = '';
  let interim = '';
  for (const slice of slices) {
    const transcript = slice.transcript.trim();
    if (transcript.length === 0) {
      continue;
    }
    if (slice.isFinal) {
      finals = joinTranscript(finals, transcript);
    } else {
      interim = joinTranscript(interim, transcript);
    }
  }
  return { finals, interim };
}

export function liveHoldTranscript(finals: string, interim: string): string {
  return joinTranscript(finals, interim);
}

export function shouldSendHoldTranscript(input: {
  cancelled: boolean;
  finals: string;
  errorCode?: string;
}): boolean {
  if (input.cancelled) {
    return false;
  }
  if (
    input.errorCode === 'no-speech' ||
    input.errorCode === 'nomatch' ||
    input.errorCode === 'aborted'
  ) {
    return false;
  }
  return input.finals.trim().length > 0;
}

export function mapSpeechRecognitionError(errorCode: string): string | undefined {
  if (errorCode === 'no-speech' || errorCode === 'nomatch' || errorCode === 'aborted') {
    return undefined;
  }
  if (errorCode === 'not-allowed' || errorCode === 'service-not-allowed') {
    return '请在系统设置中允许麦克风和语音识别。';
  }
  if (errorCode === 'audio-capture') {
    return '无法使用麦克风。';
  }
  return '语音识别失败，请改用键盘输入。';
}

function joinTranscript(left: string, right: string): string {
  const start = left.trim();
  const next = right.trim();
  if (start.length === 0) {
    return next;
  }
  if (next.length === 0) {
    return start;
  }
  return `${start} ${next}`;
}
