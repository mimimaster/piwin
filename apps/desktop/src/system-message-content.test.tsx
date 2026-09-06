// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { SystemMessageContent } from './system-message-content';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('SystemMessageContent', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders changed file names with an icon and opens them through the file callback', () => {
    const onOpenFile = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SystemMessageContent
            text="Edited src/app.ts and added README.md."
            projectPath="/workspace"
            onOpenFile={onOpenFile}
          />
        </PiwinUiProvider>,
      );
    });

    const links = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('[data-testid="system-file-link"]'),
    );
    expect(links).toHaveLength(2);
    expect(links[0]?.textContent).toContain('src/app.ts');
    expect(links[0]?.querySelector('svg')).not.toBeNull();
    expect(links[0]?.className).toContain('system-file-link');
    expect(links[0]?.className).toContain('pc');

    act(() => links[0]?.click());
    expect(onOpenFile).toHaveBeenCalledWith('/workspace/src/app.ts', 'src/app.ts');
  });

  it('keeps file references transparent when no open callback is available', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SystemMessageContent text="Created src/new-file.ts." />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="system-file-reference"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="system-file-link"]')).toBeNull();
  });
});
