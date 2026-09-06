// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PromptContextRef, MediaAttachmentRef } from '@piwin/contracts';
import { MessageAttachments } from './message-attachments';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderComponent(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { container, root };
}

describe('MessageAttachments', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
  });

  it('returns null when there are no attachments and no context refs', () => {
    const rendered = renderComponent(<MessageAttachments attachments={[]} />);
    root = rendered.root;
    container = rendered.container;
    expect(container.firstChild).toBeNull();
  });

  it('renders context refs chips when contextRefs are provided', () => {
    const contextRefs: PromptContextRef[] = [
      {
        kind: 'selection',
        relativePath: 'src/integration.test.ts',
        lineStart: 10,
        lineEnd: 25,
        snapshotText: 'test code snippet',
        label: 'integration.test.ts',
      },
    ];

    const rendered = renderComponent(
      <MessageAttachments attachments={[]} contextRefs={contextRefs} role="user" />,
    );
    root = rendered.root;
    container = rendered.container;

    const refsBox = container.querySelector('[data-testid="message-context-refs"]');
    expect(refsBox).not.toBeNull();
    const chip = container.querySelector('[data-testid="transcript-att-chip"]');
    expect(chip?.getAttribute('data-att-variant')).toBe('mention');
    expect(container.textContent).toContain('@ integration.test.ts');
  });

  it('renders both context refs and media attachments together', () => {
    const contextRefs: PromptContextRef[] = [
      {
        kind: 'file',
        projectPath: '/test/proj',
        relativePath: 'src/index.ts',
        lineStart: 1,
        lineEnd: 5,
        label: 'src/index.ts',
      },
    ];

    const attachments: MediaAttachmentRef[] = [
      {
        id: 'att-1',
        kind: 'media',
        mimeType: 'image/png',
        path: '/tmp/piwin/media/session-1/screen.png',
        byteSize: 1024,
        source: 'paste',
      },
    ];

    const rendered = renderComponent(
      <MessageAttachments attachments={attachments} contextRefs={contextRefs} role="user" />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="message-context-refs"]')).not.toBeNull();
    expect(container.textContent).toContain('index.ts');
    expect(container.textContent).toContain('screen.png');
    const variants = [...container.querySelectorAll('[data-testid="transcript-att-chip"]')].map(
      (node) => node.getAttribute('data-att-variant'),
    );
    expect(variants).toContain('file');
    expect(variants).toContain('image');
    expect(container.querySelector('[data-testid="message-attachments"]')).not.toBeNull();
  });
});
