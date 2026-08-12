// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { ChatMessageUi, SubagentStreamState } from './chat-reducer';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { SubagentSessionTranscript } from './subagent-session-transcript';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const historicalMessages: ChatMessageUi[] = [
  {
    id: 'child-message-1',
    role: 'assistant',
    text: 'The child agent completed its task.',
    thinking: 'Inspecting the child session history.',
    tools: [],
    attachments: [],
    status: 'done',
  },
];

const liveStream: SubagentStreamState = {
  childSessionId: 'child-session-1',
  text: 'The child agent is preparing the next step.',
  thinking: 'Reviewing the live child session state.',
  tools: [],
  streaming: true,
  currentMessageId: 'child-message-2',
};

function renderTranscript(input: { root: Root; showThinking: boolean }): void {
  input.root.render(
    <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <SubagentSessionTranscript
        historicalMessages={historicalMessages}
        stream={liveStream}
        loading={false}
        error={null}
        onRetry={() => undefined}
        locale="en"
        showThinking={input.showThinking}
      />
    </PiwinUiProvider>,
  );
}

describe('SubagentSessionTranscript thinking visibility', () => {
  const mountedRoots: Array<{ root: Root; container: HTMLElement }> = [];

  afterEach(() => {
    for (const mountedRoot of mountedRoots.splice(0)) {
      act(() => {
        mountedRoot.root.unmount();
      });
      mountedRoot.container.remove();
    }
  });

  it('hides persisted and live thinking without hiding child output', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    act(() => {
      renderTranscript({ root, showThinking: false });
    });

    expect(container.querySelectorAll('.turn-thinking')).toHaveLength(0);
    expect(container.textContent).toContain(historicalMessages[0]?.text);
    expect(container.textContent).toContain(liveStream.text);

    act(() => {
      renderTranscript({ root, showThinking: true });
    });

    expect(container.querySelectorAll('.turn-thinking')).toHaveLength(2);
    expect(container.textContent).toContain(historicalMessages[0]?.thinking);
    expect(container.textContent).toContain(liveStream.thinking);
  });

  it('uses the standard tool-call renderer for live child work', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentSessionTranscript
            historicalMessages={[]}
            stream={{
              ...liveStream,
              thinking: '',
              tools: [
                {
                  toolCallId: 'child-tool-1',
                  toolName: 'bash',
                  status: 'running',
                  output: 'running tests',
                  presentation: {
                    kind: 'shell',
                    title: 'Bash',
                    actionVerb: 'Ran command',
                    command: 'pnpm test',
                    output: { text: 'running tests' },
                  },
                },
              ],
            }}
            loading={false}
            error={null}
            onRetry={() => undefined}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="tool-call-card"]')).not.toBeNull();
    expect(container.textContent).toContain('pnpm test');
  });
});
