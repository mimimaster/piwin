// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useMarkdownRenderingPhase } from './markdown-rendering-phase.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ container: HTMLElement; root: Root }> = [];

function PhaseProbe(): ReactElement {
  const phase = useMarkdownRenderingPhase();
  return <span data-testid="markdown-phase">{phase}</span>;
}

function renderProbe(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PhaseProbe />);
  });
  mounted.push({ container, root });
  return container;
}

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop();
    if (!item) continue;
    act(() => {
      item.root.unmount();
    });
    item.container.remove();
  }
});

describe('useMarkdownRenderingPhase', () => {
  it("defaults to 'completed' when no provider is mounted", () => {
    const container = renderProbe();
    expect(container.querySelector('[data-testid="markdown-phase"]')?.textContent).toBe(
      'completed',
    );
  });
});
