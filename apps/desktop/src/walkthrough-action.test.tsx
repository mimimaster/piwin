// @vitest-environment happy-dom
/**
 * WalkthroughAction — generation retired (ADR 0026); view-only cards.
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

function readyArtifact(): WalkthroughArtifact {
  return {
    version: 1,
    id: 'wt-a1',
    sessionId: 's1',
    messageId: 'a1',
    mode: 'default',
    sourceHash: 'hash',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'ready',
    markdown: '# Walkthrough\n\nDone.',
    generatedAt: new Date().toISOString(),
    model: { protocol: 'openai-compatible', providerId: 'prov', modelId: 'model-a' },
  };
}

describe('WalkthroughAction ADR 0026', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root!.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
  });

  it('isWalkthroughEligible is always false', () => {
    expect(
      isWalkthroughEligible({
        message: assistantMessage(),
        messages: [assistantMessage()],
        runRecordsById: {},
        activeRunId: null,
        enabled: true,
      }),
    ).toBe(false);
  });

  it('renders nothing without an artifact', () => {
    const rendered = renderAction(
      <WalkthroughAction message={assistantMessage()} eligible={true} onGenerate={() => undefined} />,
    );
    root = rendered.root;
    container = rendered.container;
    expect(container.querySelector('[data-testid="walkthrough-action-a1"]')).toBeNull();
    expect(container.querySelector('[data-testid="walkthrough-generate-btn-a1"]')).toBeNull();
  });

  it('renders a view-only card when an artifact exists', () => {
    const rendered = renderAction(
      <WalkthroughAction
        message={assistantMessage()}
        artifact={readyArtifact()}
        eligible={true}
        onGenerate={() => undefined}
      />,
    );
    root = rendered.root;
    container = rendered.container;
    expect(container.querySelector('[data-testid="walkthrough-action-a1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="walkthrough-card-a1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="walkthrough-generate-btn-a1"]')).toBeNull();
    expect(container.querySelector('[data-testid="walkthrough-regenerate-btn-a1"]')).toBeNull();
  });
});
