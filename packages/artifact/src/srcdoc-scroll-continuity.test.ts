import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_BRIDGE_RETIRE_TYPE,
  ARTIFACT_BRIDGE_SCROLL_RESTORE_TYPE,
  ARTIFACT_BRIDGE_SCROLL_TYPE,
} from './constants.js';
import { parseArtifactScrollMessage } from './bridge-protocol.js';
import { buildScrollContinuityRuntime } from './srcdoc-scroll-continuity.js';

type FakeNode = {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
  overflowY: string;
  children: FakeNode[];
  isConnected: boolean;
  scrollTo: (options: { top: number }) => void;
};

function createNode(input: Partial<FakeNode> = {}): FakeNode {
  const node: FakeNode = {
    scrollHeight: 0,
    clientHeight: 0,
    scrollTop: 0,
    overflowY: 'visible',
    children: [],
    isConnected: true,
    scrollTo: ({ top }) => {
      node.scrollTop = top;
    },
    ...input,
  };
  return node;
}

function runRuntime(body: FakeNode): {
  posts: Array<{ type: string; payload: { top: number; restored: boolean } }>;
  scroll: () => void;
  message: (data: unknown) => void;
  flushTimers: () => void;
  isRetired: () => boolean;
} {
  const posts: Array<{ type: string; payload: { top: number; restored: boolean } }> = [];
  const timers: Array<() => void> = [];
  const documentListeners: Array<() => void> = [];
  const messageListeners: Array<(event: { data: unknown }) => void> = [];
  const fakeDocument = {
    scrollingElement: null,
    documentElement: createNode(),
    body,
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'scroll') documentListeners.push(listener);
    },
  };
  const fakeWindow = {
    getComputedStyle: (node: FakeNode) => ({ overflowY: node.overflowY }),
    addEventListener: (type: string, listener: (event: { data: unknown }) => void) => {
      if (type === 'message') messageListeners.push(listener);
    },
  };
  const run = new Function(
    'document',
    'window',
    'post',
    'channelId',
    'setTimeout',
    `var retired = false;${buildScrollContinuityRuntime()}; return function () { return retired; };`,
  ) as (...args: unknown[]) => () => boolean;
  const isRetired = run(
    fakeDocument,
    fakeWindow,
    (type: string, payload: { top: number; restored: boolean }) => posts.push({ type, payload }),
    'channel-1',
    (callback: () => void) => {
      timers.push(callback);
      return timers.length;
    },
  );
  return {
    posts,
    scroll: () => documentListeners.forEach((listener) => listener()),
    message: (data) => messageListeners.forEach((listener) => listener({ data })),
    flushTimers: () => {
      while (timers.length > 0) timers.shift()?.();
    },
    isRetired,
  };
}

describe('buildScrollContinuityRuntime', () => {
  it('is syntactically valid inside the bridge scope', () => {
    expect(
      () => new Function('post', 'channelId', `var retired;${buildScrollContinuityRuntime()}`),
    ).not.toThrow();
  });

  it('reports the scroll offset of body in a stream shell, once per gesture', () => {
    const body = createNode({ scrollHeight: 2000, clientHeight: 800, overflowY: 'auto' });
    const session = runRuntime(body);
    body.scrollTop = 640;
    session.scroll();
    session.scroll();
    session.flushTimers();
    expect(session.posts).toEqual([
      { type: ARTIFACT_BRIDGE_SCROLL_TYPE, payload: { top: 640, restored: false } },
    ]);
  });

  it('restores into the author stage when the document scrolls there instead of body', () => {
    const stage = createNode({ scrollHeight: 1900, clientHeight: 800, overflowY: 'auto' });
    const body = createNode({ scrollHeight: 800, clientHeight: 800, overflowY: 'auto', children: [stage] });
    const session = runRuntime(body);
    session.message({ type: ARTIFACT_BRIDGE_SCROLL_RESTORE_TYPE, channelId: 'channel-1', top: 640 });
    expect(stage.scrollTop).toBe(640);
    expect(session.posts.at(-1)).toEqual({
      type: ARTIFACT_BRIDGE_SCROLL_TYPE,
      payload: { top: 640, restored: true },
    });
  });

  it('waits for late layout, then clamps to what the document can scroll', () => {
    const stage = createNode({ scrollHeight: 800, clientHeight: 800, overflowY: 'auto' });
    const body = createNode({ scrollHeight: 800, clientHeight: 800, children: [stage] });
    const session = runRuntime(body);
    session.message({ type: ARTIFACT_BRIDGE_SCROLL_RESTORE_TYPE, channelId: 'channel-1', top: 900 });
    expect(session.posts).toEqual([]);
    stage.scrollHeight = 1300;
    session.flushTimers();
    expect(stage.scrollTop).toBe(500);
    expect(session.posts.at(-1)?.payload).toEqual({ top: 500, restored: true });
  });

  it('acknowledges a restore even when nothing can scroll', () => {
    const session = runRuntime(createNode({ scrollHeight: 400, clientHeight: 800 }));
    session.message({ type: ARTIFACT_BRIDGE_SCROLL_RESTORE_TYPE, channelId: 'channel-1', top: 300 });
    session.flushTimers();
    expect(session.posts.at(-1)?.payload).toEqual({ top: 0, restored: true });
  });

  it('ignores other channels and retires on request', () => {
    const body = createNode({ scrollHeight: 2000, clientHeight: 800, overflowY: 'auto' });
    const session = runRuntime(body);
    session.message({ type: ARTIFACT_BRIDGE_SCROLL_RESTORE_TYPE, channelId: 'other', top: 300 });
    session.message({ type: ARTIFACT_BRIDGE_RETIRE_TYPE, channelId: 'other' });
    expect(body.scrollTop).toBe(0);
    expect(session.isRetired()).toBe(false);
    session.message({ type: ARTIFACT_BRIDGE_RETIRE_TYPE, channelId: 'channel-1' });
    expect(session.isRetired()).toBe(true);
  });
});

describe('parseArtifactScrollMessage', () => {
  it('accepts a report and rounds the offset', () => {
    expect(
      parseArtifactScrollMessage({ type: ARTIFACT_BRIDGE_SCROLL_TYPE, channelId: 'c', top: 12.6, restored: true }),
    ).toEqual({ type: ARTIFACT_BRIDGE_SCROLL_TYPE, channelId: 'c', top: 13, restored: true });
  });

  it('rejects malformed offsets and foreign message types', () => {
    expect(parseArtifactScrollMessage({ type: ARTIFACT_BRIDGE_SCROLL_TYPE, channelId: 'c', top: -1 })).toBeNull();
    expect(parseArtifactScrollMessage({ type: ARTIFACT_BRIDGE_SCROLL_TYPE, channelId: '', top: 1 })).toBeNull();
    expect(parseArtifactScrollMessage({ type: 'piwin-artifact:size', channelId: 'c', top: 1 })).toBeNull();
  });
});
