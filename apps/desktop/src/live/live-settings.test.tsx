// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PiwinConfig } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens.js';
import { DesktopLocaleProvider } from '../desktop-locale-context.js';
import { LiveSettings, type LiveSettingsHostRequest } from './live-settings.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function makeConfig(): PiwinConfig {
  return {
    hostMode: 'sdk',
    providers: [],
    media: { maxPasteBytes: 1_000_000, allowedMimeTypes: [] },
    artifact: {
      enabled: true,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 1_000_000,
    },
  };
}

describe('LiveSettings', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
      container.remove();
    }
    root = undefined;
    container = undefined;
  });

  it('explains composer start without a settings toggle', () => {
    const saveConfig = vi.fn(async () => true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
            <LiveSettings
              config={makeConfig()}
              saving={false}
              onSave={saveConfig}
              onError={vi.fn()}
              onInfo={vi.fn()}
            />
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="settings-live-card"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="settings-live-toggle"]')).toBeNull();
    expect(container.querySelector('[data-testid="settings-live-card"]')?.textContent).toMatch(
      /composer|输入栏/i,
    );
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('renders Host schema fields and never echoes an API key', async () => {
    const saveConfig = vi.fn(async () => true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const hostRequest = vi.fn(async (command: { type: string }) => {
      if (command.type === 'voice/live/settings-schema') {
        return {
          type: 'response' as const,
          command: command.type,
          success: true,
          data: {
            revision: 1,
            selectedProviderId: 'google-gemini',
            providers: [
              {
                providerId: 'google-gemini',
                title: 'Gemini',
                mediaKind: 'pcm-websocket',
                mediaDriverId: 'gemini-live-v1beta',
                auth: { kind: 'api-key', providerId: 'google-gemini', keyConfigured: true },
                settings: [
                  {
                    key: 'voice',
                    control: 'select',
                    label: 'Voice',
                    required: true,
                    defaultValue: 'Kore',
                    options: [{ value: 'Kore', label: 'Kore' }],
                  },
                ],
              },
            ],
          },
        };
      }
      return { type: 'response' as const, command: command.type, success: false, error: 'unused' };
    });
    await act(async () => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
            <LiveSettings
              config={makeConfig()}
              saving={false}
              onSave={saveConfig}
              onError={vi.fn()}
              onInfo={vi.fn()}
              hostRequest={hostRequest as unknown as LiveSettingsHostRequest}
            />
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="settings-live-schema"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="settings-live-key"]')?.textContent).toMatch(
      /never shown|不会回显/i,
    );
    expect(container.querySelector('[data-testid="settings-live-key-input"]')?.textContent).not.toMatch(
      /AIza|sk-/,
    );
  });
});
