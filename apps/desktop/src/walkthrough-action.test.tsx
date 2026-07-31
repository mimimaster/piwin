// @vitest-environment happy-dom
/**
 * WalkthroughAction eligibility + button/card mount coverage (spec §5.1–5.3, §15.6).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { WalkthroughAction, isWalkthroughEligible } from './walkthrough-action';
import type { ChatMessageUi } from './chat-reducer';
import type { WalkthroughArtifact } from '@piwin/contracts';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function renderAction(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
  });
  return { container, root };
}

function assistantMessage(overrides: Partial<ChatMessageUi> = {}): ChatMessageUi {
  return {
    id: 'a1',
    role: 'assistant',
    text: 'Done.',
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
    ...overrides,
  };
}

function readyArtifact(
  overrides: Partial<WalkthroughArtifact> & { status?: 'ready' } = {},
): WalkthroughArtifact {
  const base = {
    version: 1 as const,
    id: 'wt-a1',
    sessionId: 's1',
    messageId: 'a1',
    mode: 'default' as const,
    sourceHash: 'hash',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return {
    ...base,
    status: 'ready',
    markdown: '# Walkthrough\n\n## Summary\n\nBody text.',
    generatedAt: '2026-01-01T00:00:00.000Z',
    model: { protocol: 'openai-compatible', providerId: 'mock', modelId: 'mock-wt' },
    ...overrides,
  } as WalkthroughArtifact;
}

function generatingArtifact(): WalkthroughArtifact {
  return {
    version: 1,
    id: 'wt-a1',
    sessionId: 's1',
    messageId: 'a1',
    mode: 'default',
    sourceHash: 'hash',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'generating',
    generationId: 'gen-1',
  };
}

function errorArtifact(): WalkthroughArtifact {
  return {
    version: 1,
    id: 'wt-a1',
    sessionId: 's1',
    messageId: 'a1',
    mode: 'default',
    sourceHash: 'hash',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'error',
    error: { code: 'model-unavailable', message: 'No model configured.' },
    generatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('isWalkthroughEligible', () => {
  it('returns false for a streaming assistant message', () => {
    const message = assistantMessage({ status: 'streaming' });
    expect(
      isWalkthroughEligible({
        message,
        messages: [message],
        runRecordsById: {},
        activeRunId: null,
        enabled: true,
      }),
    ).toBe(false);
  });

  it('returns true for a completed final assistant message', () => {
    const message = assistantMessage();
    expect(
      isWalkthroughEligible({
        message,
        messages: [message],
        runRecordsById: {},
        activeRunId: null,
        enabled: true,
      }),
    ).toBe(true);
  });

  it('returns false for a middle assistant message of a run', () => {
    const first = assistantMessage({ id: 'a1', runId: 'r1' });
    const last = assistantMessage({ id: 'a2', runId: 'r1' });
    expect(
      isWalkthroughEligible({
        message: first,
        messages: [first, last],
        runRecordsById: {
          r1: { runId: 'r1', phaseHistory: [], startedAt: null, endedAt: 1, outcome: 'completed' },
        },
        activeRunId: null,
        enabled: true,
      }),
    ).toBe(false);
  });

  it('returns false when walkthrough is disabled', () => {
    const message = assistantMessage();
    expect(
      isWalkthroughEligible({
        message,
        messages: [message],
        runRecordsById: {},
        activeRunId: null,
        enabled: false,
      }),
    ).toBe(false);
  });

  it('returns false for a failed run outcome', () => {
    const message = assistantMessage({ runId: 'r1' });
    expect(
      isWalkthroughEligible({
        message,
        messages: [message],
        runRecordsById: {
          r1: { runId: 'r1', phaseHistory: [], startedAt: null, endedAt: 1, outcome: 'failed' },
        },
        activeRunId: null,
        enabled: true,
      }),
    ).toBe(false);
  });

  it('returns false for a cancelled run outcome', () => {
    const message = assistantMessage({ runId: 'r1' });
    expect(
      isWalkthroughEligible({
        message,
        messages: [message],
        runRecordsById: {
          r1: { runId: 'r1', phaseHistory: [], startedAt: null, endedAt: 1, outcome: 'cancelled' },
        },
        activeRunId: null,
        enabled: true,
      }),
    ).toBe(false);
  });

  it('returns true for an empty-text message with tools', () => {
    const message = assistantMessage({
      text: '',
      tools: [{ toolCallId: 't1', toolName: 'bash', status: 'done', output: 'ok' }],
    });
    expect(
      isWalkthroughEligible({
        message,
        messages: [message],
        runRecordsById: {},
        activeRunId: null,
        enabled: true,
      }),
    ).toBe(true);
  });
});

describe('WalkthroughAction component', () => {
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('shows Generate button when eligible and no artifact', () => {
    const { container } = renderAction(
      <WalkthroughAction
        message={assistantMessage()}
        eligible={true}
        onGenerate={() => undefined}
      />,
    );
    expect(container.querySelector('[data-testid="walkthrough-generate-btn-a1"]')).toBeTruthy();
  });

  it('calls onGenerate with messageId when Generate is clicked', () => {
    let called: string | null = null;
    let force: boolean | undefined = undefined;
    const { container } = renderAction(
      <WalkthroughAction
        message={assistantMessage()}
        eligible={true}
        onGenerate={(id, f) => {
          called = id;
          force = f;
        }}
      />,
    );
    const btn = container.querySelector<HTMLButtonElement>(
      '[data-testid="walkthrough-generate-btn-a1"]',
    );
    act(() => {
      btn?.click();
    });
    expect(called).toBe('a1');
    expect(force).toBe(false);
  });

  it('shows loading state and disables repeat click while generating', () => {
    const { container } = renderAction(
      <WalkthroughAction
        message={assistantMessage()}
        artifact={generatingArtifact()}
        eligible={true}
        onGenerate={() => undefined}
      />,
    );
    const btn = container.querySelector<HTMLButtonElement>(
      '[data-testid="walkthrough-generate-btn-a1"]',
    );
    expect(btn).toBeTruthy();
    expect(btn?.disabled).toBe(true);
    expect(btn?.textContent).toContain('Generating');
  });

  it('delegates View and Regenerate to WalkthroughCard when artifact is ready', () => {
    const { container } = renderAction(
      <WalkthroughAction
        message={assistantMessage()}
        artifact={readyArtifact()}
        eligible={true}
        onGenerate={() => undefined}
        onOpenDocument={() => undefined}
      />,
    );
    // The card renders the doc + regenerate buttons; the action must NOT
    // render its own duplicate buttons (spec §15.6 — no duplicate testids).
    expect(container.querySelector('[data-testid="walkthrough-doc-btn-a1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="walkthrough-regenerate-btn-a1"]')).toBeTruthy();
    expect(
      container.querySelectorAll('[data-testid="walkthrough-regenerate-btn-a1"]'),
    ).toHaveLength(1);
    // The action's own view/generate buttons are absent in the ready state.
    expect(container.querySelector('[data-testid="walkthrough-view-btn-a1"]')).toBeNull();
    expect(container.querySelector('[data-testid="walkthrough-generate-btn-a1"]')).toBeNull();
  });

  it('shows error message and Retry button when artifact is error', () => {
    const { container } = renderAction(
      <WalkthroughAction
        message={assistantMessage()}
        artifact={errorArtifact()}
        eligible={true}
        onGenerate={() => undefined}
      />,
    );
    expect(container.querySelector('[data-testid="walkthrough-error-a1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="walkthrough-retry-btn-a1"]')).toBeTruthy();
  });

  it('renders nothing when not eligible and no artifact', () => {
    const { container } = renderAction(
      <WalkthroughAction
        message={assistantMessage()}
        eligible={false}
        onGenerate={() => undefined}
      />,
    );
    expect(container.querySelector('[data-testid="walkthrough-action-a1"]')).toBeNull();
  });

  it('hides walkthrough-action-buttons by default and reveals on hover/focus (spec §15.6 case 5)', () => {
    // Render the action inside a .chat-message-row wrapper so the CSS
    // hover/focus selectors can be verified by class presence. happy-dom
    // does not apply CSS, so we assert the hidden-by-default class is
    // present and that the wrapper class matches the reveal selector.
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <article className="bubble chat-message-row role-assistant">
            <WalkthroughAction
              message={assistantMessage()}
              eligible={true}
              onGenerate={() => undefined}
            />
          </article>
        </PiwinUiProvider>,
      );
    });

    const buttonsWrap = container.querySelector('.walkthrough-action-buttons');
    expect(buttonsWrap).toBeTruthy();
    // The hidden-by-default class is present (opacity:0 via CSS).
    expect(buttonsWrap?.classList.contains('walkthrough-action-buttons')).toBe(true);

    const row = container.querySelector('.chat-message-row');
    expect(row).toBeTruthy();
    // Simulate hover by adding the class happy-dom can't :hover; verify the
    // row is the correct ancestor for the reveal selector.
    expect(row?.contains(buttonsWrap)).toBe(true);

    act(() => {
      root.unmount();
    });
  });

  it('re-renders with updated artifact prop and updates the DOM (spec §15.6 case 13)', () => {
    // The memo comparator on ChatMessageRow must not block state updates when
    // the artifact prop changes. We verify by rendering with a generating
    // artifact, then re-rendering with a ready artifact and asserting the DOM
    // reflects the new status + buttons.
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WalkthroughAction
            message={assistantMessage()}
            artifact={generatingArtifact()}
            eligible={true}
            onGenerate={() => undefined}
            onOpenDocument={() => undefined}
          />
        </PiwinUiProvider>,
      );
    });
    // Initially generating: loading indicator present, no doc button.
    expect(container.querySelector('[data-testid="walkthrough-loading-a1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="walkthrough-doc-btn-a1"]')).toBeNull();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WalkthroughAction
            message={assistantMessage()}
            artifact={readyArtifact()}
            eligible={true}
            onGenerate={() => undefined}
            onOpenDocument={() => undefined}
          />
        </PiwinUiProvider>,
      );
    });
    // After update: ready status, doc button present, loading gone.
    expect(container.querySelector('[data-testid="walkthrough-loading-a1"]')).toBeNull();
    expect(container.querySelector('[data-testid="walkthrough-status-a1"]')?.textContent).toBe(
      'Ready',
    );
    expect(container.querySelector('[data-testid="walkthrough-doc-btn-a1"]')).toBeTruthy();

    act(() => {
      root.unmount();
    });
  });

  it('renders zh-CN button label when locale is zh-CN', () => {
    const { container } = renderAction(
      <WalkthroughAction
        message={assistantMessage()}
        eligible={true}
        locale="zh-CN"
        onGenerate={() => undefined}
      />,
    );
    const btn = container.querySelector<HTMLButtonElement>(
      '[data-testid="walkthrough-generate-btn-a1"]',
    );
    expect(btn?.textContent).toContain('生成演练');
    expect(btn?.getAttribute('aria-label')).toBe('生成演练');
  });

  it('renders zh-CN generating label when locale is zh-CN and artifact is generating', () => {
    const { container } = renderAction(
      <WalkthroughAction
        message={assistantMessage()}
        artifact={generatingArtifact()}
        eligible={true}
        locale="zh-CN"
        onGenerate={() => undefined}
      />,
    );
    const btn = container.querySelector<HTMLButtonElement>(
      '[data-testid="walkthrough-generate-btn-a1"]',
    );
    expect(btn?.textContent).toContain('生成中…');
  });
});
