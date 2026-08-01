// @vitest-environment happy-dom
/**
 * WebElementChip tests (ADR 0020 §6).
 *
 * Verifies the composer/chat chip for a picked web element renders URL +
 * selector + bounded text — distinct from the image-specific MediaPreview
 * which resolves a media `path` to a thumbnail.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { WebElementAttachmentRef } from '@piwin/contracts';
import { WebElementChip } from './WebElementChip';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function makeAttachment(
  overrides: Partial<WebElementAttachmentRef> = {},
): WebElementAttachmentRef {
  return {
    id: 'we-1',
    kind: 'web-element',
    url: 'http://localhost:3000/dashboard',
    selector: 'button.submit',
    text: 'Submit form',
    ...overrides,
  };
}

describe('WebElementChip', () => {
  let container: HTMLElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  function renderChip(attachment: WebElementAttachmentRef): void {
    const tree: ReactElement = <WebElementChip attachment={attachment} compact />;
    act(() => {
      root.render(tree);
    });
  }

  it('renders the shortened URL, selector, and text', () => {
    renderChip(makeAttachment());
    const chip = document.querySelector<HTMLElement>('[data-testid="web-element-chip"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('localhost:3000/dashboard');
    expect(chip?.textContent).toContain('button.submit');
    expect(chip?.textContent).toContain('Submit form');
  });

  it('truncates long text to a bounded preview', () => {
    const longText = 'A'.repeat(200);
    renderChip(makeAttachment({ text: longText }));
    const chip = document.querySelector<HTMLElement>('[data-testid="web-element-chip"]');
    // 60 chars + ellipsis marker
    expect(chip?.textContent).toContain('…');
    expect(chip?.textContent?.length ?? 0).toBeLessThan(longText.length + 100);
  });

  it('does not render a screenshot thumbnail when screenshotPath is absent', () => {
    renderChip(makeAttachment());
    const thumb = document.querySelector<HTMLImageElement>('.web-element-chip-thumb');
    expect(thumb).toBeNull();
  });

  it('omits the text line when text is empty', () => {
    renderChip(makeAttachment({ text: '' }));
    const chip = document.querySelector<HTMLElement>('[data-testid="web-element-chip"]');
    expect(chip?.querySelector('.web-element-chip-text')).toBeNull();
  });
});
