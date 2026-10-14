// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { BackendUserInputRequest } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { BackendUserInputPrompt } from './backend-user-input-prompt.js';
import { DesktopLocaleProvider } from './desktop-locale-context.js';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const selectRequest: BackendUserInputRequest = {
  title: 'Choose a model',
  questions: [{
    id: 'model',
    prompt: 'Which model?',
    type: 'select',
    choices: [
      { id: 'native-sonnet', label: 'Sonnet' },
      { id: 'native-opus', label: 'Opus' },
    ],
  }],
};

const mixedRequest: BackendUserInputRequest = {
  title: 'Need a few details',
  questions: [
    {
      id: 'name',
      prompt: 'Name',
      type: 'text',
    },
    {
      id: 'tools',
      prompt: 'Tools',
      type: 'select',
      multiple: true,
      allowOther: true,
      choices: [
        { id: 'bash', label: 'Bash' },
        { id: 'read', label: 'Read' },
      ],
    },
  ],
};

function renderPrompt(request: BackendUserInputRequest | null, onResolve = vi.fn()) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <BackendUserInputPrompt request={request} onResolve={onResolve} />
        </PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
  });
  return { container, root, onResolve };
}

describe('BackendUserInputPrompt', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    if (root) act(() => { root?.unmount(); });
    container?.parentNode?.removeChild(container);
    root = null;
    container = null;
  });

  it('renders null when there is no request', () => {
    const rendered = renderPrompt(null);
    root = rendered.root;
    container = rendered.container;
    expect(container.querySelector('[data-testid="backend-user-input-prompt"]')).toBeNull();
  });

  it('submits native option ids, not labels, and can cancel', () => {
    const rendered = renderPrompt(selectRequest);
    root = rendered.root;
    container = rendered.container;
    const submit = container.querySelector<HTMLButtonElement>('[data-testid="backend-user-input-submit"]');
    expect(submit?.disabled).toBe(true);
    const opus = container.querySelector<HTMLButtonElement>('[data-option-id="native-opus"]');
    expect(opus?.textContent).toContain('Opus');
    act(() => opus?.click());
    expect(submit?.disabled).toBe(false);
    act(() => submit?.click());
    expect(rendered.onResolve).toHaveBeenCalledWith({
      answers: [{ questionId: 'model', optionIds: ['native-opus'] }],
    });
    act(() => container?.querySelector<HTMLButtonElement>('[data-testid="backend-user-input-cancel"]')?.click());
    expect(rendered.onResolve).toHaveBeenLastCalledWith({ cancelled: true });
  });

  it('collects text, multi-select native ids, and optional other text', () => {
    const rendered = renderPrompt(mixedRequest);
    root = rendered.root;
    container = rendered.container;
    const setValue = (input: HTMLInputElement | null, value: string): void => {
      if (input === null) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const name = container.querySelector<HTMLInputElement>('[data-testid="backend-user-input-text-name"]');
    const bash = container.querySelector<HTMLButtonElement>('[data-option-id="bash"]');
    const other = container.querySelector<HTMLInputElement>('[data-testid="backend-user-input-other-tools"]');
    act(() => {
      setValue(name, 'Ada');
      bash?.click();
      setValue(other, 'web');
    });
    act(() => container?.querySelector<HTMLButtonElement>('[data-testid="backend-user-input-submit"]')?.click());
    expect(rendered.onResolve).toHaveBeenCalledWith({
      answers: [
        { questionId: 'name', text: 'Ada' },
        { questionId: 'tools', optionIds: ['bash'], otherText: 'web' },
      ],
    });
  });
});
