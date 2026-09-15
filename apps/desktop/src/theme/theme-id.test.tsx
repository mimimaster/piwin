// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { useThemeId } from './theme-id.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function ThemeProbe(): ReactElement {
  return <span>{useThemeId()}</span>;
}

describe('useThemeId', () => {
  it('re-renders when the document theme id changes', async () => {
    document.documentElement.setAttribute('data-theme-id', 'piwin-dark');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<ThemeProbe />));
    expect(container.textContent).toBe('piwin-dark');

    await act(async () => {
      document.documentElement.setAttribute('data-theme-id', 'piwin-inkstone-paper');
      await Promise.resolve();
    });
    expect(container.textContent).toBe('piwin-inkstone-paper');

    act(() => root.unmount());
    container.remove();
    document.documentElement.removeAttribute('data-theme-id');
  });
});
