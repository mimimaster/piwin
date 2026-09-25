// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { HostCommand, HostResponse, SessionSummary } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import type { HostClient } from './host-client.js';
import {
  publishSideChatComposerSeed,
  resetSideChatComposerSeedForTests,
} from './side-chat-composer-seed.js';
import {
  getSideChatBinding,
  resetSideChatBindingsForTests,
  takeSideChatBinding,
} from './side-chat-sessions.js';

// The full session window has its own tests; here it only has to show which
// session and how many quoted refs the panel handed it.
vi.mock('./conversation-pane-session.js', () => ({
  ConversationPaneSession: (props: { sessionId: string; contextRefs?: { pending: unknown[] } }) => (
    <div data-testid="pane" data-session={props.sessionId} data-refs={props.contextRefs?.pending.length ?? 0} />
  ),
}));

const { SideChatPanel } = await import('./side-chat-panel.js');

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function ok(command: string, data: unknown): HostResponse {
  return { type: 'response', command, success: true, data };
}

function fakeHost(existing: string[] = []) {
  let opened = 0;
  const calls: HostCommand[] = [];
  const client = {
    request: vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      calls.push(command);
      if (command.type === 'side-chat/list') {
        return ok(command.type, {
          sessions: existing.map((id) => ({ id }) as SessionSummary),
        });
      }
      if (command.type === 'side-chat/open') {
        opened += 1;
        return ok(command.type, { sideChatSessionId: `new-${opened}`, session: {} });
      }
      return ok(command.type, {});
    }),
  };
  return { client: client as unknown as HostClient, calls };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(host: HostClient, tabId: string, mainSessionId: string | null = 'main-1') {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <SideChatPanel
          sessionId={mainSessionId}
          tabId={tabId}
          hostClient={host}
          activeTheme={PIWIN_APPEARANCE_DARK as never}
          artifactThemeKey="t"
          locale="zh-CN"
        />
      </PiwinUiProvider>,
    );
  });
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  resetSideChatBindingsForTests();
  resetSideChatComposerSeedForTests();
});

describe('SideChatPanel', () => {
  it('opens a side chat for the tab and renders it as a full session window', async () => {
    const { client, calls } = fakeHost();
    const view = await render(client, 'sideChat');
    expect(calls.map((call) => call.type)).toEqual(['side-chat/list', 'side-chat/open']);
    expect(view.querySelector('[data-testid="pane"]')?.getAttribute('data-session')).toBe('new-1');
    expect(getSideChatBinding('main-1', 'sideChat')).toBe('new-1');
  });

  it('reuses an existing side chat, but never one another tab already shows', async () => {
    const { client, calls } = fakeHost(['side-a']);
    const first = await render(client, 'sideChat');
    expect(first.querySelector('[data-testid="pane"]')?.getAttribute('data-session')).toBe('side-a');
    act(() => root?.unmount());
    container?.remove();

    const second = await render(client, 'sideChat-2');
    expect(second.querySelector('[data-testid="pane"]')?.getAttribute('data-session')).toBe('new-1');
    expect(calls.filter((call) => call.type === 'side-chat/open')).toHaveLength(1);
  });

  it('keeps showing the bound session when the tab remounts', async () => {
    const { client, calls } = fakeHost();
    await render(client, 'sideChat');
    act(() => root?.unmount());
    container?.remove();
    const again = await render(client, 'sideChat');
    expect(again.querySelector('[data-testid="pane"]')?.getAttribute('data-session')).toBe('new-1');
    expect(calls.filter((call) => call.type === 'side-chat/open')).toHaveLength(1);
  });

  it('applies a selection seed: quoted refs go to the composer, a seeded session is shown', async () => {
    const { client } = fakeHost();
    const view = await render(client, 'sideChat');
    await act(async () => {
      publishSideChatComposerSeed({
        refs: [{ kind: 'main-message', sourceSessionId: 'main-1', messageId: 'm1', label: '热巧克力' }],
        sideChatSessionId: 'side-seeded',
      });
    });
    const pane = view.querySelector('[data-testid="pane"]');
    expect(pane?.getAttribute('data-session')).toBe('side-seeded');
    expect(pane?.getAttribute('data-refs')).toBe('1');
    expect(takeSideChatBinding('main-1', 'sideChat')).toBe('side-seeded');
  });

  it('asks for a main conversation first', async () => {
    const { client, calls } = fakeHost();
    const view = await render(client, 'sideChat', null);
    expect(calls).toEqual([]);
    expect(view.textContent).toContain('先打开一个会话');
  });
});
