// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { HostResponse } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from '../../appearance-tokens';
import { SettingsProvider } from '../settings-context';
import { createContextValue } from '../settings-shell-test-harness';
import { AgentBackendsPage } from './agent-backends-page';
import { backendExtension } from '../../test/fixtures/extension-backend.fixtures';

describe('AgentBackendsPage', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(request: (command: { type: string }) => Promise<HostResponse>): void {
    const context = {
      ...createContextValue(vi.fn()),
      hostClient: { request, subscribe: () => () => undefined },
    };
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SettingsProvider value={context}>
            <AgentBackendsPage />
          </SettingsProvider>
        </PiwinUiProvider>,
      );
    });
  }

  async function settle(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('lists an installed extension backend by its declaration name and does not install a bundled agent', async () => {
    const request = vi.fn(async (command: { type: string }): Promise<HostResponse> => ({
      type: 'response',
      command: command.type,
      success: true,
      data: command.type === 'extensions/list'
        ? { extensions: [backendExtension(true)] }
        : { agents: [{ agentId: 'example-build', state: 'ready', binaryPath: '/usr/bin/example', version: '1.0.0', supportStatus: 'verified', checkedAt: '2026-10-01T00:00:00.000Z' }] },
    }));
    render(request);
    await settle();
    expect(container.querySelector('[data-testid="agent-backend-example-build"]')?.textContent).toContain('Example Build');
    expect(container.querySelector('[data-testid="agent-backend-state-example-build"]')?.textContent).toContain('可用');
    expect(request.mock.calls.some((call) => call[0]?.type === 'agents/install')).toBe(false);
    expect(container.textContent).not.toContain('Grok Build');
  });

  it('enables a declared backend through the extension registry', async () => {
    const request = vi.fn(async (command: { type: string }): Promise<HostResponse> => ({
      type: 'response',
      command: command.type,
      success: true,
      data: command.type === 'extensions/list'
        ? { extensions: [backendExtension(false)] }
        : { agents: [] },
    }));
    render(request);
    await settle();
    const toggle = container.querySelector('[data-testid="agent-backend-toggle-example-build"] input')
      ?? container.querySelector('[data-testid="agent-backend-toggle-example-build"]');
    expect(toggle).not.toBeNull();
    await act(async () => {
      (toggle as HTMLElement).click();
    });
    await settle();
    expect(request).toHaveBeenCalledWith({
      type: 'extensions/set_enabled',
      extensionId: 'example-build',
      enabled: true,
    });
  });

  it('stays empty when no extension declares a session backend', async () => {
    render(vi.fn().mockResolvedValue({
      type: 'response',
      command: 'extensions/list',
      success: true,
      data: { extensions: [], agents: [] },
    }));
    await settle();
    expect(container.querySelector('[data-testid="agent-backends-empty"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="agent-backend-grok"]')).toBeNull();
  });

  it('mounts recheck button into settings header actions slot when present, and card does not duplicate page title', async () => {
    const headerSlot = document.createElement('div');
    headerSlot.id = 'settings-main-header-actions';
    document.body.appendChild(headerSlot);

    try {
      const request = vi.fn(async (command: { type: string }): Promise<HostResponse> => ({
        type: 'response',
        command: command.type,
        success: true,
        data: command.type === 'extensions/list'
          ? { extensions: [backendExtension(true)] }
          : { agents: [] },
      }));
      render(request);
      await settle();

      expect(container.querySelector('h4')).toBeNull();
      expect(container.textContent).not.toContain('Agent 后端');
      expect(container.textContent).not.toContain('外部智能体');
      const recheck = headerSlot.querySelector<HTMLButtonElement>('[data-testid="agent-backends-recheck"]');
      expect(recheck).not.toBeNull();

      await act(async () => {
        recheck?.click();
      });
      await settle();

      expect(request).toHaveBeenCalledWith({
        type: 'agents/status',
        refresh: true,
      });
    } finally {
      headerSlot.remove();
    }
  });
});
