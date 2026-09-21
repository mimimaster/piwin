// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createDefaultWebConfig } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens';
import { SettingsProvider, type SettingsContextValue } from './settings-context';
import { ModelCatalogSyncControl } from './model-catalog-sync-control';
import { webToDraft } from './web-draft';
import { createContextValue as createShellContext } from './settings-shell-test-harness';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

afterEach(() => {
  document.body.replaceChildren();
});

function renderControl(overrides?: Partial<SettingsContextValue>): {
  container: HTMLDivElement;
  root: Root;
} {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const value: SettingsContextValue = {
    ...createShellContext(() => {}),
    webDraft: webToDraft(createDefaultWebConfig()),
    ...overrides,
  };
  act(() => {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <SettingsProvider value={value}>
          <ModelCatalogSyncControl />
        </SettingsProvider>
      </PiwinUiProvider>,
    );
  });
  return { container, root };
}

describe('ModelCatalogSyncControl', () => {
  it('loads status on mount and syncs on click', async () => {
    const getModelCatalogStatus = vi.fn(async () => ({
      source: 'pi-bootstrap' as const,
      catalogVersion: '0.84.2',
      entryCount: 10,
      imageEntryCount: 2,
    }));
    const syncModelCatalog = vi.fn(async () => ({
      ok: true as const,
      source: 'models.dev' as const,
      catalogVersion: 'models.dev@2026-09-21T12:00:00.000Z',
      fetchedAt: '2026-09-21T12:00:00.000Z',
      entryCount: 42,
      imageEntryCount: 3,
    }));
    const setInfo = vi.fn();
    const { container } = renderControl({
      getModelCatalogStatus,
      syncModelCatalog,
      setInfo,
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(getModelCatalogStatus).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="model-catalog-sync-status"]')?.textContent).toMatch(
      /尚未同步|Not synced/,
    );

    const button = container.querySelector(
      '[data-testid="model-catalog-sync-button"]',
    ) as HTMLButtonElement;
    expect(button).toBeTruthy();
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(syncModelCatalog).toHaveBeenCalledTimes(1);
    expect(setInfo).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="model-catalog-sync-status"]')?.textContent).toMatch(
      /42/,
    );
  });
});
