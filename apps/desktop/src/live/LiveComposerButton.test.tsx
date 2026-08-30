// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens.js';
import type { LiveCallView } from '@piwin/contracts';
import { LiveComposerButton } from './LiveComposerButton.js';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const call: LiveCallView = {
  callId: 'c1',
  revision: 1,
  phase: 'active',
  boundSessionId: 's1',
  boundSessionLabel: '图片生成被审核拦截',
  ownerDeviceId: 'local',
  providerId: 'openai-codex',
  mediaDriverId: 'codex-webrtc-v1',
  voiceModelId: 'gpt-live-1-codex',
  startedAt: '2026-08-29T00:00:00.000Z',
};

describe('LiveComposerButton', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
  });

  function render(node: ReactElement): void {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const next = createRoot(host);
    act(() => {
      next.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
    });
    root = next;
    container = host;
  }

  it('does not turn the active composer entry into an accidental hangup control', () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    render(
      <LiveComposerButton
        enabled={true}
        canStart={true}
        starting={false}
        call={call}
        error={null}
        missing={[]}
        isChinese={true}
        onStart={onStart}
        onEnd={onEnd}
      />,
    );
    act(() => {
      container?.querySelector<HTMLButtonElement>('[data-testid="composer-live-btn"]')?.click();
    });
    expect(onEnd).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
  });

  it('cancels an in-flight start instead of starting again', () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    render(
      <LiveComposerButton
        enabled={true}
        canStart={false}
        starting={true}
        call={null}
        error={null}
        missing={[]}
        isChinese={true}
        onStart={onStart}
        onEnd={onEnd}
      />,
    );
    expect(container?.querySelector('[data-testid="composer-live-btn"]')?.textContent).toContain(
      '连接中',
    );
    act(() => {
      container?.querySelector<HTMLButtonElement>('[data-testid="composer-live-btn"]')?.click();
    });
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });
});
