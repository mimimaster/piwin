// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { HostCommand, HostPush, HostResponse, KnowledgeContextRef } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from '../../theme/appearance-tokens.js';
import { KnowledgeAssistPanel } from './KnowledgeAssistPanel.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pageRef: KnowledgeContextRef = {
  kind: 'knowledge-selection',
  baseId: 'base-1',
  scope: 'page',
  relativePath: 'notes/sleep-debt.md',
  lineStart: 1,
  snapshotText: 'Sleep debt',
  label: 'notes/sleep-debt.md',
};

function ok(command: string, data: unknown): HostResponse {
  return {
    id: '1',
    type: 'response',
    command: command as HostResponse['command'],
    success: true,
    data,
  };
}

describe('KnowledgeAssistPanel', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
  });

  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
    });
  }

  function mount(
    commands: HostCommand[],
    overrides: {
      sessionId?: string | null;
      pendingRef?: KnowledgeContextRef | null;
      subscribeConnected?: (listener: (connected: boolean) => void) => () => void;
      subscribePush?: (listener: (push: HostPush) => void) => () => void;
    } = {},
  ): void {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const request = async (command: HostCommand): Promise<HostResponse> => {
      commands.push(command);
      if (command.type === 'session/create') {
        return ok('session/create', { sessionId: 'assist-1' });
      }
      if (command.type === 'session/prompt') {
        return ok('session/prompt', { sessionId: command.sessionId, runId: 'run-1' });
      }
      if (command.type === 'session/resume') {
        return ok('session/resume', { sessionId: command.sessionId, messages: [], live: true });
      }
      if (command.type === 'session/abort') {
        return ok('session/abort', { sessionId: command.sessionId, cancelled: true });
      }
      if (command.type === 'knowledge/wiki/write') {
        return ok('knowledge/wiki/write', {
          concept: { slug: 'sleep-debt-md', title: command.input.title, content: command.input.content },
        });
      }
      return ok(command.type, {});
    };
    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeAssistPanel
            locale="en"
            request={request}
            baseId="base-1"
            documentTitle="sleep-debt.md"
            sessionId={overrides.sessionId ?? null}
            onSessionId={() => {}}
            pendingRef={overrides.pendingRef ?? null}
            onConsumedPendingRef={() => {}}
            {...(overrides.subscribeConnected
              ? { subscribeConnected: overrides.subscribeConnected }
              : {})}
            {...(overrides.subscribePush ? { subscribePush: overrides.subscribePush } : {})}
          />
        </PiwinUiProvider>,
      );
    });
  }

  it('asks AI in a new session that does not parent the main chat', async () => {
    const commands: HostCommand[] = [];
    mount(commands, { pendingRef: pageRef });
    await flush();
    const created = commands.find((command) => command.type === 'session/create');
    expect(created?.type).toBe('session/create');
    if (created?.type !== 'session/create') throw new Error('expected create');
    expect(created.input.parentSessionId).toBeUndefined();
    const prompted = commands.find((command) => command.type === 'session/prompt');
    expect(prompted?.type).toBe('session/prompt');
    if (prompted?.type !== 'session/prompt') throw new Error('expected prompt');
    expect(prompted.sessionId).toBe('assist-1');
    expect(prompted.input.contextRefs?.[0]?.kind).toBe('knowledge-selection');
  });

  it('stops the in-flight assist run', async () => {
    const commands: HostCommand[] = [];
    mount(commands, { pendingRef: pageRef });
    await flush();
    await flush();
    const stop = host?.querySelector('[data-testid="knowledge-assist-stop"]');
    expect(stop, commands.map((command) => command.type).join(',')).not.toBeNull();
    await act(async () => {
      (stop as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const aborted = commands.find((command) => command.type === 'session/abort');
    expect(aborted?.type).toBe('session/abort');
    if (aborted?.type !== 'session/abort') throw new Error('expected abort');
    expect(aborted.sessionId).toBe('assist-1');
  });

  it('resumes the same session after reconnect instead of creating another', async () => {
    const commands: HostCommand[] = [];
    const listeners: Array<(connected: boolean) => void> = [];
    mount(commands, {
      sessionId: 'assist-1',
      subscribeConnected: (listener) => {
        listeners.push(listener);
        return () => {};
      },
    });
    await flush();
    expect(commands.filter((command) => command.type === 'session/resume')).toHaveLength(1);
    expect(commands.some((command) => command.type === 'session/create')).toBe(false);
    act(() => {
      listeners[0]?.(false);
    });
    await act(async () => {
      listeners[0]?.(true);
      await Promise.resolve();
    });
    expect(commands.filter((command) => command.type === 'session/resume')).toHaveLength(2);
    expect(commands.filter((command) => command.type === 'session/create')).toHaveLength(0);
  });

  it('saves the answer as a new wiki note with sources', async () => {
    const commands: HostCommand[] = [];
    let push: ((next: HostPush) => void) | null = null;
    mount(commands, {
      pendingRef: pageRef,
      subscribePush: (listener) => {
        push = listener;
        return () => {};
      },
    });
    await flush();
    await flush();
    act(() => {
      push?.({
        type: 'event',
        sessionId: 'assist-1',
        event: { type: 'message/start', messageId: 'a1', role: 'assistant', runId: 'run-1' },
      });
      push?.({
        type: 'event',
        sessionId: 'assist-1',
        event: {
          type: 'message/text_delta',
          messageId: 'a1',
          delta: 'Hours owed to sleep.',
          runId: 'run-1',
        },
      });
      push?.({
        type: 'event',
        sessionId: 'assist-1',
        event: { type: 'message/end', messageId: 'a1', runId: 'run-1' },
      });
    });
    const save = host?.querySelector('[data-testid="knowledge-assist-save-note"]');
    expect(save).not.toBeNull();
    await act(async () => {
      (save as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const written = commands.find((command) => command.type === 'knowledge/wiki/write');
    expect(written?.type).toBe('knowledge/wiki/write');
    if (written?.type !== 'knowledge/wiki/write') throw new Error('expected wiki write');
    expect(written.input.content).toContain('Hours owed');
    expect(written.input.sources?.[0]?.relativePath).toBe('notes/sleep-debt.md');
    expect(written.input.sources?.[0]?.baseId).toBe('base-1');
  });
});
