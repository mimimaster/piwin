// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HostResponse } from '@piwin/contracts';
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
let finish: (response: HostResponse) => void;

function Harness() {
  const cli = useWorkbenchCli({ state, hostClient: host, studioOpen: false,
    subpageOpen: false, locale: 'zh-CN', appearanceMode: 'dark', onResumeSession: resume, onError: error });
  return <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{cli.control}{cli.stage}<span data-active={cli.active} /></PiwinUiProvider>;
}
function render() { act(() => root.render(<Harness />)); }
function click(id: string) {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  if (button === null) throw new Error('Switch missing');
  act(() => button.click());
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  state = createInitialChatUiState(); state.activeSessionId = 'grok-product';
  state.sessionEntitiesById['grok-product'] = { id: 'grok-product', name: 'Build', backend: { agentId: 'grok' } };
  host = new HostClient({ transport: 'live' });
  vi.spyOn(host, 'request').mockImplementation(() => new Promise<HostResponse>((resolve) => { finish = resolve; }));
  native.announce = undefined; resume.mockReset(); error.mockReset(); render();
});
afterEach(async () => { act(() => root.unmount()); container.remove(); await host.dispose(); vi.restoreAllMocks(); });

it('keeps native Grok available during background replay, then reloads the same Desktop conversation', async () => {
  click('conversation-shell-cli'); click('conversation-shell-desktop');
  expect(host.request).toHaveBeenCalledWith({ type: 'agents/cli-sync', sessionId: 'grok-product' });
  expect(container.querySelector<HTMLButtonElement>('[data-testid="conversation-shell-cli"]')?.disabled).toBe(false);
  expect(resume).not.toHaveBeenCalled();
  await act(async () => finish({ type: 'response', command: 'agents/cli-sync', success: true, data: {} }));
  expect(resume).toHaveBeenCalledOnce(); expect(resume).toHaveBeenCalledWith('grok-product', { refresh: true });
  expect(container.querySelector<HTMLButtonElement>('[data-testid="conversation-shell-cli"]')?.disabled).toBe(false);
  expect(error).not.toHaveBeenCalled();
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
});

it('retains Grok while session selection and No Repo hydration arrive in separate commits', () => {
  state = { ...state, activeSessionId: null, draftAgentId: 'grok' }; render();
  click('conversation-shell-cli');
  act(() => native.announce?.('native-created-product'));
  state = { ...state, activeSessionId: 'native-created-product' }; render();
  expect(container.querySelector('[data-testid="native-agent"]')?.getAttribute('data-agent')).toBe('grok');
  state = { ...state, activeScope: { kind: 'project', projectPath: 'no-repo' } }; render();
  expect(container.querySelector('[data-testid="native-agent"]')?.getAttribute('data-agent')).toBe('grok');
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

it('releases a hidden Grok snapshot when a Host turn starts', () => {
  click('conversation-shell-cli'); click('conversation-shell-desktop');
  expect(container.querySelector('[data-testid="native-agent"]')).not.toBeNull();
  state = { ...state, activeRunId: 'desktop-turn' }; render();
  expect(container.querySelector('[data-testid="native-agent"]')).toBeNull();
});

it('invalidates a Grok view that observed a complete Host turn while still selected', () => {
  click('conversation-shell-cli');
  state = { ...state, activeRunId: 'other-client-turn' }; render();
  state = { ...state, activeRunId: null, lastTerminalRunId: 'other-client-turn' }; render();
  expect(container.querySelector('[data-testid="native-agent"]')).not.toBeNull();
  click('conversation-shell-desktop');
  expect(container.querySelector('[data-testid="native-agent"]')).toBeNull();
});
