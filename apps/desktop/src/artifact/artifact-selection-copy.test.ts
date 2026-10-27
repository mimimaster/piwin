// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { copyArtifactSelectionText } from './artifact-selection-copy.js';

type CopyLog = { data: Map<string, string>; prevented: boolean };

function copyEvent(): { event: Parameters<typeof copyArtifactSelectionText>[0]; log: CopyLog } {
  const log: CopyLog = { data: new Map(), prevented: false };
  const clipboardData = {
    setData: (type: string, value: string) => log.data.set(type, value),
  } as unknown as DataTransfer;
  return {
    event: {
      clipboardData,
      preventDefault: () => {
        log.prevented = true;
      },
    },
    log,
  };
}

function mountArtifact(): { shadow: ShadowRoot; text: Text; outside: Text } {
  const outsideParagraph = document.createElement('p');
  outsideParagraph.textContent = 'transcript prose';
  const host = document.createElement('div');
  document.body.append(outsideParagraph, host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = '.card { color: red; }';
  const card = document.createElement('div');
  card.className = 'card';
  card.textContent = 'Encrypted content';
  shadow.append(style, card);
  const text = card.firstChild;
  const outside = outsideParagraph.firstChild;
  if (!(text instanceof Text) || !(outside instanceof Text)) {
    throw new Error('expected text nodes');
  }
  return { shadow, text, outside };
}

function selectionOf(
  boundary: { startContainer: Node; startOffset: number; endContainer: Node; endOffset: number },
  laidOut: string,
): Selection {
  return {
    rangeCount: 1,
    getRangeAt: () => {
      throw new Error('composed path only');
    },
    getComposedRanges: () => [boundary],
    toString: () => laidOut,
  } as unknown as Selection;
}

describe('copyArtifactSelectionText', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('puts only the selected words on the clipboard as plain text', () => {
    const { shadow, text } = mountArtifact();
    const selection = selectionOf(
      { startContainer: text, startOffset: 0, endContainer: text, endOffset: 9 },
      'Encrypted',
    );
    const { event, log } = copyEvent();

    expect(copyArtifactSelectionText(event, shadow, selection)).toBe(true);
    expect([...log.data.entries()]).toEqual([['text/plain', 'Encrypted']]);
    expect(log.prevented).toBe(true);
  });

  it('walks visible text when the engine re-scopes toString to the host', () => {
    const { shadow, text } = mountArtifact();
    const selection = selectionOf(
      { startContainer: text, startOffset: 10, endContainer: text, endOffset: 17 },
      '',
    );
    const { event, log } = copyEvent();

    expect(copyArtifactSelectionText(event, shadow, selection)).toBe(true);
    expect(log.data.get('text/plain')).toBe('content');
  });

  it('leaves a selection that starts outside the Artifact to the native copy', () => {
    const { shadow, text, outside } = mountArtifact();
    const selection = selectionOf(
      { startContainer: outside, startOffset: 0, endContainer: text, endOffset: 9 },
      'transcript prose Encrypted',
    );
    const { event, log } = copyEvent();

    expect(copyArtifactSelectionText(event, shadow, selection)).toBe(false);
    expect(log.data.size).toBe(0);
    expect(log.prevented).toBe(false);
  });
});
