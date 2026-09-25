// Test-only fixture: a Host context carrying just the read model the pages use.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { RemoteSessionSummary } from '@piwin/contracts';
import { MOBILE_THEME } from '../mobile-theme.js';
import { InkstoneApp } from './InkstoneApp.js';
import type { InkstoneHost, InkstoneHostContextValue } from './host/inkstone-host-context.js';

export const FIXTURE_SESSIONS: RemoteSessionSummary[] = [
  {
    sessionId: 's1',
    name: '修好移动端重连',
    scope: 'project',
    projectId: 'p1',
    updatedAt: '2026-09-25T10:00:00.000Z',
    messageCount: 4,
    lastPreview: '断线后草稿不要丢',
  },
  { sessionId: 's2', name: '周末读书笔记', scope: 'general', updatedAt: '2026-09-24T10:00:00.000Z', messageCount: 2 },
];

export function fakeHost(overrides: Partial<InkstoneHost> = {}): InkstoneHost {
  const host: Partial<InkstoneHost> = {
    client: undefined,
    endpoint: 'ws://127.0.0.1:8787',
    connectionState: { kind: 'ready' },
    sessions: FIXTURE_SESSIONS,
    projects: [{ projectId: 'p1', displayName: 'piwin' }],
    activityItems: [],
    knowledgeBases: [],
    activeSessionId: undefined,
    messages: [],
    composerText: '',
    setComposerText: () => undefined,
    attachments: [],
    removeAttachment: () => undefined,
    activeRunId: undefined,
    pausedCheckpointId: undefined,
    permissionRequest: undefined,
    isSending: false,
    isResolvingPermission: false,
    errorMessage: undefined,
    configuredModels: [],
    handleSelectSession: async () => undefined,
    loadMoreSessions: () => undefined,
    ...overrides,
  };
  return host as InkstoneHost;
}

export function fakeHostContext(host: InkstoneHost = fakeHost()): InkstoneHostContextValue {
  return {
    host,
    onOpenConnection: () => undefined,
    modelSelection: {
      providerId: undefined,
      modelId: undefined,
      thinkingLevel: undefined,
      select: () => undefined,
      selectThinking: () => undefined,
    },
  };
}

export interface RenderedInkstone {
  unmount: () => void;
}

export function renderInkstone(hostContext: InkstoneHostContextValue | null, hash = ''): RenderedInkstone {
  window.history.pushState(null, '', hash.length > 0 ? `#${hash}` : '#');
  const container = document.createElement('div');
  document.body.append(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(
      <PiwinUiProvider manifest={MOBILE_THEME}>
        <InkstoneApp hostContext={hostContext} />
      </PiwinUiProvider>,
    );
  });
  return {
    unmount: () => {
      act(() => root.unmount());
      container.remove();
      window.location.hash = '';
    },
  };
}

export function click(element: Element | null | undefined): void {
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}
