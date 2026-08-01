// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TextArea } from './textarea.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('TextArea (static)', () => {
  it('renders the controlled value into the native textarea', () => {
    const markup = renderToStaticMarkup(
      createElement(TextArea, {
        value: 'hello world',
        onChange: () => undefined,
      }),
    );

    expect(markup).toContain('<textarea');
    expect(markup).toContain('hello world');
  });

  it('applies label, description, and testId', () => {
    const markup = renderToStaticMarkup(
      createElement(TextArea, {
        label: 'Notes',
        description: 'Markdown supported',
        testId: 'notes-field',
        value: '',
        onChange: () => undefined,
      }),
    );

    expect(markup).toContain('data-testid="notes-field"');
    expect(markup).toContain('Notes');
    expect(markup).toContain('Markdown supported');
    // Label associates with the control via htmlFor.
    expect(markup).toContain('class="piwin-text-area-label"');
    expect(markup).toContain('class="piwin-text-area-description');
  });

  it('marks the disabled state on the wrapper and the control', () => {
    const markup = renderToStaticMarkup(
      createElement(TextArea, {
        disabled: true,
        value: '',
        onChange: () => undefined,
      }),
    );

    expect(markup).toContain('data-disabled="true"');
    expect(markup).toContain('disabled=""');
  });

  it('renders the error message and flags aria-invalid', () => {
    const markup = renderToStaticMarkup(
      createElement(TextArea, {
        error: 'Too short',
        value: '',
        onChange: () => undefined,
      }),
    );

    expect(markup).toContain('data-invalid="true"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('Too short');
    expect(markup).toContain('role="alert"');
  });

  it('renders a character counter when maxLength is set', () => {
    const markup = renderToStaticMarkup(
      createElement(TextArea, {
        maxLength: 10,
        value: 'abc',
        onChange: () => undefined,
      }),
    );

    expect(markup).toContain('maxLength="10"');
    expect(markup).toContain('3/10');
  });
});

describe('TextArea (interactive)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it('fires onChange with the new value on user input', () => {
    const handleChange = vi.fn();

    act(() => {
      root.render(createElement(TextArea, { value: '', onChange: handleChange }));
    });

    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    const node = textarea as HTMLTextAreaElement;

    // React tracks the controlled value via the native prototype setter, so we
    // must set through it (not direct assignment) before dispatching `input`.
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )?.set;
    expect(valueSetter).toBeDefined();

    act(() => {
      (valueSetter as (v: string) => void).call(node, 'typed text');
      node.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(handleChange).toHaveBeenCalledTimes(1);
    const [firstCall] = handleChange.mock.calls;
    expect(firstCall).toBeDefined();
    const [newValue] = firstCall as unknown as [string];
    expect(newValue).toBe('typed text');
  });
});
