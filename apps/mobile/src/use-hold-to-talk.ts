import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  HOLD_TO_TALK_EMPTY_HINT,
  HOLD_TO_TALK_FINAL_TIMEOUT_MS,
  HOLD_TO_TALK_LONG_PRESS_MS,
  HOLD_TO_TALK_TAP_HINT,
  accumulateSpeechSlices,
  classifyHoldToTalkRelease,
  isHoldToTalkSlideCancel,
  liveHoldTranscript,
  mapSpeechRecognitionError,
  shouldSendHoldTranscript,
  type HoldToTalkPhase,
} from './hold-to-talk.js';
import {
  getSharedSpeechRecognition,
  isSpeechRecognitionSupported,
  readSpeechRecognitionErrorCode,
  readSpeechRecognitionEvent,
  warmMicrophoneAccess,
  type SpeechRecognitionLike,
} from './speech-recognition.js';

export type UseHoldToTalkOptions = {
  enabled: boolean;
  lang?: string;
  onSend: (text: string) => void;
  onError?: (message: string) => void;
};

export function useHoldToTalk(options: UseHoldToTalkOptions) {
  const { enabled, lang = 'zh-CN', onSend, onError } = options;
  const [supported] = useState(() => isSpeechRecognitionSupported());
  const [phase, setPhase] = useState<HoldToTalkPhase>('idle');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [hint, setHint] = useState<string | undefined>();
  const [cancelling, setCancelling] = useState(false);

  const onSendRef = useRef(onSend);
  const onErrorRef = useRef(onError);
  onSendRef.current = onSend;
  onErrorRef.current = onError;

  const pointerIdRef = useRef<number | undefined>(undefined);
  const startYRef = useRef(0);
  const startAtRef = useRef(0);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const startedListeningRef = useRef(false);
  const cancelledRef = useRef(false);
  const finalsRef = useRef('');
  const interimRef = useRef('');
  const errorCodeRef = useRef<string | undefined>(undefined);
  const endedRef = useRef(true);
  const waitersRef = useRef<Array<(text: string) => void>>([]);
  const warmedRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionLike | undefined>(undefined);

  const clearArmTimer = useCallback(() => {
    if (armTimerRef.current !== undefined) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = undefined;
    }
  }, []);

  const resetTranscript = useCallback(() => {
    finalsRef.current = '';
    interimRef.current = '';
    errorCodeRef.current = undefined;
    setLiveTranscript('');
    setCancelling(false);
  }, []);

  const resolveWaiters = useCallback((text: string) => {
    const waiters = waitersRef.current;
    waitersRef.current = [];
    for (const resolve of waiters) {
      resolve(text);
    }
  }, []);

  const bindRecognitionHandlers = useCallback(
    (recognition: SpeechRecognitionLike) => {
      recognition.onstart = () => {
        endedRef.current = false;
        startedListeningRef.current = true;
        setPhase('listening');
      };
      recognition.onresult = (event) => {
        const parsed = readSpeechRecognitionEvent(event);
        const slices = [
          ...parsed.finals.map((transcript) => ({ isFinal: true as const, transcript })),
          ...parsed.interims.map((transcript) => ({ isFinal: false as const, transcript })),
        ];
        const accumulated = accumulateSpeechSlices(slices);
        if (accumulated.finals.length > 0) {
          finalsRef.current =
            finalsRef.current.length === 0
              ? accumulated.finals
              : `${finalsRef.current} ${accumulated.finals}`.trim();
        }
        interimRef.current = accumulated.interim;
        setLiveTranscript(liveHoldTranscript(finalsRef.current, interimRef.current));
      };
      recognition.onerror = (event) => {
        const code = readSpeechRecognitionErrorCode(event);
        errorCodeRef.current = code;
        const mapped = mapSpeechRecognitionError(code);
        if (mapped !== undefined) {
          onErrorRef.current?.(mapped);
        }
      };
      recognition.onend = () => {
        endedRef.current = true;
        window.setTimeout(() => {
          resolveWaiters(finalsRef.current.trim());
        }, 40);
      };
    },
    [resolveWaiters],
  );

  const waitForFinals = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      if (endedRef.current) {
        window.setTimeout(() => resolve(finalsRef.current.trim()), 40);
        return;
      }
      const timer = window.setTimeout(() => {
        waitersRef.current = waitersRef.current.filter((item) => item !== resolve);
        resolve(finalsRef.current.trim());
      }, HOLD_TO_TALK_FINAL_TIMEOUT_MS);
      waitersRef.current.push((text) => {
        window.clearTimeout(timer);
        resolve(text);
      });
    });
  }, []);

  const startListening = useCallback(async () => {
    if (!enabled || cancelledRef.current) {
      return;
    }
    const recognition = getSharedSpeechRecognition(lang);
    if (recognition === undefined) {
      onErrorRef.current?.('当前环境不支持按住说话。');
      return;
    }
    recognitionRef.current = recognition;
    bindRecognitionHandlers(recognition);
    resetTranscript();
    if (!warmedRef.current) {
      try {
        await warmMicrophoneAccess();
        warmedRef.current = true;
      } catch {
        onErrorRef.current?.('请在系统设置中允许麦克风和语音识别。');
        return;
      }
    }
    if (cancelledRef.current || pointerIdRef.current === undefined) {
      return;
    }
    try {
      recognition.start();
    } catch {
      onErrorRef.current?.('无法开始语音识别。');
    }
  }, [bindRecognitionHandlers, enabled, lang, resetTranscript]);

  const abortListening = useCallback(() => {
    cancelledRef.current = true;
    setCancelling(true);
    try {
      recognitionRef.current?.abort();
    } catch {
      // ignore
    }
    endedRef.current = true;
    resolveWaiters('');
    setPhase('idle');
    resetTranscript();
  }, [resetTranscript, resolveWaiters]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!enabled || !supported || event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      pointerIdRef.current = event.pointerId;
      startYRef.current = event.clientY;
      startAtRef.current = Date.now();
      startedListeningRef.current = false;
      cancelledRef.current = false;
      setHint(undefined);
      clearArmTimer();
      armTimerRef.current = setTimeout(() => {
        void startListening();
      }, HOLD_TO_TALK_LONG_PRESS_MS);
    },
    [clearArmTimer, enabled, startListening, supported],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (pointerIdRef.current !== event.pointerId) {
        return;
      }
      if (isHoldToTalkSlideCancel(startYRef.current, event.clientY)) {
        clearArmTimer();
        if (startedListeningRef.current || phase === 'listening') {
          abortListening();
        } else {
          cancelledRef.current = true;
        }
      }
    },
    [abortListening, clearArmTimer, phase],
  );

  const handlePointerUp = useCallback(
    async (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (pointerIdRef.current !== event.pointerId) {
        return;
      }
      pointerIdRef.current = undefined;
      clearArmTimer();
      const kind = classifyHoldToTalkRelease({
        heldMs: Date.now() - startAtRef.current,
        startedListening: startedListeningRef.current,
        cancelled: cancelledRef.current,
      });
      if (kind === 'tap-hint') {
        setHint(HOLD_TO_TALK_TAP_HINT);
        setPhase('idle');
        return;
      }
      if (kind === 'abort') {
        abortListening();
        return;
      }
      setPhase('finalizing');
      try {
        recognitionRef.current?.stop();
      } catch {
        endedRef.current = true;
      }
      const finals = await waitForFinals();
      const sendable = shouldSendHoldTranscript({
        cancelled: cancelledRef.current,
        finals,
        ...(errorCodeRef.current === undefined ? {} : { errorCode: errorCodeRef.current }),
      });
      setPhase('idle');
      setLiveTranscript('');
      if (!sendable) {
        if (!cancelledRef.current) {
          setHint(HOLD_TO_TALK_EMPTY_HINT);
        }
        return;
      }
      onSendRef.current(finals);
    },
    [abortListening, clearArmTimer, waitForFinals],
  );

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (pointerIdRef.current !== event.pointerId) {
        return;
      }
      pointerIdRef.current = undefined;
      clearArmTimer();
      abortListening();
    },
    [abortListening, clearArmTimer],
  );

  useEffect(() => {
    const abortIfHidden = () => {
      if (document.visibilityState === 'hidden') {
        clearArmTimer();
        abortListening();
      }
    };
    document.addEventListener('visibilitychange', abortIfHidden);
    return () => {
      document.removeEventListener('visibilitychange', abortIfHidden);
      clearArmTimer();
      try {
        recognitionRef.current?.abort();
      } catch {
        // ignore
      }
    };
  }, [abortListening, clearArmTimer]);

  return {
    supported,
    phase,
    liveTranscript,
    hint,
    cancelling,
    micPointer: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => {
        void handlePointerUp(event);
      },
      onPointerCancel: handlePointerCancel,
    },
  };
}
