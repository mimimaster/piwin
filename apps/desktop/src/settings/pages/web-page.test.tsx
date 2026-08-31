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
  transport?: 'live' | 'remote';
};

function baseConfig(): PiwinConfig {
  return {
    hostMode: 'sdk',
    providers: [
      {
        id: 'gemini',
        name: 'Gemini',
        protocol: 'google-gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        models: [
          {
            id: 'gemini-search',
            label: 'Gemini Search',
            capabilities: ['chat', 'native-web-search'],
          },
          { id: 'gemini-plain', capabilities: ['chat'] },
        ],
      },
    ],
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
    },
    modelLabel: 'Native test model',
  };
}

function warningPreview(policy: SearchRoutePolicy): SearchRoutePreviewData {
  return {
    route: {
      policy,
      selected: null,
      fallback: null,
      readiness: {
        native: { ready: false, reasons: ['native search adapter is unavailable'] },
        external: { ready: false, reasons: ['no enabled external search source'] },
      },
      issues: ['native search adapter is unavailable'],
    },
    modelLabel: 'Unavailable search model',
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
  if (props.transport) {
    const transport = props.transport;
    contextValue.hostClient = {
      subscribe: () => () => {},
      getTransport: () => transport,
    };
  }

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

  function renderPage(
    request: SettingsRequest,
    initialDraft?: DraftWeb,
    transport?: 'live' | 'remote',
  ): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    activeContainer = container;
    activeRoot = root;
    const harnessProps = {
      request,
      ...(initialDraft === undefined ? {} : { initialDraft }),
      ...(transport === undefined ? {} : { transport }),
    };
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
    expect(policySelect?.value).toBe('native-first');
    expect(container.querySelector('[data-testid="search-route-selected"]')?.textContent).toContain(
      'native',
    );
    expect(request).toHaveBeenCalledWith({
      type: 'web/search-route-preview',
      input: expect.objectContaining({ policy: 'native-first' }),
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

  it('lists only native-search models and sends the selected delegate to Host preview', async () => {
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
    const delegateSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="web-search-delegate-model"]',
    );
    if (!delegateSelect) throw new Error('delegate selector missing');

    expect(delegateSelect.textContent).toContain('Gemini Search');
    expect(delegateSelect.textContent).not.toContain('gemini-plain');
    act(() => {
      delegateSelect.value = 'google-gemini/gemini/gemini-search';
      delegateSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushPreviewDebounce();

    expect(previewInputs.at(-1)?.searchDelegateModel).toEqual({
      protocol: 'google-gemini',
      providerId: 'gemini',
      modelId: 'gemini-search',
    });
    expect(container.querySelector('[data-testid="web-search-delegate-active"]')).toBeTruthy();
  });

  it('shows a warning status for a Host route issue', async () => {
    const request = vi.fn<SettingsRequest>(async (command: SettingsCommand) => {
      const input = getSearchRoutePreviewInput(command);
      if (input) {
        return successResponse(warningPreview(input.policy));
      }
      return { type: 'response', command: command.type, success: true, data: {} };
    });

    const container = renderPage(request);
    await flushPreviewDebounce();

    const selectedStatus = container.querySelector<HTMLElement>(
      '[data-testid="search-route-selected"]',
    );
    expect(selectedStatus?.getAttribute('data-tone')).toBe('warning');
    expect(container.querySelector('[data-testid="search-route-issues"]')).toBeTruthy();
  });

  it('lists chat models for focused web_fetch extract', async () => {
    const request = vi.fn<SettingsRequest>(async (command: SettingsCommand) => {
      const input = getSearchRoutePreviewInput(command);
      if (input) {
        return successResponse(nativePreview(input.policy));
      }
      return { type: 'response', command: command.type, success: true, data: {} };
    });

    const container = renderPage(request);
    await flushPreviewDebounce();
    const fetchTab = Array.from(container.querySelectorAll('label')).find(
      (element) => element.textContent === 'Fetch',
    );
    if (!fetchTab) throw new Error('Fetch tab missing');
    act(() => {
      fetchTab.click();
    });

    const delegateSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="web-fetch-delegate-model"]',
    );
    if (!delegateSelect) throw new Error('fetch extract selector missing');
    expect(delegateSelect.textContent).toContain('Gemini Search');
    expect(delegateSelect.textContent).toContain('gemini-plain');
    act(() => {
      delegateSelect.value = 'google-gemini/gemini/gemini-plain';
      delegateSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="web-fetch-delegate-active"]')).toBeTruthy();
  });

  it('lets the user enable jina fallback for thin local extracts', async () => {
    const request = vi.fn<SettingsRequest>(async (command: SettingsCommand) => {
      const input = getSearchRoutePreviewInput(command);
      if (input) {
        return successResponse(nativePreview(input.policy));
      }
      return { type: 'response', command: command.type, success: true, data: {} };
    });

    const container = renderPage(request);
    await flushPreviewDebounce();
    const fetchTab = Array.from(container.querySelectorAll('label')).find(
      (element) => element.textContent === 'Fetch',
    );
    if (!fetchTab) throw new Error('Fetch tab missing');
    act(() => {
      fetchTab.click();
    });

    const fallbackSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="web-fetch-fallback"]',
    );
    if (!fallbackSelect) throw new Error('fetch fallback selector missing');
    act(() => {
      fallbackSelect.value = 'jina';
      fallbackSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(fallbackSelect.value).toBe('jina');
    expect(container.querySelector('[data-testid="web-fetch-return-max-chars"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="web-fetch-store-max-chars"]')).toBeTruthy();
  });

  it('shows CLI launcher fields on a remote shell so they can be saved to Host', async () => {
    const request = vi.fn<SettingsRequest>(async (command: SettingsCommand) => {
      const input = getSearchRoutePreviewInput(command);
      if (input) {
        return successResponse(nativePreview(input.policy));
      }
      return { type: 'response', command: command.type, success: true, data: {} };
    });
    const draft = webToDraft({
      ...createDefaultWebConfig(),
      searchProvider: 'cli',
      searchSources: [
        {
          id: 'cli',
          kind: 'cli',
          enabled: true,
          command: '/usr/local/bin/my-search',
          args: ['{{query}}'],
        },
      ],
    });
    const container = renderPage(request, draft, 'remote');
    await flushPreviewDebounce();
    const cliHeader = container.querySelector<HTMLButtonElement>(
      '[data-testid="web-search-source-cli"]',
    );
    if (!cliHeader) {
      throw new Error('CLI source card missing');
    }
    act(() => {
      cliHeader.click();
    });
    expect(container.querySelector('[data-testid="web-search-cli-host-held"]')).toBeNull();
    const commandInput = container.querySelector<HTMLInputElement>(
      '[data-testid="web-search-cli-command"]',
    );
    expect(commandInput).not.toBeNull();
    expect(commandInput?.querySelector('input')?.value ?? commandInput?.value).toBe(
      '/usr/local/bin/my-search',
    );
    const argsInput = container.querySelector('[data-testid="web-search-cli-args"]');
    const argsValue =
      argsInput instanceof HTMLInputElement
        ? argsInput.value
        : argsInput?.querySelector('input')?.value;
    expect(argsValue).toContain('{{query}}');
  });

  it('fills a CLI example into the command line', async () => {
    const request = vi.fn<SettingsRequest>(async (command: SettingsCommand) => {
      const input = getSearchRoutePreviewInput(command);
      if (input) {
        return successResponse(nativePreview(input.policy));
      }
      return { type: 'response', command: command.type, success: true, data: {} };
    });
    const draft = webToDraft({
      ...createDefaultWebConfig(),
      searchProvider: 'cli',
      searchSources: [
        {
          id: 'cli',
          kind: 'cli',
          enabled: true,
          command: 'my-search',
          args: ['{{query}}'],
        },
      ],
    });
    const container = renderPage(request, draft, 'live');
    await flushPreviewDebounce();
    const cliHeader = container.querySelector<HTMLButtonElement>(
      '[data-testid="web-search-source-cli"]',
    );
    if (!cliHeader) throw new Error('CLI source card missing');
    act(() => {
      cliHeader.click();
    });
    expect(container.querySelector('[data-testid="web-search-source-searxng"]')).toBeTruthy();
    const examplesToggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="web-search-cli-examples-toggle"]',
    );
    if (!examplesToggle) throw new Error('examples toggle missing');
    act(() => {
      examplesToggle.click();
    });
    const anySearch = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button.web-cli-example'),
    ).find((button) => button.textContent?.includes('AnySearch'));
    if (!anySearch) throw new Error('AnySearch example missing');
    act(() => {
      anySearch.click();
    });
    const commandInput = container.querySelector('[data-testid="web-search-cli-command"]');
    const commandValue =
      commandInput instanceof HTMLInputElement
        ? commandInput.value
        : commandInput?.querySelector('input')?.value;
    expect(commandValue).toBe('python3');
    const argsInput = container.querySelector('[data-testid="web-search-cli-args"]');
    const argsValue =
      argsInput instanceof HTMLInputElement
        ? argsInput.value
        : argsInput?.querySelector('input')?.value;
    expect(argsValue).toContain('anysearch_cli.py');
    expect(argsValue).toContain('{{query}}');
  });
});
