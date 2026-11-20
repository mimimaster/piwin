// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  HostCommand,
  HostResponse,
  PiwinConfig,
  ProjectRecord,
  SystemPromptPreset,
} from '@piwin/contracts';
import { createDefaultWebConfig } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../../theme/appearance-tokens';
import { DesktopLocaleProvider } from '../../i18n/desktop-locale-context';
import { SettingsProvider, type SettingsContextValue } from '../settings-context';
import { webToDraft } from '../web-draft';
import { SystemPromptsPage } from './system-prompts-page';

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
    web: createDefaultWebConfig(),
  };
}

const CANDIDATES = [
  {
    path: '/Users/demo/.piwin/system-prompts/persona.md',
    displayPath: 'persona.md',
    fileName: 'persona.md',
    extension: 'md' as const,
    source: 'global' as const,
    sizeBytes: 120,
    updatedAtMs: 1_731_800_000_000,
  },
  {
    path: '/repo/demo/rules.txt',
    displayPath: 'rules.txt',
    fileName: 'rules.txt',
    extension: 'txt' as const,
    source: 'project' as const,
    sizeBytes: 90,
    updatedAtMs: 1_731_800_000_000,
  },
];

const FILE_BODIES: Record<string, string> = {
  '/Users/demo/.piwin/system-prompts/persona.md': '# Persona\nAct as a careful reviewer.',
  '/repo/demo/rules.txt': 'Always verify changed files with tests.',
};

function makeProject(path: string, displayName?: string): ProjectRecord {
  return {
    path,
    trust: 'trusted',
    ...(displayName ? { displayName } : {}),
    lastOpenedAt: '2026-11-20T00:00:00.000Z',
    createdAt: '2026-11-20T00:00:00.000Z',
  };
}

function makePreset(id: string, name: string, filePaths: string[]): SystemPromptPreset {
  return {
    id,
    name,
    mode: 'append',
    filePaths,
    updatedAt: '2026-11-20T00:00:00.000Z',
  };
}

type TestHarnessOptions = {
  projectPath?: string | null;
  recentProjects?: ProjectRecord[];
  activeSessionId?: string | null;
  sessionPresetId?: string;
};

function TestHarness(props: {
  initialConfig?: PiwinConfig;
  onConfigSaved?: (next: PiwinConfig) => void;
  options?: TestHarnessOptions;
}): ReactElement {
  const [config, setConfig] = useState<PiwinConfig>(props.initialConfig ?? baseConfig());
  const resolvedProjectPath =
    props.options && 'projectPath' in props.options
      ? (props.options.projectPath ?? null)
      : '/repo/demo';
  const activeSessionId = props.options?.activeSessionId ?? null;
  const recentProjects = props.options?.recentProjects ?? [];

  const hostRequest = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
    if (command.type === 'project/list') {
      return {
        type: 'response',
        command: 'project/list',
        success: true,
        data: {
          projects: recentProjects,
        },
      };
    }
    if (command.type === 'host/list-dir') {
      const targetPath = command.path?.trim() || '/Users/demo';
      return {
        type: 'response',
        command: 'host/list-dir',
        success: true,
        data: {
          path: targetPath,
          homePath: '/Users/demo',
          entries: [
            { name: 'repo-alpha', path: '/Users/demo/repo-alpha', kind: 'directory' },
          ],
          locations: [],
        },
      };
    }
    if (command.type === 'system-prompts/list-files') {
      return {
        type: 'response',
        command: 'system-prompts/list-files',
        success: true,
        data: {
          systemPromptsDir: '/Users/demo/.piwin/system-prompts',
          files: CANDIDATES,
        },
      };
    }
    if (command.type === 'system-prompts/read-files') {
      return {
        type: 'response',
        command: 'system-prompts/read-files',
        success: true,
        data: {
          files: command.paths.map((filePath) => ({
            path: filePath,
            resolvedPath: filePath,
            fileName: filePath.split('/').pop() || 'file.md',
            exists: filePath in FILE_BODIES,
            content: FILE_BODIES[filePath] ?? '',
            sizeBytes: (FILE_BODIES[filePath] ?? '').length,
            updatedAtMs: 1_731_800_000_000,
            ...(filePath in FILE_BODIES ? {} : { error: 'ENOENT' }),
          })),
        },
      };
    }
    return {
      type: 'response',
      command: command.type,
      success: true,
      data: {},
    };
  });

  const value = {
    request: vi.fn(async (command: { type: string }) => {
      if (command.type === 'session/list' && activeSessionId) {
        return {
          type: 'response',
          command: 'session/list',
          success: true,
          data: {
            sessions: [
              {
                id: activeSessionId,
                title: 'Active session',
                scope: resolvedProjectPath
                  ? { kind: 'project', projectPath: resolvedProjectPath }
                  : { kind: 'general' },
                createdAt: '2026-11-20T00:00:00.000Z',
                updatedAt: '2026-11-20T00:00:00.000Z',
                ...(props.options?.sessionPresetId
                  ? { systemPromptPresetId: props.options.sessionPresetId }
                  : {}),
              },
            ],
          },
        };
      }
      return { type: 'response', command: command.type, success: true, data: {} };
    }),
    hostClient: {
      subscribe: () => () => {},
      request: hostRequest,
      getTransport: () => 'live' as const,
      supportsCommand: () => true,
    },
    config,
    root: '/Users/demo/.piwin',
    saving: false,
    setError: vi.fn(),
    setInfo: vi.fn(),
    saveConfig: vi.fn(async (next: PiwinConfig) => {
      setConfig(next);
      props.onConfigSaved?.(next);
      return true;
    }),
    webDraft: webToDraft(createDefaultWebConfig()),
    setWebDraft: vi.fn(),
    saveWeb: vi.fn(async () => true),
    preferences: { assistantTextSize: 'default', codeTextSize: 'default', codeWrap: false },
    onPreferencesChange: vi.fn(),
    projectPath: resolvedProjectPath,
    projectTrusted: true,
    hostStatus: null,
    activeSessionId,
    onOpenSubagentSession: undefined,
    selectSection: vi.fn(),
    requestSkills: vi.fn(),
    requestMcp: vi.fn(),
    requestExtensions: vi.fn(),
    requestPlugins: vi.fn(),
    requestPrompts: vi.fn(),
    requestPet: vi.fn(),
    requestAutomation: vi.fn(),
    requestSubAgent: undefined,
    activeTheme: PIWIN_APPEARANCE_DARK,
    onThemeApplied: vi.fn(),
    onPetActiveChanged: vi.fn(),
    discoverProviderModels: vi.fn(),
    testProviderModel: vi.fn(),
    testProviderConnection: vi.fn(),
    searchModelCatalog: vi.fn(),
    searchImageModelCatalog: vi.fn(),
    getModelCatalogStatus: vi.fn(),
    syncModelCatalog: vi.fn(),
    storeProviderSecret: vi.fn(),
    loadProviderSecret: vi.fn(),
  } as unknown as SettingsContextValue;

  return (
    <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
        <SettingsProvider value={value}>
          <SystemPromptsPage />
        </SettingsProvider>
      </DesktopLocaleProvider>
    </PiwinUiProvider>
  );
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setReactInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setReactSelectValue(select: HTMLSelectElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  descriptor?.set?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('SystemPromptsPage (file-stacked + read-only modal)', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
  });

  async function renderHarness(
    initialConfig?: PiwinConfig,
    onConfigSaved?: (next: PiwinConfig) => void,
    options?: TestHarnessOptions,
  ): Promise<HTMLElement> {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <TestHarness
          {...(initialConfig ? { initialConfig } : {})}
          {...(onConfigSaved ? { onConfigSaved } : {})}
          {...(options ? { options } : {})}
        />,
      );
    });
    await flushAsync();
    return container;
  }

  it('has no inline textarea editors, stacks .md/.txt files via @, reorders, and opens read-only modal previews', async () => {
    const onConfigSaved = vi.fn();
    const host = await renderHarness(undefined, onConfigSaved);

    // No in-app editable textarea anywhere on the page.
    expect(host.querySelectorAll('textarea')).toHaveLength(0);

    const nameInput = host.querySelector<HTMLInputElement>('[data-testid="system-prompts-preset-name"]');
    expect(nameInput).not.toBeNull();
    act(() => {
      setReactInputValue(nameInput!, '审查方案');
    });

    // Type '@' to bring up .md / .txt candidates.
    const atInput = host.querySelector<HTMLInputElement>('[data-testid="system-prompts-at-input"]');
    expect(atInput).not.toBeNull();
    act(() => {
      atInput!.focus();
      setReactInputValue(atInput!, '@');
    });

    const menu = host.querySelector('[data-testid="system-prompts-at-menu"]');
    expect(menu).not.toBeNull();
    expect(menu!.textContent).toContain('persona.md');
    expect(menu!.textContent).toContain('rules.txt');

    // Add persona.md then rules.txt into the ordered stack.
    const optPersona = host.querySelector<HTMLButtonElement>('[data-testid="sysprompt-at-option-persona.md"]');
    expect(optPersona).not.toBeNull();
    act(() => {
      optPersona!.click();
    });
    await flushAsync();

    act(() => {
      setReactInputValue(atInput!, '@rules');
    });
    const optRules = host.querySelector<HTMLButtonElement>('[data-testid="sysprompt-at-option-rules.txt"]');
    expect(optRules).not.toBeNull();
    act(() => {
      optRules!.click();
    });
    await flushAsync();

    // Move second item up so rules.txt precedes persona.md.
    const moveUpSecond = host.querySelector<HTMLButtonElement>('[data-testid="sysprompt-stack-up-1"]');
    expect(moveUpSecond).not.toBeNull();
    act(() => {
      moveUpSecond!.click();
    });

    // Save preset and verify ordered filePaths persisted.
    const saveBtn = host.querySelector<HTMLButtonElement>('[data-testid="system-prompts-preset-save"]');
    expect(saveBtn?.disabled).toBe(false);
    await act(async () => {
      saveBtn!.click();
    });
    await flushAsync();

    expect(onConfigSaved).toHaveBeenCalledTimes(1);
    const savedConfig = onConfigSaved.mock.calls[0]?.[0] as PiwinConfig;
    expect(savedConfig.systemPrompts?.presets[0]?.filePaths).toEqual([
      '/repo/demo/rules.txt',
      '/Users/demo/.piwin/system-prompts/persona.md',
    ]);

    // Click first stacked card to open read-only modal preview.
    const firstCard = host.querySelector<HTMLButtonElement>('[data-testid="sysprompt-stack-preview-0"]');
    expect(firstCard).not.toBeNull();
    await act(async () => {
      firstCard!.click();
    });
    await flushAsync();

    const modal = document.body.querySelector('[data-testid="system-prompts-preview-modal"]');
    expect(modal).not.toBeNull();
    expect(modal!.querySelectorAll('textarea')).toHaveLength(0);
    expect(modal!.textContent).toContain('Always verify changed files with tests.');
    expect(modal!.querySelector('[data-testid="sysprompt-preview-open-external"]')).not.toBeNull();
  });

  it('renders read-only built-in cards and opens modal on click', async () => {
    const host = await renderHarness();

    const builtinsTab = host.querySelector<HTMLElement>('[data-testid="system-prompts-tab-control"]');
    const radios = builtinsTab?.querySelectorAll<HTMLElement>('input[type="radio"], label');
    const targetRadio = Array.from(radios ?? []).find((el) =>
      el.textContent?.includes('内置提示词'),
    );
    expect(targetRadio).toBeDefined();
    act(() => {
      targetRadio!.click();
    });
    await flushAsync();

    expect(host.querySelectorAll('textarea')).toHaveLength(0);
    const agentCard = host.querySelector<HTMLButtonElement>(
      '[data-testid="sysprompt-builtin-card-agent.default"]',
    );
    expect(agentCard).not.toBeNull();

    act(() => {
      agentCard!.click();
    });
    await flushAsync();

    const previewBody = document.body.querySelector('[data-testid="system-prompts-preview-content"]');
    expect(previewBody).not.toBeNull();
    expect(previewBody!.textContent?.length).toBeGreaterThan(20);
    expect(document.body.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('switches target project in the scope bar, persists projectPresetIds, and isolates effective preview from active session', async () => {
    const onConfigSaved = vi.fn();
    const initialConfig: PiwinConfig = {
      ...baseConfig(),
      systemPrompts: {
        presets: [
          makePreset('reviewer', '审查员', ['/Users/demo/.piwin/system-prompts/persona.md']),
          makePreset('concise', '精简模式', ['/repo/demo/rules.txt']),
        ],
      },
    };
    const host = await renderHarness(initialConfig, onConfigSaved, {
      projectPath: '/repo/demo',
      recentProjects: [makeProject('/repo/demo'), makeProject('/repo/other')],
      activeSessionId: 'sess-1',
      sessionPresetId: 'concise',
    });

    const targetSelect = host.querySelector<HTMLSelectElement>(
      '[data-testid="system-prompts-project-target-select"]',
    );
    expect(targetSelect).not.toBeNull();
    const optionTexts = Array.from(targetSelect!.options).map((opt) => opt.textContent);
    expect(optionTexts).toContain('demo（当前）');
    expect(optionTexts).toContain('other');
    expect(targetSelect!.value).toBe('/repo/demo');

    await act(async () => {
      setReactSelectValue(targetSelect!, '/repo/other');
    });
    await flushAsync();

    const presetSelect = host.querySelector<HTMLSelectElement>(
      '[data-testid="system-prompts-project-select"]',
    );
    expect(presetSelect).not.toBeNull();
    await act(async () => {
      setReactSelectValue(presetSelect!, 'reviewer');
    });
    await flushAsync();

    expect(onConfigSaved).toHaveBeenCalledTimes(1);
    const savedConfig = onConfigSaved.mock.calls[0]?.[0] as PiwinConfig;
    expect(savedConfig.systemPrompts?.projectPresetIds).toEqual({
      '/repo/other': 'reviewer',
    });

    const effectiveBtn = host.querySelector<HTMLButtonElement>(
      '[data-testid="system-prompts-effective-preview-btn"]',
    );
    expect(effectiveBtn).not.toBeNull();
    await act(async () => {
      effectiveBtn!.click();
    });
    await flushAsync();

    const modal = document.body.querySelector('[data-testid="system-prompts-preview-modal"]');
    expect(modal).not.toBeNull();
    expect(modal!.textContent).toContain('项目「other」 · 审查员');
    expect(modal!.textContent).toContain('Act as a careful reviewer.');
    expect(modal!.textContent).not.toContain('Always verify changed files with tests.');
  });

  it('binds, focuses, and unbinds projects directly inside CustomPresetsPanel', async () => {
    const onConfigSaved = vi.fn();
    const initialConfig: PiwinConfig = {
      ...baseConfig(),
      systemPrompts: {
        presets: [
          makePreset('reviewer', '审查员', ['/Users/demo/.piwin/system-prompts/persona.md']),
        ],
        projectPresetIds: {
          '/repo/demo': 'reviewer',
        },
      },
    };
    const host = await renderHarness(initialConfig, onConfigSaved, {
      projectPath: '/repo/demo',
      recentProjects: [makeProject('/repo/demo'), makeProject('/repo/other')],
    });

    const bindingsStrip = host.querySelector('[data-testid="system-prompts-preset-projects"]');
    expect(bindingsStrip).not.toBeNull();
    expect(bindingsStrip!.querySelectorAll('[data-testid="sysprompt-bound-project-chip"]')).toHaveLength(1);

    const addSelect = host.querySelector<HTMLSelectElement>(
      '[data-testid="system-prompts-preset-add-project"]',
    );
    expect(addSelect).not.toBeNull();
    await act(async () => {
      setReactSelectValue(addSelect!, '/repo/other');
    });
    await flushAsync();

    expect(onConfigSaved).toHaveBeenCalledTimes(1);
    const afterBind = onConfigSaved.mock.calls[0]?.[0] as PiwinConfig;
    expect(afterBind.systemPrompts?.projectPresetIds).toEqual({
      '/repo/demo': 'reviewer',
      '/repo/other': 'reviewer',
    });

    const chips = host.querySelectorAll('[data-testid="sysprompt-bound-project-chip"]');
    expect(chips).toHaveLength(2);
    const targetSelect = host.querySelector<HTMLSelectElement>(
      '[data-testid="system-prompts-project-target-select"]',
    );
    expect(targetSelect?.value).toBe('/repo/other');

    const unbindSecond = host.querySelector<HTMLButtonElement>(
      '[data-testid="sysprompt-unbind-project-1"]',
    );
    expect(unbindSecond).not.toBeNull();
    await act(async () => {
      unbindSecond!.click();
    });
    await flushAsync();

    expect(onConfigSaved).toHaveBeenCalledTimes(2);
    const afterUnbind = onConfigSaved.mock.calls[1]?.[0] as PiwinConfig;
    expect(afterUnbind.systemPrompts?.projectPresetIds).toEqual({
      '/repo/demo': 'reviewer',
    });
  });

  it('shows a project browse button when no workspace is open and opens the directory picker dialog', async () => {
    const host = await renderHarness(undefined, undefined, {
      projectPath: null,
      recentProjects: [],
    });

    const browseBtn = host.querySelector<HTMLButtonElement>(
      '[data-testid="system-prompts-project-browse-btn"]',
    );
    expect(browseBtn).not.toBeNull();
    await act(async () => {
      browseBtn!.click();
    });
    await flushAsync();

    const pickerDialog = document.body.querySelector(
      '[data-testid="system-prompts-project-picker-dialog"]',
    );
    expect(pickerDialog).not.toBeNull();
  });
});
