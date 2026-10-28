// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { MobileDiffViewer } from './MobileDiffViewer.js';
import { MOBILE_THEME } from '../../mobile-theme.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('MobileDiffViewer', () => {
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

  it('renders MobileDiffViewer with additions and deletions', () => {
    const diffSample = `@@ -1,3 +1,3 @@\n-const a = 1;\n+const a = 2;\n const b = 3;`;

    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <MobileDiffViewer diffText={diffSample} />
        </PiwinUiProvider>,
      );
    });

    expect(document.body.querySelector('.mobile-diff-viewer')).not.toBeNull();
    expect(document.body.querySelector('.diff-line.delete')).not.toBeNull();
    expect(document.body.querySelector('.diff-line.add')).not.toBeNull();
    expect(document.body.textContent).toContain('const a = 1;');
    expect(document.body.textContent).toContain('const a = 2;');
  });

});
