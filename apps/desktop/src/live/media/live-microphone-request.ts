import { waitForLiveStart } from '../live-start-wait.js';

export async function requestLiveMicrophone(input: {
  request?: () => Promise<MediaStream>;
  signal?: AbortSignal;
} = {}): Promise<MediaStream> {
  if (input.signal?.aborted) throw new DOMException('aborted', 'AbortError');
  const request = input.request ?? (() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('mic-unavailable');
    }
    return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  });
  return waitForLiveStart({
    work: request(),
    ...(input.signal ? { signal: input.signal } : {}),
    timeoutMs: 30_000,
    timeoutCode: 'mic-permission-timeout',
    releaseLate: (stream) => { for (const track of stream.getTracks()) track.stop(); },
  });
}

export function mapLiveMicrophoneError(error: unknown): 'mic-denied' | 'mic-unavailable' | 'mic-permission-timeout' {
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
    return 'mic-denied';
  }
  if (error instanceof Error && error.message === 'mic-permission-timeout') return 'mic-permission-timeout';
  return 'mic-unavailable';
}
