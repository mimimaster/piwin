// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import type { ChatMessageUi } from './chat-reducer.js';
import { ConversationResponseContent } from './conversation-response-content.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ container: HTMLElement; root: Root }> = [];

function renderContent(node: ReactElement): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
  });
  mounted.push({ container, root });
  return container;
}

function assistant(partial: Partial<ChatMessageUi> & Pick<ChatMessageUi, 'id'>): ChatMessageUi {
  return {
    role: 'assistant',
    text: '',
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
    ...partial,
  };
}

function renderMessage(message: ChatMessageUi): HTMLElement {
  return renderContent(
    <ConversationResponseContent
      message={message}
      messageIndex={0}
      showStreamingCaret={false}
      activeTheme={null}
      artifactThemeKey="default"
      runRecordsById={{}}
      activeRunId={null}
      locale="zh-CN"
      artifactInlineEnabled
    />,
  );
}

describe('ConversationResponseContent process markdown', () => {
  afterEach(() => {
    for (const { container, root } of mounted) {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
    mounted.length = 0;
  });

  it('paints tool-loop body as normal markdown beside the tools', () => {
    const body = '空框就是中间轮次的复制/再生成栏。接下来核对 transcript。';
    const container = renderMessage(
      assistant({
        id: 'process',
        text: body,
        thinking: 'The user is asking about a fragmented conversation.',
        tools: [{ toolCallId: 't1', toolName: 'web_fetch', status: 'done', output: 'ok' }],
      }),
    );

    expect(container.querySelector('.markdown')?.textContent).toContain(body);
    expect(container.querySelector('[data-testid="conversation-thinking-summary"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="turn-tool-group"]')).not.toBeNull();
  });

  it('still paints a flashcard caption as the reply body', () => {
    const caption = '已创建一张关于光合作用的闪卡。';
    const container = renderMessage(
      assistant({
        id: 'flash',
        text: caption,
        tools: [{ toolCallId: 'c1', toolName: 'flashcard_create', status: 'done', output: '{}' }],
      }),
    );

    expect(container.querySelector('.markdown')?.textContent).toContain(caption);
  });
});
