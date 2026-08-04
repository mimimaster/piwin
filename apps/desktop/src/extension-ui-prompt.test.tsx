// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { ExtensionUiPrompt, type ExtensionUiPromptProps } from './extension-ui-prompt';
import { DesktopLocaleProvider } from './desktop-locale-context';

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
};

function renderPrompt(
  props: ExtensionUiPromptProps,
  locale: 'zh-CN' | 'en' = 'en',
): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <DesktopLocaleProvider locale={locale} onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ExtensionUiPrompt {...props} />
        </PiwinUiProvider>
      </DesktopLocaleProvider>,
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

  it('renders null when request is null', () => {
    const rendered = renderPrompt({ ...baseProps, request: null });
    root = rendered.root;
    container = rendered.container;
    expect(container.querySelector('[data-testid="extension-ui-prompt"]')).toBeNull();
  });

  it('renders select choices and resolves the selected value', () => {
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

  it('uses native group semantics, not incomplete listbox', () => {
    const rendered = renderPrompt(baseProps);
    root = rendered.root;
    container = rendered.container;

    const group = container.querySelector('.agent-interruption-choices');
    expect(group?.getAttribute('role')).toBe('group');
    // No role="option" buttons — they are plain buttons now
    expect(container.querySelector('[role="option"]')).toBeNull();
  });

  it('does not render a Stop run button (composer owns Stop)', () => {
    const rendered = renderPrompt(baseProps);
    root = rendered.root;
    container = rendered.container;
    expect(container.querySelector('[data-testid="extension-ui-stop"]')).toBeNull();
  });

  it('renders cancel for select and resolves cancelled', () => {
    const onResolve = vi.fn();
    const rendered = renderPrompt({ ...baseProps, onResolve });
    root = rendered.root;
    container = rendered.container;

    const cancel = container.querySelector<HTMLButtonElement>(
      '[data-testid="extension-ui-cancel"]',
    );
    expect(cancel).not.toBeNull();
    act(() => {
      cancel?.click();
    });
    expect(onResolve).toHaveBeenCalledWith({ cancelled: true, confirmed: false });
  });

  it('renders confirm with Continue and Cancel (not Allow/Deny)', () => {
    const onResolve = vi.fn();
    const rendered = renderPrompt({
      ...baseProps,
      onResolve,
      request: {
        sessionId: 'session-1',
        requestId: 'request-2',
        kind: 'confirm',
        title: 'Proceed with refactoring?',
      },
    });
    root = rendered.root;
    container = rendered.container;

    const allowBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="extension-ui-allow"]',
    );
    const denyBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="extension-ui-deny"]',
    );
    expect(allowBtn?.textContent).toBe('Continue');
    expect(denyBtn?.textContent).toBe('Cancel');

    act(() => {
      allowBtn?.click();
    });
    expect(onResolve).toHaveBeenCalledWith({ confirmed: true });
  });

  it('renders input hint in description, no option buttons', () => {
    const rendered = renderPrompt({
      ...baseProps,
      request: {
        sessionId: 'session-1',
        requestId: 'request-3',
        kind: 'input',
        title: 'Describe the task',
        placeholder: 'Type your answer',
      },
    });
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="extension-ui-option"]')).toBeNull();
    expect(container.textContent).toContain('Answer in the composer below');
  });

  it('renders localized Chinese copy', () => {
    const rendered = renderPrompt(baseProps, 'zh-CN');
    root = rendered.root;
    container = rendered.container;

    expect(container.textContent).toContain('Agent 正等待你的回答');
    const cancel = container.querySelector<HTMLButtonElement>(
      '[data-testid="extension-ui-cancel"]',
    );
    expect(cancel?.textContent).toBe('取消问题');
  });
});
