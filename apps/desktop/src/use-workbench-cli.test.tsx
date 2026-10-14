// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExternalAgentStatus, HostResponse, SessionBackendCapabilities } from '@piwin/contracts';
import { createPiSessionCapabilities } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { createInitialChatUiState, type ChatUiState } from './chat-reducer.js';
import { HostClient } from './host-client.js';
import type { TuiPaneProps } from './tui-pane.js';
import { useWorkbenchCli } from './use-workbench-cli.js';

const native = vi.hoisted(() => ({ announce: undefined as TuiPaneProps['onSessionChange'] }));
vi.mock('./deferred-desktop-surfaces.js', () => ({ DeferredTuiPane: (props: TuiPaneProps) => {
  native.announce = props.onSessionChange;
  return <div data-testid="native-agent" data-agent={props.agentId} />;
}, prefetchTuiPane: async () => undefined }));
vi.mock('./tauri-pty.js', () => ({ isTauriPtyAvailable: () => true }));
let root: Root;
let container: HTMLDivElement;
let host: HostClient;
let state: ChatUiState;
const resume = vi.fn();
const error = vi.fn();
const writerBusy = vi.fn();
let finish: (response: HostResponse) => void;

const NATIVE_CLI_AGENTS = ['grok', 'claude-code', 'codex'] as const;

function nativeCapabilities(agentId: string): SessionBackendCapabilities {
  return { ...createPiSessionCapabilities(), agentId, nativeCli: { supported: true } };
}

function nativeStatus(agentId: string): ExternalAgentStatus {
  return {
    agentId,
    state: 'ready',
    binaryPath: `/fake/${agentId}`,
    version: '1.0.0',
    supportStatus: 'verified',
    checkedAt: '2026-10-03T08:00:00Z',
    nativeCli: { supported: true },
  };
}

function bindNativeCli(current: ChatUiState, agentId: string, sessionId: string): ChatUiState {
  return {
    ...current,
    activeSessionId: sessionId,
    sessionEntitiesById: {
      ...current.sessionEntitiesById,
      [sessionId]: { id: sessionId, name: 'Build', backend: { agentId } },
    },
    backendCapabilitiesBySession: {
      ...current.backendCapabilitiesBySession,
      [sessionId]: nativeCapabilities(agentId),
    },
    externalAgents: [nativeStatus(agentId)],
  };
}

function Harness() {
  const cli = useWorkbenchCli({ state, hostClient: host, studioOpen: false,
    subpageOpen: false, locale: 'zh-CN', appearanceMode: 'dark', onResumeSession: resume, onError: error,
    onWriterBusy: writerBusy });
  return <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{cli.control}{cli.stage}
    <span data-active={cli.active} data-send-blocked={cli.sendBlocked} /></PiwinUiProvider>;
}
function render() { act(() => root.render(<Harness />)); }
function click(id: string) {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  if (button === null) throw new Error('Switch missing');
  act(() => button.click());
}
function sendBlocked(): boolean {
  return container.querySelector('[data-send-blocked]')?.getAttribute('data-send-blocked') === 'true';
}

describe.each(NATIVE_CLI_AGENTS)('%s native CLI handoff', (agentId) => {
  const sessionId = `${agentId}-product`;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    state = bindNativeCli(createInitialChatUiState(), agentId, sessionId);
    host = new HostClient({ transport: 'live' });
    vi.spyOn(host, 'request').mockImplementation(() => new Promise<HostResponse>((resolve) => { finish = resolve; }));
    native.announce = undefined; resume.mockReset(); error.mockReset(); writerBusy.mockReset(); render();
  });
  afterEach(async () => { act(() => root.unmount()); container.remove(); await host.dispose(); vi.restoreAllMocks(); });

  it('keeps native CLI available during background replay, then reloads the same Desktop conversation', async () => {
    click('conversation-shell-cli');
    expect(sendBlocked()).toBe(true);
    click('conversation-shell-desktop');
    expect(host.request).toHaveBeenCalledWith({ type: 'agents/cli-snapshot', sessionId });
    expect(container.querySelector<HTMLButtonElement>('[data-testid="conversation-shell-cli"]')?.disabled).toBe(false);
    expect(resume).not.toHaveBeenCalled();
    expect(sendBlocked()).toBe(true);
    await act(async () => finish({ type: 'response', command: 'agents/cli-sync', success: true, data: {} }));
    expect(resume).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledWith(sessionId, { refresh: true, nativeHistorySynced: true });
    expect(container.querySelector<HTMLButtonElement>('[data-testid="conversation-shell-cli"]')?.disabled).toBe(false);
    expect(error).not.toHaveBeenCalled();
    expect(sendBlocked()).toBe(false);
  });

  it('does not reopen a previous session after the user navigates away during replay', async () => {
    click('conversation-shell-cli'); click('conversation-shell-desktop');
    state = { ...state, activeSessionId: null }; render();
    await act(async () => finish({ type: 'response', command: 'agents/cli-sync', success: true, data: {} }));
    expect(resume).not.toHaveBeenCalled();
  });

  it('reports replay failures and releases the switch so the user can try again', async () => {
    click('conversation-shell-cli'); click('conversation-shell-desktop');
    await act(async () => finish({ type: 'response', command: 'agents/cli-sync', success: false, error: 'history unavailable' }));
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'history unavailable' }));
    expect(resume).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLButtonElement>('[data-testid="conversation-shell-cli"]')?.disabled).toBe(false);
    expect(sendBlocked()).toBe(false);
  });

  it('retains the native backend while session selection and No Repo hydration arrive in separate commits', () => {
    state = { ...state, activeSessionId: null, draftAgentId: agentId }; render();
    click('conversation-shell-cli');
    act(() => native.announce?.('native-created-product'));
    state = { ...state, activeSessionId: 'native-created-product' }; render();
    expect(container.querySelector('[data-testid="native-agent"]')?.getAttribute('data-agent')).toBe(agentId);
    state = { ...state, activeScope: { kind: 'project', projectPath: 'no-repo' } }; render();
    expect(container.querySelector('[data-testid="native-agent"]')?.getAttribute('data-agent')).toBe(agentId);
    expect(container.querySelector('[data-testid="conversation-shell-cli"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('reuses the mounted native view and skips a late Desktop refresh after switching back to CLI', async () => {
    click('conversation-shell-cli');
    const view = container.querySelector('[data-testid="native-agent"]');
    click('conversation-shell-desktop');
    expect(container.querySelector('[data-testid="native-agent"]')).toBe(view);
    click('conversation-shell-cli');
    expect(container.querySelector('[data-testid="native-agent"]')).toBe(view);
    await act(async () => finish({ type: 'response', command: 'agents/cli-sync', success: true, data: {} }));
    expect(resume).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="conversation-shell-cli"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('coalesces rapid returns while replay is pending and refreshes after the last snapshot', async () => {
    click('conversation-shell-cli'); click('conversation-shell-desktop');
    const firstFinish = finish;
    for (let index = 0; index < 3; index += 1) {
      click('conversation-shell-cli'); click('conversation-shell-desktop');
    }
    expect(host.request).toHaveBeenCalledOnce();
    await act(async () => firstFinish({ type: 'response', command: 'agents/cli-sync', success: true, data: {} }));
    expect(host.request).toHaveBeenCalledTimes(2);
    expect(resume).not.toHaveBeenCalled();
    await act(async () => finish({ type: 'response', command: 'agents/cli-sync', success: true, data: {} }));
    expect(resume).toHaveBeenCalledOnce();
  });

  it('releases a hidden native snapshot when a Host turn starts', () => {
    click('conversation-shell-cli'); click('conversation-shell-desktop');
    expect(container.querySelector('[data-testid="native-agent"]')).not.toBeNull();
    state = { ...state, activeRunId: 'desktop-turn' }; render();
    expect(container.querySelector('[data-testid="native-agent"]')).toBeNull();
  });

  it('invalidates a native view that observed a complete Host turn while still selected', () => {
    click('conversation-shell-cli');
    state = { ...state, activeRunId: 'other-client-turn' }; render();
    state = { ...state, activeRunId: null, lastTerminalRunId: 'other-client-turn' }; render();
    expect(container.querySelector('[data-testid="native-agent"]')).not.toBeNull();
    click('conversation-shell-desktop');
    expect(container.querySelector('[data-testid="native-agent"]')).toBeNull();
  });

  it('opens the attached Host terminal view for an active Desktop turn and leaves that actor running', () => {
    state = { ...state, activeRunId: 'desktop-native-turn' }; render();
    click('conversation-shell-cli');
    expect(container.querySelector('[data-testid="native-agent"]')?.getAttribute('data-agent')).toBe('pi');
    expect(container.querySelector('[data-testid="conversation-shell-cli"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(sendBlocked()).toBe(false);
    click('conversation-shell-desktop');
    expect(host.request).not.toHaveBeenCalled();
    expect(state.activeRunId).toBe('desktop-native-turn');
  });
});

describe('conversation CLI gating', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    state = createInitialChatUiState();
    host = new HostClient({ transport: 'live' });
    vi.spyOn(host, 'request').mockImplementation(() => new Promise<HostResponse>((resolve) => { finish = resolve; }));
    native.announce = undefined; resume.mockReset(); error.mockReset(); writerBusy.mockReset();
  });
  afterEach(async () => { act(() => root.unmount()); container.remove(); await host.dispose(); vi.restoreAllMocks(); });

  it('keeps Pi embedded TUI without inventing nativeCli', () => {
    state = { ...state, activeSessionId: 'pi-session' };
    render();
    expect(container.querySelector('[data-testid="conversation-shell-cli"]')).not.toBeNull();
    click('conversation-shell-cli');
    expect(sendBlocked()).toBe(false);
    click('conversation-shell-desktop');
    expect(host.request).not.toHaveBeenCalled();
  });

  it('still offers Grok when legacy adapters omit nativeCli', () => {
    state = {
      ...state,
      activeSessionId: 'grok-product',
      sessionEntitiesById: { 'grok-product': { id: 'grok-product', name: 'Build', backend: { agentId: 'grok' } } },
    };
    render();
    expect(container.querySelector('[data-testid="conversation-shell-cli"]')).not.toBeNull();
  });

  it('hides the switch for an unknown backend instead of falling back to Pi', () => {
    state = {
      ...state,
      activeSessionId: 'mystery',
      sessionEntitiesById: { mystery: { id: 'mystery', name: 'Mystery', backend: { agentId: 'mystery' } } },
    };
    render();
    expect(container.querySelector('[data-testid="conversation-shell-cli"]')).toBeNull();
    expect(container.querySelector('[data-testid="native-agent"]')).toBeNull();
  });

  it('hides the switch when Host marks native CLI unsupported', () => {
    state = bindNativeCli(state, 'claude-code', 'cc-session');
    state = {
      ...state,
      backendCapabilitiesBySession: {
        'cc-session': { ...createPiSessionCapabilities(), agentId: 'claude-code', nativeCli: { supported: false, reason: 'no TUI' } },
      },
    };
    render();
    expect(container.querySelector('[data-testid="conversation-shell-cli"]')).toBeNull();
  });

  it('hides the switch when the backend is not ready even if it advertises native CLI', () => {
    state = {
      ...state,
      activeSessionId: null,
      draftAgentId: 'codex',
      externalAgents: [{
        agentId: 'codex',
        state: 'not-installed',
        searched: ['/usr/bin'],
        checkedAt: '2026-10-03T08:00:00Z',
      }],
    };
    render();
    expect(container.querySelector('[data-testid="conversation-shell-cli"]')).toBeNull();
  });
});
