// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { BranchSwitchConfirmDialog } from './branch-switch-confirm-dialog';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('BranchSwitchConfirmDialog', () => {
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

  it('names disk and lists abandoned files', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <BranchSwitchConfirmDialog
            open
            locale="en"
            offPathWrites={{ files: ['src/app.ts'], hasUnknownWrites: true }}
            onCancel={onCancel}
            onConfirm={onConfirm}
          />
        </PiwinUiProvider>,
      );
    });
    const dialog = document.querySelector('[data-testid="branch-switch-confirm"]');
    expect(dialog?.textContent?.toLowerCase()).toContain('disk will not follow');
    expect(dialog?.textContent).toContain('src/app.ts');
    act(() => {
      (document.querySelector('[data-testid="branch-switch-continue"]') as HTMLButtonElement).click();
    });
    expect(onConfirm).toHaveBeenCalledOnce();
    act(() => {
      (document.querySelector('[data-testid="branch-switch-cancel"]') as HTMLButtonElement).click();
    });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('renders nothing when closed', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <BranchSwitchConfirmDialog
            open={false}
            offPathWrites={null}
            onCancel={() => undefined}
            onConfirm={() => undefined}
          />
        </PiwinUiProvider>,
      );
    });
    expect(document.querySelector('[data-testid="branch-switch-confirm"]')).toBeNull();
  });
});
