// @vitest-environment happy-dom
/**
 * ArchivePage — Archive Management in Settings tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createDefaultWebConfig, type SessionListData, type SessionSummary } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../../appearance-tokens';
import { DesktopLocaleProvider } from '../../desktop-locale-context';
import { SettingsProvider, type SettingsContextValue } from '../settings-context';
import { ArchivePage } from './archive-page';
import { webToDraft } from '../web-draft';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const mockSessions: SessionSummary[] = [
  {
    id: 's-archived-1',
    name: 'Build React Website',
    scope: { kind: 'general' },
    workingDirectory: '/tmp/workspace',
    projectPath: '',
    updatedAt: '2026-08-15T12:00:00.000Z',
    archivedAt: '2026-08-15T12:30:00.000Z',
    isArchived: true,
    messageCount: 10,
    lastPreview: 'I have finished setting up the Vite project.',
  },
  {
    id: 's-archived-2',
    name: 'Fix Backend Database Bug',
    scope: { kind: 'project', projectPath: '/Users/test/backend-app' },
    workingDirectory: '/Users/test/backend-app',
    projectPath: '/Users/test/backend-app',
    updatedAt: '2026-08-14T10:00:00.000Z',
    archivedAt: '2026-08-14T11:00:00.000Z',
    isArchived: true,
    messageCount: 5,
    lastPreview: 'SQL connection pool issue resolved.',
  },
  {
    id: 's-active-3',
    name: 'Active Chat Session',
    scope: { kind: 'general' },
    workingDirectory: '/tmp/workspace',
    projectPath: '',
    updatedAt: '2026-08-16T09:00:00.000Z',
    isArchived: false,
    messageCount: 2,
    lastPreview: 'Hello there!',
  },
];

function createContextValue(
  requestMock: SettingsContextValue['request'],
): SettingsContextValue {
  return {
    request: requestMock,
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
      artifactPreviewEnabled: true,
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
        background: '#1E1E1E',
        foreground: '#D4D4D4',
        accent: '#0E639C',
      },
    },
    onPreferencesChange: vi.fn(),
    projectPath: null,
    projectTrusted: true,
    hostStatus: null,
    activeSessionId: null,
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
    searchModelCatalog: vi.fn(),
    searchImageModelCatalog: vi.fn(),
    storeProviderSecret: vi.fn(),
    loadProviderSecret: vi.fn(),
  };
}

describe('ArchivePage', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
    container = null;
    root = null;
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('loads and renders archived sessions', async () => {
    const request = vi.fn(async (cmd) => {
      if (cmd.type === 'session/list') {
        const data: SessionListData = {
          sessions: mockSessions,
          totalCount: mockSessions.length,
          truncated: false,
        };
        return {
          type: 'response' as const,
          command: 'session/list',
          success: true as const,
          data,
        };
      }
      return {
        type: 'response' as const,
        command: 'test',
        success: true as const,
      };
    });

    const contextValue = createContextValue(request);

    await act(async () => {
      root?.render(
        <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <SettingsProvider value={contextValue}>
              <ArchivePage />
            </SettingsProvider>
          </PiwinUiProvider>
        </DesktopLocaleProvider>,
      );
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session/list',
        allScopes: true,
        includeArchived: true,
      }),
    );

    // Active session should be filtered out; 2 archived sessions should be visible
    expect(container?.querySelector('[data-testid="archive-item-s-archived-1"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="archive-item-s-archived-2"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="archive-item-s-active-3"]')).toBeNull();

    // Check titles and preview texts
    expect(container?.textContent).toContain('Build React Website');
    expect(container?.textContent).toContain('Fix Backend Database Bug');
    expect(container?.textContent).toContain('SQL connection pool issue resolved.');
  });

  it('renders empty state when there are no archived sessions', async () => {
    const request = vi.fn(async (cmd) => {
      if (cmd.type === 'session/list') {
        const data: SessionListData = {
          sessions: [mockSessions[2]!], // only active session
          totalCount: 1,
          truncated: false,
        };
        return {
          type: 'response' as const,
          command: 'session/list',
          success: true as const,
          data,
        };
      }
      return { type: 'response' as const, command: 'test', success: true as const };
    });

    const contextValue = createContextValue(request);

    await act(async () => {
      root?.render(
        <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <SettingsProvider value={contextValue}>
              <ArchivePage />
            </SettingsProvider>
          </PiwinUiProvider>
        </DesktopLocaleProvider>,
      );
    });

    expect(container?.querySelector('[data-testid="archive-empty-state"]')).not.toBeNull();
    expect(container?.textContent).toContain('暂无归档会话');
  });

  it('filters archived sessions by search query', async () => {
    const request = vi.fn(async (cmd) => {
      if (cmd.type === 'session/list') {
        const data: SessionListData = {
          sessions: mockSessions,
          totalCount: mockSessions.length,
          truncated: false,
        };
        return {
          type: 'response' as const,
          command: 'session/list',
          success: true as const,
          data,
        };
      }
      return { type: 'response' as const, command: 'test', success: true as const };
    });

    const contextValue = createContextValue(request);

    await act(async () => {
      root?.render(
        <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <SettingsProvider value={contextValue}>
              <ArchivePage />
            </SettingsProvider>
          </PiwinUiProvider>
        </DesktopLocaleProvider>,
      );
    });

    const searchInput = container?.querySelector(
      '[data-testid="archive-search-input"]',
    ) as HTMLInputElement;
    expect(searchInput).not.toBeNull();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(searchInput, 'backend');
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container?.querySelector('[data-testid="archive-item-s-archived-2"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="archive-item-s-archived-1"]')).toBeNull();
  });

  it('restores an archived session on restore button click', async () => {
    const request = vi.fn(async (cmd) => {
      if (cmd.type === 'session/list') {
        const data: SessionListData = {
          sessions: [...mockSessions],
          totalCount: mockSessions.length,
          truncated: false,
        };
        return {
          type: 'response' as const,
          command: 'session/list',
          success: true as const,
          data,
        };
      }
      if (cmd.type === 'session/unarchive') {
        return {
          type: 'response' as const,
          command: 'session/unarchive',
          success: true as const,
        };
      }
      return { type: 'response' as const, command: 'test', success: true as const };
    });

    const contextValue = createContextValue(request);

    await act(async () => {
      root?.render(
        <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <SettingsProvider value={contextValue}>
              <ArchivePage />
            </SettingsProvider>
          </PiwinUiProvider>
        </DesktopLocaleProvider>,
      );
    });

    const restoreBtn = container?.querySelector(
      '[data-testid="archive-restore-btn-s-archived-1"]',
    ) as HTMLButtonElement;
    expect(restoreBtn).not.toBeNull();

    await act(async () => {
      restoreBtn.click();
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session/unarchive',
        sessionId: 's-archived-1',
      }),
    );

    // After restore, item s-archived-1 should be removed from view
    expect(container?.querySelector('[data-testid="archive-item-s-archived-1"]')).toBeNull();
    expect(contextValue.setInfo).toHaveBeenCalledWith(
      expect.stringContaining('已还原'),
      'success',
    );
  });

  it('deletes an archived session after confirmation dialog', async () => {
    const request = vi.fn(async (cmd) => {
      if (cmd.type === 'session/list') {
        const data: SessionListData = {
          sessions: [...mockSessions],
          totalCount: mockSessions.length,
          truncated: false,
        };
        return {
          type: 'response' as const,
          command: 'session/list',
          success: true as const,
          data,
        };
      }
      if (cmd.type === 'session/delete') {
        return {
          type: 'response' as const,
          command: 'session/delete',
          success: true as const,
        };
      }
      return { type: 'response' as const, command: 'test', success: true as const };
    });

    const contextValue = createContextValue(request);

    await act(async () => {
      root?.render(
        <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <SettingsProvider value={contextValue}>
              <ArchivePage />
            </SettingsProvider>
          </PiwinUiProvider>
        </DesktopLocaleProvider>,
      );
    });

    const deleteBtn = container?.querySelector(
      '[data-testid="archive-delete-btn-s-archived-1"]',
    ) as HTMLButtonElement;
    expect(deleteBtn).not.toBeNull();

    await act(async () => {
      deleteBtn.click();
    });

    // Confirm dialog should be open
    const confirmBtn = document.querySelector('[data-testid="confirm-dialog-confirm"]') as HTMLButtonElement;
    expect(confirmBtn).not.toBeNull();

    await act(async () => {
      confirmBtn.click();
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session/delete',
        sessionId: 's-archived-1',
      }),
    );

    // After delete, item s-archived-1 should be removed from view
    expect(container?.querySelector('[data-testid="archive-item-s-archived-1"]')).toBeNull();
  });

  it('supports select-all and batch restore', async () => {
    const request = vi.fn(async (cmd) => {
      if (cmd.type === 'session/list') {
        const data: SessionListData = {
          sessions: [...mockSessions],
          totalCount: mockSessions.length,
          truncated: false,
        };
        return {
          type: 'response' as const,
          command: 'session/list',
          success: true as const,
          data,
        };
      }
      if (cmd.type === 'session/unarchive') {
        return {
          type: 'response' as const,
          command: 'session/unarchive',
          success: true as const,
        };
      }
      return { type: 'response' as const, command: 'test', success: true as const };
    });

    const contextValue = createContextValue(request);

    await act(async () => {
      root?.render(
        <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <SettingsProvider value={contextValue}>
              <ArchivePage />
            </SettingsProvider>
          </PiwinUiProvider>
        </DesktopLocaleProvider>,
      );
    });

    const selectAllCheckbox = container?.querySelector(
      '[data-testid="archive-select-all-checkbox"]',
    ) as HTMLInputElement;
    expect(selectAllCheckbox).not.toBeNull();

    await act(async () => {
      selectAllCheckbox.click();
    });

    const batchRestoreBtn = container?.querySelector(
      '[data-testid="archive-batch-restore-button"]',
    ) as HTMLButtonElement;
    expect(batchRestoreBtn).not.toBeNull();
    expect(batchRestoreBtn.textContent).toContain('还原所选 (2)');

    await act(async () => {
      batchRestoreBtn.click();
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session/unarchive',
        sessionId: 's-archived-1',
      }),
    );
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session/unarchive',
        sessionId: 's-archived-2',
      }),
    );

    // After restoring all, empty state should be rendered
    expect(container?.querySelector('[data-testid="archive-empty-state"]')).not.toBeNull();
  });

  it('supports batch delete with confirmation', async () => {
    const request = vi.fn(async (cmd) => {
      if (cmd.type === 'session/list') {
        const data: SessionListData = {
          sessions: [...mockSessions],
          totalCount: mockSessions.length,
          truncated: false,
        };
        return {
          type: 'response' as const,
          command: 'session/list',
          success: true as const,
          data,
        };
      }
      if (cmd.type === 'session/delete') {
        return {
          type: 'response' as const,
          command: 'session/delete',
          success: true as const,
        };
      }
      return { type: 'response' as const, command: 'test', success: true as const };
    });

    const contextValue = createContextValue(request);

    await act(async () => {
      root?.render(
        <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <SettingsProvider value={contextValue}>
              <ArchivePage />
            </SettingsProvider>
          </PiwinUiProvider>
        </DesktopLocaleProvider>,
      );
    });

    const selectAllCheckbox = container?.querySelector(
      '[data-testid="archive-select-all-checkbox"]',
    ) as HTMLInputElement;
    expect(selectAllCheckbox).not.toBeNull();

    await act(async () => {
      selectAllCheckbox.click();
    });

    const batchDeleteBtn = container?.querySelector(
      '[data-testid="archive-batch-delete-button"]',
    ) as HTMLButtonElement;
    expect(batchDeleteBtn).not.toBeNull();
    expect(batchDeleteBtn.textContent).toContain('删除所选 (2)');

    await act(async () => {
      batchDeleteBtn.click();
    });

    const confirmBtn = document.querySelector('[data-testid="confirm-dialog-confirm"]') as HTMLButtonElement;
    expect(confirmBtn).not.toBeNull();

    await act(async () => {
      confirmBtn.click();
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session/delete',
        sessionId: 's-archived-1',
      }),
    );
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session/delete',
        sessionId: 's-archived-2',
      }),
    );

    expect(container?.querySelector('[data-testid="archive-empty-state"]')).not.toBeNull();
  });

  it('supports empty-all archive with confirmation', async () => {
    const request = vi.fn(async (cmd) => {
      if (cmd.type === 'session/list') {
        const data: SessionListData = {
          sessions: [...mockSessions],
          totalCount: mockSessions.length,
          truncated: false,
        };
        return {
          type: 'response' as const,
          command: 'session/list',
          success: true as const,
          data,
        };
      }
      if (cmd.type === 'session/delete') {
        return {
          type: 'response' as const,
          command: 'session/delete',
          success: true as const,
        };
      }
      return { type: 'response' as const, command: 'test', success: true as const };
    });

    const contextValue = createContextValue(request);

    await act(async () => {
      root?.render(
        <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <SettingsProvider value={contextValue}>
              <ArchivePage />
            </SettingsProvider>
          </PiwinUiProvider>
        </DesktopLocaleProvider>,
      );
    });

    const emptyAllBtn = container?.querySelector(
      '[data-testid="archive-empty-all-button"]',
    ) as HTMLButtonElement;
    expect(emptyAllBtn).not.toBeNull();

    await act(async () => {
      emptyAllBtn.click();
    });

    const confirmBtn = document.querySelector('[data-testid="confirm-dialog-confirm"]') as HTMLButtonElement;
    expect(confirmBtn).not.toBeNull();

    await act(async () => {
      confirmBtn.click();
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session/delete',
        sessionId: 's-archived-1',
      }),
    );
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session/delete',
        sessionId: 's-archived-2',
      }),
    );

    expect(container?.querySelector('[data-testid="archive-empty-state"]')).not.toBeNull();
  });

  it('refreshes the list when refresh button is clicked', async () => {
    const request = vi.fn(async (cmd) => {
      if (cmd.type === 'session/list') {
        const data: SessionListData = {
          sessions: [...mockSessions],
          totalCount: mockSessions.length,
          truncated: false,
        };
        return {
          type: 'response' as const,
          command: 'session/list',
          success: true as const,
          data,
        };
      }
      return { type: 'response' as const, command: 'test', success: true as const };
    });

    const contextValue = createContextValue(request);

    await act(async () => {
      root?.render(
        <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <SettingsProvider value={contextValue}>
              <ArchivePage />
            </SettingsProvider>
          </PiwinUiProvider>
        </DesktopLocaleProvider>,
      );
    });

    expect(request).toHaveBeenCalledTimes(1);

    const refreshBtn = container?.querySelector(
      '[data-testid="archive-refresh-button"]',
    ) as HTMLButtonElement;
    expect(refreshBtn).not.toBeNull();

    await act(async () => {
      refreshBtn.click();
    });

    expect(request).toHaveBeenCalledTimes(2);
  });
});
