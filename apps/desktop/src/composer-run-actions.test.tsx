// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ComposerActionSlot, type ComposerActionSlotCopy } from './composer-run-actions';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const copy: ComposerActionSlotCopy = {
  send: 'Send',
  sendShortcut: 'Send (Enter)',
  pause: 'Pause',
  pausing: 'Pausing…',
  stop: 'Stop',
  stopping: 'Stopping…',
  continueRun: 'Continue run',
  attachmentRetryOnly: 'Retry attachments',
  queueFollowUp: 'Queue follow-up',
  queueFollowUpHint: 'Queue next turn (Enter)',
};

const CIRCULAR =
  '[data-testid="send-btn"], [data-testid="pause-btn"], [data-testid="resume-run-btn"], [data-testid="discard-pause-btn"], [data-testid="stop-btn"]';

const idle = {
  copy,
  activeSessionId: 'session-1',
  runPhase: 'idle' as const,
  isStreamingRun: false,
  isPaused: false,
  hasContent: false,
  onlyFailedAttachments: false,
  isExtensionUiActive: false,
  onSend: vi.fn(),
  onPause: vi.fn(),
};

describe('ComposerActionSlot', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    root = null;
    container = null;
  });

  function renderSlot(props: Parameters<typeof ComposerActionSlot>[0]): HTMLElement {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<ComposerActionSlot {...props} />);
    });
    return container;
  }

  it('idle empty: one disabled Send', () => {
    const node = renderSlot(idle);
    expect(node.querySelectorAll(CIRCULAR).length).toBe(1);
    const send = node.querySelector('[data-testid="send-btn"]') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  it('live empty: one Pause, never a second Send or Stop circle', () => {
    const onPause = vi.fn();
    const node = renderSlot({
      ...idle,
      isStreamingRun: true,
      runPhase: 'streaming',
      onPause,
    });
    expect(node.querySelectorAll(CIRCULAR).length).toBe(1);
    expect(node.querySelector('[data-testid="send-btn"]')).toBeNull();
    expect(node.querySelector('[data-testid="steer-btn"]')).toBeNull();
    expect(node.querySelector('[data-testid="stop-btn"]')).toBeNull();
    expect(node.querySelector('[data-testid="discard-pause-btn"]')).toBeNull();
    const pause = node.querySelector('[data-testid="pause-btn"]') as HTMLButtonElement;
    act(() => {
      pause.click();
    });
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('live draft: Send replaces Pause and queues on click', () => {
    const onSend = vi.fn();
    const onPause = vi.fn();
    const node = renderSlot({
      ...idle,
      isStreamingRun: true,
      runPhase: 'streaming',
      hasContent: true,
      onSend,
      onPause,
    });
    expect(node.querySelectorAll(CIRCULAR).length).toBe(1);
    expect(node.querySelector('[data-testid="pause-btn"]')).toBeNull();
    expect(node.querySelector('[data-testid="steer-btn"]')).toBeNull();
    const send = node.querySelector('[data-testid="send-btn"]') as HTMLButtonElement;
    expect(send.getAttribute('aria-label')).toBe('Queue follow-up');
    act(() => {
      send.click();
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onPause).not.toHaveBeenCalled();
  });

  it('live pausing with draft: keeps disabled Pause', () => {
    const onSend = vi.fn();
    const onPause = vi.fn();
    const node = renderSlot({
      ...idle,
      isStreamingRun: true,
      runPhase: 'pausing',
      hasContent: true,
      onSend,
      onPause,
    });
    expect(node.querySelector('[data-testid="send-btn"]')).toBeNull();
    const pause = node.querySelector('[data-testid="pause-btn"]') as HTMLButtonElement;
    expect(pause.disabled).toBe(true);
    act(() => {
      pause.click();
    });
    expect(onPause).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('paused empty: one Continue, no Discard', () => {
    const onResume = vi.fn();
    const node = renderSlot({
      ...idle,
      isPaused: true,
      onResume,
    });
    expect(node.querySelectorAll(CIRCULAR).length).toBe(1);
    expect(node.querySelector('[data-testid="discard-pause-btn"]')).toBeNull();
    const resume = node.querySelector('[data-testid="resume-run-btn"]') as HTMLButtonElement;
    act(() => {
      resume.click();
    });
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('paused with draft: one Send, not Continue+Discard', () => {
    const onSend = vi.fn();
    const node = renderSlot({
      ...idle,
      isPaused: true,
      hasContent: true,
      onSend,
      onResume: vi.fn(),
    });
    expect(node.querySelectorAll(CIRCULAR).length).toBe(1);
    expect(node.querySelector('[data-testid="resume-run-btn"]')).toBeNull();
    expect(node.querySelector('[data-testid="discard-pause-btn"]')).toBeNull();
    const send = node.querySelector('[data-testid="send-btn"]') as HTMLButtonElement;
    act(() => {
      send.click();
    });
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
