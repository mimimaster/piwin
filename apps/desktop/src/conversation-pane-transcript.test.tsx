// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { chatUiReducer, createInitialChatUiState, type ChatUiState } from './chat-reducer';
import { ConversationPaneTranscript } from './conversation-pane-transcript';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SESSION_ID = 'session-pane-follow';

function stateWith(count: number): ChatUiState {
  const messages: SessionTranscriptMessage[] = Array.from({ length: count }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `Message ${index}`,
    createdAt: '2026-09-15T12:00:00.000Z',
    status: 'done',
  }));
  const state = chatUiReducer(createInitialChatUiState(), {
    type: 'session/set',
    sessionId: SESSION_ID,
  });
  return chatUiReducer(state, { type: 'session/load-messages', sessionId: SESSION_ID, messages });
}

describe('conversation pane transcript scrolling', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(state: ChatUiState): HTMLElement {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ConversationPaneTranscript
            sessionId={SESSION_ID}
            state={state}
            activeTheme={PIWIN_APPEARANCE_DARK}
            artifactThemeKey={0}
            artifactPreviewEnabled={false}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });
    const scroller = container.querySelector<HTMLElement>('.conversation-pane-transcript');
    if (!scroller) throw new Error('expected the pane transcript');
    return scroller;
  }

  function mount(state: ChatUiState): HTMLElement {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const scroller = render(state);
    let scrollTop = 0;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, get: () => scroller.children.length * 300 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.max(0, Math.min(value, scroller.scrollHeight - 400));
        },
      },
    });
    return scroller;
  }

  function scrollTo(scroller: HTMLElement, top: number): void {
    scroller.scrollTop = top;
    act(() => {
      scroller.dispatchEvent(new Event('scroll'));
    });
  }

  it('follows new output while the reader is at the bottom', () => {
    const scroller = mount(stateWith(4));
    scrollTo(scroller, scroller.scrollHeight);
    render(stateWith(6));
    expect(scroller.scrollTop).toBe(scroller.scrollHeight - scroller.clientHeight);
  });

  it('leaves the reader in history when new output arrives', () => {
    const scroller = mount(stateWith(4));
    scrollTo(scroller, 120);
    render(stateWith(6));
    expect(scroller.scrollTop).toBe(120);

    scrollTo(scroller, scroller.scrollHeight);
    render(stateWith(8));
    expect(scroller.scrollTop).toBe(scroller.scrollHeight - scroller.clientHeight);
  });
});
