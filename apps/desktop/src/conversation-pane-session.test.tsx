// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type {
  ExecutionRunRecord,
  HostCommand,
  HostResponse,
  HostServerMessage,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { ConversationPaneSession } from './conversation-pane-session.js';
import type { HostClient } from './host-client.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class FakeHostClient {
  readonly requests: HostCommand[] = [];
  private readonly listeners = new Set<(message: HostServerMessage) => void>();
  run: ExecutionRunRecord | null = null;
  resumeMissing = false;
  resumeFail = false;
  advertiseContextTelemetry = false;
  contextSnapshot: unknown = null;

  getTransport(): 'remote' {
    return 'remote';
  }

  isReady(): boolean {
    return true;
  }

  supportsForegroundAdmission(): boolean {
    return true;
  }

  subscribe(listener: (message: HostServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(message: HostServerMessage): void {
    for (const listener of this.listeners) listener(message);
  }

  request(command: HostCommand): Promise<HostResponse> {
    this.requests.push(command);
    if (command.type === 'host/status') {
      return Promise.resolve({
        type: 'response',
        command: command.type,
        success: true,
        data: {
          capabilities: this.advertiseContextTelemetry
            ? { contextTelemetryVersion: 1 as const }
            : {},
        },
      });
    }
    if (command.type === 'session/resume') {
      if (this.resumeMissing) {
        return Promise.resolve({
          type: 'response',
          command: command.type,
          success: false,
          error: `Unknown session: ${command.sessionId}`,
          problem: { code: 'session-not-found' },
        });
      }
      if (this.resumeFail) {
        return Promise.resolve({
          type: 'response',
          command: command.type,
          success: false,
          error: 'resume failed',
        });
      }
      return Promise.resolve({
        type: 'response',
        command: command.type,
        success: true,
        data: {
          sessionId: command.sessionId,
          live: true,
          scope: { kind: 'general' },
          name: 'Auxiliary Chat',
          messages: [
            message('user-1', 'user', 'Pane question'),
            message('assistant-1', 'assistant', 'Pane answer'),
          ],
          ...(this.contextSnapshot ? { contextSnapshot: this.contextSnapshot } : {}),
        },
      });
    }
    if (command.type === 'session/foreground-run') {
      return Promise.resolve({
        type: 'response',
        command: command.type,
        success: true,
        data: { sessionId: command.sessionId, run: this.run },
      });
    }
    if (command.type === 'session/messages') {
      return Promise.resolve({
        type: 'response',
        command: command.type,
        success: true,
        data: {
          sessionId: command.sessionId,
          messages: [
            message('user-1', 'user', 'Pane question'),
            message('assistant-1', 'assistant', 'Pane answer'),
          ],
        },
      });
    }
    if (command.type === 'session/prompt') {
      return Promise.resolve({
        type: 'response',
        command: command.type,
        success: true,
        data: { runId: 'run-new' },
      });
    }
    if (command.type === 'session/abort') {
      return Promise.resolve({ type: 'response', command: command.type, success: true, data: {} });
    }
    return Promise.resolve({
      type: 'response',
      command: command.type,
      success: false,
      error: 'unexpected command',
    });
  }
}

function message(id: string, role: 'user' | 'assistant', text: string): SessionTranscriptMessage {
  return {
    id,
    role,
    text,
    createdAt: '2026-08-24T10:00:00.000Z',
    status: 'done',
  };
}

function renderSession(
  host: FakeHostClient,
  onSessionDeleted?: () => void,
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <ConversationPaneSession
          sessionId="session-aux"
          hostClient={host as unknown as HostClient}
          activeTheme={PIWIN_APPEARANCE_DARK}
          artifactThemeKey="test"
          artifactPreviewEnabled={true}
          readMedia={null}
          locale="en"
          {...(onSessionDeleted ? { onSessionDeleted } : {})}
        />
      </PiwinUiProvider>,
    );
  });
  return { container, root };
}

describe('ConversationPaneSession', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it('hydrates its own transcript, filters pushes, and sends to its bound session', async () => {
    const host = new FakeHostClient();
    ({ container, root } = renderSession(host));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() =>
      expect(host.requests.some((command) => command.type === 'session/resume')).toBe(true),
    );
    expect(host.requests.filter((command) => command.type === 'session/resume')).toHaveLength(1);
    await vi.waitFor(() =>
      expect(
        container?.querySelector<HTMLElement>('[data-testid="conversation-pane-session"]')?.dataset,
      ).toMatchObject({ awaitingTranscript: 'false', messageCount: '2' }),
    );
    expect(container?.textContent).toContain('Pane question');
    expect(container?.textContent).toContain('Pane answer');

    act(() => {
      host.emit({
        type: 'transcript/append',
        sessionId: 'another-session',
        message: message('other', 'assistant', 'Wrong session'),
      });
      host.emit({
        type: 'transcript/append',
        sessionId: 'session-aux',
        message: message('own', 'assistant', 'Right session'),
      });
    });
    expect(container?.textContent).not.toContain('Wrong session');
    expect(container?.textContent).toContain('Right session');

    const textarea = container?.querySelector<HTMLTextAreaElement>('textarea');
    if (!textarea) throw new Error('pane composer missing');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!setter) throw new Error('textarea value setter missing');
      setter.call(textarea, 'Independent prompt');
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          host.requests.some(
            (command) =>
              command.type === 'session/prompt' &&
              command.sessionId === 'session-aux' &&
              command.input.text === 'Independent prompt',
          ),
        ).toBe(true),
      );
    });
  });

  it('stops the exact foreground run owned by this pane', async () => {
    const host = new FakeHostClient();
    host.run = {
      runId: 'run-active',
      kind: 'session-turn',
      status: 'running',
      rootRunId: 'run-active',
      sessionId: 'session-aux',
    };
    ({ container, root } = renderSession(host));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() =>
      expect(host.requests.some((command) => command.type === 'session/foreground-run')).toBe(true),
    );
    await vi.waitFor(() =>
      expect(container?.querySelector('[aria-label="Stop response"]')).not.toBeNull(),
    );
    act(() => {
      container?.querySelector<HTMLButtonElement>('[aria-label="Stop response"]')?.click();
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          host.requests.some(
            (command) =>
              command.type === 'session/abort' &&
              command.sessionId === 'session-aux' &&
              command.runId === 'run-active',
          ),
        ).toBe(true),
      );
    });
  });

  it('settles the pane when a terminal push is missed', async () => {
    const host = new FakeHostClient();
    host.run = {
      runId: 'run-active',
      kind: 'session-turn',
      status: 'running',
      rootRunId: 'run-active',
      sessionId: 'session-aux',
    };
    ({ container, root } = renderSession(host));
    await vi.waitFor(() =>
      expect(container?.querySelector('[aria-label="Stop response"]')).not.toBeNull(),
    );

    host.run = null;
    act(() => {
      host.emit({
        type: 'host/status',
        mode: 'sdk',
        ready: true,
        mock: false,
      });
    });

    await vi.waitFor(() =>
      expect(
        container?.querySelector<HTMLElement>('[data-testid="conversation-pane-session"]')?.dataset
          .streaming,
      ).toBe('false'),
    );
    expect(container?.querySelector('[aria-label="Stop response"]')).toBeNull();
    expect(container?.textContent).toContain('Pane answer');
  });

  it('clears a stale binding when the Host reports that the session no longer exists', async () => {
    const host = new FakeHostClient();
    const onSessionDeleted = vi.fn();
    host.resumeMissing = true;
    ({ container, root } = renderSession(host, onSessionDeleted));

    await vi.waitFor(() => expect(onSessionDeleted).toHaveBeenCalledOnce());
    expect(container?.textContent).not.toContain('Unknown session');
  });

  it('drives occupancy from a parsed Host snapshot via the shared selector', async () => {
    const host = new FakeHostClient();
    host.advertiseContextTelemetry = true;
    host.contextSnapshot = {
      sessionId: 'session-aux',
      revision: 3,
      contextVersion: 1,
      contextBoundary: { activeLeafMessageId: 'assistant-1' },
      responseEvidence: {
        currentRunHasResponse: false,
        historyHasDisplayableResponse: true,
      },
      phase: 'idle',
      occupancy: {
        kind: 'known',
        tokensUsed: 12_400,
        tokensLimit: 128_000,
        quality: 'measured',
        coverage: 'complete',
        basis: 'test',
        sampledAt: '2026-08-30T00:00:00.000Z',
      },
      updatedAt: '2026-08-30T00:00:00.000Z',
    };
    ({ container, root } = renderSession(host));
    await vi.waitFor(() =>
      expect(
        container?.querySelector<HTMLElement>('[data-testid="conversation-pane-session"]')?.dataset
          .contextRing,
      ).toBe('visible'),
    );
    expect(container?.querySelector('[data-testid="context-usage-ring"]')).not.toBeNull();
  });

  it('hides occupancy when resume fails', async () => {
    const host = new FakeHostClient();
    host.advertiseContextTelemetry = true;
    host.resumeFail = true;
    host.contextSnapshot = {
      sessionId: 'session-aux',
      revision: 3,
      contextVersion: 1,
      contextBoundary: { activeLeafMessageId: 'assistant-1' },
      responseEvidence: {
        currentRunHasResponse: false,
        historyHasDisplayableResponse: true,
      },
      phase: 'idle',
      occupancy: {
        kind: 'known',
        tokensUsed: 12_400,
        tokensLimit: 128_000,
        quality: 'measured',
        coverage: 'complete',
        basis: 'test',
        sampledAt: '2026-08-30T00:00:00.000Z',
      },
      updatedAt: '2026-08-30T00:00:00.000Z',
    };
    ({ container, root } = renderSession(host));
    await vi.waitFor(() => expect(container?.textContent).toContain('resume failed'));
    expect(
      container?.querySelector<HTMLElement>('[data-testid="conversation-pane-session"]')?.dataset
        .contextRing,
    ).toBe('hidden');
    expect(container?.querySelector('[data-testid="context-usage-ring"]')).toBeNull();
  });

  it('parses live session/context-updated onto the shared selector', async () => {
    const host = new FakeHostClient();
    host.advertiseContextTelemetry = true;
    ({ container, root } = renderSession(host));
    await vi.waitFor(() => expect(container?.textContent).toContain('Pane answer'));
    expect(
      container?.querySelector<HTMLElement>('[data-testid="conversation-pane-session"]')?.dataset
        .contextRing,
    ).toBe('hidden');

    act(() => {
      host.emit({
        type: 'session/context-updated',
        sessionId: 'session-aux',
        snapshot: {
          sessionId: 'session-aux',
          revision: 8,
          contextVersion: 1,
          contextBoundary: { activeLeafMessageId: 'assistant-1' },
          responseEvidence: {
            currentRunHasResponse: false,
            historyHasDisplayableResponse: true,
          },
          phase: 'idle',
          occupancy: {
            kind: 'known',
            tokensUsed: 9_100,
            tokensLimit: 128_000,
            quality: 'measured',
            coverage: 'complete',
            basis: 'test',
            sampledAt: '2026-08-30T00:00:00.000Z',
          },
          updatedAt: '2026-08-30T00:00:00.000Z',
        },
      });
    });
    await vi.waitFor(() =>
      expect(
        container?.querySelector<HTMLElement>('[data-testid="conversation-pane-session"]')?.dataset
          .contextRing,
      ).toBe('visible'),
    );
  });
});
