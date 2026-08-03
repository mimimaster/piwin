// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { ExtensionUiPrompt, type ExtensionUiPromptProps } from './extension-ui-prompt';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseProps: ExtensionUiPromptProps = {
  request: {
    sessionId: 'session-1',
    requestId: 'request-1',
    kind: 'select',
    title: 'What should I work on?',
    options: ['Fix the bug', 'Improve the UI', 'Other'],
  },
  onResolve: vi.fn(),
  onAbort: vi.fn(),
};

function renderPrompt(props: ExtensionUiPromptProps): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <ExtensionUiPrompt {...props} />
      </PiwinUiProvider>,
    );
  });
  return { container, root };
}

describe('ExtensionUiPrompt', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    if (container?.parentNode) {
      container.parentNode.removeChild(container);
    }
    root = null;
    container = null;
  });

  it('renders select choices inline and resolves the selected value', () => {
    const onResolve = vi.fn();
    const rendered = renderPrompt({ ...baseProps, onResolve });
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="extension-ui-prompt"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="extension-ui-option"]')).toHaveLength(3);

    const option = container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="extension-ui-option"]',
    )[1];
    act(() => {
      option?.click();
    });

    expect(onResolve).toHaveBeenCalledWith({ value: 'Improve the UI' });
  });

  it('uses the same prompt surface for Other input and exposes cancel and stop', () => {
    const onResolve = vi.fn();
    const onAbort = vi.fn();
    const rendered = renderPrompt({
      ...baseProps,
      onResolve,
      onAbort,
      request: {
        sessionId: 'session-1',
        requestId: 'request-1',
        kind: 'input',
        title: 'Tell me what to do instead',
        placeholder: 'Describe the task',
      },
    });
    root = rendered.root;
    container = rendered.container;

    expect(container.textContent).toContain('Type your answer in the composer below');
    expect(container.querySelector('[data-testid="extension-ui-option"]')).toBeNull();

    act(() => {
      container?.querySelector<HTMLButtonElement>('[data-testid="extension-ui-cancel"]')?.click();
      container?.querySelector<HTMLButtonElement>('[data-testid="extension-ui-stop"]')?.click();
    });

    expect(onResolve).toHaveBeenCalledWith({ cancelled: true, confirmed: false });
    expect(onAbort).toHaveBeenCalledTimes(1);
  });
});
