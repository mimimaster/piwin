// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PRIMARY_CONVERSATION_PANE_ID,
  applyConversationPanePreset,
  bindConversationPaneSession,
  createConversationPaneLayout,
  listConversationPaneLeaves,
  type ConversationPaneIdFactory,
  type ConversationPaneLayout,
} from './conversation-pane-layout.js';
import type { HostClient } from './host-client.js';
import { useConversationPaneSubscriptions } from './use-conversation-pane-layout.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function createIds(): ConversationPaneIdFactory {
  let sequence = 0;
  return (kind) => `${kind}-${++sequence}`;
}

function createBoundLayout(): ConversationPaneLayout {
  const createId = createIds();
  let layout = applyConversationPanePreset(
    createConversationPaneLayout('session-primary-old'),
    4,
    createId,
  );
  const supplementaryLeaves = listConversationPaneLeaves(layout.root).filter(
    (leaf) => leaf.paneId !== PRIMARY_CONVERSATION_PANE_ID,
  );
  for (const [index, leaf] of supplementaryLeaves.entries()) {
    layout = bindConversationPaneSession(layout, leaf.paneId, `session-${index + 1}`);
  }
  return layout;
}

function Harness(props: {
  hostClient: HostClient;
  layout: ConversationPaneLayout;
  activeSessionId: string | null;
  panesEnabled: boolean;
}): null {
  useConversationPaneSubscriptions({
    hostClient: props.hostClient,
    activeSessionId: props.activeSessionId,
    paneLayout: props.layout,
    panesEnabled: props.panesEnabled,
  });
  return null;
}

describe('useConversationPaneSubscriptions', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it('publishes one deduplicated union and includes a newly selected primary immediately', async () => {
    const updateSubscriptions = vi.fn<(sessionIds: string[]) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const hostClient = { updateSubscriptions } as unknown as HostClient;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const layout = createBoundLayout();

    await act(async () => {
      root?.render(
        <Harness
          hostClient={hostClient}
          layout={layout}
          activeSessionId="session-primary-new"
          panesEnabled
        />,
      );
      await Promise.resolve();
    });

    expect(updateSubscriptions).toHaveBeenLastCalledWith([
      'session-primary-new',
      'session-primary-old',
      'session-1',
      'session-2',
      'session-3',
    ]);
  });

  it('falls back to the selected session outside the pane workspace', async () => {
    const updateSubscriptions = vi.fn<(sessionIds: string[]) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const hostClient = { updateSubscriptions } as unknown as HostClient;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <Harness
          hostClient={hostClient}
          layout={createBoundLayout()}
          activeSessionId="project-session"
          panesEnabled={false}
        />,
      );
      await Promise.resolve();
    });

    expect(updateSubscriptions).toHaveBeenLastCalledWith(['project-session']);
  });
});
