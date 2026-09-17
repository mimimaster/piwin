// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CodePreviewView } from './code-preview-view.js';
import { globalMemoryGovernor } from './memory-governor.js';
import { HighlightClient } from './syntax/highlight-client.js';
import { MAX_FILE_HIGHLIGHT_CHARS } from './syntax/file-highlight.js';
import type { TokenLine } from './syntax/highlight-protocol.js';

const { highlight, dispose } = vi.hoisted(() => ({ highlight: vi.fn(), dispose: vi.fn() }));
vi.mock('./syntax/highlight-client.js', () => ({
  HighlightClient: vi.fn(function () {
    return { highlight, dispose };
  }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
let intersect: IntersectionObserverCallback;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Worker', class {});
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  highlight.mockImplementation(async ({ code }: { code: string }) =>
    code.split('\n').map((line) => [{ content: line, color: '#abcdef', offset: 0 }]),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalMemoryGovernor.reset();
  vi.unstubAllGlobals();
});

async function render(code: string, filePath = 'large.ts'): Promise<void> {
  await act(async () => root.render(<CodePreviewView code={code} filePath={filePath} />));
}

it('highlights files over 400 lines / 40KB off-thread, keeping colored DOM bounded', async () => {
  const code = Array.from(
    { length: 2000 },
    (_, index) => `const value${index} = "hello world";`,
  ).join('\n');
  await render(code);
  expect(highlight).toHaveBeenCalledWith(expect.objectContaining({ code, language: 'typescript' }));
  expect(container.querySelectorAll('.code-preview-row')).toHaveLength(2000);
  expect(container.querySelectorAll('.code-preview-text [style]')).toHaveLength(80);
  const first = container.querySelector('[data-code-group="0"]');
  const last = container.querySelector('[data-code-group="24"]');
  if (!first || !last) throw new Error('Missing source groups');
  act(() =>
    intersect(
      [
        { target: first, isIntersecting: false },
        { target: last, isIntersecting: true },
      ] as IntersectionObserverEntry[],
      {} as IntersectionObserver,
    ),
  );
  expect(first.querySelectorAll('[style]')).toHaveLength(0);
  expect(last.querySelectorAll('.code-preview-text [style]')).toHaveLength(80);
  expect(container.querySelector('[data-line="2000"]')?.textContent).toContain('value1999');
});

it('paints the head of a long file before the full result arrives', async () => {
  let resolveFull: ((tokens: TokenLine[]) => void) | undefined;
  const code = Array.from({ length: 600 }, (_, index) => `let head${index} = 0;`).join('\n');
  highlight.mockImplementation(({ code: requested }: { code: string }) => {
    const tokens = requested
      .split('\n')
      .map((line) => [{ content: line, color: '#abcdef', offset: 0 }]);
    if (requested === code) {
      return new Promise<TokenLine[]>((resolve) => {
        resolveFull = () => resolve(tokens);
      });
    }
    return Promise.resolve(tokens);
  });
  await render(code, 'head.ts');
  expect(highlight.mock.calls.map(([request]) => request.code.split('\n').length)).toEqual([
    200, 600,
  ]);
  expect(container.querySelectorAll('.code-preview-text [style]')).toHaveLength(80);
  await act(async () => resolveFull?.([]));
  expect(container.querySelectorAll('.code-preview-text [style]')).toHaveLength(80);
});

it('reuses tokens when a recent file is reopened', async () => {
  await render('const reopened = 1;', 'reopen.ts');
  await render('other', 'other.ts');
  highlight.mockClear();
  await render('const reopened = 1;', 'reopen.ts');
  expect(highlight).not.toHaveBeenCalled();
  expect(container.querySelector('.code-preview-text [style]')).not.toBeNull();
});

it('drops stale file results on a file switch without killing the shared worker', async () => {
  let resolveFirst: ((tokens: TokenLine[]) => void) | undefined;
  highlight.mockImplementationOnce(
    () =>
      new Promise<TokenLine[]>((resolve) => {
        resolveFirst = resolve;
      }),
  );
  await render('old source');
  await render('new source', 'new.py');
  await act(async () => resolveFirst?.([[{ content: 'old source', color: '#ff0000', offset: 0 }]]));
  expect(container.textContent).toContain('new source');
  expect(container.textContent).not.toContain('old source');
  expect(highlight.mock.calls[0]?.[0].signal.aborted).toBe(true);
  expect(dispose).not.toHaveBeenCalled();
});

it('defers token removal while a native selection crosses the preview', async () => {
  await render(Array.from({ length: 160 }, (_, index) => `const value${index} = 1;`).join('\n'));
  const first = container.querySelector('[data-code-group="0"]');
  const last = container.querySelector('[data-code-group="1"]');
  const token = first?.querySelector('.code-preview-text span');
  if (!first || !last || !token) throw new Error('Missing colored source');
  const range = document.createRange();
  range.selectNodeContents(token);
  window.getSelection()?.addRange(range);
  act(() =>
    intersect(
      [
        { target: first, isIntersecting: false },
        { target: last, isIntersecting: true },
      ] as IntersectionObserverEntry[],
      {} as IntersectionObserver,
    ),
  );
  expect(first.querySelector('.code-preview-text span')).toBe(token);
  act(() => {
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
  });
  expect(first.querySelector('.code-preview-text span')).toBeNull();
  expect(last.querySelector('.code-preview-text span')).not.toBeNull();
});

it('releases tokens on critical pressure and resumes when pressure clears', async () => {
  await render('const value = 1;');
  expect(container.querySelector('.code-preview-text [style]')).not.toBeNull();
  await act(async () => globalMemoryGovernor.setLevel('critical'));
  expect(container.querySelector('.code-preview-text [style]')).toBeNull();
  expect(container.textContent).toContain('const value = 1;');
  await act(async () => globalMemoryGovernor.setLevel('normal'));
  expect(container.querySelector('.code-preview-text [style]')).not.toBeNull();
});

it('keeps oversized files readable without starting a worker', async () => {
  await render('x'.repeat(MAX_FILE_HIGHLIGHT_CHARS + 1));
  expect(HighlightClient).not.toHaveBeenCalled();
  expect(container.querySelector('.code-preview-text')?.textContent?.length).toBe(
    MAX_FILE_HIGHLIGHT_CHARS + 1,
  );
});
