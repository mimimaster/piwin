// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { prepareRendererRelaunch } from '../platform/renderer-relaunch-preparation.js';
import { useSpeechInput, type SpeechInputController } from './use-speech-input.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('protects a pending microphone permission request before recording begins', async () => {
  const mediaDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  let rejectPermission: ((error: Error) => void) | undefined;
  const getUserMedia = vi.fn(
    () =>
      new Promise<MediaStream>((_resolve, reject) => {
        rejectPermission = reject;
      }),
  );
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  vi.stubGlobal('MediaRecorder', class {});
  const root = createRoot(document.createElement('div'));
  let controller: SpeechInputController | undefined;
  function Harness() {
    controller = useSpeechInput({ enabled: true, request: vi.fn(), onTranscript: vi.fn() });
    return null;
  }
  try {
    act(() => root.render(<Harness />));
    expect(prepareRendererRelaunch()).toBe(true);
    act(() => controller?.toggle());
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(controller?.status).toBe('idle');
    expect(prepareRendererRelaunch()).toBe(false);
    await act(async () => {
      rejectPermission?.(new Error('permission declined'));
    });
    expect(prepareRendererRelaunch()).toBe(true);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    if (mediaDescriptor) Object.defineProperty(navigator, 'mediaDevices', mediaDescriptor);
    else Reflect.deleteProperty(navigator, 'mediaDevices');
  }
});
