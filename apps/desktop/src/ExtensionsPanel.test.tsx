// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { ExtensionsPanel } from './ExtensionsPanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ExtensionsPanel refresh', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
      container.remove();
    }
  });

  it('lists on mount and applies the current session on refresh', async () => {
    const request = vi.fn(async (command: { type: string }) => {
      if (command.type === 'extensions/list') {
        return {
          type: 'response' as const,
          command: 'extensions/list',
          success: true as const,
          data: {
            extensions: [
              {
                id: 'pi-build-ios-apps',
                name: 'pi-build-ios-apps',
                description: 'RN',
                source: 'pi-native',
                path: '/pi/ext.ts',
                enabled: true,
                compatibility: { tier: 'compatible' },
              },
              {
                id: 'tui-theme',
                name: 'tui-theme',
                description: 'theme',
                source: 'pi-native',
                path: '/pi/theme.ts',
                enabled: false,
                compatibility: { tier: 'incompatible' },
              },
            ],
          },
        };
      }
      if (command.type === 'extensions/apply') {
        return {
          type: 'response' as const,
          command: 'extensions/apply',
          success: true as const,
          data: { state: 'active' },
        };
      }
      return { type: 'response' as const, command: command.type, success: true as const, data: {} };
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        (
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
              <ExtensionsPanel
                projectPath={null}
                sessionId="session-1"
                request={request as never}
                variant="inline"
              />
            </DesktopLocaleProvider>
          </PiwinUiProvider>
        ) as ReactElement,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalledWith({ type: 'extensions/list' });
    expect(request.mock.calls.some((call) => call[0]?.type === 'extensions/apply')).toBe(false);
    const compat = container.querySelector('[data-testid="extensions-compat-notice"]');
    expect(compat?.textContent).toContain('Pi extensions change the Agent, not the UI');
    expect(compat?.textContent).toContain('confirm / select / input / notify');
    expect(compat?.textContent).toContain('Pi TUI chrome');
    expect(container.querySelector('[data-testid="extension-compat-pi-build-ios-apps"]')?.textContent).toBe(
      'compatible',
    );
    expect(container.querySelector('[data-testid="extension-compat-tui-theme"]')?.textContent).toBe(
      'Pi TUI only',
    );

    const refresh = container.querySelector('[data-testid="extensions-refresh"]');
    expect(refresh).toBeTruthy();
    await act(async () => {
      (refresh as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      request.mock.calls.some(
        (call) =>
          call[0]?.type === 'extensions/apply' &&
          (call[0] as { sessionId?: string }).sessionId === 'session-1',
      ),
    ).toBe(true);
  });

  it('shows staged progress then a friendly error for a failed git install', async () => {
    let resolveInstall: ((value: HostResponseLike) => void) | undefined;
    const request = vi.fn(async (command: { type: string; source?: unknown }) => {
      if (command.type === 'extensions/list') {
        return {
          type: 'response' as const,
          command: 'extensions/list',
          success: true as const,
          data: { extensions: [] },
        };
      }
      if (command.type === 'extensions/install') {
        return new Promise<HostResponseLike>((resolve) => {
          resolveInstall = resolve;
        });
      }
      return { type: 'response' as const, command: command.type, success: true as const, data: {} };
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        (
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
              <ExtensionsPanel projectPath={null} request={request as never} variant="inline" />
            </DesktopLocaleProvider>
          </PiwinUiProvider>
        ) as ReactElement,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      (
        container?.querySelector('[data-testid="extensions-install-toggle"]') as HTMLButtonElement
      ).click();
    });
    const kindGit = Array.from(container.querySelectorAll('button')).find(
      (node) => node.textContent === 'Git',
    );
    await act(async () => kindGit?.click());
    const source = container.querySelector(
      '.settings-toolbar--install input.piwin-text-input-field',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(source, 'https://example.com/repo');
      source.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      (
        container?.querySelector('[data-testid="extensions-install-submit"]') as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="extensions-install-progress"]')).toBeTruthy();
    expect(
      (container.querySelector('[data-testid="extensions-install-submit"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    await act(async () => {
      resolveInstall?.({
        type: 'response',
        command: 'extensions/install',
        success: false,
        error:
          'git extension install failed: Extension directory must contain index.ts: /var/folders/xy/tmp/piwin-extension-git-AbC',
      });
      await Promise.resolve();
    });

    const notice = container.querySelector('[data-testid="extensions-install-error"]');
    expect(notice).toBeTruthy();
    expect(notice?.textContent).toContain('No extension entry point found');
    // The human-readable message never surfaces the throwaway temp clone path;
    // the raw string stays tucked inside the collapsed "Technical details".
    expect(notice?.querySelector('.ui-notice-message')?.textContent).not.toContain('/var/folders/');
    expect(notice?.querySelector('.ext-install-error-raw')?.textContent).toContain('/var/folders/');
    expect(container.querySelector('[data-testid="extensions-install-progress"]')).toBeNull();

    await act(async () => {
      (
        container?.querySelector(
          '[data-testid="extensions-install-error-dismiss"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(container.querySelector('[data-testid="extensions-install-error"]')).toBeNull();
  });

  it('explains that npm-distributed Pi TUI packages will not work', async () => {
    const request = vi.fn(async (command: { type: string }) => {
      if (command.type === 'extensions/list') {
        return {
          type: 'response' as const,
          command: 'extensions/list',
          success: true as const,
          data: { extensions: [] },
        };
      }
      if (command.type === 'extensions/install') {
        return {
          type: 'response' as const,
          command: 'extensions/install',
          success: false as const,
          error:
            '@injaneity/pi-computer-use is an npm-distributed package. Install it with `pi install npm:@injaneity/pi-computer-use`.',
        };
      }
      return { type: 'response' as const, command: command.type, success: true as const, data: {} };
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        (
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
              <ExtensionsPanel projectPath={null} request={request as never} variant="inline" />
            </DesktopLocaleProvider>
          </PiwinUiProvider>
        ) as ReactElement,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      (
        container?.querySelector('[data-testid="extensions-install-toggle"]') as HTMLButtonElement
      ).click();
    });
    const source = container.querySelector(
      '.settings-toolbar--install input.piwin-text-input-field',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(source, '/tmp/ext');
      source.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      (
        container?.querySelector('[data-testid="extensions-install-submit"]') as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });

    const notice = container.querySelector('[data-testid="extensions-install-error"]');
    expect(notice?.textContent).toContain('This is an npm package');
    expect(notice?.textContent).toContain('Pi TUI plugins');
  });
});

type HostResponseLike = {
  type: 'response';
  command: string;
  success: boolean;
  error?: string;
  data?: unknown;
};
