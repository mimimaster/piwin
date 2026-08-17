// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens.js';
import { KnowledgeResultView } from './KnowledgeResultView.js';

describe('KnowledgeResultView', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('opens the review session only when the user clicks', () => {
    const onOpenSession = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeResultView
            resultKind="created"
            created={2}
            skipped={0}
            sessionId="session-1"
            error={undefined}
            onOpenSession={onOpenSession}
            onGenerateAgain={() => undefined}
            onDismiss={() => undefined}
          />
        </PiwinUiProvider>,
      );
    });
    const button = container.querySelector<HTMLButtonElement>('[data-testid="open-review-session-btn"]');
    expect(button).not.toBeNull();
    act(() => {
      button?.click();
    });
    expect(onOpenSession).toHaveBeenCalledWith('session-1');
  });

  it('treats created=0 as status, not an alert', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeResultView
            resultKind="zero"
            created={0}
            skipped={2}
            sessionId={undefined}
            error={undefined}
            onOpenSession={vi.fn()}
            onGenerateAgain={() => undefined}
            onDismiss={() => undefined}
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="open-review-session-btn"]')).toBeNull();
    expect(container.textContent).toContain('没有新卡片');
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('describes degraded saves without an open-session button', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeResultView
            resultKind="degraded"
            created={3}
            skipped={undefined}
            sessionId={undefined}
            error={undefined}
            onOpenSession={vi.fn()}
            onGenerateAgain={() => undefined}
            onDismiss={() => undefined}
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="open-review-session-btn"]')).toBeNull();
    expect(container.textContent).toContain('已保存 3 张卡片');
  });

  it('wires generate-again and dismiss', () => {
    const onGenerateAgain = vi.fn();
    const onDismiss = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeResultView
            resultKind="created"
            created={1}
            skipped={undefined}
            sessionId="s"
            error={undefined}
            onOpenSession={vi.fn()}
            onGenerateAgain={onGenerateAgain}
            onDismiss={onDismiss}
          />
        </PiwinUiProvider>,
      );
    });
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="generate-again-btn"]')?.click();
      container.querySelector<HTMLButtonElement>('[data-testid="dismiss-result-btn"]')?.click();
    });
    expect(onGenerateAgain).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
