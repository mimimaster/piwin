// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import type { ChatMessageUi } from './chat-reducer';
import { TurnWorkDetails } from './turn-work-details';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ container: HTMLElement; root: Root }> = [];

function renderNode(node: ReactElement): HTMLElement {
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

afterEach(() => {
  for (const { container, root } of mounted) {
    try {
      act(() => {
        root.unmount();
      });
      container.remove();
    } catch {
      // cleanup best-effort
    }
  }
  mounted.length = 0;
});

describe('TurnWorkDetails thinking fold', () => {
  it('keeps the running thinking title when the user expands the fold', () => {
    const container = renderNode(
      <TurnWorkDetails
        message={assistant({
          id: 'p4',
          thinking: 'long grok reasoning',
          status: 'streaming',
          runId: 'run-p4',
        })}
        runRecordsById={{
          'run-p4': {
            runId: 'run-p4',
            phaseHistory: [{ phase: 'streaming', at: 1 }],
            startedAt: Date.now() - 8_000,
            endedAt: null,
          },
        }}
        activeRunId="run-p4"
        permissionPrompt={null}
        workDetailsExpanded="auto"
        locale="zh-CN"
      />,
    );

    const summary = container.querySelector<HTMLButtonElement>(
      '[data-testid="turn-work-details-summary"]',
    );
    expect(summary?.textContent).toContain('思考过程');
    expect(summary?.textContent).not.toContain('正在运行');

    act(() => {
      summary?.click();
    });

    const opened = container.querySelector('[data-testid="turn-work-details-summary"]');
    expect(container.querySelector('[data-testid="turn-thinking"]')).not.toBeNull();
    expect(opened?.textContent).toContain('思考过程');
    expect(opened?.textContent).not.toContain('正在运行');
  });

  it('shows thought duration on the thinking row, not the run clock', () => {
    const now = Date.now();
    const thinkingOnly = renderNode(
      <TurnWorkDetails
        message={assistant({
          id: 'p5-think',
          thinking: 'inspect the repository',
          thinkingStartedAt: now - 4_000,
          status: 'streaming',
          runId: 'run-p5',
        })}
        runRecordsById={{
          'run-p5': {
            runId: 'run-p5',
            phaseHistory: [{ phase: 'streaming', at: now - 60_000 }],
            startedAt: now - 60_000,
            endedAt: null,
          },
        }}
        activeRunId="run-p5"
        permissionPrompt={null}
        workDetailsExpanded="auto"
        locale="zh-CN"
      />,
    );
    const thinkHeader = thinkingOnly.querySelector('[data-testid="turn-work-details-summary"]');
    expect(thinkHeader?.querySelector('.work-fold-brain')).not.toBeNull();
    expect(thinkHeader?.querySelector('.lamp')).toBeNull();
    expect(thinkHeader?.querySelector('[data-testid="work-fold-elapsed"]')?.textContent).toMatch(
      /^4s$/,
    );

    const working = renderNode(
      <TurnWorkDetails
        message={assistant({
          id: 'p5-work',
          thinking: 'inspect the repository',
          thinkingStartedAt: now - 4_000,
          thinkingEndedAt: now,
          status: 'streaming',
          runId: 'run-p5-work',
          tools: [{ toolCallId: 't1', toolName: 'read', status: 'running', output: '' }],
        })}
        runRecordsById={{
          'run-p5-work': {
            runId: 'run-p5-work',
            phaseHistory: [{ phase: 'tool-running', at: now - 60_000 }],
            startedAt: now - 60_000,
            endedAt: null,
          },
        }}
        activeRunId="run-p5-work"
        permissionPrompt={null}
        workDetailsExpanded="auto"
        locale="zh-CN"
      />,
    );
    const workHeader = working.querySelector('[data-testid="turn-work-details-summary"]');
    expect(workHeader?.textContent).toContain('思考过程');
    expect(workHeader?.textContent).not.toContain('正在运行');
    expect(workHeader?.querySelector('.lamp')).toBeNull();
    expect(workHeader?.querySelector('[data-testid="work-fold-elapsed"]')?.textContent).toBe('4s');
  });

  it('does not auto-open thinking when a tool errors', () => {
    const running = assistant({
      id: 'p6',
      thinking: 'I will write the file',
      status: 'streaming',
      runId: 'run-p6',
      tools: [{ toolCallId: 't1', toolName: 'write', status: 'running', output: '' }],
    });
    const container = renderNode(
      <TurnWorkDetails
        message={running}
        runRecordsById={{
          'run-p6': {
            runId: 'run-p6',
            phaseHistory: [{ phase: 'tool-running', at: 1 }],
            startedAt: 1,
            endedAt: null,
          },
        }}
        activeRunId="run-p6"
        permissionPrompt={null}
        workDetailsExpanded="auto"
        locale="zh-CN"
      />,
    );
    expect(container.querySelector('[data-testid="turn-work-details"]')?.getAttribute('data-open')).toBe(
      'false',
    );

    const { root } = mounted[0]!;
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnWorkDetails
            message={{
              ...running,
              tools: [{ toolCallId: 't1', toolName: 'write', status: 'error', output: 'denied' }],
            }}
            runRecordsById={{
              'run-p6': {
                runId: 'run-p6',
                phaseHistory: [{ phase: 'tool-running', at: 1 }],
                startedAt: 1,
                endedAt: null,
              },
            }}
            activeRunId="run-p6"
            permissionPrompt={null}
            workDetailsExpanded="auto"
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="turn-work-details"]')?.getAttribute('data-open')).toBe(
      'false',
    );
    expect(container.querySelector('[data-testid="turn-thinking"]')).toBeNull();
  });
});

describe('TurnWorkDetails call-chain header', () => {
  const liveRun = {
    r1: { runId: 'r1', phaseHistory: [], startedAt: Date.now(), endedAt: null },
  };

  function renderRound(status: 'running' | 'done'): HTMLElement {
    return renderNode(
      <TurnWorkDetails
        message={assistant({
          id: `h-${status}`,
          runId: 'r1',
          status: 'streaming',
          tools: [
            { toolCallId: 'plan', toolName: 'piwin_plan_set_step', status: 'done', output: '' },
            {
              toolCallId: 'bash',
              toolName: 'bash',
              status,
              output: '',
              presentation: { kind: 'shell', title: 'bash', command: 'pnpm test' },
            },
          ],
        })}
        runRecordsById={liveRun}
        activeRunId="r1"
        permissionPrompt={null}
        workDetailsExpanded="auto"
        locale="zh-CN"
      />,
    );
  }

  it('leaves live tool state to the chain instead of a duplicate running header', () => {
    for (const status of ['running', 'done'] as const) {
      const container = renderRound(status);
      expect(container.querySelector('[data-testid="turn-work-details-summary"]')).toBeNull();
      expect(container.querySelectorAll('[data-testid="tool-call-card"]')).toHaveLength(1);
    }
  });
});

describe('TurnWorkDetails run terminal message', () => {
  function render(input: { outcome: 'failed' | 'cancelled'; show: boolean }): HTMLElement {
    return renderNode(
      <TurnWorkDetails
        message={assistant({ id: `t-${input.outcome}-${input.show}`, runId: 'r1', text: 'step' })}
        runRecordsById={{
          r1: {
            runId: 'r1',
            phaseHistory: [],
            startedAt: 1,
            endedAt: 2,
            outcome: input.outcome,
            terminalMessage: 'run ended',
          },
        }}
        activeRunId={null}
        permissionPrompt={null}
        showRunTerminalMessage={input.show}
        workDetailsExpanded="auto"
        locale="zh-CN"
      />,
    );
  }

  it('renders only on the response that owns the run tail', () => {
    expect(render({ outcome: 'cancelled', show: false }).querySelector('.turn-terminal-message')).toBeNull();
    expect(
      render({ outcome: 'cancelled', show: true }).querySelector('.turn-terminal-message')?.textContent,
    ).toBe('run ended');
  });

  it('leaves failed runs to the turn error card', () => {
    expect(render({ outcome: 'failed', show: true }).querySelector('.turn-terminal-message')).toBeNull();
  });
});
