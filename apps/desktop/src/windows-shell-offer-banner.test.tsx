// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_LIGHT } from './appearance-tokens';
import { WindowsShellOfferBanner } from './windows-shell-offer-banner';
import * as openExternalUrlModule from './open-external-url.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('WindowsShellOfferBanner', () => {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    host?.remove();
    host = null;
    root = null;
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
  });

  function render(props: {
    visible: boolean;
    onUseGitBash?: () => void;
    onDecline?: () => void;
  }): void {
    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_LIGHT}>
          <WindowsShellOfferBanner
            visible={props.visible}
            locale="zh-CN"
            onUseGitBash={props.onUseGitBash ?? (() => undefined)}
            onDecline={props.onDecline ?? (() => undefined)}
          />
        </PiwinUiProvider>,
      );
    });
  }

  it('renders nothing when not visible', () => {
    render({ visible: false });
    expect(host?.querySelector('[data-testid="windows-shell-offer"]')).toBeNull();
  });

  it('opens the download page and only then offers the confirm step', async () => {
    const openSpy = vi
      .spyOn(openExternalUrlModule, 'openExternalUrl')
      .mockResolvedValue(true);
    const onUseGitBash = vi.fn();
    render({ visible: true, onUseGitBash });

    expect(host?.textContent).toContain('Git Bash');
    // Confirming before anything is downloaded would record a shell that is
    // not on disk yet, so the step does not exist yet.
    expect(host?.querySelector('[data-testid="windows-shell-confirm"]')).toBeNull();

    await act(async () => {
      host
        ?.querySelector<HTMLButtonElement>('[data-testid="windows-shell-install"]')
        ?.click();
    });

    expect(openSpy).toHaveBeenCalledWith('https://git-scm.com/download/win');
    const confirm = host?.querySelector<HTMLButtonElement>('[data-testid="windows-shell-confirm"]');
    expect(confirm).not.toBeNull();

    act(() => {
      confirm?.click();
    });
    expect(onUseGitBash).toHaveBeenCalledTimes(1);
  });

  it('keeps the confirm step hidden when the download page does not open', async () => {
    vi.spyOn(openExternalUrlModule, 'openExternalUrl').mockResolvedValue(false);
    render({ visible: true });

    await act(async () => {
      host
        ?.querySelector<HTMLButtonElement>('[data-testid="windows-shell-install"]')
        ?.click();
    });

    expect(host?.querySelector('[data-testid="windows-shell-confirm"]')).toBeNull();
  });

  it('records the PowerShell fallback from the decline button', () => {
    const onDecline = vi.fn();
    render({ visible: true, onDecline });

    act(() => {
      host
        ?.querySelector<HTMLButtonElement>('[data-testid="windows-shell-powershell"]')
        ?.click();
    });

    expect(onDecline).toHaveBeenCalledTimes(1);
  });
});
