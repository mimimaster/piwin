/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens.js';
import { WorkspaceHealth } from './settings-workspace-header.js';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('WorkspaceHealth', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  function render(node: ReactElement): HTMLDivElement {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root?.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>));
    return host;
  }

  it('is a plain badge when nothing needs attention', () => {
    const container = render(
      <WorkspaceHealth
        issues={[]}
        readyLabel="Ready"
        pendingLabel={(count) => `${count} pending`}
        onOpen={vi.fn()}
        testId="health"
      />,
    );
    const health = container.querySelector('[data-testid="health"]');
    expect(health?.tagName).not.toBe('BUTTON');
    expect(health?.textContent).toContain('Ready');
  });

  it('lists the issues and opens the fixing tab when something is pending', () => {
    const onOpen = vi.fn();
    const container = render(
      <WorkspaceHealth
        issues={[{ label: 'No default image model' }, { label: 'No default video model' }]}
        readyLabel="Ready"
        pendingLabel={(count) => `${count} pending`}
        onOpen={onOpen}
        testId="health"
      />,
    );
    const health = container.querySelector<HTMLButtonElement>('[data-testid="health"]');
    expect(health?.tagName).toBe('BUTTON');
    expect(health?.textContent).toContain('2 pending');
    expect(health?.title).toBe('No default image model\nNo default video model');
    act(() => health?.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
