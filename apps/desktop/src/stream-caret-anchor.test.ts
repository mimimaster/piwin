// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { resolveStreamCaretAnchor } from './stream-caret-anchor.js';

function render(html: string): Element {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('resolveStreamCaretAnchor', () => {
  it('anchors on a trailing paragraph or heading', () => {
    expect(resolveStreamCaretAnchor(render('<p>one</p><p id="t">two <code>x</code></p>'))?.id).toBe('t');
    expect(resolveStreamCaretAnchor(render('<p>one</p><h2 id="t">Title</h2>'))?.id).toBe('t');
  });

  it('follows a list down to its last item, through nesting and loose paragraphs', () => {
    expect(
      resolveStreamCaretAnchor(render('<ul><li>a</li><li id="t">b <strong>c</strong></li></ul>'))?.id,
    ).toBe('t');
    expect(
      resolveStreamCaretAnchor(
        render('<ol><li>a<ul><li>x</li><li id="t">y</li></ul></li></ol>'),
      )?.id,
    ).toBe('t');
    expect(
      resolveStreamCaretAnchor(render('<ul><li><p>a</p><p id="t">b</p></li></ul>'))?.id,
    ).toBe('t');
  });

  it('anchors in the last cell of a table that is still growing', () => {
    const root = render(
      '<div class="md-table-wrapper"><table><thead><tr><th>A</th><th>B</th></tr></thead>' +
        '<tbody><tr><td>1</td><td>2</td></tr><tr><td id="t">3</td></tr></tbody></table></div>',
    );
    expect(resolveStreamCaretAnchor(root)?.id).toBe('t');
  });

  it('anchors on the text of the last code line, past the header and toggle', () => {
    const root = render(
      '<div class="md-code-block"><div class="md-code-header"><span>ts</span></div>' +
        '<div class="collapsible-content-block"><div><pre class="md-code"><div>' +
        '<div class="md-code-line"><span class="md-code-line-num">1</span><span class="md-code-line-text">a</span></div>' +
        '<div class="md-code-line"><span class="md-code-line-num">2</span><span class="md-code-line-text" id="t">b</span></div>' +
        '</div></pre></div><button type="button">toggle</button></div></div>',
    );
    expect(resolveStreamCaretAnchor(root)?.id).toBe('t');
  });

  it('leaves a rendered widget alone and reports no anchor for an empty reply', () => {
    expect(
      resolveStreamCaretAnchor(render('<p>before</p><div class="artifact-frame"><div>chrome</div></div>')),
    ).toBeNull();
    expect(resolveStreamCaretAnchor(render('<p>before</p><div class="md-mermaid"><div></div></div>'))).toBeNull();
    expect(resolveStreamCaretAnchor(render(''))).toBeNull();
  });

  it('skips hidden trailing blocks', () => {
    expect(
      resolveStreamCaretAnchor(render('<p id="t">text</p><div hidden><p>x</p></div><div aria-hidden="true"></div>'))?.id,
    ).toBe('t');
  });
});
