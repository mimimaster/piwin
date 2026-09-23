// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PiwinConfig } from '@piwin/contracts';

import type { HostClient } from '../host-client';
import { useWindowsShellOffer } from './use-windows-shell-offer';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** Minimal config: the hook reads the offer flag and passes the draft back on write. */
function baseConfig(overrides: Partial<PiwinConfig> = {}): PiwinConfig {
  return {
    hostMode: 'rpc',
    providers: [],
    media: { maxPasteBytes: 1, allowedMimeTypes: [] },
    artifact: {
      enabled: false,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 1,
    },
    ...overrides,
  };
}

describe('useWindowsShellOffer', () => {
  let container: HTMLElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubWindows(): void {
    vi.stubGlobal('navigator', {
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });
  }

  /** Host answer is driven by `installed`, so a re-probe can change it. */
  function fakeHostClient(state: { installed: boolean; answer?: boolean }): HostClient {
    return {
      request: vi.fn(async () =>
        state.answer === false
          ? { success: false }
          : {
              success: true,
              data: { platform: 'win32', gitBashInstalled: state.installed },
            },
      ),
    } as unknown as HostClient;
  }

  let latest: ReturnType<typeof useWindowsShellOffer>;

  function Harness(props: { hostClient: HostClient; config: PiwinConfig; requestConfig: unknown }) {
    latest = useWindowsShellOffer({
      hostClient: props.hostClient,
      config: props.config,
      requestConfig: props.requestConfig as never,
    });
    return null;
  }

  async function render(props: {
    hostClient: HostClient;
    config: PiwinConfig;
    requestConfig: unknown;
  }): Promise<void> {
    await act(async () => {
      root.render(<Harness {...props} />);
    });
  }

  it('offers the install only when Git Bash is missing', async () => {
    stubWindows();
    await render({
      hostClient: fakeHostClient({ installed: false }),
      config: baseConfig(),
      requestConfig: vi.fn(),
    });
    expect(latest.offer).toBe(true);
  });

  it('stays quiet when Git Bash is installed, already declined, or not Windows', async () => {
    stubWindows();
    await render({
      hostClient: fakeHostClient({ installed: true }),
      config: baseConfig(),
      requestConfig: vi.fn(),
    });
    expect(latest.offer).toBe(false);

    await render({
      hostClient: fakeHostClient({ installed: false }),
      config: baseConfig({ shell: { windowsBashOfferDeclined: true } }),
      requestConfig: vi.fn(),
    });
    expect(latest.offer).toBe(false);

    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'Macintosh' });
    await render({
      hostClient: fakeHostClient({ installed: false }),
      config: baseConfig(),
      requestConfig: vi.fn(),
    });
    expect(latest.offer).toBe(false);
  });

  it('never reads a Host that cannot answer as "Git Bash is missing"', async () => {
    stubWindows();
    await render({
      hostClient: fakeHostClient({ installed: false, answer: false }),
      config: baseConfig(),
      requestConfig: vi.fn(),
    });
    expect(latest.offer).toBe(false);
  });

  it('records only the decline, never a shell to run', async () => {
    stubWindows();
    const requestConfig = vi.fn(async () => ({ success: true }));
    await render({
      hostClient: fakeHostClient({ installed: false }),
      config: baseConfig(),
      requestConfig,
    });

    act(() => {
      latest.declineGitBash();
    });

    expect(requestConfig).toHaveBeenCalledWith({
      type: 'config/set',
      config: expect.objectContaining({ shell: { windowsBashOfferDeclined: true } }),
    });
  });

  it('writes nothing when the user says they installed it', async () => {
    stubWindows();
    const state = { installed: false };
    const requestConfig = vi.fn(async () => ({ success: true }));
    await render({
      hostClient: fakeHostClient(state),
      config: baseConfig(),
      requestConfig,
    });

    // Confirmed straight after downloading, before the installer ran.
    act(() => {
      latest.useGitBash();
    });
    await act(async () => {});
    expect(requestConfig).not.toHaveBeenCalled();

    // Once detection sees the real thing the offer retires on its own.
    state.installed = true;
    await act(async () => {
      latest.useGitBash();
    });
    expect(latest.offer).toBe(false);
    expect(requestConfig).not.toHaveBeenCalled();
  });
});
