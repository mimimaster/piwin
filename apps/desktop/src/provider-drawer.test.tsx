/**
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import type { ProviderDraft } from './provider-draft.js';
import {
  ProviderDrawer,
  type ProviderDrawerCommon,
  type ProviderDrawerCopy,
} from './provider-drawer.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const copy: ProviderDrawerCopy = {
  enableProvider: 'Enable provider',
  providerEnabledHint: 'Included in the global model list',
  providerDisabledHint: 'Models cannot be selected while disabled',
  statusOff: 'Disabled',
  testing: 'Testing…',
  testConnection: 'Test connection',
  testOk: (count, duration) => `Connected · ${count} · ${duration}ms`,
  saveAndAdd: 'Add and save',
  providerName: 'Provider name',
  connectionHint: 'Keys stay on the Host',
  apiKeyLabel: 'API key',
  apiKeyPlaceholder: 'sk-…',
  apiKeyStoredPlaceholder: '••••••••',
  apiKeyEnvironment: 'API key environment variable',
  apiKeyEnvironmentDescription: 'For RPC/Worker mode.',
  apiAddress: 'API address',
  requestHeaders: 'Request headers',
  requestHeadersHint: 'Optional.',
  headerName: 'Name',
  headerValue: 'Value',
  addHeader: 'Add header',
  advanced: 'Advanced',
};

const common: ProviderDrawerCommon = {
  cancel: 'Cancel',
  delete: 'Delete',
  save: 'Save',
};

function makeDraft(): ProviderDraft {
  return {
    id: 'custom-openai',
    protocol: 'openai-compatible',
    name: 'Custom (OpenAI-compatible)',
    baseUrl: 'https://api.example.com/v1',
    enabled: true,
    apiKeyInput: '',
    storedApiKeyEnv: '',
    storedApiKeyRef: '',
    headerRows: [],
    models: [],
  };
}

function dispatchPointer(target: EventTarget, type: 'pointerdown' | 'pointerup'): void {
  target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true }));
}

function dispatchClick(target: EventTarget): void {
  target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('ProviderDrawer overlay dismiss', () => {
  let container: HTMLDivElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  function renderDrawer(onClose = vi.fn()): ReturnType<typeof vi.fn> {
    const tree: ReactElement = (
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <ProviderDrawer
          draft={makeDraft()}
          isNew
          saving={false}
          testingId={null}
          testStatus={{}}
          isChinese={false}
          copy={copy}
          common={common}
          onClose={onClose}
          onSave={vi.fn(async () => true)}
          onDelete={vi.fn(async () => undefined)}
          onDraftChange={vi.fn()}
          onTestConnection={vi.fn()}
        />
      </PiwinUiProvider>
    );
    act(() => {
      root.render(tree);
    });
    return onClose;
  }

  it('does not close when a text-selection drag starts in a field and is released on the overlay', () => {
    const onClose = renderDrawer();
    const field =
      container.querySelector<HTMLInputElement>('[data-testid="provider-name-input"] input') ??
      container.querySelector<HTMLElement>('[data-testid="provider-name-input"]');
    const overlay = container.querySelector<HTMLElement>('[data-testid="provider-drawer-overlay"]');
    expect(field).not.toBeNull();
    expect(overlay).not.toBeNull();

    act(() => {
      dispatchPointer(field!, 'pointerdown');
      dispatchPointer(overlay!, 'pointerup');
      dispatchClick(overlay!);
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes when the dimmed overlay is pressed and released on itself', () => {
    const onClose = renderDrawer();
    const overlay = container.querySelector<HTMLElement>('[data-testid="provider-drawer-overlay"]');
    expect(overlay).not.toBeNull();

    act(() => {
      dispatchPointer(overlay!, 'pointerdown');
      dispatchPointer(overlay!, 'pointerup');
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when the overlay press is released inside the dialog', () => {
    const onClose = renderDrawer();
    const overlay = container.querySelector<HTMLElement>('[data-testid="provider-drawer-overlay"]');
    const dialog = container.querySelector<HTMLElement>('[data-testid="provider-drawer"]');
    expect(overlay).not.toBeNull();
    expect(dialog).not.toBeNull();

    act(() => {
      dispatchPointer(overlay!, 'pointerdown');
      dispatchPointer(dialog!, 'pointerup');
      dispatchClick(overlay!);
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});
