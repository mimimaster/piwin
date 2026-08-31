// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens.js';
import { DesktopLocaleProvider } from '../desktop-locale-context.js';
import type { LiveCallView } from '@piwin/contracts';
import { LiveBar } from './LiveBar.js';

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

describe('LiveBar', () => {
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
      next.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
            {node}
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });
    root = next;
    container = host;
  }

  const controls = {
    starting: false,
    peer: { phase: 'connected', muted: false, errorCode: null } as const,
    error: null,
    onRetry: vi.fn(),
    onDismiss: vi.fn(),
    onMute: vi.fn(),
    onEnd: vi.fn(),
  };

  it('renders the bound session on the compact capsule', () => {
    render(<LiveBar call={call} {...controls} />);
    const bar = container?.querySelector('[data-testid="live-bar"]');
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute('aria-label')).toContain('语音正在倾听');
    expect(container?.querySelector('[data-testid="live-bar-session"]')?.textContent).toBe(
      '图片生成被审核拦截',
    );
  });

  it('renders spinner only while media is still coming up', () => {
    render(
      <LiveBar
        call={{ ...call, phase: 'starting' }}
        {...controls}
        peer={{ phase: 'negotiating', muted: false, errorCode: null }}
      />,
    );
    const bar = container?.querySelector('[data-testid="live-bar"]');
    expect(bar?.getAttribute('aria-label')).toContain('正在连接');
    expect(bar?.classList.contains('is-connecting')).toBe(true);
    expect(container?.querySelector('.live-spinner')).not.toBeNull();
  });

  it('leaves the connecting spinner once local media is up', () => {
    render(<LiveBar call={{ ...call, phase: 'starting' }} {...controls} />);
    const bar = container?.querySelector('[data-testid="live-bar"]');
    expect(bar?.getAttribute('aria-label')).toContain('语音正在倾听');
    expect(container?.querySelector('.live-spinner')).toBeNull();
    expect(container?.querySelector('.live-equalizer')).not.toBeNull();
  });

  it('provides accessible retry and dismiss icon buttons on error', () => {
    render(<LiveBar call={null} {...controls} error="live-provider-access-denied" />);
    const bar = container?.querySelector('[data-testid="live-bar"]');
    expect(bar?.getAttribute('aria-label')).toContain('语音连接未建立');
    expect(bar?.classList.contains('is-error')).toBe(true);

    const retryBtn = container?.querySelector('[data-testid="live-bar-retry"]') as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();
    act(() => {
      retryBtn.click();
    });
    expect(controls.onRetry).toHaveBeenCalled();

    const dismissBtn = container?.querySelector('[data-testid="live-bar-dismiss"]') as HTMLButtonElement;
    expect(dismissBtn).not.toBeNull();
    act(() => {
      dismissBtn.click();
    });
    expect(controls.onDismiss).toHaveBeenCalled();
  });

  it('toggles mute and triggers hangup via pure icon buttons', () => {
    render(<LiveBar call={call} {...controls} />);
    const muteBtn = container?.querySelector('[data-testid="live-bar-mute"]') as HTMLButtonElement;
    expect(muteBtn).not.toBeNull();
    act(() => {
      muteBtn.click();
    });
    expect(controls.onMute).toHaveBeenCalledWith(true);

    const endBtn = container?.querySelector('[data-testid="live-bar-end"]') as HTMLButtonElement;
    expect(endBtn).not.toBeNull();
    act(() => {
      endBtn.click();
    });
    expect(controls.onEnd).toHaveBeenCalled();
  });

  it('keeps real mute controls while responding instead of a fake interrupt button', () => {
    render(<LiveBar call={{ ...call, activity: 'assistant-speaking' }} {...controls} />);
    const interruptBtn = container?.querySelector('[data-testid="live-bar-interrupt"]') as HTMLButtonElement;
    expect(interruptBtn).toBeNull();
    expect(container?.querySelector('[data-testid="live-bar-mute"]')).not.toBeNull();
  });

  it('does not present unmute as permission approval', () => {
    render(<LiveBar call={{ ...call, activity: 'waiting-for-permission' }} {...controls} />);
    expect(container?.querySelector('[data-testid="live-bar-allow"]')).toBeNull();
    expect(container?.querySelector('[data-testid="live-bar-mute"]')).not.toBeNull();
  });

  it('shows the failure text visually and announces it', () => {
    render(<LiveBar call={null} {...controls} error="live-protocol-failed" />);
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain('上游');
  });

  it('renders drag grip dots for free repositioning', () => {
    render(<LiveBar call={call} {...controls} />);
    const grip = container?.querySelector('.live-bar-grip');
    expect(grip).not.toBeNull();
    expect(grip?.getAttribute('title')).toBe('按住可拖拽移动');
  });
});
