// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { MarkdownView } from './MarkdownView';
import { createMarkdownBlockIndex } from './markdown-stream-blocks.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('markdown block index', () => {
  it('locates every block in the markdown it was split from', () => {
    const markdown = 'Intro paragraph.\n\n```ts\nconst a = 1;\n```\n\nOutro.';
    const index = createMarkdownBlockIndex();
    const blocks = index.parse(markdown);

    expect(blocks.length).toBeGreaterThan(1);
    blocks.forEach((block, blockIndex) => {
      const start = index.startOffsetOf(blockIndex, block);
      expect(markdown.slice(start, start + block.length)).toBe(block);
    });
    const fenceIndex = blocks.findIndex((block) => block.startsWith('```ts'));
    expect(index.startOffsetOf(fenceIndex, blocks[fenceIndex] ?? '')).toBe(
      markdown.indexOf('```ts'),
    );
  });

  it('resolves a block against the split it was rendered from', () => {
    const index = createMarkdownBlockIndex();
    const before = index.parse('One.\n\nTwo.');
    const tailIndex = before.length - 1;
    // Streamdown still renders `before` for one commit after this split.
    const after = index.parse('One.\n\nTwo and more.\n\nThree.');
    expect(after[tailIndex]).not.toBe(before[tailIndex]);

    expect(index.startOffsetOf(tailIndex, before[tailIndex] ?? '')).toBe('One.\n\n'.length);
    expect(index.startOffsetOf(tailIndex, after[tailIndex] ?? '')).toBe('One.\n\n'.length);
    expect(index.startOffsetOf(0, 'text from neither split')).toBe(0);
  });

  it('returns the same blocks for the same markdown', () => {
    const index = createMarkdownBlockIndex();
    expect(index.parse('A.\n\nB.')).toBe(index.parse('A.\n\nB.'));
  });

  it('keeps a reply with link reference definitions as one document', () => {
    const markdown = 'See [the docs][docs].\n\nMore prose.\n\n[docs]: https://example.com/docs';
    expect(createMarkdownBlockIndex().parse(markdown)).toEqual([markdown]);
  });
});

describe('MarkdownView block-wise streaming', () => {
  let mounted: { container: HTMLElement; root: Root } | null = null;

  function mount(node: ReactElement): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted = { container, root };
    update(node);
    return container;
  }

  function update(node: ReactElement): void {
    act(() => {
      mounted?.root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>,
      );
    });
  }

  afterEach(() => {
    act(() => mounted?.root.unmount());
    mounted?.container.remove();
    mounted = null;
  });

  const origin = { sessionId: 'session-blocks', messageId: 'message-blocks' };
  const twoFences = [
    'Here is the first card.',
    '',
    '```artifact-html title="First"',
    '<section><h1>One</h1></section>',
    '```',
    '',
    'And the second, after some prose.',
    '',
    '```artifact-html title="Second"',
    '<section><h1>Two</h1></section>',
    '```',
    '',
    'Closing words',
  ].join('\n');

  function artifactIds(container: HTMLElement): Array<string | null> {
    return [...container.querySelectorAll('[data-artifact-id]')].map((element) =>
      element.getAttribute('data-artifact-id'),
    );
  }

  it('binds fences behind prose to their canonical ordinals while streaming', () => {
    const container = mount(
      <MarkdownView text={twoFences} renderingPhase="streaming" artifactOrigin={origin} />,
    );

    expect(artifactIds(container)).toEqual([
      'message-blocks-artifact-0',
      'message-blocks-artifact-1',
    ]);
  });

  it('keeps settled blocks mounted as the tail grows and the reply completes', () => {
    const container = mount(
      <MarkdownView text={twoFences} renderingPhase="streaming" artifactOrigin={origin} />,
    );
    const firstParagraph = container.querySelector('p');
    const firstArtifact = container.querySelector('[data-artifact-id="message-blocks-artifact-0"]');
    expect(firstParagraph).not.toBeNull();
    expect(firstArtifact).not.toBeNull();

    update(
      <MarkdownView
        text={`${twoFences} keep arriving.`}
        renderingPhase="streaming"
        artifactOrigin={origin}
      />,
    );
    expect(container.textContent).toContain('Closing words keep arriving.');
    expect(container.querySelector('p')).toBe(firstParagraph);
    expect(container.querySelector('[data-artifact-id="message-blocks-artifact-0"]')).toBe(
      firstArtifact,
    );

    update(
      <MarkdownView
        text={`${twoFences} keep arriving.`}
        renderingPhase="completed"
        artifactOrigin={origin}
      />,
    );
    expect(artifactIds(container)).toEqual([
      'message-blocks-artifact-0',
      'message-blocks-artifact-1',
    ]);
    expect(container.querySelector('[data-artifact-id="message-blocks-artifact-0"]')).toBe(
      firstArtifact,
    );
  });

  it('applies a changed option to a fence in a block no token touched', () => {
    const text = [
      '```artifact-html title="Card"',
      '<section><h1>One</h1></section>',
      '```',
      '',
      'Tail paragraph',
    ].join('\n');
    const container = mount(
      <MarkdownView text={text} renderingPhase="streaming" artifactOrigin={origin} />,
    );
    expect(container.querySelector('[data-testid="code-fence-source"]')).toBeNull();

    // Same text: Streamdown skips the fence's block, so only the options
    // context can carry the switch to it.
    update(
      <MarkdownView
        text={text}
        renderingPhase="streaming"
        artifactOrigin={origin}
        artifactInlineEnabled={false}
        artifactCanvasEnabled={false}
      />,
    );

    expect(container.querySelector('[data-testid="code-fence-source"]')).not.toBeNull();
  });
});
