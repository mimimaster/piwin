// @vitest-environment happy-dom
/**
 * ArtifactCanvasLauncher — transcript launcher for surface="canvas" fences.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { ArtifactCanvasLauncher } from './artifact-canvas-launcher';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function renderLauncher(props: Partial<Parameters<typeof ArtifactCanvasLauncher>[0]> = {}): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      (
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ArtifactCanvasLauncher
            title="Deployment configurator"
            source="<div>config</div>"
            rawLanguage="artifact-html"
            onOpenCanvas={() => {}}
            {...props}
          />
        </PiwinUiProvider>
      ) as ReactElement,
    );
  });
  return { container, root };
}

describe('ArtifactCanvasLauncher', () => {
  let previousActEnvironment: boolean | undefined;
  let instances: { container: HTMLDivElement; root: Root }[] = [];

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    instances = [];
  });

  afterEach(() => {
    for (const { container, root } of instances) {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('renders a compact launcher without mounting an inline iframe', () => {
    const { container, root } = renderLauncher();
    instances.push({ container, root });
    expect(container.querySelector('[data-testid="artifact-canvas-launcher"]')).not.toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('.artifact-frame')).toBeNull();
  });

  it('shows the title and a canvas pill', () => {
    const { container, root } = renderLauncher({ title: 'Stack picker' });
    instances.push({ container, root });
    expect(container.querySelector('.artifact-canvas-launcher-title strong')?.textContent).toBe(
      'Stack picker',
    );
    expect(container.querySelector('.pill')?.textContent).toBe('canvas');
  });

  it('invokes onOpenCanvas when Open Canvas is clicked', () => {
    const onOpenCanvas = vi.fn();
    const { container, root } = renderLauncher({ onOpenCanvas });
    instances.push({ container, root });
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="artifact-canvas-open"]',
    );
    expect(button).not.toBeNull();
    act(() => {
      button?.click();
    });
    expect(onOpenCanvas).toHaveBeenCalledTimes(1);
  });

  it('discloses raw source on demand without rendering it', () => {
    const { container, root } = renderLauncher({ source: '<div>secret-config</div>' });
    instances.push({ container, root });
    const details = container.querySelector<HTMLDetailsElement>('.artifact-canvas-launcher-source');
    expect(details).not.toBeNull();
    // Source is present in the DOM inside the collapsed <details> body.
    expect(container.textContent).toContain('secret-config');
    // No iframe is mounted even with the source disclosure present.
    expect(container.querySelector('iframe')).toBeNull();
  });
});
