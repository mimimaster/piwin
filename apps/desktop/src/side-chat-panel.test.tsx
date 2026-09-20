// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type {
  HostCommand,
  HostResponse,
  HostServerMessage,
  SessionSummary,
} from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import type { HostClient } from './host-client.js';
import { SideChatPanel } from './side-chat-panel.js';
import {
  publishSideChatComposerSeed,
  resetSideChatComposerSeedForTests,
} from './side-chat-composer-seed.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CONFIGURED_MODELS = {
  defaultProviderId: 'openai',
  defaultModelId: 'gpt-4o',
  models: [
    {
      providerId: 'openai',
      modelId: 'gpt-4o',
      label: 'GPT-4o',
      protocol: 'openai-compatible',
      source: 'channel' as const,
      group: 'channel' as const,
    },
  ],
};

function sideChatSummary(id: string): SessionSummary {
  const relation = {
    kind: 'side-chat' as const,
    sourceSessionId: 'main-1',
    sourceCapturedAt: '2026-09-04T00:00:00.000Z',
    contextVersion: 1,
    sourceState: 'active' as const,
  };
  return {
    id,
    scope: { kind: 'general' },
    workingDirectory: '/tmp',
    projectPath: '',
    name: `Side Chat · ${id}`,
    updatedAt: '2026-09-04T00:00:00.000Z',
    messageCount: 0,
    kind: 'side-chat',
    sideChatRelation: relation,
  };
}

class FakeHostClient {
  readonly requests: HostCommand[] = [];
  private readonly listeners = new Set<(message: HostServerMessage) => void>();
  listed: SessionSummary[] = [];
  messagesBySession: Record<
    string,
    { id: string; role: string; text: string; createdAt: string }[]
  > = {};

  getTransport(): 'mock' {
    return 'mock';
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

  async sideChatList(_sourceSessionId: string): Promise<HostResponse> {
    this.requests.push({ type: 'side-chat/list', sourceSessionId: _sourceSessionId });
    return {
      type: 'response',
      command: 'side-chat/list',
      success: true,
      data: { sourceSessionId: _sourceSessionId, sessions: this.listed },
    };
  }

  async sideChatOpen(sourceSessionId: string): Promise<HostResponse> {
    const session = sideChatSummary('side-new');
    this.requests.push({ type: 'side-chat/open', sourceSessionId });
    this.listed = [session, ...this.listed];
    const relation = session.sideChatRelation;
    if (!relation) {
      return {
        type: 'response',
        command: 'side-chat/open',
        success: false,
        error: 'missing relation',
      };
    }
    return {
      type: 'response',
      command: 'side-chat/open',
      success: true,
      data: {
        sideChatSessionId: session.id,
        session,
        relation,
        context: {
          version: 1,
          capturedAt: '2026-09-04T00:00:00.000Z',
          sourceSessionId,
          conversation: { messageIds: [], formattedText: '', truncated: false },
          workspace: { scope: 'general', workingDirectory: '/tmp' },
          refs: [],
        },
      },
    };
  }

  request(command: HostCommand): Promise<HostResponse> {
    this.requests.push(command);
    if (command.type === 'side-chat/list') {
      return Promise.resolve({
        type: 'response',
        command: command.type,
        success: true,
        data: { sourceSessionId: command.sourceSessionId, sessions: this.listed },
      });
    }
    if (command.type === 'side-chat/open') {
      const session = sideChatSummary('side-new');
      this.listed = [session, ...this.listed];
      const relation = session.sideChatRelation;
      if (!relation) {
        return Promise.resolve({
          type: 'response',
          command: command.type,
          success: false,
          error: 'missing relation',
        });
      }
      return Promise.resolve({
        type: 'response',
        command: command.type,
        success: true,
        data: {
          sideChatSessionId: session.id,
          session,
          relation,
          context: {
            version: 1,
            capturedAt: '2026-09-04T00:00:00.000Z',
            sourceSessionId: command.sourceSessionId,
            conversation: { messageIds: [], formattedText: '', truncated: false },
            workspace: { scope: 'general', workingDirectory: '/tmp' },
            refs: [],
          },
        },
      });
    }
    if (command.type === 'models/configured') {
      return Promise.resolve({
        type: 'response',
        command: command.type,
        success: true,
        data: CONFIGURED_MODELS,
      });
    }
    if (command.type === 'session/set-composer-profile') {
      return Promise.resolve({ type: 'response', command: command.type, success: true, data: {} });
    }
    if (command.type === 'session/resume') {
      return Promise.resolve({
        type: 'response',
        command: command.type,
        success: true,
        data: { sessionId: command.sessionId, messages: [] },
      });
    }
    if (command.type === 'session/messages') {
      return Promise.resolve({
        type: 'response',
        command: command.type,
        success: true,
        data: {
          sessionId: command.sessionId,
          messages: this.messagesBySession[command.sessionId] ?? [],
        },
      });
    }
    if (command.type === 'session/archive') {
      this.listed = this.listed.filter((session) => session.id !== command.sessionId);
      return Promise.resolve({
        type: 'response',
        command: command.type,
        success: true,
        data: { sessionId: command.sessionId },
      });
    }
    if (command.type === 'session/prompt') {
      return Promise.resolve({
        type: 'response',
        command: command.type,
        success: true,
        data: { runId: 'run-side' },
      });
    }
    return Promise.resolve({
      type: 'response',
      command: command.type,
      success: false,
      error: 'unexpected command',
    });
  }
}

function panelInput(container: HTMLElement): HTMLTextAreaElement | null {
  return container.querySelector('[data-testid="side-chat-panel"] [data-testid="composer-input"]');
}

function panelSend(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector('[data-testid="side-chat-panel"] [data-testid="send-btn"]');
}

describe('SideChatPanel', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    resetSideChatComposerSeedForTests();
  });

  it('lets the user type and pick a model before a side chat exists', async () => {
    const host = new FakeHostClient();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SideChatPanel sessionId="main-1" hostClient={host as unknown as HostClient} />
        </PiwinUiProvider>,
      );
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(panelInput(container!)?.disabled).toBe(false);
        expect(container?.querySelector('[data-testid="side-chat-empty"]')).not.toBeNull();
        expect(
          container?.querySelector('[data-testid="side-chat-tab-draft"]') ??
            document.querySelector('[data-testid="side-chat-tab-draft"]'),
        ).not.toBeNull();
      });
    });

    const textarea = panelInput(container!);
    expect(textarea).not.toBeNull();
    expect(textarea?.disabled).toBe(false);
    expect(container.querySelector('[data-testid="thinking-effort-trigger"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="composer-card"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="composer-plus-btn"]')).toBeNull();

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!setter || !textarea) throw new Error('textarea missing');
      setter.call(textarea, 'What does this change do?');
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    act(() => {
      panelSend(container!)?.click();
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(host.requests.some((command) => command.type === 'session/prompt')).toBe(true);
      });
    });

    expect(host.requests.some((command) => command.type === 'side-chat/open')).toBe(true);
    const prompt = host.requests.find((command) => command.type === 'session/prompt');
    expect(prompt).toMatchObject({
      type: 'session/prompt',
      sessionId: 'side-new',
      input: { text: 'What does this change do?' },
    });
  });

  it('auto-selects an existing side chat so the input stays enabled', async () => {
    const host = new FakeHostClient();
    host.listed = [sideChatSummary('side-existing')];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SideChatPanel sessionId="main-1" hostClient={host as unknown as HostClient} />
        </PiwinUiProvider>,
      );
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(
          host.requests.some((command) => command.type === 'side-chat/list'),
        ).toBe(true);
      });
    });
    expect(panelInput(container!)?.disabled).toBe(false);
    expect(container.querySelector('[data-testid="side-chat-tab-side-existing"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="side-chat-tab-draft"]')).toBeNull();
  });

  it('does not show a second plus or a sync control in the tab strip', async () => {
    const host = new FakeHostClient();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SideChatPanel sessionId="main-1" hostClient={host as unknown as HostClient} />
        </PiwinUiProvider>,
      );
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(panelInput(container!)).not.toBeNull();
      });
    });
    expect(container.querySelector('[data-testid="side-chat-new"]')).toBeNull();
    expect(container.querySelector('[data-testid="side-chat-sync"]')).toBeNull();
  });

  it('shows a selection capsule on the side-chat composer when opened with a quote', async () => {
    const host = new FakeHostClient();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SideChatPanel sessionId="main-1" hostClient={host as unknown as HostClient} />
        </PiwinUiProvider>,
      );
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(panelInput(container!)).not.toBeNull();
      });
    });
    act(() => {
      publishSideChatComposerSeed({
        sideChatSessionId: 'side-quoted',
        refs: [
          {
            kind: 'selection',
            snapshotText: '想要基于选中文本调整壁纸',
            label: '想要基于选中文本调整壁纸',
          },
        ],
      });
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(container?.querySelector('[data-testid="composer-context-chip"]')).not.toBeNull();
      });
    });
    expect(container.querySelector('[data-testid="composer-context-chip"]')?.textContent).toContain(
      '想要基于选中文本调整壁纸',
    );
  });

  it('renders hydrated assistant markdown instead of source markers', async () => {
    const host = new FakeHostClient();
    host.listed = [sideChatSummary('side-existing')];
    host.messagesBySession['side-existing'] = [
      {
        id: 'u1',
        role: 'user',
        text: 'keep **literal** stars',
        createdAt: '2026-09-04T00:00:00.000Z',
      },
      {
        id: 'a1',
        role: 'assistant',
        text: '**bold** and `code`\n\n### Heading',
        createdAt: '2026-09-04T00:00:01.000Z',
      },
    ];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SideChatPanel sessionId="main-1" hostClient={host as unknown as HostClient} />
        </PiwinUiProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(
      () => {
        const assistant = container?.querySelector('[data-testid="side-chat-message-assistant"]');
        if (assistant) return;
        const types = host.requests.map((command) => command.type).join(',');
        throw new Error(
          `assistant missing; requests=${types || '(none)'}; html=${container?.innerHTML.slice(0, 500) ?? ''}`,
        );
      },
      { timeout: 4000 },
    );

    const userBubble = container.querySelector('[data-testid="side-chat-message-user"] .side-chat-bubble');
    expect(userBubble?.textContent).toContain('keep **literal** stars');

    const assistant = container.querySelector('[data-testid="side-chat-message-assistant"]');
    expect(assistant).not.toBeNull();
    expect(assistant?.textContent).toContain('bold');
    expect(assistant?.textContent).not.toContain('**');
    expect(assistant?.querySelector('strong, .md-strong')).not.toBeNull();
    expect(assistant?.querySelector('code')).not.toBeNull();
    expect(assistant?.querySelector('h3, .md-h, [class*="md-h"]')).not.toBeNull();
  });
});
