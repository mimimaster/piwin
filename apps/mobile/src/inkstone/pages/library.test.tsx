// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostPush, HostResponse, MediaLibraryItem } from '@piwin/contracts';
import type { HostClient, HostClientState } from '@piwin/host-client';
import {
  InkstoneHostProvider,
  type InkstoneHost,
  type InkstoneHostContextValue,
} from '../host/inkstone-host-context.js';
import { InkstoneContext } from '../inkstone-context.js';
import { INITIAL_INKSTONE_STATE } from '../inkstone-state.js';
import { LibraryPage } from './library.js';
import { LIBRARY_FAVORITES_STORAGE_KEY } from './library-favorites.js';

let root: Root;
let container: HTMLDivElement;
let mounted: boolean;
let clipboardWrite: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.localStorage.clear();
  // happy-dom has no layout, so its IntersectionObserver never reports
  // intersecting — tiles and the sentinel would never fire. Take the
  // "no observer" path both hooks already handle.
  vi.stubGlobal('IntersectionObserver', undefined);
  clipboardWrite = vi.fn(async () => undefined);
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText: clipboardWrite },
    configurable: true,
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  mounted = true;
});

afterEach(() => {
  if (mounted) act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

function asset(index: number, overrides: Partial<MediaLibraryItem> = {}): MediaLibraryItem {
  return {
    assetId: `asset-${index}`,
    sessionId: 'session-1',
    mimeType: 'image/webp',
    byteSize: 204_800 + index,
    createdAt: new Date(Date.UTC(2026, 10, 2, 9) - index * 86_400_000).toISOString(),
    kind: 'image',
    prompt: `提示词 ${index}`,
    ...overrides,
  };
}

const okList = (items: MediaLibraryItem[], extra: Record<string, unknown> = {}): HostResponse => ({
  type: 'response',
  command: 'media/list',
  success: true,
  data: { items, total: items.length, ...extra },
});

const okRead = (): HostResponse => ({
  type: 'response',
  command: 'media/read',
  success: true,
  data: {
    status: 'ready',
    assetId: 'asset-1',
    sessionId: 'session-1',
    mimeType: 'image/webp',
    byteSize: 1234,
    base64Data: 'AAAA',
  },
});

type Handler = (command: HostCommand) => HostResponse | Promise<HostResponse> | undefined;

type Command = HostCommand;

function makeClient(handler?: Handler, unsupported: Command['type'][] = []) {
  const pushes = new Set<(push: HostPush) => void>();
  const states = new Set<(state: HostClientState) => void>();
  const request = vi.fn(async (command: Command): Promise<HostResponse> => {
    const custom = handler?.(command);
    if (custom !== undefined) return custom;
    if (command.type === 'media/list') return okList([asset(1), asset(2), asset(3)]);
    if (command.type === 'media/read') return okRead();
    throw new Error(`unexpected command ${command.type}`);
  });
  const client = {
    supportsCommand: (type: Command['type']) => !unsupported.includes(type),
    request,
    subscribePush: (listener: (push: HostPush) => void) => {
      pushes.add(listener);
      return () => pushes.delete(listener);
    },
    subscribeState: (listener: (state: HostClientState) => void) => {
      states.add(listener);
      listener({ kind: 'ready' });
      return () => states.delete(listener);
    },
  } as unknown as HostClient;
  return { client, request };
}

async function fixture(handler?: Handler, unsupported: Command['type'][] = []) {
  const transport = makeClient(handler, unsupported);
  const host = {
    client: unsupported.includes('__no-client' as Command['type']) ? undefined : transport.client,
    activeSessionId: 'session-1',
    connectionState: { kind: 'ready' },
  } as unknown as InkstoneHost;
  const dispatch = vi.fn();
  const draw = (): void => {
    root.render(
      <InkstoneContext.Provider value={{ state: INITIAL_INKSTONE_STATE, dispatch }}>
        <InkstoneHostProvider
          value={{ host, onOpenConnection: vi.fn(), modelSelection: {} } as unknown as InkstoneHostContextValue}
        >
          <LibraryPage />
        </InkstoneHostProvider>
      </InkstoneContext.Provider>,
    );
  };
  await act(async () => {
    draw();
  });
  return { ...transport, dispatch };
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.getAttribute('aria-label') === label || item.textContent?.trim() === label,
  );
  if (found === undefined) throw new Error(`missing button ${label}`);
  return found;
}

async function click(label: string): Promise<void> {
  await act(async () => {
    button(label).click();
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function calls(request: ReturnType<typeof makeClient>['request'], type: Command['type']): Command[] {
  return request.mock.calls.map(([command]) => command).filter((command) => command.type === type);
}

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('资料库 page', () => {
  it('lists Host assets with a poster read per tile and no client-side paging guess', async () => {
    const view = await fixture();
    await flush();
    expect(calls(view.request, 'media/list')[0]).toEqual({
      type: 'media/list',
      input: { limit: 24 },
    });
    expect(container.textContent).toContain('提示词 1');
    expect(container.textContent).toContain('Host 资料库 · 3 项');
    expect(container.textContent).toContain('共 3 项 · 已到底');
    const reads = calls(view.request, 'media/read');
    expect(reads.length).toBeGreaterThan(0);
    expect(reads[0]).toMatchObject({
      type: 'media/read',
      input: { sessionId: 'session-1', assetId: 'asset-1', variant: 'thumb', thumbEdge: 384 },
    });
  });

  it('asks the Host for the kind behind each tab instead of filtering locally', async () => {
    const view = await fixture();
    await flush();
    await click('视频');
    await flush();
    const last = calls(view.request, 'media/list').at(-1);
    expect(last).toMatchObject({ type: 'media/list', input: { kind: 'video', limit: 24 } });
    await click('图片');
    await flush();
    expect(calls(view.request, 'media/list').at(-1)).toMatchObject({ input: { kind: 'image' } });
  });

  it('keeps 收藏 on the phone: starring one asset stores it and filters the tab', async () => {
    const view = await fixture();
    await flush();
    await click('收藏 提示词 1');
    expect(JSON.parse(globalThis.localStorage.getItem(LIBRARY_FAVORITES_STORAGE_KEY) ?? '[]')).toEqual([
      'session-1:asset-1',
    ]);
    await click('收藏');
    await flush();
    expect(container.textContent).toContain('提示词 1');
    expect(container.textContent).not.toContain('提示词 2');
    // 收藏 never asks the Host for a kind, only for its own pages.
    expect(calls(view.request, 'media/list').at(-1)).toMatchObject({ input: { limit: 24 } });
  });

  it('scans further pages when the favorite sits past the first page', async () => {
    globalThis.localStorage.setItem(LIBRARY_FAVORITES_STORAGE_KEY, JSON.stringify(['session-1:asset-9']));
    const view = await fixture((command) => {
      if (command.type !== 'media/list') return undefined;
      if (command.input.cursor === undefined) {
        return okList([asset(1), asset(2)], { total: 3, nextCursor: 'cursor-2' });
      }
      return okList([asset(9)], { total: 3 });
    });
    await flush();
    await click('收藏');
    await flush();
    await flush();
    expect(calls(view.request, 'media/list').at(-1)).toMatchObject({
      type: 'media/list',
      input: { limit: 24, cursor: 'cursor-2' },
    });
    expect(container.textContent).toContain('提示词 9');
  });

  it('sends the debounced search text to the Host', async () => {
    vi.useFakeTimers();
    const view = await fixture();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    await click('搜索资料库');
    const input = container.querySelector<HTMLInputElement>('input[aria-label="搜索资料库"]');
    expect(input).not.toBeNull();
    if (input === null) return;
    typeInto(input, '墨色');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(calls(view.request, 'media/list').at(-1)).toMatchObject({
      type: 'media/list',
      input: { limit: 24, query: '墨色' },
    });
  });

  it('opens a full-screen preview from the Host and copies the prompt', async () => {
    const view = await fixture();
    await flush();
    await click('打开 提示词 1');
    await flush();
    const full = calls(view.request, 'media/read').filter(
      (command) => command.type === 'media/read' && command.input.variant === 'full',
    );
    expect(full).toHaveLength(1);
    const dialog = container.querySelector('dialog.lib-viewer');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('提示词 1');
    expect(dialog?.textContent).toContain('1 / 3');
    await click('复制提示词');
    await flush();
    expect(clipboardWrite).toHaveBeenCalledWith('提示词 1');
    expect(view.dispatch).toHaveBeenCalledWith({ type: 'toast', message: '提示词已复制' });
  });

  it('follows the cursor for more pages and keeps the earlier tiles', async () => {
    const view = await fixture((command) => {
      if (command.type !== 'media/list') return undefined;
      if (command.input.cursor === undefined) {
        return okList([asset(1), asset(2)], { total: 3, nextCursor: 'cursor-2' });
      }
      return okList([asset(3)], { total: 3 });
    });
    await flush();
    await click('加载更多');
    await flush();
    expect(calls(view.request, 'media/list').at(-1)).toMatchObject({ input: { cursor: 'cursor-2' } });
    expect(container.textContent).toContain('提示词 1');
    expect(container.textContent).toContain('提示词 3');
    expect(container.textContent).toContain('共 3 项 · 已到底');
  });

  it('explains a Host without the library command instead of reporting an error', async () => {
    const view = await fixture(undefined, ['media/list']);
    await flush();
    expect(calls(view.request, 'media/list')).toHaveLength(0);
    expect(container.textContent).toContain('这个 Host 还没有资料库接口');
    expect(container.textContent).toContain('更新并重启 Host');
  });

  it('shows the Host failure and retries on demand', async () => {
    let attempts = 0;
    await fixture((command) => {
      if (command.type !== 'media/list') return undefined;
      attempts += 1;
      if (attempts === 1) {
        return { type: 'response', command: 'media/list', success: false, error: 'Host transport is not open' };
      }
      return okList([asset(1)]);
    });
    await flush();
    expect(container.textContent).toContain('读不到资料库');
    expect(container.textContent).toContain('连接已断开');
    await click('重新读取');
    await flush();
    expect(container.textContent).toContain('提示词 1');
  });
});
