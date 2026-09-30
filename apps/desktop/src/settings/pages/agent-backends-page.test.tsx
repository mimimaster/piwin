// @vitest-environment happy-dom
/**
 * Settings → Agent Backends (ADR 0082).
 * Renders the real page against a stubbed Host client so the honesty rules
 * (never claim ready before a handshake; never fake an operator action) are
 * covered by the test rather than by convention.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { ExternalAgentStatus, HostResponse } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from '../../appearance-tokens';
import { SettingsProvider } from '../settings-context';
import { createContextValue } from '../settings-shell-test-harness';
import { AgentBackendsPage } from './agent-backends-page';

function readyAgent(): ExternalAgentStatus {
  return {
    agentId: 'grok',
    state: 'ready',
    binaryPath: '/usr/local/bin/grok',
    version: '1.0.44',
    supportStatus: 'verified',
    checkedAt: '2026-09-30T00:00:00.000Z',
  };
}

function notInstalledAgent(): ExternalAgentStatus {
  return {
    agentId: 'grok',
    state: 'not-installed',
    searched: ['/usr/local/bin'],
    checkedAt: '2026-09-30T00:00:00.000Z',
  };
}

type Request = (command: { type: string; refresh?: boolean }) => Promise<HostResponse>;

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
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  function render(request: Request): void {
    const context = {
      ...createContextValue(vi.fn()),
      // The page only reads `request`; `subscribe` satisfies the context shape.
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

  it('installs and toggles the adapter through Host commands without probing implicitly', async () => {
    let installed = false;
    let enabled = true;
    const plugin = () => ({ agentId: 'grok', enabled, manifest: { name: 'Grok Build', version: '1.0.0' }, runtime: { ownership: 'user' } });
    const request = vi.fn(async (command: { type: string; enabled?: boolean }): Promise<HostResponse> => {
      if (command.type === 'agents/install') installed = true;
      if (command.type === 'agents/set-enabled') enabled = command.enabled === true;
      return { type: 'response', command: command.type, success: true, data: command.type === 'agents/list' ? { plugins: installed ? [plugin()] : [] } : { agents: [] } };
    });
    render(request);
    await settle();
    const install = container.querySelector('[data-testid="agent-plugin-install"]') as HTMLButtonElement;
    expect(install).not.toBeNull();
    await act(async () => { install.click(); });
    await settle();
    expect(request).toHaveBeenCalledWith({ type: 'agents/install', source: { kind: 'bundled', agentId: 'grok' } });
    expect(container.querySelector('[data-testid="agent-plugin-grok"]')?.textContent).toContain('已启用');
    const toggle = container.querySelector('[data-testid="agent-plugin-toggle"]') as HTMLButtonElement;
    await act(async () => { toggle.click(); });
    await settle();
    expect(request).toHaveBeenCalledWith({ type: 'agents/set-enabled', agentId: 'grok', enabled: false });
    expect(container.querySelector('[data-testid="agent-plugin-grok"]')?.textContent).toContain('已停用');
    expect(request.mock.calls.some(([command]) => 'refresh' in command)).toBe(false);
  });

  it('renders safe observed MCP status without inventing an empty configuration', async () => {
    const request = vi.fn(async (command: { type: string }): Promise<HostResponse> => ({ type: 'response', command: command.type, success: true, data: command.type === 'agents/mcp-status' ? { observed: true, servers: [{ name: 'notes', status: 'connected', transport: 'stdio' }] } : { agents: [], plugins: [] } }));
    render(request);
    await settle();
    const panel = container.querySelector('[data-testid="agent-backend-mcp-grok"]');
    expect(panel?.textContent).toContain('notes');
    expect(panel?.textContent).toContain('connected');
    expect(panel?.textContent).not.toContain('尚未收到');
  });

  it('lists an agent the Host reports as ready', async () => {
    render(vi.fn().mockResolvedValue({ success: true, data: { agents: [readyAgent()] } }));
    await settle();

    const row = container.querySelector('[data-testid="agent-backend-grok"]');
    expect(row?.textContent).toContain('Grok Build');
    expect(
      container.querySelector('[data-testid="agent-backend-state-grok"]')?.textContent,
    ).toBe('可用');
    // Ready agents carry no "next step" nudge.
    expect(container.querySelector('[data-testid="agent-backend-next-grok"]')).toBeNull();
    expect(container.querySelector('[data-testid="agent-backend-permission-grok"]')?.textContent).toContain(
      'Grok 未报告',
    );
    expect(container.querySelector('[data-testid="agent-backend-mcp-grok"]')).not.toBeNull();
  });

  it('shows Grok\'s permission mode as read-only', async () => {
    const agent = readyAgent();
    if (agent.state !== 'ready') {
      throw new Error('expected ready');
    }
    render(
      vi.fn().mockResolvedValue({
        success: true,
        data: { agents: [{ ...agent, permissionMode: 'always-approve' }] },
      }),
    );
    await settle();

    expect(container.querySelector('[data-testid="agent-backend-permission-grok"]')?.textContent).toContain(
      '自动批准',
    );
  });

  it('shows the searched paths and a next step when the CLI is missing', async () => {
    render(vi.fn().mockResolvedValue({ success: true, data: { agents: [notInstalledAgent()] } }));
    await settle();

    expect(container.textContent).toContain('/usr/local/bin');
    expect(container.querySelector('[data-testid="agent-backend-next-grok"]')).not.toBeNull();
  });

  it('states no agent is configured rather than implying Grok always exists', async () => {
    render(vi.fn().mockResolvedValue({ success: true, data: { agents: [] } }));
    await settle();

    expect(container.querySelector('[data-testid="agent-backends-empty"]')).not.toBeNull();
  });

  it('surfaces a Host error instead of a stale list', async () => {
    render(vi.fn().mockResolvedValue({ success: false, error: 'host offline' }));
    await settle();

    expect(container.querySelector('[data-testid="agent-backends-error"]')?.textContent).toContain(
      'host offline',
    );
  });

  it('re-probes the Host on "Check again"', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, data: { agents: [] } });
    render(request);
    await settle();

    // The first read is cached state, not a forced probe.
    expect(request).toHaveBeenCalledWith({ type: 'agents/status' });

    const button = container.querySelector(
      '[data-testid="agent-backends-recheck"]',
    ) as HTMLButtonElement;
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(request).toHaveBeenLastCalledWith({ type: 'agents/status', refresh: true });
  });
});
