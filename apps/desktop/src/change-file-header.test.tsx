// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { ChangeFileHeader } from './change-file-header';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('ChangeFileHeader', () => {
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

  it('renders relative path split, additions/deletions, and status label in zh-CN', () => {
    const onBack = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChangeFileHeader
            projectPath="/Volumes/BigDisk/Projects/piwin"
            relativePath="apps/desktop/src/goal/GoalRunControl.tsx"
            status="added"
            additions={54}
            deletions={0}
            locale="zh-CN"
            onBack={onBack}
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('.change-file-path-dir')?.textContent).toBe('apps/desktop/src/goal/');
    expect(container.querySelector('.change-file-path-name')?.textContent).toBe('GoalRunControl.tsx');
    expect(container.querySelector('.change-file-stats .add')?.textContent).toBe('+54');
    expect(container.querySelector('.change-file-stats .del')).toBeNull();
    expect(container.querySelector('[data-testid="change-file-status-badge"]')?.textContent).toBe('A');

    const backBtn = container.querySelector<HTMLButtonElement>('[data-testid="change-file-back"]');
    expect(backBtn).not.toBeNull();
    act(() => {
      backBtn?.click();
    });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders status label and stats in English', () => {
    const onBack = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChangeFileHeader
            projectPath="/workspace"
            relativePath="src/utils.ts"
            status="deleted"
            additions={0}
            deletions={12}
            locale="en"
            onBack={onBack}
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('.change-file-path-dir')?.textContent).toBe('src/');
    expect(container.querySelector('.change-file-path-name')?.textContent).toBe('utils.ts');
    expect(container.querySelector('.change-file-stats .del')?.textContent).toBe('−12');
    expect(container.querySelector('[data-testid="change-file-status-badge"]')?.textContent).toBe('D');
  });
});
