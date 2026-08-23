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
});
