export type SpeechRecognitionErrorEventLike = {
  error: string;
  message?: string;
};

export type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

export type SpeechRecognitionResultLike = {
  isFinal: boolean;
  length: number;
  item?: (index: number) => SpeechRecognitionAlternativeLike | undefined;
  [index: number]: SpeechRecognitionAlternativeLike | undefined;
};

export type SpeechRecognitionResultListLike = {
  length: number;
  item?: (index: number) => SpeechRecognitionResultLike | undefined;
  [index: number]: SpeechRecognitionResultLike | undefined;
};

export type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
};

export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((event: Event) => void) | null;
  onend: ((event: Event) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
};

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type WindowWithSpeech = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export function findSpeechRecognitionConstructor(
  win: Window | undefined = typeof window === 'undefined' ? undefined : window,
): SpeechRecognitionConstructor | undefined {
  if (win === undefined) {
    return undefined;
  }
  const candidate = win as WindowWithSpeech;
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition;
}

export function isSpeechRecognitionSupported(
  win: Window | undefined = typeof window === 'undefined' ? undefined : window,
): boolean {
  return findSpeechRecognitionConstructor(win) !== undefined;
}

/**
 * One recognizer per WebView. Recreating on every press retriggers the iOS
 * system chime and can drop the first utterance.
 */
let sharedRecognition: SpeechRecognitionLike | undefined;

export function getSharedSpeechRecognition(lang: string): SpeechRecognitionLike | undefined {
  const Recognition = findSpeechRecognitionConstructor();
  if (Recognition === undefined) {
    return undefined;
  }
  if (sharedRecognition === undefined) {
    sharedRecognition = new Recognition();
  }
  sharedRecognition.lang = lang;
  sharedRecognition.continuous = true;
  sharedRecognition.interimResults = true;
  sharedRecognition.maxAlternatives = 1;
  return sharedRecognition;
}

export function resetSharedSpeechRecognition(): void {
  if (sharedRecognition !== undefined) {
    try {
      sharedRecognition.abort();
    } catch {
      // ignore
    }
  }
  sharedRecognition = undefined;
}

export function readSpeechRecognitionEvent(event: unknown): {
  finals: string[];
  interims: string[];
} {
  if (!isRecord(event) || !isRecord(event.results)) {
    return { finals: [], interims: [] };
  }
  const results = event.results;
  const resultCount = results.length;
  if (typeof resultCount !== 'number') {
    return { finals: [], interims: [] };
  }
  const resultIndex = typeof event.resultIndex === 'number' ? event.resultIndex : 0;
  const finals: string[] = [];
  const interims: string[] = [];
  for (let index = resultIndex; index < resultCount; index += 1) {
    const result = readIndexed(results, index);
    if (!isRecord(result)) {
      continue;
    }
    const alternative = readIndexed(result, 0);
    const transcript =
      isRecord(alternative) && typeof alternative.transcript === 'string'
        ? alternative.transcript
        : '';
    if (result.isFinal === true) {
      finals.push(transcript);
    } else {
      interims.push(transcript);
    }
  }
  return { finals, interims };
}

export function readSpeechRecognitionErrorCode(event: unknown): string {
  if (isRecord(event) && typeof event.error === 'string' && event.error.length > 0) {
    return event.error;
  }
  return 'unknown';
}

export async function warmMicrophoneAccess(): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.mediaDevices?.getUserMedia === undefined) {
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function readIndexed(value: object, index: number): unknown {
  const record = value as Record<string, unknown>;
  if (typeof record.item === 'function') {
    return (record.item as (itemIndex: number) => unknown)(index);
  }
  return record[String(index)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
