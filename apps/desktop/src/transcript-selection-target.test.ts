// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { ContextMenuTarget } from './context-menu/types.js';
import {
  computeTranscriptSelectionTarget,
  formatTranscriptSelectionLabel,
  looksLikeSerializedHtml,
  resolveBubbleContextMenuTarget,
  resolveCodeFenceContextMenuTarget,
  stripSerializedHtml,
  TRANSCRIPT_SELECTION_MAX_CHARS,
} from './transcript-selection-target.js';

const messageTarget: ContextMenuTarget = {
  surface: 'message-assistant',
  sessionId: 's1',
  messageId: 'm1',
  text: 'hello world',
  label: 'Assistant response',
  capabilities: { canRetry: false, canFork: true, canSideChat: true },
};

function selectInside(textNode: Text, start: number, end: number): Selection {
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);
  const selection = window.getSelection();
  if (!selection) {
    throw new Error('expected window.getSelection');
  }
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

describe('computeTranscriptSelectionTarget', () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  it('returns null for a collapsed selection', () => {
    const bubble = document.createElement('article');
    bubble.textContent = 'hello';
    document.body.appendChild(bubble);
    const text = bubble.firstChild;
    if (!(text instanceof Text)) {
      throw new Error('expected text node');
    }
    const selection = selectInside(text, 1, 1);
    expect(computeTranscriptSelectionTarget(bubble, selection)).toBeNull();
  });

  it('returns null when the selection is outside the bubble', () => {
    const bubble = document.createElement('article');
    const other = document.createElement('div');
    other.textContent = 'outside';
    bubble.textContent = 'inside';
    document.body.appendChild(bubble);
    document.body.appendChild(other);
    const text = other.firstChild;
    if (!(text instanceof Text)) {
      throw new Error('expected text node');
    }
    const selection = selectInside(text, 0, 7);
    expect(computeTranscriptSelectionTarget(bubble, selection)).toBeNull();
  });

  it('returns a selection target without a file path', () => {
    const bubble = document.createElement('article');
    bubble.textContent = 'the number 42 is fine';
    document.body.appendChild(bubble);
    const text = bubble.firstChild;
    if (!(text instanceof Text)) {
      throw new Error('expected text node');
    }
    const selection = selectInside(text, 11, 13);
    expect(computeTranscriptSelectionTarget(bubble, selection)).toEqual({
      surface: 'selection',
      selectedText: '42',
      label: '42',
    });
  });

  it('truncates selected text at 8000 characters', () => {
    const bubble = document.createElement('article');
    const body = 'x'.repeat(TRANSCRIPT_SELECTION_MAX_CHARS + 20);
    bubble.textContent = body;
    document.body.appendChild(bubble);
    const text = bubble.firstChild;
    if (!(text instanceof Text)) {
      throw new Error('expected text node');
    }
    const selection = selectInside(text, 0, body.length);
    const target = computeTranscriptSelectionTarget(bubble, selection);
    expect(target?.surface).toBe('selection');
    expect(target && 'selectedText' in target ? target.selectedText : '').toHaveLength(
      TRANSCRIPT_SELECTION_MAX_CHARS,
    );
  });

  it('uses the first line, truncated, as the label', () => {
    expect(formatTranscriptSelectionLabel('  hello   world  \nsecond')).toBe('hello world');
    expect(formatTranscriptSelectionLabel(`${'a'.repeat(60)}\nmore`)).toBe(
      `${'a'.repeat(47)}…`,
    );
    expect(formatTranscriptSelectionLabel(':host { color: red; }')).toBe('selection');
  });

  it('returns null when the selection lives inside a code fence', () => {
    const bubble = document.createElement('article');
    const fence = document.createElement('pre');
    fence.className = 'md-code-block';
    fence.textContent = 'const x = 1;';
    bubble.appendChild(fence);
    document.body.appendChild(bubble);
    const text = fence.firstChild;
    if (!(text instanceof Text)) {
      throw new Error('expected text node');
    }
    const selection = selectInside(text, 0, 5);
    expect(computeTranscriptSelectionTarget(bubble, selection)).toBeNull();
  });

  it('falls back to the message target when there is no usable selection', () => {
    const bubble = document.createElement('article');
    bubble.textContent = 'hello';
    document.body.appendChild(bubble);
    expect(resolveBubbleContextMenuTarget(bubble, messageTarget, null)).toBe(messageTarget);
  });

  it('uses visible Artifact text when the light-DOM range wraps the shadow host', () => {
    const bubble = document.createElement('article');
    const host = document.createElement('div');
    host.className = 'artifact-static';
    bubble.appendChild(host);
    document.body.appendChild(bubble);
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host { color: red; }';
    const root = document.createElement('div');
    root.textContent = 'Hello card';
    shadow.append(style, root);
    const range = document.createRange();
    range.selectNode(host);
    const selection = window.getSelection();
    if (!selection) {
      throw new Error('expected window.getSelection');
    }
    selection.removeAllRanges();
    selection.addRange(range);
    expect(computeTranscriptSelectionTarget(bubble, selection)).toEqual({
      surface: 'selection',
      selectedText: 'Hello card',
      label: 'Hello card',
    });
  });

  it('keeps only visible text when a selection includes Artifact style tags', () => {
    const bubble = document.createElement('article');
    const host = document.createElement('div');
    host.className = 'artifact-static';
    bubble.appendChild(host);
    document.body.appendChild(bubble);
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host { color: red; } h1 { font-size: 24px; }';
    const root = document.createElement('div');
    root.textContent = 'Hello card';
    shadow.append(style, root);
    const text = root.firstChild;
    if (!(text instanceof Text)) {
      throw new Error('expected artifact text');
    }
    const selection = selectInside(text, 0, 10);
    expect(computeTranscriptSelectionTarget(bubble, selection)).toEqual({
      surface: 'selection',
      selectedText: 'Hello card',
      label: 'Hello card',
    });
  });

  it('does not snapshot fence HTML when Artifact preview has a live selection', () => {
    const host = document.createElement('div');
    const preview = document.createElement('div');
    preview.className = 'artifact-preview-surface';
    const card = document.createElement('div');
    card.textContent = 'visible title';
    preview.appendChild(card);
    host.appendChild(preview);
    document.body.appendChild(host);
    const text = card.firstChild;
    if (!(text instanceof Text)) {
      throw new Error('expected preview text');
    }
    const selection = selectInside(text, 0, 13);
    expect(
      resolveCodeFenceContextMenuTarget(
        host,
        '<div style="color:red"><h1>visible title</h1></div>',
        'html',
        selection,
      ),
    ).toEqual({
      surface: 'selection',
      selectedText: 'visible title',
      label: 'visible title',
    });
  });

  it('keeps the code-block source when the fence has no live selection', () => {
    const host = document.createElement('div');
    host.textContent = '';
    document.body.appendChild(host);
    expect(resolveCodeFenceContextMenuTarget(host, '<h1>card</h1>', 'html', null)).toEqual({
      surface: 'code-block',
      selectedText: '<h1>card</h1>',
      label: 'html',
    });
  });

  it('strips serialized HTML that leaked into a selection snapshot', () => {
    expect(looksLikeSerializedHtml('<div style="color:red">Hello</div>')).toBe(true);
    expect(stripSerializedHtml('<div style="color:red">Hello</div>')).toBe('Hello');
    expect(looksLikeSerializedHtml('use <div> as a wrapper')).toBe(false);
  });
});
