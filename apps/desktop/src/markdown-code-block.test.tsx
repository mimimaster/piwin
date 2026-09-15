// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { SourceCodeBlock } from './markdown-code-block';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ container: HTMLElement; root: Root }> = [];

function renderBlock(node: ReactElement): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
  });
  mounted.push({ container, root });
  return container;
}

describe('SourceCodeBlock download', () => {
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    for (const { container, root } of mounted) {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
    mounted.length = 0;
    vi.restoreAllMocks();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('keeps a download action on streaming artifact-html source', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:code-html');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const source = '<!DOCTYPE html>\n<html lang="zh-CN"></html>';
    const container = renderBlock(
      <SourceCodeBlock language="artifact-html" source={source} isShell={false} streaming />,
    );

    const download = container.querySelector<HTMLButtonElement>('[data-testid="code-download-button"]');
    expect(download).not.toBeNull();
    expect(container.querySelector('[data-testid="code-copy-button"]')).toBeNull();

    act(() => {
      download?.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(await (blob as Blob).text()).toBe(source);
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe('code.html');
  });

  it('downloads completed python source next to copy', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:code-py');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const container = renderBlock(
      <SourceCodeBlock language="python" source="print('hi')" isShell={false} />,
    );

    expect(container.querySelector('[data-testid="code-copy-button"]')).not.toBeNull();
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="code-download-button"]')?.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe('code.python');
    expect(createObjectURL).toHaveBeenCalledOnce();
  });
});
