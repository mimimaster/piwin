// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { TextInput } from './text-input.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('ui-kit test ids', () => {
  let container: HTMLDivElement;
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

  it('keeps a caller data-testid when no testId prop is given', () => {
    act(() =>
      root.render(
        <MantineProvider>
          <TextInput data-testid="caller-id" />
          <TextInput testId="prop-id" />
        </MantineProvider>,
      ),
    );
    expect(container.querySelector('[data-testid="caller-id"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="prop-id"]')).not.toBeNull();
  });
});
