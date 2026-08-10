// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  HostResponse,
  PiwinConfig,
  SearchRoutePreviewData,
  SearchRoutePreviewInput,
  SearchRoutePolicy,
} from '@piwin/contracts';
import { createDefaultWebConfig } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../../appearance-tokens';
import { DesktopLocaleProvider } from '../../desktop-locale-context';
import { SettingsProvider, type SettingsContextValue } from '../settings-context';
import { webToDraft, type DraftWeb } from '../web-draft';
import { WebPage } from './web-page';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

type SettingsRequest = SettingsContextValue['request'];
type SettingsCommand = Parameters<SettingsRequest>[0];

function getSearchRoutePreviewInput(command: SettingsCommand): SearchRoutePreviewInput | null {
  if (command.type !== 'web/search-route-preview' || !command.input) {
    return null;
  }
  const input = command.input;
  return 'policy' in input && 'searchSources' in input ? input : null;
}

type WebPageHarnessProps = {
  request: SettingsRequest;
  initialDraft?: DraftWeb;
};

function baseConfig(): PiwinConfig {
  return {
    hostMode: 'sdk',
    providers: [],
    media: { maxPasteBytes: 1024, allowedMimeTypes: [] },
    artifact: {
      enabled: true,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 1024,
    },
    web: createDefaultWebConfig(),
  };
}

function nativePreview(policy: SearchRoutePolicy): SearchRoutePreviewData {
  return {
    route: {
      policy,
      selected: 'native',
      fallback: 'external',
      readiness: {
        native: { ready: true, reasons: [] },
        external: { ready: true, reasons: [] },
      },
      issues: [],
      incompatible: false,
    },
    modelLabel: 'Native test model',
  };
}

function incompatiblePreview(policy: SearchRoutePolicy): SearchRoutePreviewData {
  return {
    route: {
      policy,
      selected: 'native',
      fallback: null,
      readiness: {
        native: { ready: true, alwaysOn: true, reasons: [] },
        external: { ready: true, reasons: [] },
      },
      issues: [],
      incompatible: true,
    },
    modelLabel: 'Always-on native model',
  };
}

function createContextValue(request: SettingsRequest): SettingsContextValue {
  return {
    request,
    config: baseConfig(),
    root: '~/.piwin',
    saving: false,
    setError: vi.fn(),
    setInfo: vi.fn(),
    saveConfig: vi.fn(async () => true),
    webDraft: webToDraft(createDefaultWebConfig()),
    setWebDraft: vi.fn(),
    saveWeb: vi.fn(async () => true),
    preferences: { assistantTextSize: 'default', codeTextSize: 'default', codeWrap: false },
    onPreferencesChange: vi.fn(),
    projectPath: null,
    projectTrusted: false,
    hostStatus: null,
    activeSessionId: null,
    onOpenSubagentSession: undefined,
    selectSection: vi.fn(),
    requestSkills: vi.fn(async () => ({
      type: 'response',
      command: 'test',
      success: true,
      data: {},
    })),
    requestMcp: vi.fn(async () => ({ type: 'response', command: 'test', success: true, data: {} })),
    requestExtensions: vi.fn(async () => ({
      type: 'response',
      command: 'test',
      success: true,
      data: {},
    })),
    requestPlugins: vi.fn(async () => ({
      type: 'response',
      command: 'test',
      success: true,
      data: {},
    })),
    requestPrompts: vi.fn(async () => ({
      type: 'response',
      command: 'test',
      success: true,
      data: {},
    })),
    requestPet: vi.fn(async () => ({ type: 'response', command: 'test', success: true, data: {} })),
    requestAutomation: vi.fn(async () => ({
      type: 'response',
      command: 'test',
      success: true,
      data: {},
    })),
    requestSubAgent: undefined,
    activeTheme: PIWIN_APPEARANCE_DARK,
    onThemeApplied: vi.fn(),
    onPetActiveChanged: vi.fn(),
    discoverProviderModels: vi.fn(async () => ({ models: [] })),
    testProviderModel: vi.fn(async () => ({ durationMs: 1 })),
    searchModelCatalog: vi.fn(async () => ({ items: [] })),
    searchImageModelCatalog: vi.fn(async () => ({ items: [] })),
    storeProviderSecret: vi.fn(async () => 'keychain:test'),
    loadProviderSecret: vi.fn(async () => null),
  } as unknown as SettingsContextValue;
}

function WebPageHarness(props: WebPageHarnessProps): ReactElement {
  const [webDraft, setWebDraft] = useState<DraftWeb>(
    props.initialDraft ?? webToDraft(createDefaultWebConfig()),
  );
  const contextValue = createContextValue(props.request);
  contextValue.webDraft = webDraft;
  contextValue.setWebDraft = setWebDraft;

  return (
    <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
        <SettingsProvider value={contextValue}>
          <WebPage />
        </SettingsProvider>
      </DesktopLocaleProvider>
    </PiwinUiProvider>
  );
}

function successResponse(data: SearchRoutePreviewData): HostResponse {
  return {
    type: 'response',
    command: 'web/search-route-preview',
    success: true,
    data,
  };
}

async function flushPreviewDebounce(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(150);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('WebPage search route settings', () => {
  let activeRoot: Root | null = null;
  let activeContainer: HTMLElement | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (activeRoot) {
      act(() => {
        activeRoot?.unmount();
      });
    }
    activeContainer?.remove();
    activeRoot = null;
    activeContainer = null;
    vi.useRealTimers();
  });

  function renderPage(request: SettingsRequest, initialDraft?: DraftWeb): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    activeContainer = container;
    activeRoot = root;
    const harnessProps = initialDraft === undefined ? { request } : { request, initialDraft };
    act(() => {
      root.render(<WebPageHarness {...harnessProps} />);
    });
    return container;
  }

  it('renders the policy selector and a Host-derived native preview', async () => {
    const request = vi.fn<SettingsRequest>(async (command: SettingsCommand) => {
      const input = getSearchRoutePreviewInput(command);
      if (input) {
        return successResponse(nativePreview(input.policy));
      }
      return { type: 'response', command: command.type, success: true, data: {} };
    });

    const container = renderPage(request);
    await flushPreviewDebounce();

    const policySelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="web-search-route-policy"]',
    );
    expect(policySelect?.value).toBe('external-first');
    expect(container.querySelector('[data-testid="search-route-selected"]')?.textContent).toContain(
      'native',
    );
    expect(request).toHaveBeenCalledWith({
      type: 'web/search-route-preview',
      input: expect.objectContaining({ policy: 'external-first' }),
    });
  });

  it('debounces policy changes and sends the typed policy to Host', async () => {
    const previewInputs: SearchRoutePreviewInput[] = [];
    const request = vi.fn<SettingsRequest>(async (command: SettingsCommand) => {
      const input = getSearchRoutePreviewInput(command);
      if (input) {
        previewInputs.push(input);
        return successResponse(nativePreview(input.policy));
      }
      return { type: 'response', command: command.type, success: true, data: {} };
    });

    const container = renderPage(request);
    await flushPreviewDebounce();
    const policySelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="web-search-route-policy"]',
    );
    if (!policySelect) {
      throw new Error('Web search route policy selector was not rendered');
    }

    act(() => {
      policySelect.value = 'native-only';
      policySelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushPreviewDebounce();

    expect(previewInputs.at(-1)?.policy).toBe('native-only');
  });

  it('shows a warning status for an incompatible Host route preview', async () => {
    const request = vi.fn<SettingsRequest>(async (command: SettingsCommand) => {
      const input = getSearchRoutePreviewInput(command);
      if (input) {
        return successResponse(incompatiblePreview(input.policy));
      }
      return { type: 'response', command: command.type, success: true, data: {} };
    });

    const container = renderPage(request);
    await flushPreviewDebounce();

    const selectedStatus = container.querySelector<HTMLElement>(
      '[data-testid="search-route-selected"]',
    );
    expect(selectedStatus?.getAttribute('data-tone')).toBe('warning');
    expect(container.querySelector('.ui-notice[data-tone="warning"]')).toBeTruthy();
  });
});
