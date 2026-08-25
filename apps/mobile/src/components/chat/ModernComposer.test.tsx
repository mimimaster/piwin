// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { ModernComposer } from './ModernComposer.js';
import { MOBILE_THEME } from '../../mobile-theme.js';
import { HOLD_TO_TALK_LONG_PRESS_MS, HOLD_TO_TALK_TAP_HINT } from '../../hold-to-talk.js';
import { resetSharedSpeechRecognition } from '../../speech-recognition.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

class FakeSpeechRecognition {
  public lang = '';
  public continuous = false;
  public interimResults = false;
  public maxAlternatives = 1;
  public onstart: ((event: Event) => void) | null = null;
  public onend: ((event: Event) => void) | null = null;
  public onerror: ((event: { error: string }) => void) | null = null;
  public onresult: ((event: unknown) => void) | null = null;
  public emitFinalOnStart = true;

  public start(): void {
    this.onstart?.(new Event('start'));
    if (this.emitFinalOnStart) {
      this.onresult?.({
        resultIndex: 0,
        results: {
          length: 1,
          0: { isFinal: true, 0: { transcript: '这个报错什么意思' } },
        },
      });
    }
  }

  public stop(): void {
    this.onend?.(new Event('end'));
  }

  public abort(): void {
    this.onend?.(new Event('end'));
  }
}

describe('ModernComposer hold-to-talk', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    resetSharedSpeechRecognition();
    if (!HTMLElement.prototype.setPointerCapture) {
      HTMLElement.prototype.setPointerCapture = () => undefined;
      HTMLElement.prototype.releasePointerCapture = () => undefined;
    }
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    resetSharedSpeechRecognition();
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
    vi.useRealTimers();
  });

  it('shows the @Health chip only when Health is enabled', () => {
    const onToggleAppleHealth = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <ModernComposer
            composerText="分析睡眠"
            setComposerText={() => undefined}
            attachments={[]}
            onRemoveAttachment={() => undefined}
            onFileSelected={() => undefined}
            onSend={() => undefined}
            isSending={false}
            isUploadingMedia={false}
            healthEnabled={true}
            includeAppleHealth={false}
            onToggleAppleHealth={onToggleAppleHealth}
          />
        </PiwinUiProvider>,
      );
    });
    const chip = container.querySelector('[data-testid="mobile-health-chip"]');
    expect(chip).not.toBeNull();
    act(() => {
      (chip as HTMLButtonElement).click();
    });
    expect(onToggleAppleHealth).toHaveBeenCalled();
  });

  it('hides the mic when SpeechRecognition is unavailable', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <ModernComposer
            composerText=""
            setComposerText={() => undefined}
            attachments={[]}
            onRemoveAttachment={() => undefined}
            onFileSelected={() => undefined}
            onSend={() => undefined}
            isSending={false}
            isUploadingMedia={false}
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="mobile-hold-mic"]')).toBeNull();
    const camera = container.querySelector('[data-testid="mobile-camera-input"]');
    expect(camera?.getAttribute('capture')).toBe('environment');
    expect(camera?.getAttribute('accept')).toBe('image/*');
  });

  it('shows a hold hint on a short tap and does not send', () => {
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition =
      FakeSpeechRecognition;
    const onSend = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <ModernComposer
            composerText=""
            setComposerText={() => undefined}
            attachments={[]}
            onRemoveAttachment={() => undefined}
            onFileSelected={() => undefined}
            onSend={onSend}
            isSending={false}
            isUploadingMedia={false}
          />
        </PiwinUiProvider>,
      );
    });
    const mic = container.querySelector('[data-testid="mobile-hold-mic"]');
    expect(mic).not.toBeNull();
    act(() => {
      mic?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, clientY: 400 }),
      );
      mic?.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0, clientY: 400 }),
      );
    });
    expect(container.textContent).toContain(HOLD_TO_TALK_TAP_HINT);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends accumulated finals after a hold release, not on pointerup', async () => {
    vi.useFakeTimers();
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition =
      FakeSpeechRecognition;
    const onSend = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <ModernComposer
            composerText=""
            setComposerText={() => undefined}
            attachments={[]}
            onRemoveAttachment={() => undefined}
            onFileSelected={() => undefined}
            onSend={onSend}
            isSending={false}
            isUploadingMedia={false}
          />
        </PiwinUiProvider>,
      );
    });
    const mic = container.querySelector('[data-testid="mobile-hold-mic"]');
    act(() => {
      mic?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, clientY: 400 }),
      );
    });
    await act(async () => {
      vi.advanceTimersByTime(HOLD_TO_TALK_LONG_PRESS_MS);
      await Promise.resolve();
    });
    expect(onSend).not.toHaveBeenCalled();
    await act(async () => {
      mic?.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0, clientY: 400 }),
      );
      vi.advanceTimersByTime(80);
      await Promise.resolve();
    });
    expect(onSend).toHaveBeenCalledWith('这个报错什么意思');
  });

  it('does not send when the pointer slides up to cancel', async () => {
    vi.useFakeTimers();
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition =
      FakeSpeechRecognition;
    const onSend = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <ModernComposer
            composerText=""
            setComposerText={() => undefined}
            attachments={[]}
            onRemoveAttachment={() => undefined}
            onFileSelected={() => undefined}
            onSend={onSend}
            isSending={false}
            isUploadingMedia={false}
          />
        </PiwinUiProvider>,
      );
    });
    const mic = container.querySelector('[data-testid="mobile-hold-mic"]');
    act(() => {
      mic?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, clientY: 400 }),
      );
    });
    await act(async () => {
      vi.advanceTimersByTime(HOLD_TO_TALK_LONG_PRESS_MS);
      await Promise.resolve();
    });
    act(() => {
      mic?.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, pointerId: 1, button: 0, clientY: 300 }),
      );
      mic?.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0, clientY: 300 }),
      );
    });
    expect(onSend).not.toHaveBeenCalled();
  });
});
