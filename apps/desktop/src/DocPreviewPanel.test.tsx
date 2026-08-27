// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { DocPreviewPanel } from './DocPreviewPanel';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('DocPreviewPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('shows a back action when embedded in the workspace stage', () => {
    const onClose = vi.fn();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DocPreviewPanel
            title="README.md"
            content="# Readme"
            filePath="/workspace/README.md"
            onClose={onClose}
          />
        </PiwinUiProvider>,
      );
    });

    const closeButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="doc-preview-close"]',
    );
    expect(closeButton).not.toBeNull();

    act(() => {
      closeButton?.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not render a back action for standalone document previews', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DocPreviewPanel title="README.md" content="# Readme" />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="doc-preview-close"]')).toBeNull();
  });

  it('shows the outside-project read-only badge for trusted-config previews', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DocPreviewPanel
            title="config.json"
            content='{"ok":true}'
            provenance="trusted-config"
            readOnly
          />
        </PiwinUiProvider>,
      );
    });

    const badge = container.querySelector('[data-testid="doc-preview-readonly"]');
    expect(badge?.textContent).toContain('项目外 · 只读');
  });

  it('renders HTML files visually instead of as source code', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DocPreviewPanel
            title="card.html"
            filePath="/tmp/card.html"
            content="<h1>Hello</h1>"
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="markup-preview"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="artifact-static"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="code-preview-view"]')).toBeNull();
  });

  it('renders SVG files visually instead of as source code', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DocPreviewPanel
            title="mark.svg"
            filePath="/tmp/mark.svg"
            content='<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>'
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="markup-preview"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="code-preview-view"]')).toBeNull();
  });
});
