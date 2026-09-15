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
            locale="en"
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
    vi.restoreAllMocks();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('renders a compact launcher without mounting an inline iframe', () => {
    const { container, root } = renderLauncher();
    instances.push({ container, root });
    expect(container.querySelector('[data-testid="artifact-canvas-launcher"]')).not.toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('.artifact-frame')).toBeNull();
  });

  it('shows the canvas title, CANVAS badge, and description well', () => {
    const { container, root } = renderLauncher({ title: 'Stack picker' });
    instances.push({ container, root });
    expect(container.querySelector('.artifact-canvas-launcher-title')?.textContent).toBe(
      'Stack picker',
    );
    expect(container.querySelector('.artifact-canvas-launcher-badge')?.textContent).toBe('CANVAS');
    expect(container.querySelector('.artifact-canvas-launcher-description')?.textContent).toContain(
      'inspector Canvas tab',
    );
  });

  it('downloads original source from the launcher header', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:canvas-source');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clickAnchor = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    const { container, root } = renderLauncher({
      title: '2D 鹈鹕骑自行车动画',
      source: '<!DOCTYPE html><html><body>骑行</body></html>',
      locale: 'zh-CN',
    });
    instances.push({ container, root });
    const download = container.querySelector<HTMLButtonElement>(
      '[data-testid="artifact-canvas-download-source"]',
    );
    expect(download).not.toBeNull();
    expect(download?.getAttribute('aria-label')).toBe('下载 HTML');

    act(() => {
      download?.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(await (blob as Blob).text()).toContain('骑行');
    const anchor = clickAnchor.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe('2D-鹈鹕骑自行车动画.html');
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

  it('uses the canvas title and Chinese description in zh-CN', () => {
    const { container, root } = renderLauncher({
      title: '部署配置器',
      locale: 'zh-CN',
    });
    instances.push({ container, root });
    expect(container.querySelector('.artifact-canvas-launcher-title')?.textContent).toBe(
      '部署配置器',
    );
    expect(container.querySelector('.artifact-canvas-launcher-description')?.textContent).toContain(
      '检视器「画布」页签',
    );
    expect(container.querySelector('[data-testid="artifact-canvas-open"]')?.textContent).toContain(
      '在画布打开',
    );
  });
});
