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

  it('shows only the filename in the header, not the path or provenance', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DocPreviewPanel
            title="live-call-coordinator.ts"
            content="export {}"
            filePath="/Users/me/piwin/packages/host-runtime/src/voice/live-call-coordinator.ts"
            displayRef="packages/host-runtime/src/voice/live-call-coordinator.ts"
            provenance="project-current"
          />
        </PiwinUiProvider>,
      );
    });

    const heading = container.querySelector('.doc-preview-title');
    expect(heading?.textContent).toBe('live-call-coordinator.ts');
    expect(heading?.getAttribute('title')).toBe(
      'packages/host-runtime/src/voice/live-call-coordinator.ts',
    );
    expect(container.querySelector('[data-testid="doc-preview-provenance"]')).toBeNull();
    expect(container.querySelector('[data-testid="doc-preview-meta"]')).toBeNull();
    expect(container.querySelector('.doc-preview-header')?.textContent).not.toContain(
      'packages/host-runtime/src/voice/live-call-coordinator.ts',
    );
    expect(container.querySelector('.doc-preview-header')?.textContent).not.toContain(
      '当前磁盘版本',
    );
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

  it('shows a centered reason instead of dumping host codes', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DocPreviewPanel
            title="Setup.dmg"
            filePath="/proj/Setup.dmg"
            status="unavailable"
            unavailableReason="binary"
            displayRef="/proj/Setup.dmg"
            suggestion="该文件无法作为文档预览。请右键路径芯片选择另存为，或在文件管理器中显示。"
          />
        </PiwinUiProvider>,
      );
    });

    const state = container.querySelector('[data-testid="doc-preview-state-unavailable"]');
    expect(state).not.toBeNull();
    expect(state?.textContent).toContain('无法预览此文件');
    expect(state?.textContent).toContain('不支持预览 .dmg 文件');
    expect(state?.textContent).not.toContain('binary');
    expect(state?.textContent).not.toContain('Reason');
    expect(state?.textContent).not.toContain('/proj/Setup.dmg');
  });

  it('explains when a file is too large to preview', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DocPreviewPanel
            title="huge.png"
            filePath="/proj/huge.png"
            status="unavailable"
            unavailableReason="too-large"
            byteSize={12.4 * 1024 * 1024}
            maxBytes={8 * 1024 * 1024}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    const state = container.querySelector('[data-testid="doc-preview-state-unavailable"]');
    expect(state?.textContent).toContain('File is too large to preview');
    expect(state?.textContent).toContain('12.4 MB exceeds the 8.0 MB preview limit');
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
