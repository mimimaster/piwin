import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AbortOperationError,
  BrowserSessionError,
  BrowserStaleTargetError,
  NavigateError,
} from './browser-errors.js';
import {
  createBrowserOperations,
  isValidBrowserKey,
  type BrowserOperationsDeps,
} from './browser-operations.js';
import { createBrowserSession } from './browser-session.js';

const launchMock = vi.hoisted(() => vi.fn());

vi.mock('playwright-core', () => ({
  chromium: { launchPersistentContext: launchMock },
}));

function createPage() {
  const locator = {
    ariaSnapshot: vi.fn().mockResolvedValue('- document [ref=e1]'),
    click: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    selectOption: vi.fn().mockResolvedValue(undefined),
    setChecked: vi.fn().mockResolvedValue(undefined),
    setInputFiles: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    isVisible: vi.fn().mockResolvedValue(true),
  };
  return {
    locator: vi.fn().mockReturnValue(locator),
    goto: vi.fn().mockResolvedValue(null),
    keyboard: {
      type: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
      up: vi.fn().mockResolvedValue(undefined),
      insertText: vi.fn().mockResolvedValue(undefined),
      press: vi.fn().mockResolvedValue(undefined),
    },
    mouse: {
      wheel: vi.fn().mockResolvedValue(undefined),
      move: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
      up: vi.fn().mockResolvedValue(undefined),
    },
    url: vi.fn().mockResolvedValue('https://example.com'),
    title: vi.fn().mockResolvedValue('Example'),
    viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 800 }),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('jpeg')),
    goBack: vi.fn().mockResolvedValue(null),
    goForward: vi.fn().mockResolvedValue(null),
    getByText: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
    setViewportSize: vi.fn().mockResolvedValue(undefined),
    locatorHandle: locator,
  };
}

function createOps(page = createPage(), overrides: Partial<BrowserOperationsDeps> = {}) {
  const deps: BrowserOperationsDeps = {
    getPage: vi.fn().mockResolvedValue(page),
    peekPage: vi.fn().mockReturnValue(page),
    pageId: vi.fn().mockReturnValue('p-1'),
    emitState: vi.fn().mockResolvedValue(undefined),
    requestFrame: vi.fn().mockResolvedValue(undefined),
    assertActor: vi.fn(),
    maxDimension: 1280,
    ...overrides,
  };
  return {
    ops: createBrowserOperations(deps),
    page,
    deps,
  };
}

describe('createBrowserOperations timeouts and actionability', () => {
  it('navigates with a 15s timeout and domcontentloaded', async () => {
    const { ops, page } = createOps();
    await ops.navigate('https://example.com/path');
    expect(page.goto).toHaveBeenCalledWith('https://example.com/path', {
      timeout: 15_000,
      waitUntil: 'domcontentloaded',
    });
  });

  it('clicks with an 8s timeout and does not force through overlays', async () => {
    const { ops, page } = createOps();
    await ops.click('e5');
    expect(page.locator).toHaveBeenCalledWith('aria-ref=e5');
    expect(page.locatorHandle.click).toHaveBeenCalledTimes(1);
    expect(page.locatorHandle.click).toHaveBeenCalledWith({ timeout: 8_000 });
    expect(page.locatorHandle.click.mock.calls[0]?.[0]).not.toMatchObject({ force: true });
  });

  it('hovers, selects, and checks with the action timeout', async () => {
    const { ops, page } = createOps();
    await ops.hover('#menu');
    await ops.selectOption('#sel', ['one', 'two']);
    await ops.setChecked('#box', true);
    expect(page.locatorHandle.hover).toHaveBeenCalledWith({ timeout: 8_000 });
    expect(page.locatorHandle.selectOption).toHaveBeenCalledWith(['one', 'two'], { timeout: 8_000 });
    expect(page.locatorHandle.setChecked).toHaveBeenCalledWith(true, { timeout: 8_000 });
  });

  it('uploads an existing Host file path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-ops-upload-'));
    const path = join(dir, 'file.txt');
    await writeFile(path, 'data');
    const { ops, page } = createOps();
    await ops.uploadFiles('#file', [path]);
    expect(page.locatorHandle.setInputFiles).toHaveBeenCalledWith([path], { timeout: 8_000 });
  });

  it('types after an 8s click timeout without forcing', async () => {
    const { ops, page } = createOps();
    await ops.type('e15', 'hello');
    expect(page.locatorHandle.click).toHaveBeenCalledWith({ timeout: 8_000 });
    expect(page.locatorHandle.click.mock.calls[0]?.[0]).not.toMatchObject({ force: true });
    expect(page.keyboard.type).toHaveBeenCalledWith('hello');
  });
});

describe('createBrowserOperations abort between side effects', () => {
  it('does not fill later fields after abort', async () => {
    const { ops, page } = createOps();
    const abort = new AbortController();
    page.locatorHandle.fill.mockImplementation(async () => {
      abort.abort();
    });

    await expect(
      ops.fillForm({ e1: 'one', e2: 'two' }, { signal: abort.signal }),
    ).rejects.toBeInstanceOf(AbortOperationError);
    expect(page.locatorHandle.fill).toHaveBeenCalledTimes(1);
    expect(page.locatorHandle.fill).toHaveBeenCalledWith('one', { timeout: 8_000 });
  });

  it('does not type after aborting the preceding click', async () => {
    const { ops, page } = createOps();
    const abort = new AbortController();
    page.locatorHandle.click.mockImplementation(async () => {
      abort.abort();
    });

    await expect(ops.type('e1', 'hello', { signal: abort.signal })).rejects.toBeInstanceOf(
      AbortOperationError,
    );
    expect(page.keyboard.type).not.toHaveBeenCalled();
  });

  it('does not dispatch later input events after abort', async () => {
    const { ops, page } = createOps();
    const abort = new AbortController();
    page.mouse.move.mockImplementation(async () => {
      abort.abort();
    });

    await expect(
      ops.dispatchEvents(
        [
          { type: 'mouse', action: 'move', x: 1, y: 1 },
          { type: 'mouse', action: 'down', x: 1, y: 1 },
        ],
        abort.signal,
      ),
    ).rejects.toBeInstanceOf(AbortOperationError);
    expect(page.mouse.down).not.toHaveBeenCalled();
  });

  it('does not start fillForm when the signal is already aborted', async () => {
    const { ops, page, deps } = createOps();
    const abort = new AbortController();
    abort.abort();
    await expect(ops.fillForm({ e1: 'one' }, { signal: abort.signal })).rejects.toBeInstanceOf(
      AbortOperationError,
    );
    expect(deps.getPage).not.toHaveBeenCalled();
    expect(page.locatorHandle.fill).not.toHaveBeenCalled();
  });
});

describe('createBrowserOperations wait', () => {
  it('aborts a pending wait without waiting for the delay', async () => {
    const { ops } = createOps();
    const abort = new AbortController();
    const waiting = ops.wait(5_000, abort.signal);
    abort.abort();
    await expect(waiting).rejects.toBeInstanceOf(AbortOperationError);
  });
});

describe('createBrowserOperations reload / pressKey / waitFor / viewport', () => {
  it('reloads the live URL after identity checks and does not force click', async () => {
    const { ops, page } = createOps();
    await ops.reload({ expectedUrl: 'https://example.com', expectedPageId: 'p-1' });
    expect(page.goto).toHaveBeenCalledWith('https://example.com', {
      timeout: 15_000,
      waitUntil: 'domcontentloaded',
    });
  });

  it('does not launch when reload has no open page', async () => {
    const { ops, page, deps } = createOps(createPage(), {
      peekPage: vi.fn().mockReturnValue(undefined),
    });
    await expect(ops.reload()).rejects.toBeInstanceOf(NavigateError);
    expect(deps.getPage).not.toHaveBeenCalled();
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('returns stale-target when the URL changed after permission', async () => {
    const { ops, page } = createOps();
    await expect(
      ops.reload({ expectedUrl: 'https://other.example/', expectedPageId: 'p-1' }),
    ).rejects.toBeInstanceOf(BrowserStaleTargetError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('presses a named key', async () => {
    const { ops, page } = createOps();
    await ops.pressKey('Enter');
    expect(page.keyboard.press).toHaveBeenCalledWith('Enter');
  });

  it('rejects an invalid key before touching the page', async () => {
    const { ops, deps } = createOps();
    await expect(ops.pressKey('not a key')).rejects.toBeInstanceOf(BrowserSessionError);
    expect(deps.getPage).not.toHaveBeenCalled();
  });

  it('wait_for does not call getPage and does not treat a navigation as success', async () => {
    const page = createPage();
    let url = 'https://example.com/start';
    page.url = vi.fn().mockImplementation(() => url);
    page.getByText = vi.fn().mockReturnValue({
      count: vi.fn().mockImplementation(async () => {
        url = 'https://example.com/navigated';
        return 1;
      }),
    });
    const { ops, deps } = createOps(page);
    await expect(ops.waitFor({ text: 'Hello' }, { timeoutMs: 200 })).rejects.toBeInstanceOf(
      BrowserStaleTargetError,
    );
    expect(deps.getPage).not.toHaveBeenCalled();
  });

  it('wait_for succeeds when text is already present on the same URL', async () => {
    const page = createPage();
    page.getByText = vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(1) });
    const { ops } = createOps(page);
    await ops.waitFor({ text: 'Hello' }, { timeoutMs: 50 });
  });

  it('queryViewport reads the page without launching', () => {
    const { ops, deps } = createOps();
    expect(ops.queryViewport()).toEqual({ width: 1280, height: 800 });
    expect(deps.getPage).not.toHaveBeenCalled();
  });

  it('queryViewport returns undefined when Chromium is not launched', () => {
    const { ops, deps } = createOps(createPage(), {
      peekPage: vi.fn().mockReturnValue(undefined),
    });
    expect(ops.queryViewport()).toBeUndefined();
    expect(deps.getPage).not.toHaveBeenCalled();
  });
});

describe('isValidBrowserKey', () => {
  it('accepts named keys and modifier chords', () => {
    expect(isValidBrowserKey('Enter')).toBe(true);
    expect(isValidBrowserKey('Tab')).toBe(true);
    expect(isValidBrowserKey('Escape')).toBe(true);
    expect(isValidBrowserKey('Control+l')).toBe(true);
    expect(isValidBrowserKey('Shift+Tab')).toBe(true);
    expect(isValidBrowserKey('a')).toBe(true);
  });

  it('rejects empty, whitespace, and unknown chords', () => {
    expect(isValidBrowserKey('')).toBe(false);
    expect(isValidBrowserKey('Control+')).toBe(false);
    expect(isValidBrowserKey('not a key')).toBe(false);
  });
});

describe('session status does not launch', () => {
  beforeEach(() => {
    launchMock.mockReset();
  });

  it('status does not increment the launch mock', () => {
    const session = createBrowserSession({ profileDir: '/tmp/piwin-browser-status-test' });
    const status = session.status();
    expect(status.lifecycle).toBe('stopped');
    expect(status.generation).toBe(0);
    expect(launchMock).not.toHaveBeenCalled();
  });
});
