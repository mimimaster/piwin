// @vitest-environment happy-dom
/**
 * SessionRuntimePage — runtime status, residency, retention policy (ADR 0040).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  HostRuntimeResourcesData,
  HostServerMessage,
  PiwinConfig,
  SessionRuntimeStatus,
} from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../../appearance-tokens';
import { DesktopLocaleProvider } from '../../desktop-locale-context';
import { SettingsProvider, type SettingsContextValue } from '../settings-context';
import { buildSessionRuntimeRetentionDraft, SessionRuntimePage } from './session-runtime-page';
import { webToDraft } from '../web-draft';
import { createDefaultWebConfig } from '@piwin/contracts';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

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
    session: {
      autoName: true,
      runtimeRetention: {
        idleTtlSeconds: 600,
        maxIdleRuntimes: 2,
      },
    },
  };
}

function resourceSample(): HostRuntimeResourcesData {
  return {
    counts: {
      resident: 1,
      idle: 1,
      busy: 0,
      activating: 0,
      suspending: 0,
    },
    waiterCount: 0,
    budget: {
      maxResidentRuntimes: 3,
      maxIdleRuntimes: 2,
      memoryHighWaterMiB: 1024,
      memoryLowWaterMiB: 819,
    },
    memory: {
      hostRssMiB: 256,
      sampleCompleteness: 'missing',
    },
    counters: {
      evictedByIdleTtl: 0,
      evictedByMaxIdle: 1,
      evictedByMaxResident: 0,
      evictedByMemoryPressure: 0,
      memoryPressureFailures: 0,
    },
    execution: {
      configuredMaxConcurrentRuns: 8,
      effectiveMaxConcurrentRuns: 8,
      activeRuns: 0,
      waitingRuns: 0,
      activeForegroundRuns: 0,
      waitingForegroundRuns: 0,
      activeSubagentRuns: 0,
      waitingSubagentRuns: 0,
      subagentMaxConcurrency: 4,
      limitingReason: 'execution-config',
    },
  };
}

function staleStatus(): SessionRuntimeStatus {
  return {
    sessionId: 's1',
    state: 'stale',
    residency: 'resident-idle',
    generationId: 's1-gen-1',
    staleDomains: ['web', 'skills'],
  };
}

function liveStatus(): SessionRuntimeStatus {
  return {
    sessionId: 's1',
    state: 'live',
    residency: 'resident-idle',
    generationId: 's1-gen-1',
    staleDomains: [],
  };
}

function coldStatus(): SessionRuntimeStatus {
  return {
    sessionId: 's1',
    state: 'lazy-shell',
    residency: 'cold',
    lastEvictionReason: 'idle-ttl',
    generationId: 's1-gen-1',
    staleDomains: [],
  };
}

function failedStatus(): SessionRuntimeStatus {
  return {
    sessionId: 's1',
    state: 'failed',
    residency: 'resident-idle',
    generationId: 's1-gen-1',
    staleDomains: ['web'],
    candidateState: 'failed',
    candidateError: 'candidate backend failed',
  };
}

function createContextValue(overrides: Partial<SettingsContextValue> = {}): SettingsContextValue {
  return {
    request: vi.fn(async (command: { type: string }) => {
      if (command.type === 'host/runtime-resources') {
        return {
          type: 'response' as const,
          command: 'host/runtime-resources',
          success: true as const,
          data: resourceSample(),
        };
      }
      return {
        type: 'response' as const,
        command: 'session/runtime-status',
        success: true as const,
        data: { status: liveStatus() },
      };
    }),
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
    activeSessionId: 's1',
    onOpenSubagentSession: undefined,
    selectSection: vi.fn(),
    requestSkills: vi.fn(async () => ({ type: 'response', command: 'x', success: true, data: {} })),
    requestMcp: vi.fn(async () => ({ type: 'response', command: 'x', success: true, data: {} })),
    requestExtensions: vi.fn(async () => ({
      type: 'response',
      command: 'x',
      success: true,
      data: {},
    })),
    requestPlugins: vi.fn(async () => ({
      type: 'response',
      command: 'x',
      success: true,
      data: {},
    })),
    requestPrompts: vi.fn(async () => ({
      type: 'response',
      command: 'x',
      success: true,
      data: {},
    })),
    requestPet: vi.fn(async () => ({ type: 'response', command: 'x', success: true, data: {} })),
    requestAutomation: vi.fn(async () => ({
      type: 'response',
      command: 'x',
      success: true,
      data: {},
    })),
    requestSubAgent: undefined,
    onThemeApplied: vi.fn(),
    onPetActiveChanged: vi.fn(),
    discoverProviderModels: vi.fn(async () => ({ models: [] })),
    testProviderModel: vi.fn(async () => ({ durationMs: 1 })),
    searchModelCatalog: vi.fn(async () => ({ items: [] })),
    getModelCatalogStatus: vi.fn(async () => ({
      source: 'pi-bootstrap' as const,
      catalogVersion: 'test',
      entryCount: 0,
      imageEntryCount: 0,
    })),
    syncModelCatalog: vi.fn(async () => ({
      ok: true as const,
      source: 'models.dev' as const,
      catalogVersion: 'test',
      fetchedAt: '2026-09-21T00:00:00.000Z',
      entryCount: 1,
      imageEntryCount: 0,
    })),
    storeProviderSecret: vi.fn(async () => 'ref'),
    loadProviderSecret: vi.fn(async () => null),
    ...overrides,
  } as unknown as SettingsContextValue;
}

function renderPage(contextValue: SettingsContextValue): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
          <SettingsProvider value={contextValue}>
            <SessionRuntimePage />
          </SettingsProvider>
        </DesktopLocaleProvider>
      </PiwinUiProvider>,
    );
  });
  return container;
}

describe('SessionRuntimePage', () => {
  let container: HTMLElement | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    container?.remove();
    container = null;
  });

  it('renders a stale runtime with Pending Changes and affected domains', async () => {
    const request = vi.fn(async (command: { type: string }) => {
      if (command.type === 'host/runtime-resources') {
        return {
          type: 'response' as const,
          command: 'host/runtime-resources',
          success: true as const,
          data: resourceSample(),
        };
      }
      return {
        type: 'response' as const,
        command: 'session/runtime-status',
        success: true as const,
        data: { status: staleStatus() },
      };
    });
    container = renderPage(createContextValue({ request }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(container!.querySelector('[data-testid="pending-changes-bar"]')).toBeTruthy();
    expect(container!.querySelector('[data-testid="runtime-state-value"]')?.textContent).toContain(
      'Stale',
    );
    expect(
      container!.querySelector('[data-testid="runtime-reload-unavailable-note"]'),
    ).toBeTruthy();
    expect(container!.querySelector('[data-testid="runtime-reload-now-button"]')).toBeNull();
    expect(container!.querySelector('[data-testid="runtime-apply-after-run-button"]')).toBeNull();
  });

  it('renders a fresh runtime without the Pending Changes bar', async () => {
    container = renderPage(createContextValue());
    await act(async () => {
      await Promise.resolve();
    });
    expect(container!.querySelector('[data-testid="pending-changes-bar"]')).toBeNull();
    expect(container!.querySelector('[data-testid="runtime-fresh-note"]')).toBeTruthy();
    expect(
      container!.querySelector('[data-testid="runtime-residency-value"]')?.textContent,
    ).toContain('Ready');
  });

  it('shows Cold residency and last eviction without labeling history as damaged', async () => {
    const request = vi.fn(async (command: { type: string }) => {
      if (command.type === 'host/runtime-resources') {
        return {
          type: 'response' as const,
          command: 'host/runtime-resources',
          success: true as const,
          data: resourceSample(),
        };
      }
      return {
        type: 'response' as const,
        command: 'session/runtime-status',
        success: true as const,
        data: { status: coldStatus() },
      };
    });
    container = renderPage(createContextValue({ request }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      container!.querySelector('[data-testid="runtime-residency-value"]')?.textContent,
    ).toContain('Cold');
    expect(
      container!.querySelector('[data-testid="runtime-eviction-value"]')?.textContent,
    ).toContain('Idle TTL');
    expect(container!.querySelector('[data-testid="runtime-fresh-note"]')?.textContent).toMatch(
      /history usable|Cold sessions keep history/i,
    );
    expect(container!.textContent).not.toMatch(/disconnected|damaged/i);
  });

  it('builds a normalized retention draft from form strings', () => {
    expect(
      buildSessionRuntimeRetentionDraft({
        idleTtlDraft: '120',
        maxIdleDraft: '1',
        maxResidentDraft: '4',
        memoryHighWaterDraft: '900',
      }),
    ).toEqual({
      idleTtlSeconds: 120,
      maxIdleRuntimes: 1,
      maxResidentRuntimes: 4,
      memoryHighWaterMiB: 900,
    });
    // Empty optional fields stay adaptive (omitted after normalize).
    expect(
      buildSessionRuntimeRetentionDraft({
        idleTtlDraft: '600',
        maxIdleDraft: '2',
        maxResidentDraft: '',
        memoryHighWaterDraft: '',
      }),
    ).toEqual({
      idleTtlSeconds: 600,
      maxIdleRuntimes: 2,
    });
    // Invalid numbers fall back to defaults / omit optionals.
    expect(
      buildSessionRuntimeRetentionDraft({
        idleTtlDraft: 'nope',
        maxIdleDraft: '-3',
        maxResidentDraft: '0',
        memoryHighWaterDraft: 'abc',
      }),
    ).toEqual({
      idleTtlSeconds: 600,
      maxIdleRuntimes: 2,
    });
  });

  it('renders retention policy controls and Host-owned policy note', async () => {
    const saveConfig = vi.fn(async () => true);
    container = renderPage(createContextValue({ saveConfig }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(container!.querySelector('[data-testid="runtime-retention-section"]')).toBeTruthy();
    expect(
      container!.querySelector('[data-testid="runtime-retention-host-owns-note"]')?.textContent,
    ).toMatch(/Host-owned|never run a local eviction clock/i);
    expect(container!.querySelector('[data-testid="runtime-retention-idle-ttl"]')).toBeTruthy();
    expect(container!.querySelector('[data-testid="runtime-retention-max-idle"]')).toBeTruthy();
    expect(container!.querySelector('[data-testid="runtime-retention-max-resident"]')).toBeTruthy();
    expect(
      container!.querySelector('[data-testid="runtime-retention-memory-high-water"]'),
    ).toBeTruthy();
    // Clean draft matches saved config → save stays disabled until dirty.
    const saveButton = container!.querySelector(
      '[data-testid="runtime-retention-save"]',
    ) as HTMLButtonElement | null;
    expect(saveButton?.disabled).toBe(true);
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('shows aggregate Host resource metrics', async () => {
    container = renderPage(createContextValue());
    await act(async () => {
      await Promise.resolve();
    });
    expect(container!.querySelector('[data-testid="runtime-resources-section"]')).toBeTruthy();
    expect(
      container!.querySelector('[data-testid="runtime-resources-snapshot-note"]')?.textContent,
    ).toMatch(/snapshot|Refresh/i);
    expect(
      container!.querySelector('[data-testid="runtime-resources-budget"]')?.textContent,
    ).toContain('maxIdle=2');
    expect(
      container!.querySelector('[data-testid="runtime-resources-counters"]')?.textContent,
    ).toContain('idle=1');
    expect(container!.querySelector('[data-testid="runtime-resources-workers"]')).toBeNull();
  });

  it('renders the workers pool block when host/runtime-resources includes workers', async () => {
    const request = vi.fn(async (command: { type: string }) => {
      if (command.type === 'host/runtime-resources') {
        return {
          type: 'response' as const,
          command: 'host/runtime-resources',
          success: true as const,
          data: {
            ...resourceSample(),
            workers: {
              pool: 5,
              max: 6,
              active: 3,
              starting: 0,
              subagent: 2,
              subagentMax: 4,
              subagentWaiting: 1,
            },
          },
        };
      }
      return {
        type: 'response' as const,
        command: 'session/runtime-status',
        success: true as const,
        data: { status: liveStatus() },
      };
    });
    container = renderPage(createContextValue({ request }));
    await act(async () => {
      await Promise.resolve();
    });
    const workers = container!.querySelector('[data-testid="runtime-resources-workers"]');
    expect(workers?.textContent).toContain('3/5');
    expect(workers?.textContent).toContain('2/4');
    expect(workers?.textContent).toMatch(/waiting 1/);
  });

  it('applies a pushed runtime status without polling', async () => {
    let listener: ((message: HostServerMessage) => void) | undefined;
    const hostClient = {
      subscribe: (next: (message: HostServerMessage) => void): (() => void) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    };
    container = renderPage(createContextValue({ hostClient }));
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      listener?.({ type: 'session/runtime-updated', status: staleStatus() });
    });

    expect(container!.querySelector('[data-testid="pending-changes-bar"]')).toBeTruthy();
    expect(container!.querySelector('[data-testid="runtime-state-value"]')?.textContent).toContain(
      'Stale',
    );
    expect(
      container!.querySelector('[data-testid="runtime-residency-value"]')?.textContent,
    ).toContain('Ready');
  });

  it('shows rebuilding and failed states with candidate diagnostics', async () => {
    let listener: ((message: HostServerMessage) => void) | undefined;
    const hostClient = {
      subscribe: (next: (message: HostServerMessage) => void): (() => void) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    };
    container = renderPage(createContextValue({ hostClient }));
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      listener?.({
        type: 'session/runtime-updated',
        status: {
          ...liveStatus(),
          state: 'rebuilding',
          residency: 'resident-busy',
          candidateState: 'rebuilding',
        },
      });
    });
    expect(container!.querySelector('[data-testid="runtime-state-value"]')?.textContent).toContain(
      'Rebuilding',
    );
    expect(
      container!.querySelector('[data-testid="runtime-residency-value"]')?.textContent,
    ).toContain('Busy');

    await act(async () => {
      listener?.({
        type: 'session/runtime-updated',
        status: failedStatus(),
      });
    });
    expect(container!.querySelector('[data-testid="runtime-state-value"]')?.textContent).toContain(
      'Failed',
    );
    expect(container!.querySelector('[data-testid="runtime-failed-bar"]')).toBeTruthy();
    expect(
      container!.querySelector('[data-testid="runtime-candidate-error"]')?.textContent,
    ).toContain('candidate backend failed');
  });
});
