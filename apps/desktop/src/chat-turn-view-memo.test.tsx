// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { ChatThread, type ChatThreadProps } from './chat-thread';
import type { ChatMessageUi, RunRecordUi } from './chat-reducer';
import type { ComposerDockProps } from './composer-dock.js';
import * as chatTurnRenderer from './chat-turn-renderer.js';

vi.mock('./chat-turn-renderer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./chat-turn-renderer.js')>();
  return { ...actual, renderChatTurn: vi.fn(actual.renderChatTurn) };
});

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function noop(): void {}

function message(
  id: string,
  role: ChatMessageUi['role'],
  overrides: Partial<ChatMessageUi> = {},
): ChatMessageUi {
  return {
    id,
    role,
    text: `${id} text`,
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
    ...overrides,
  };
}

// The edit card never mounts here; only the field a turn reads matters.
const composerCard = { onAgentModeChange: noop } as unknown as ComposerDockProps;

function thread(overrides: Partial<ChatThreadProps> & Pick<ChatThreadProps, 'messages'>): ReactElement {
  return (
    <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <ChatThread
        streaming
        editingMessageId={null}
        lastUserMessageId="user-2"
        activeTheme={null}
        artifactThemeKey={0}
        artifactInlineEnabled
        onEdit={noop}
        onCancelEdit={noop}
        onEditResend={noop}
        onRetry={noop}
        onInspectSubagent={undefined}
        // A fresh object per render, as the workbench hands it over.
        composerCard={{ ...composerCard }}
        {...overrides}
      />
    </PiwinUiProvider>
  );
}

describe('ChatTurnView memo boundary', () => {
  let container: HTMLDivElement;
  let root: Root;
  const renderChatTurn = vi.mocked(chatTurnRenderer.renderChatTurn);

  function renderedTurnIds(): string[] {
    return renderChatTurn.mock.calls.map(([input]) => input.turn.id);
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    renderChatTurn.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const settled = [message('user-1', 'user'), message('assistant-1', 'assistant')];
  const prompt = message('user-2', 'user');

  it('re-projects only the live turn when a token arrives', () => {
    const streamingReply = message('assistant-2', 'assistant', { text: 'Hel', status: 'streaming' });
    act(() => root.render(thread({ messages: [...settled, prompt, streamingReply] })));
    expect(new Set(renderedTurnIds())).toEqual(new Set(['turn-user-1', 'turn-user-2']));

    renderChatTurn.mockClear();
    act(() =>
      root.render(
        thread({ messages: [...settled, prompt, { ...streamingReply, text: 'Hello' }] }),
      ),
    );

    expect(renderedTurnIds()).toEqual(['turn-user-2']);
    expect(container.textContent).toContain('Hello');
  });

  it('skips a settled turn when another run advances, and follows its own run', () => {
    const runOne = { runId: 'run-1', status: 'succeeded', phaseHistory: [] } as unknown as RunRecordUi;
    const runTwo = { runId: 'run-2', status: 'running', phaseHistory: [] } as unknown as RunRecordUi;
    const messages = [
      settled[0] as ChatMessageUi,
      message('assistant-1', 'assistant', { runId: 'run-1' }),
      prompt,
      message('assistant-2', 'assistant', { runId: 'run-2', status: 'streaming' }),
    ];
    act(() =>
      root.render(thread({ messages, runRecordsById: { 'run-1': runOne, 'run-2': runTwo } })),
    );

    renderChatTurn.mockClear();
    act(() =>
      root.render(
        thread({ messages, runRecordsById: { 'run-1': runOne, 'run-2': { ...runTwo } } }),
      ),
    );
    expect(renderedTurnIds()).toEqual(['turn-user-2']);

    renderChatTurn.mockClear();
    act(() =>
      root.render(
        thread({ messages, runRecordsById: { 'run-1': { ...runOne }, 'run-2': runTwo } }),
      ),
    );
    expect(renderedTurnIds()).toContain('turn-user-1');
  });

  it('re-renders every turn when a session-wide setting changes', () => {
    const messages = [...settled, prompt, message('assistant-2', 'assistant')];
    act(() => root.render(thread({ messages, streaming: false })));

    renderChatTurn.mockClear();
    act(() => root.render(thread({ messages, streaming: false, toolDensity: 'detailed' })));

    expect(new Set(renderedTurnIds())).toEqual(new Set(['turn-user-1', 'turn-user-2']));
  });
});
