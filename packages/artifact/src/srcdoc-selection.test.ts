import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_BRIDGE_SELECTION_CLEAR_TYPE,
  ARTIFACT_BRIDGE_SELECTION_TYPE,
  ARTIFACT_SELECTION_MAX_CHARS,
} from './constants.js';
import { parseArtifactSelectionMessage } from './bridge-protocol.js';
import { buildSelectionRuntime } from './srcdoc-selection.js';

type Box = { left: number; top: number; width: number; height: number; bottom: number };
type FakeSelection = {
  text: string;
  box: Box;
  removed: boolean;
};

function box(left: number, top: number, width: number, height: number): Box {
  return { left, top, width, height, bottom: top + height };
}

function runRuntime(frameMode: 'canvas' | 'inline-flow' = 'canvas') {
  const posts: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const timers: Array<() => void> = [];
  const documentListeners = new Map<string, Array<(event: unknown) => void>>();
  const messageListeners: Array<(event: { data: unknown }) => void> = [];
  const selection: FakeSelection = { text: '', box: box(0, 0, 0, 0), removed: false };
  const fakeSelection = {
    get isCollapsed() {
      return selection.text.length === 0;
    },
    get rangeCount() {
      return selection.text.length === 0 ? 0 : 1;
    },
    toString: () => selection.text,
    getRangeAt: () => ({
      getBoundingClientRect: () => selection.box,
      getClientRects: () => [selection.box],
    }),
    removeAllRanges: () => {
      selection.text = '';
      selection.removed = true;
    },
  };
  const fakeDocument = {
    documentElement: { clientHeight: 600 },
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      documentListeners.set(type, [...(documentListeners.get(type) ?? []), listener]);
    },
  };
  const fakeWindow = {
    innerHeight: 600,
    getSelection: () => fakeSelection,
    addEventListener: (type: string, listener: (event: { data: unknown }) => void) => {
      if (type === 'message') messageListeners.push(listener);
    },
  };
  const run = new Function(
    'document',
    'window',
    'post',
    'channelId',
    'currentFrameMode',
    'setTimeout',
    'clearTimeout',
    buildSelectionRuntime(),
  ) as (...args: unknown[]) => void;
  run(
    fakeDocument,
    fakeWindow,
    (type: string, payload: Record<string, unknown>) => posts.push({ type, payload }),
    'channel-1',
    frameMode,
    (callback: () => void) => {
      timers.push(callback);
      return timers.length;
    },
    () => undefined,
  );
  const fire = (type: string, event: unknown = {}): void => {
    for (const listener of documentListeners.get(type) ?? []) listener(event);
    for (const callback of timers.splice(0)) callback();
  };
  return {
    posts,
    selection,
    fire,
    message: (data: unknown) => {
      for (const listener of messageListeners) listener({ data });
    },
  };
}

describe('Canvas selection runtime', () => {
  it('reports the selected text and the box of its first line on mouseup', () => {
    const runtime = runRuntime();
    runtime.selection.text = 'quoted words';
    runtime.selection.box = box(10, 20, 80, 16);
    runtime.fire('mouseup');
    expect(runtime.posts).toEqual([
      {
        type: ARTIFACT_BRIDGE_SELECTION_TYPE,
        payload: { text: 'quoted words', rect: { left: 10, top: 20, width: 80, height: 16 } },
      },
    ]);
  });

  it('clears once when the selection collapses, and stays quiet afterwards', () => {
    const runtime = runRuntime();
    runtime.selection.text = 'quoted';
    runtime.selection.box = box(0, 0, 10, 10);
    runtime.fire('mouseup');
    runtime.selection.text = '';
    runtime.fire('selectionchange');
    runtime.fire('mouseup');
    expect(runtime.posts.map((post) => post.payload['text'])).toEqual(['quoted', '']);
  });

  it('drops the report when the selection scrolls out of view', () => {
    const runtime = runRuntime();
    runtime.selection.text = 'quoted';
    runtime.selection.box = box(0, 100, 10, 10);
    runtime.fire('mouseup');
    runtime.selection.box = box(0, -50, 10, 10);
    runtime.fire('scroll');
    expect(runtime.posts.at(-1)?.payload).toEqual({ text: '', rect: null });
  });

  it('clips text to the protocol ceiling', () => {
    const runtime = runRuntime();
    runtime.selection.text = 'x'.repeat(ARTIFACT_SELECTION_MAX_CHARS + 5);
    runtime.selection.box = box(0, 0, 10, 10);
    runtime.fire('mouseup');
    expect(String(runtime.posts[0]?.payload['text']).length).toBe(ARTIFACT_SELECTION_MAX_CHARS);
  });

  it('stays silent outside canvas frame mode', () => {
    const runtime = runRuntime('inline-flow');
    runtime.selection.text = 'quoted';
    runtime.selection.box = box(0, 0, 10, 10);
    runtime.fire('mouseup');
    expect(runtime.posts).toEqual([]);
  });

  it('removes the document selection when the host asks on its channel only', () => {
    const runtime = runRuntime();
    runtime.selection.text = 'quoted';
    runtime.message({ type: ARTIFACT_BRIDGE_SELECTION_CLEAR_TYPE, channelId: 'other' });
    expect(runtime.selection.removed).toBe(false);
    runtime.message({ type: ARTIFACT_BRIDGE_SELECTION_CLEAR_TYPE, channelId: 'channel-1' });
    expect(runtime.selection.removed).toBe(true);
  });
});

describe('parseArtifactSelectionMessage', () => {
  const base = { type: ARTIFACT_BRIDGE_SELECTION_TYPE, channelId: 'channel-1' };

  it('accepts a selection with a finite rect', () => {
    expect(
      parseArtifactSelectionMessage({ ...base, text: 'hi', rect: { left: 1, top: 2, width: 3, height: 4 } }),
    ).toEqual({ ...base, text: 'hi', rect: { left: 1, top: 2, width: 3, height: 4 } });
  });

  it('normalizes blank text to a clear', () => {
    expect(parseArtifactSelectionMessage({ ...base, text: '   ', rect: null })).toEqual({
      ...base,
      text: '',
      rect: null,
    });
  });

  it('rejects oversized text, missing or absurd rects, and foreign types', () => {
    const rect = { left: 0, top: 0, width: 1, height: 1 };
    expect(
      parseArtifactSelectionMessage({ ...base, text: 'x'.repeat(ARTIFACT_SELECTION_MAX_CHARS + 1), rect }),
    ).toBeNull();
    expect(parseArtifactSelectionMessage({ ...base, text: 'hi' })).toBeNull();
    expect(parseArtifactSelectionMessage({ ...base, text: 'hi', rect: { ...rect, top: 1e9 } })).toBeNull();
    expect(parseArtifactSelectionMessage({ ...base, text: 'hi', rect: { ...rect, left: Number.NaN } })).toBeNull();
    expect(parseArtifactSelectionMessage({ ...base, type: 'piwin-artifact:scroll', text: 'hi', rect })).toBeNull();
    expect(parseArtifactSelectionMessage({ ...base, channelId: '', text: 'hi', rect })).toBeNull();
  });
});
