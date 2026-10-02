// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnabledExtensionSessionBackend, ExtensionSummary, HostResponse, HostServerMessage } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import { backendExtension } from '../test/fixtures/extension-backend.fixtures';
import { useEnabledSessionBackends } from './use-enabled-session-backends';

describe('useEnabledSessionBackends', () => {
  let container: HTMLElement;
  let root: Root;
  let latest: EnabledExtensionSessionBackend[];

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    root = createRoot(container);
    latest = [];
  });

  afterEach(() => {
    act(() => root.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  function mount(request: () => Promise<HostResponse>) {
    const listeners = new Set<(message: HostServerMessage) => void>();
    const unsubscribe = vi.fn();
    const hostClient = {
      request,
      subscribe: (listener: (message: HostServerMessage) => void) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); unsubscribe(); };
      },
    } as unknown as HostClient;
    function Harness(): null {
      latest = useEnabledSessionBackends(hostClient);
      return null;
    }
    act(() => root.render(<Harness />));
    return {
      unsubscribe,
      emit: (message: HostServerMessage) => { for (const listener of listeners) listener(message); },
    };
  }

  function response(extensions: ExtensionSummary[]): HostResponse {
    return { type: 'response', command: 'extensions/list', success: true, data: { extensions } };
  }

  async function settle(): Promise<void> {
    await act(async () => { await Promise.resolve(); });
  }

  it('shows a backend installed while the composer is already mounted and removes it when disabled or uninstalled', async () => {
    let extensions: ExtensionSummary[] = [];
    const request = vi.fn(async () => response(extensions));
    const { emit } = mount(request);
    await settle();
    expect(latest).toEqual([]);

    extensions = [backendExtension(true)];
    act(() => emit({ type: 'marketplace/inventory-updated', revision: 'installed', changedKinds: ['extension'] }));
    await settle();
    expect(latest).toMatchObject([{ agentId: 'example-build', name: 'Example Build' }]);

    extensions = [backendExtension(false)];
    act(() => emit({ type: 'marketplace/inventory-updated', revision: 'disabled', changedKinds: ['extension'] }));
    await settle();
    expect(latest).toEqual([]);

    extensions = [backendExtension(true)];
    act(() => emit({ type: 'marketplace/inventory-updated', revision: 'enabled', changedKinds: ['extension'] }));
    await settle();
    expect(latest).toHaveLength(1);

    extensions = [];
    act(() => emit({ type: 'marketplace/inventory-updated', revision: 'removed', changedKinds: ['extension'] }));
    await settle();
    expect(latest).toEqual([]);
  });

  it('ignores an older list response that arrives after an install refresh', async () => {
    let resolveInitial: ((value: HostResponse) => void) | undefined;
    const initial = new Promise<HostResponse>((resolve) => { resolveInitial = resolve; });
    const request = vi.fn().mockReturnValueOnce(initial).mockResolvedValue(response([backendExtension(true)]));
    const { emit } = mount(request);
    act(() => emit({ type: 'marketplace/inventory-updated', revision: 'installed', changedKinds: ['extension'] }));
    await settle();
    expect(latest).toHaveLength(1);
    await act(async () => { resolveInitial?.(response([])); });
    expect(latest).toHaveLength(1);
  });

  it('ignores unrelated inventory changes and unsubscribes on unmount', async () => {
    const request = vi.fn(async () => response([]));
    const { emit, unsubscribe } = mount(request);
    await settle();
    act(() => emit({ type: 'marketplace/inventory-updated', revision: 'skill', changedKinds: ['skill'] }));
    expect(request).toHaveBeenCalledTimes(1);
    act(() => root.render(null));
    expect(unsubscribe).toHaveBeenCalledOnce();
    act(() => emit({ type: 'marketplace/inventory-updated', revision: 'extension', changedKinds: ['extension'] }));
    expect(request).toHaveBeenCalledTimes(1);
  });
});
