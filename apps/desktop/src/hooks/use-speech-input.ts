import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SPEECH_MAX_AUDIO_BYTES,
  SPEECH_MAX_DURATION_MS,
  sanitizeLiveDelegationInstruction,
} from '@piwin/contracts';
import type { HostResponse, SpeechTranscribeData, SpeechTranscribeInput } from '@piwin/contracts';

export type SpeechInputStatus = 'idle' | 'listening' | 'transcribing';

export type SpeechInputRequest = (input: SpeechTranscribeInput) => Promise<HostResponse>;

export type UseSpeechInputOptions = {
  enabled: boolean;
  request?: SpeechInputRequest;
  onTranscript: (text: string) => void;
};

export type SpeechInputController = {
  status: SpeechInputStatus;
  error: string | null;
  toggle: () => void;
};

const RECORDER_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
] as const;

/** Choose a browser-supported recording container without probing permissions. */
export function chooseRecorderMimeType(
  isSupported: (mimeType: string) => boolean = (mimeType) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mimeType),
): string {
  return RECORDER_MIME_CANDIDATES.find((mimeType) => isSupported(mimeType)) ?? '';
}

/** Convert transient recorder bytes to transport base64 without a large call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function useSpeechInput(options: UseSpeechInputOptions): SpeechInputController {
  const [status, setStatus] = useState<SpeechInputStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const cancelledRef = useRef(false);
  const requestRef = useRef(options.request);
  const onTranscriptRef = useRef(options.onTranscript);
  requestRef.current = options.request;
  onTranscriptRef.current = options.onTranscript;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelledRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
      releaseMediaStream(streamRef.current);
      clearRecordingTimeout(recordingTimeoutRef);
      recorderRef.current = null;
      streamRef.current = null;
      chunksRef.current = [];
    };
  }, []);

  const finishRecording = useCallback(async (mimeType: string, durationMs: number) => {
    const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
    chunksRef.current = [];
    clearRecordingTimeout(recordingTimeoutRef);
    releaseMediaStream(streamRef.current);
    streamRef.current = null;
    recorderRef.current = null;
    if (cancelledRef.current || blob.size === 0) {
      if (mountedRef.current) setStatus('idle');
      return;
    }
    if (blob.size > SPEECH_MAX_AUDIO_BYTES) {
      if (mountedRef.current) {
        setError('Audio recording is too large.');
        setStatus('idle');
      }
      return;
    }
    const request = requestRef.current;
    if (!request) {
      if (mountedRef.current) {
        setError('ASR request is unavailable.');
        setStatus('idle');
      }
      return;
    }
    if (mountedRef.current) {
      setStatus('transcribing');
      setError(null);
    }
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const response = await request({
        mimeType: blob.type || mimeType || 'audio/webm',
        base64Data: bytesToBase64(bytes),
        durationMs,
      });
      if (!response.success) {
        throw new Error(response.error);
      }
      const data = response.data as SpeechTranscribeData | undefined;
      if (!data || typeof data.text !== 'string') {
        throw new Error('ASR response did not contain transcript text.');
      }
      const transcript = sanitizeLiveDelegationInstruction(data.text);
      if (!transcript) {
        return;
      }
      if (!cancelledRef.current) {
        onTranscriptRef.current(transcript);
      }
    } catch (caughtError) {
      if (mountedRef.current && !cancelledRef.current) {
        setError(caughtError instanceof Error ? caughtError.message : 'ASR transcription failed.');
      }
    } finally {
      if (mountedRef.current) setStatus('idle');
    }
  }, []);

  const start = useCallback(async () => {
    if (!options.enabled || status !== 'idle') return;
    if (!requestRef.current) {
      setError('ASR request is unavailable.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('This desktop environment does not support microphone recording.');
      return;
    }
    cancelledRef.current = false;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current || !options.enabled) {
        releaseMediaStream(stream);
        return;
      }
      streamRef.current = stream;
      const preferredMimeType = chooseRecorderMimeType();
      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        releaseMediaStream(streamRef.current);
        clearRecordingTimeout(recordingTimeoutRef);
        streamRef.current = null;
        recorderRef.current = null;
        chunksRef.current = [];
        if (mountedRef.current) {
          setStatus('idle');
          setError('Microphone recording failed.');
        }
      };
      recorder.onstop = () => {
        const durationMs = Math.max(1, Date.now() - startedAtRef.current);
        // The event handler intentionally owns the async transcription task.
        void finishRecording(recorder.mimeType || preferredMimeType, durationMs);
      };
      recorder.start();
      recordingTimeoutRef.current = setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, SPEECH_MAX_DURATION_MS);
      setStatus('listening');
    } catch (caughtError) {
      releaseMediaStream(streamRef.current);
      clearRecordingTimeout(recordingTimeoutRef);
      streamRef.current = null;
      recorderRef.current = null;
      setStatus('idle');
      setError(
        caughtError instanceof Error ? caughtError.message : 'Microphone permission denied.',
      );
    }
  }, [finishRecording, options.enabled, status]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    recorder.stop();
  }, []);

  const toggle = useCallback(() => {
    if (status === 'listening') {
      stop();
      return;
    }
    if (status === 'idle') {
      void start();
    }
  }, [start, status, stop]);

  useEffect(() => {
    if (!options.enabled && status === 'listening') {
      cancelledRef.current = true;
      stop();
    }
  }, [options.enabled, status, stop]);

  return { status, error, toggle };
}

function releaseMediaStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

function clearRecordingTimeout(timeoutRef: {
  current: ReturnType<typeof setTimeout> | null;
}): void {
  if (timeoutRef.current !== null) {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }
}
