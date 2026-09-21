// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createDefaultWalkthroughConfig,
  DEFAULT_ARTIFACT_DECISION_PROMPT,
  type ArtifactConfig,
  type PiwinConfig,
} from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../../appearance-tokens.js';
import { DesktopLocaleProvider } from '../../desktop-locale-context.js';
import { SettingsProvider, type SettingsContextValue } from '../settings-context.js';
import { ArtifactPage } from './artifact-page.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function artifactConfig(overrides?: Partial<ArtifactConfig['decisionPrompt']>): PiwinConfig {
  return {
    hostMode: 'sdk',
    providers: [],
    media: { maxPasteBytes: 1024, allowedMimeTypes: [] },
    artifact: {
      enabled: true,
      triggerMode: 'automatic',
      decisionPrompt: {
        mode: 'default',
        customPrompt: '',
        ...overrides,
      },
      maxBytes: 1024,
    },
    walkthrough: createDefaultWalkthroughConfig(),
  };
}

let saveSpy: ReturnType<typeof vi.fn> | null = null;

function renderPage(config: PiwinConfig): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const saveConfig = vi.fn(async () => true);
  saveSpy = saveConfig;
  const contextValue = {
    config,
    saveConfig,
    setInfo: vi.fn(),
    preferences: {
      artifactCodeFirst: false,
      assistantTextSize: 'default',
      codeTextSize: 'default',
      codeWrap: false,
    },
    onPreferencesChange: vi.fn(),
  } as unknown as SettingsContextValue;
  act(() => {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
          <SettingsProvider value={contextValue}>
            <ArtifactPage />
          </SettingsProvider>
        </DesktopLocaleProvider>
      </PiwinUiProvider>,
    );
  });
  mounted = { container, root };
  return container;
}

let mounted: { container: HTMLDivElement; root: Root } | null = null;

function clickCustom(container: HTMLElement): void {
  const control = container.querySelector('[data-testid="artifact-prompt-mode-control"]');
  const radio = control?.querySelector<HTMLInputElement>('input[value="custom"]');
  if (radio) {
    act(() => {
      radio.click();
    });
    return;
  }
  const label = [...(control?.querySelectorAll('label, [data-active]') ?? [])].find((node) =>
    (node.textContent ?? '').includes('Custom'),
  );
  if (!(label instanceof HTMLElement)) {
    throw new Error('custom decision control not found');
  }
  act(() => {
    label.click();
  });
}

describe('ArtifactPage decision prompt', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    mounted = null;
    saveSpy = null;
  });

  afterEach(() => {
    act(() => {
      mounted?.root.unmount();
    });
    mounted?.container.remove();
    mounted = null;
  });

  it('seeds the default decision prompt when switching to custom', () => {
    const container = renderPage(artifactConfig());
    expect(container.querySelector('[data-testid="artifact-custom-prompt-textarea"]')).toBeNull();
    clickCustom(container);
    const field = container.querySelector('[data-testid="artifact-custom-prompt-textarea"]');
    const textarea = field?.querySelector('textarea');
    expect(textarea).not.toBeNull();
    expect(textarea?.className).toContain('piwin-text-area-field');
    expect(textarea?.value).toBe(DEFAULT_ARTIFACT_DECISION_PROMPT);
  });

  it('keeps a saved custom prompt when switching to custom', () => {
    const container = renderPage(
      artifactConfig({ customPrompt: 'private custom sentinel' }),
    );
    clickCustom(container);
    const textarea = container.querySelector(
      '[data-testid="artifact-custom-prompt-textarea"] textarea',
    );
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
    expect((textarea as HTMLTextAreaElement).value).toBe('private custom sentinel');
  });

  it('renders the max-bytes cap as ui-kit NumberInput instead of a native stepper', () => {
    const container = renderPage(artifactConfig());
    const control = container.querySelector('[data-testid="artifact-max-bytes-input"]');
    expect(control).toBeTruthy();
    expect(control!.className).toContain('piwin-number-input');
    expect(control!.className).toContain('piwin-text-input');

    const field =
      control instanceof HTMLInputElement
        ? control
        : control!.querySelector('input');
    expect(field).toBeInstanceOf(HTMLInputElement);
    expect((field as HTMLInputElement).getAttribute('type')).not.toBe('number');
    expect((field as HTMLInputElement).className).toContain('piwin-text-input-field');
    expect((field as HTMLInputElement).value).toBe('1024');
  });
});

describe('ArtifactPage per-scope surface tree', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    mounted = null;
    saveSpy = null;
  });

  afterEach(() => {
    act(() => {
      mounted?.root.unmount();
    });
    mounted?.container.remove();
    mounted = null;
  });

  function switchAt(container: HTMLElement, testId: string): HTMLInputElement {
    const input = container.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
    if (!input) throw new Error(`${testId} not found`);
    return input;
  }

  it('renders both scope classes with the shipped default: Agent chat off', () => {
    const container = renderPage(artifactConfig());
    expect(switchAt(container, 'artifact-scope-general-inline-switch').checked).toBe(true);
    expect(switchAt(container, 'artifact-scope-general-canvas-switch').checked).toBe(true);
    expect(switchAt(container, 'artifact-scope-project-inline-switch').checked).toBe(false);
    expect(switchAt(container, 'artifact-scope-project-canvas-switch').checked).toBe(false);
  });

  it('shows the saved per-scope state instead of the default', () => {
    const config = artifactConfig();
    config.artifact.scopes = {
      general: { inline: true, canvas: false },
      project: { inline: false, canvas: true },
    };
    const container = renderPage(config);
    expect(switchAt(container, 'artifact-scope-general-canvas-switch').checked).toBe(false);
    expect(switchAt(container, 'artifact-scope-general-inline-switch').checked).toBe(true);
    expect(switchAt(container, 'artifact-scope-project-inline-switch').checked).toBe(false);
    expect(switchAt(container, 'artifact-scope-project-canvas-switch').checked).toBe(true);
  });

  it('saves the toggled surface with the rest of the artifact draft', async () => {
    const container = renderPage(artifactConfig());
    // Agent chat ships off, so the first toggle opts its Inline surface in.
    const canvasInput = switchAt(container, 'artifact-scope-project-inline-switch');
    act(() => {
      canvasInput.click();
    });
    const saveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="artifact-save-button"]',
    );
    expect(saveButton).not.toBeNull();
    await act(async () => {
      saveButton!.click();
    });

    expect(saveSpy).not.toBeNull();
    const saved = saveSpy!.mock.calls[0]?.[0] as PiwinConfig;
    expect(saved.artifact.scopes).toEqual({
      general: { inline: true, canvas: true },
      project: { inline: true, canvas: false },
    });
  });

  it('keeps the per-scope state while the master switch is off', () => {
    const config = artifactConfig();
    config.artifact.scopes = {
      general: { inline: false, canvas: false },
      project: { inline: true, canvas: true },
    };
    const container = renderPage(config);
    const masterSwitch = switchAt(container, 'artifact-enabled-switch');
    act(() => {
      masterSwitch.click();
    });
    // Master off hides the tree but must not rewrite the saved choices.
    expect(container.querySelector('[data-testid="artifact-scope-tree"]')).toBeNull();
    act(() => {
      masterSwitch.click();
    });
    expect(switchAt(container, 'artifact-scope-general-canvas-switch').checked).toBe(false);
    expect(switchAt(container, 'artifact-scope-project-canvas-switch').checked).toBe(true);
  });
});
