/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ArtifactLayoutBadge, artifactLayoutFixProposal } from './artifact-layout-badge.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let mounted: { container: HTMLElement; root: Root } | null = null;

function render(element: React.ReactElement): HTMLElement {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  mounted = { container, root };
  return container;
}

afterEach(() => {
  if (!mounted) return;
  const { container, root } = mounted;
  act(() => root.unmount());
  container.remove();
  mounted = null;
});

describe('ArtifactLayoutBadge', () => {
  it('stays hidden for a healthy artifact', () => {
    const container = render(<ArtifactLayoutBadge shatteredText={0} locale="zh-CN" />);
    expect(container.querySelector('[data-testid="artifact-layout-badge"]')).toBeNull();
  });

  it('drafts a fix request in the composer instead of sending or rewriting anything', () => {
    const onComposerProposal = vi.fn();
    const container = render(
      <ArtifactLayoutBadge shatteredText={2} locale="en" onComposerProposal={onComposerProposal} />,
    );
    expect(container.querySelector('[data-testid="artifact-layout-badge"]')?.textContent).toContain(
      'Some text is squeezed into a narrow column',
    );
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="artifact-layout-fix"]')?.click();
    });
    expect(onComposerProposal).toHaveBeenCalledExactlyOnceWith(artifactLayoutFixProposal('en'));
    expect(artifactLayoutFixProposal('zh-CN').text).toContain('包进同一个子元素');
  });
});
