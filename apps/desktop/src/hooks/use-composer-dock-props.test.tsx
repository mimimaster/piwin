// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionBackendOptions } from '@piwin/contracts';
import { createInitialChatUiState } from '../chat-reducer.js';
import { useComposerDockProps } from './use-composer-dock-props.js';

const stable = vi.hoisted(() => ({ live: {}, stop: { isStopping: false }, files: [] }));
vi.mock('../desktop-locale-context.js', () => ({ useDesktopLocale: () => ({ locale: 'zh-CN' }) }));
vi.mock('../live/use-live-call.js', () => ({ useLiveCall: () => stable.live, liveStartErrorLabel: String }));
vi.mock('../live/live-intended-session-sync.js', () => ({ useLiveIntendedSessionSync: () => {} }));
vi.mock('../subagent-stop-controller.js', () => ({ useSubagentStopController: () => stable.stop }));
vi.mock('./use-at-workspace-files.js', () => ({ useAtWorkspaceFiles: () => stable.files }));

type Arguments = Parameters<typeof useComposerDockProps>[0];
type Card = ReturnType<typeof useComposerDockProps>['composerCard'];
let root: Root;
let container: HTMLDivElement;
let latest: Card | undefined;

function Probe({ args }: { args: Arguments }) {
  latest = useComposerDockProps(args).composerCard;
  return null;
}

function baseArgs(): Arguments {
  // Unused event ports remain opaque; exercised state/catalog ports are real.
  return {
    state: createInitialChatUiState(), config: null, hostStatus: null,
    hostClient: { getTransport: () => 'sidecar', supportsCommand: () => false },
    composer: '', activeCommentsCount: 0, agentMode: 'agent', liveSessionId: null,
    queuedTurnEditId: null, steerQueueMessages: [], activeJobs: [], recentProjects: [],
    pendingAttachments: [], pendingContextRefs: [], modelOptions: [], menuSkills: [], menuMcp: [],
    selectedModelKey: 'native::model', selectedModelLabel: 'Native model', thinkingLevel: 'off',
    backendControls: { options: null, selectModel: vi.fn(), selectEffort: vi.fn(), selectMode: vi.fn() },
    capabilities: { isExternalBackend: false, supports: () => true, unsupportedReason: () => undefined },
    draftAgentOptions: [{ agentId: 'pi', label: 'Pi', ready: true }, { agentId: 'grok', label: 'Grok', ready: true }],
    draftAgentId: 'pi', onDraftAgentChange: vi.fn(), onStartNewSession: vi.fn(),
    orchestrationSchemeOptions: [], sidebarMode: 'code',
  } as unknown as Arguments;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  latest = undefined;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

it('updates the dock catalog when only backend controls change', () => {
  const args = baseArgs();
  const loaded: SessionBackendOptions = {
    agentId: 'grok', models: [{ id: 'fast', label: 'Fast' }], currentModelId: 'fast',
    modes: [], modeConfirmed: false, commands: [],
  };
  act(() => root.render(<Probe args={args} />));
  act(() => root.render(<Probe args={{ ...args, backendControls: { ...args.backendControls, options: loaded } }} />));
  expect(latest?.backendOptions).toBe(loaded);
});

it('updates the draft engine without changing the native model or other dependencies', () => {
  const args = baseArgs();
  act(() => root.render(<Probe args={args} />));
  act(() => root.render(<Probe args={{ ...args, draftAgentId: 'grok' }} />));
  expect(latest?.draftAgentId).toBe('grok');
});

it('updates backend setter closures without an unrelated dock change', () => {
  const args = baseArgs();
  const currentModelHandler = vi.fn();
  act(() => root.render(<Probe args={args} />));
  act(() => root.render(<Probe args={{ ...args, backendControls: { ...args.backendControls, selectModel: currentModelHandler } }} />));
  latest?.onBackendModelChange?.('fast');
  expect(currentModelHandler).toHaveBeenCalledWith('fast');
  expect(args.backendControls.selectModel).not.toHaveBeenCalled();
});
