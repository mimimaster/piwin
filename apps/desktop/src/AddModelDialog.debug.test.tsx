// @vitest-environment happy-dom
import { describe, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { AddModelDialog } from './AddModelDialog';
import { DesktopLocaleProvider } from './desktop-locale-context';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('debug', () => {
  it('dumps', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
            <AddModelDialog
              open
              onOpenChange={() => undefined}
              existingModelIds={[]}
              onAdd={() => undefined}
              searchCatalog={async () => []}
            />
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    console.log('BODY', document.body.innerHTML.slice(0, 4000));
    console.log('testid count', document.body.querySelectorAll('[data-testid]').length);
    for (const el of document.body.querySelectorAll('[data-testid]')) {
      console.log('tid', el.getAttribute('data-testid'), el.tagName, el.className);
    }
    act(() => root.unmount());
  });
});
