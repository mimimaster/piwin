// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PiwinConfig } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens.js';
import { DesktopLocaleProvider } from '../desktop-locale-context.js';
import { AsrModelSettings } from './asr-model-settings.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function makeConfig(): PiwinConfig {
  return {
    hostMode: 'sdk',
    providers: [
      {
        id: 'openai',
        protocol: 'openai-compatible',
        name: 'OpenAI',
        baseUrl: 'https://api.example.test/v1',
        models: [{ id: 'whisper-1', capabilities: ['speech-to-text'] }, { id: 'chat-model' }],
      },
    ],
    media: { maxPasteBytes: 1_000_000, allowedMimeTypes: [] },
    artifact: {
      enabled: true,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 1_000_000,
    },
  };
}

describe('AsrModelSettings', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
      container.remove();
    }
    root = undefined;
    container = undefined;
    document.body.querySelector('[data-testid="settings-asr-dialog"]')?.remove();
  });

  it('lists only enabled ASR-tagged models and saves the selected default', async () => {
    const config = makeConfig();
    const saveConfig = vi.fn(async () => true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
            <AsrModelSettings
              config={config}
              saving={false}
              onSave={saveConfig}
              onError={vi.fn()}
              onInfo={vi.fn()}
            />
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="settings-speech-defaults"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="settings-asr-unconfigured"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="settings-tts-reserved"]')).not.toBeNull();
    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="settings-asr-unconfigured"] button')
        ?.click();
    });
    expect(document.querySelector('[data-testid="settings-asr-dialog"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="settings-asr-model-select"]')).not.toBeNull();

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="settings-asr-save"]')?.click();
      await Promise.resolve();
    });
    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        speech: {
          asr: {
            defaultModel: {
              protocol: 'openai-compatible',
              providerId: 'openai',
              modelId: 'whisper-1',
            },
          },
        },
      }),
    );
  });
});
