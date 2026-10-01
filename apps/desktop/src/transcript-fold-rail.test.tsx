// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranscriptFoldRail } from './transcript-fold-rail.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function place(element: Element, top: number): void {
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(
    () => ({ top, bottom: top, left: 0, right: 0, width: 0, height: 0 }) as DOMRect,
  );
}

function addFold(
  stream: HTMLElement,
  id: string,
  level: 'turn' | 'segment',
  title: string,
  headerTop: number,
  endTop: number,
): HTMLButtonElement {
  const header = document.createElement('button');
  header.dataset.foldHeader = id;
  header.dataset.foldOpen = 'true';
  header.dataset.foldLevel = level;
  header.dataset.foldTitle = title;
  header.dataset.foldMeta = '9 个工具';
  const end = document.createElement('span');
  end.dataset.foldEnd = id;
  stream.append(header, end);
  place(header, headerTop);
  place(end, endTop);
  return header;
}

describe('TranscriptFoldRail', () => {
  let shell: HTMLDivElement;
  let stream: HTMLDivElement;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    shell = document.createElement('div');
    shell.className = 'transcript-viewport';
    stream = document.createElement('div');
    stream.className = 'chat-stream';
    place(stream, 0);
    Object.defineProperty(stream, 'scrollTop', { value: 0, writable: true });
    host = document.createElement('div');
    shell.append(stream, host);
    document.body.appendChild(shell);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    shell.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderRail(): void {
    act(() =>
      root.render(
        <TranscriptFoldRail
          scrollElementRef={{ current: stream }}
          beginProgrammaticScroll={() => undefined}
          locale="zh-CN"
        />,
      ),
    );
  }

  it('shows nothing while every open fold still has its header on screen', () => {
    addFold(stream, 'turn:a', 'turn', '已工作 3h', 10, 900);
    renderRail();
    expect(host.querySelector('[data-testid="transcript-fold-rail"]')).toBeNull();
  });

  it('pins the enclosing folds, outermost first, once their headers scrolled away', () => {
    addFold(stream, 'turn:a', 'turn', '已工作 3h 8m 50s', -600, 1500);
    addFold(stream, 'segment:s2', 'segment', '站点的 Agent 分类已实现', -200, 800);
    renderRail();
    const rows = host.querySelectorAll('[data-testid="transcript-fold-rail-row"]');
    expect(Array.from(rows, (row) => row.getAttribute('data-fold-level'))).toEqual([
      'turn',
      'segment',
    ]);
    expect(rows[0]?.textContent).toContain('已工作 3h 8m 50s');
    expect(rows[1]?.textContent).toContain('站点的 Agent 分类已实现');
    expect(rows[1]?.textContent).toContain('9 个工具');
    expect(rows[1]?.textContent).toContain('收起');
  });

  it('collapses through the real header when a row is clicked', () => {
    addFold(stream, 'turn:a', 'turn', '已工作 3h', -600, 1500);
    const segmentHeader = addFold(stream, 'segment:s2', 'segment', '第二步', -200, 800);
    const clicked = vi.fn();
    segmentHeader.addEventListener('click', clicked);
    renderRail();
    const rows = host.querySelectorAll<HTMLButtonElement>('[data-testid="transcript-fold-rail-row"]');
    act(() => rows[1]?.click());
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('Esc collapses the innermost fold from the transcript, but never from a composer', () => {
    addFold(stream, 'turn:a', 'turn', '已工作 3h', -600, 1500);
    const segmentHeader = addFold(stream, 'segment:s2', 'segment', '第二步', -200, 800);
    const clicked = vi.fn();
    segmentHeader.addEventListener('click', clicked);
    renderRail();

    const composer = document.createElement('textarea');
    document.body.appendChild(composer);
    act(() => {
      composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(clicked).not.toHaveBeenCalled();
    composer.remove();

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(clicked).toHaveBeenCalledTimes(1);
  });
});
