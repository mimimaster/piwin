// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import {
  chatUiReducer,
  createInitialChatUiState,
  type ChatMessageUi,
} from './chat-reducer';
import { ConversationPaneTranscript } from './conversation-pane-transcript';
import { ConversationResponseContent } from './conversation-response-content';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mountedRenders: Array<{ container: HTMLElement; root: Root }> = [];

function renderContent(node: ReactElement): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
  });
  mountedRenders.push({ container, root });
  return container;
}

const orphanMessage: ChatMessageUi = {
  id: 'orphan-assistant',
  role: 'assistant',
  text: '',
  thinking: '<svg opacity="0.',
  tools: [],
  attachments: [],
  status: 'streaming',
  createdAt: '2026-08-27T03:25:58.000Z',
};

describe('orphan streaming chrome', () => {
  afterEach(() => {
    for (const { container, root } of mountedRenders) {
      try {
        act(() => {
          root.unmount();
        });
        container.remove();
      } catch {
        // cleanup best-effort
      }
    }
    mountedRenders.length = 0;
  });

  it('does not show running thinking chrome without a live run', () => {
    const container = renderContent(
      <ConversationResponseContent
        message={orphanMessage}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey={0}
        runRecordsById={{}}
        activeRunId={null}
        locale="zh-CN"
        isStreaming={false}
        artifactPreviewEnabled={false}
      />,
    );
    expect(container.querySelector('[data-testid="conversation-thinking-active-animation"]')).toBeNull();
    expect(container.querySelector('[data-tool-status="running"]')).toBeNull();
  });

  it('renders a healed interrupted SVG session without crashing', () => {
    const messages: SessionTranscriptMessage[] = [
      {
        id: '5e88008a-b15a-4530-9d9b-cd769db39659',
        role: 'user',
        text: '画一张2D的鹈鹕骑自行车的SVG',
        createdAt: '2026-08-27T03:25:34.345Z',
        status: 'done',
      },
      {
        id: 'piw-m-7f90ab069b90f19a45944656',
        role: 'assistant',
        text: '先读取 Artifact 规范，再画一张 2D 鹈鹕骑自行车的 SVG。',
        thinking: 'The user wants an SVG.',
        createdAt: '2026-08-27T03:25:37.938Z',
        status: 'done',
        runId: '6ac46cf8-952c-4768-bce2-22787ed55671',
        thinkingStartedAt: '2026-08-27T03:25:37.939Z',
        thinkingEndedAt: '2026-08-27T03:25:38.957Z',
      },
      {
        id: '8e9c29da-4611-4b71-bbc5-06141847e117',
        role: 'user',
        text: '要不HTML吧',
        createdAt: '2026-08-27T03:25:43.619Z',
        status: 'done',
        runId: '6ac46cf8-952c-4768-bce2-22787ed55671',
        instructionDelivery: {
          kind: 'run-intervention',
          instructionId: '9988ba27-60a9-456d-b7f5-27ae89490c48',
          status: 'expired',
          targetRunId: '6ac46cf8-952c-4768-bce2-22787ed55671',
          revision: 2,
        },
      },
      {
        id: 'piw-m-113a41fc2eb4def665b64d43',
        role: 'assistant',
        text: '',
        thinking: '<svg opacity="0.',
        createdAt: '2026-08-27T03:25:58.982Z',
        status: 'done',
        runId: '6ac46cf8-952c-4768-bce2-22787ed55671',
        thinkingStartedAt: '2026-08-27T03:25:58.983Z',
        thinkingEndedAt: '2026-08-27T04:39:18.761Z',
        endedAt: '2026-08-27T04:39:18.761Z',
        outcome: 'cancelled',
        terminalMessage: 'The previous run was interrupted before this response finished.',
      },
      {
        id: '2026e0d0-4373-4528-a62d-82ff4fed6c51',
        role: 'user',
        text: '算了，还是SVG吧',
        createdAt: '2026-08-27T03:26:01.651Z',
        status: 'done',
        runId: '6ac46cf8-952c-4768-bce2-22787ed55671',
        instructionDelivery: {
          kind: 'run-intervention',
          instructionId: 'e2348ab8-41b7-4de4-b305-22449377d8ce',
          status: 'expired',
          targetRunId: '6ac46cf8-952c-4768-bce2-22787ed55671',
          revision: 2,
        },
      },
    ];
    const state = chatUiReducer(createInitialChatUiState(), {
      type: 'session/load-messages',
      sessionId: 'session-mtaymv82-9wz6ccco',
      messages,
    });
    const container = renderContent(
      <ConversationPaneTranscript
        sessionId="session-mtaymv82-9wz6ccco"
        state={state}
        activeTheme={PIWIN_APPEARANCE_DARK}
        artifactThemeKey={0}
        artifactPreviewEnabled={false}
        locale="zh-CN"
      />,
    );
    expect(container.querySelector('[data-testid="app-error-boundary"]')).toBeNull();
    expect(container.textContent).toContain('画一张2D的鹈鹕骑自行车的SVG');
    expect(container.textContent).toContain('当前任务已结束，未应用');
  });

  it('keeps running thinking chrome while the live run owns the message', () => {
    const container = renderContent(
      <ConversationResponseContent
        message={orphanMessage}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey={0}
        runRecordsById={{}}
        activeRunId="run-live"
        locale="zh-CN"
        isStreaming
        artifactPreviewEnabled={false}
      />,
    );
    expect(
      container.querySelector('[data-testid="conversation-thinking-active-animation"]'),
    ).not.toBeNull();
  });
});
