// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PiwinConfig } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens.js';
import { SettingsProvider, type SettingsContextValue } from './settings-context.js';
import { DevinLoginFollowUp } from './devin-login-follow-up.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function render(contextValue: SettingsContextValue, followUp: Parameters<typeof DevinLoginFollowUp>[0]['followUp']) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <SettingsProvider value={contextValue}>
          <DevinLoginFollowUp followUp={followUp} zh onDismiss={() => undefined} />
        </SettingsProvider>
      </PiwinUiProvider>,
    );
  });
  return container;
}

describe('DevinLoginFollowUp', () => {
  it('reports what the sign-in turned on without offering a switch when not needed', () => {
    const view = render(
      { setInfo: vi.fn(), saveConfig: vi.fn() } as unknown as SettingsContextValue,
      { enabled: ['code-search', 'web-search-source'] },
    );
    expect(view.textContent).toContain('已用 Devin 账号启用 code_search 和 Devin 网页搜索');
    expect(view.querySelector('[data-testid="devin-login-follow-up-switch"]')).toBeNull();
  });

  it('switches priority on top of the Host config, not a stale copy', async () => {
    const fresh = {
      providers: [],
      web: {
        searchRoutePolicy: 'native-first',
        searchSources: [{ id: 'devin', kind: 'devin', enabled: true, apiKeyRef: 'oauth:devin' }],
      },
      codeSearch: { enabled: true, backend: 'windsurf', apiKeyRef: 'oauth:devin' },
    } as unknown as PiwinConfig;
    const saveConfig = vi.fn(async () => true);
    const request = vi.fn(async () => ({
      type: 'response' as const,
      command: 'settings/get',
      success: true as const,
      data: { snapshot: { config: fresh } },
    }));
    const view = render(
      {
        hostClient: { request, subscribe: vi.fn(() => () => {}) },
        setInfo: vi.fn(),
        saveConfig,
      } as unknown as SettingsContextValue,
      { enabled: ['web-search-source'], suggestExternalSearchPriority: true },
    );
    expect(view.textContent).toContain('模型内置搜索优先');
    await act(async () => {
      view.querySelector<HTMLButtonElement>('[data-testid="devin-login-follow-up-switch"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalledWith({ type: 'settings/get' });
    const saved = (saveConfig.mock.calls[0] as unknown as [PiwinConfig])[0];
    expect(saved.web?.searchRoutePolicy).toBe('external-first');
    expect(saved.web?.searchSources).toEqual(fresh.web?.searchSources);
    expect(saved.codeSearch).toEqual(fresh.codeSearch);
    expect(view.querySelector('[data-testid="devin-login-follow-up-switch"]')).toBeNull();
  });
});
