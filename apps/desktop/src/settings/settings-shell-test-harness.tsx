/**
 * Shared harness for `SettingsShell` tests.
 *
 * Lives outside the test file so a second suite (lazy-load failure) can render
 * the same shell without importing a `.test.tsx` — importing one would execute
 * the other suite's `describe` blocks inside the importer.
 */
import { useState, type ReactElement } from 'react';
import { createDefaultWebConfig } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { vi } from 'vitest';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens';
import type { SettingsSectionId } from './section-registry';
import type { SettingsContextValue } from './settings-context';
import { SettingsShell } from './settings-shell';
import { webToDraft } from './web-draft';

export const noopRequest = vi.fn(async () => ({
  type: 'response' as const,
  command: 'test',
  success: true as const,
  // `config` satisfies panels (e.g. SkillsPanel) that read config/get on mount.
  data: { config: {} },
}));

export function createContextValue(
  selectSection: (section: SettingsSectionId) => void,
): SettingsContextValue {
  return {
    request: noopRequest,
    config: null,
    root: '~/.piwin',
    saving: false,
    setError: vi.fn(),
    setInfo: vi.fn(),
    saveConfig: vi.fn(async () => true),
    webDraft: webToDraft(createDefaultWebConfig()),
    setWebDraft: vi.fn(),
    saveWeb: vi.fn(async () => true),
    preferences: {
      assistantTextSize: 'default',
      codeTextSize: 'default',
      codeWrap: false,
      toolDensity: 'comfortable',
      workDetailsExpanded: 'auto',
      artifactCodeFirst: false,
      verboseAgentChat: true,
      conversationWidth: 'wide',
      appearanceMode: 'dark',
      lightTheme: {
        preset: 'default',
        background: '#EEEEEE',
        foreground: '#101010',
        accent: '#007ACC',
      },
      darkTheme: {
        preset: 'default',
        background: '#101010',
        foreground: '#CCCCCC',
        accent: '#007ACC',
      },
    },
    onPreferencesChange: vi.fn(),
    projectPath: null,
    projectTrusted: false,
    hostStatus: null,
    activeSessionId: null,
    onOpenSubagentSession: undefined,
    selectSection,
    requestSkills: noopRequest,
    requestMcp: noopRequest,
    requestExtensions: noopRequest,
    requestPlugins: noopRequest,
    requestPrompts: noopRequest,
    requestPet: noopRequest,
    requestAutomation: noopRequest,
    requestSubAgent: undefined,
    activeTheme: PIWIN_APPEARANCE_DARK,
    onThemeApplied: vi.fn(),
    onPetActiveChanged: vi.fn(),
    discoverProviderModels: vi.fn(),
    testProviderModel: vi.fn(),
    searchModelCatalog: vi.fn(async () => ({ entries: [], catalogVersion: 'test' })),
    searchImageModelCatalog: vi.fn(async () => ({ entries: [], catalogVersion: 'test' })),
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
    testCodeSearchWindsurf: vi.fn(async () => ({ durationMs: 1, resultCount: 1 })),
    storeProviderSecret: vi.fn(),
    loadProviderSecret: vi.fn(),
  };
}

export function ShellHarness({
  initialSection = 'general',
}: {
  initialSection?: SettingsSectionId;
}): ReactElement {
  const [section, setSection] = useState<SettingsSectionId>(initialSection);
  return (
    <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <SettingsShell
        activeSection={section}
        onSelectSection={setSection}
        contextValue={createContextValue(setSection)}
      />
    </PiwinUiProvider>
  );
}
