import { describe, expect, it, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';
import type { BrowserRuntime } from './browser-runtime.js';
import type { BrowserControllerHandle } from './controller.js';
import { createExclusiveQueue } from './mutex.js';
import { createBrowserSessionResidency } from './browser-session-residency.js';

function fixture() {
  const conditions = { resident: true, visible: false, agent: false, dialog: false,
    download: false, attached: false, headless: true, pageCount: 1, checkpointable: true, now: 1000 };
  const page = {
    url: () => 'https://fixture.invalid/read-only',
    evaluate: vi.fn(async () => conditions.checkpointable),
    goto: vi.fn(async () => undefined),
  };
  const context = { pages: () => Array.from({ length: conditions.pageCount }, () => page as unknown as Page) };
  const runtime = {
    isClosed: () => false,
    peekPage: () => conditions.resident ? page as unknown as Page : undefined,
    peekContext: () => conditions.resident ? context as unknown as BrowserContext : undefined,
    lifecycle: () => conditions.resident ? 'ready' : 'stopped',
    ownership: () => conditions.attached ? 'attached' : 'owned',
    hasActiveMirrorLease: () => conditions.visible,
    hasPendingDownloads: () => conditions.download,
    pendingDialog: () => conditions.dialog ? {} : undefined,
    getPage: vi.fn(async () => { conditions.resident = true; return page as unknown as Page; }),
    releaseRuntime: vi.fn(async () => { conditions.resident = false; }),
  } as unknown as BrowserRuntime;
  const controller = { snapshot: () => ({ owner: conditions.agent ? 'agent' : 'idle',
    agentWantsLock: conditions.agent }) } as unknown as BrowserControllerHandle;
  const changed = vi.fn(async () => undefined);
  const residency = createBrowserSessionResidency({ runtime, controller,
    runExclusive: createExclusiveQueue().runExclusive, now: () => conditions.now,
    headless: () => conditions.headless, onStateChange: changed });
  return { conditions, page, runtime, residency, changed };
}

describe('browser idle residency', () => {
  it('suspends only an eligible idle runtime and restores its URL on the next page request', async () => {
    const { residency, runtime, page } = fixture();
    expect(residency.snapshot()).toMatchObject({ resident: true, eligible: true, lastUsedAtMs: 1000 });
    expect(await residency.suspendIdle(1000)).toEqual({ suspended: true });
    expect(runtime.releaseRuntime).toHaveBeenCalledOnce();
    expect(residency.snapshot().resident).toBe(false);
    await residency.getPage();
    expect(page.goto).toHaveBeenCalledWith('https://fixture.invalid/read-only', expect.any(Object));
  });
  it.each([
    ['visible', 'visible'], ['agent', 'agent'], ['dialog', 'dialog'],
    ['download', 'download'], ['attached', 'external'],
  ] as const)('protects %s resources', async (condition, reason) => {
    const { conditions, residency, runtime } = fixture();
    conditions[condition] = true;
    expect(await residency.suspendIdle(1000)).toEqual({ suspended: false, reason });
    expect(runtime.releaseRuntime).not.toHaveBeenCalled();
  });
  it('protects non-headless owned browsers that may have direct human interaction', async () => {
    const { conditions, residency } = fixture();
    conditions.headless = false;
    expect(await residency.suspendIdle(1000)).toMatchObject({ suspended: false, reason: 'external' });
  });
  it('protects interactions until a document replacement resets their lifetime', async () => {
    const { residency } = fixture();
    residency.noteInteraction();
    expect(await residency.suspendIdle(1000)).toMatchObject({ suspended: false, reason: 'interaction' });
    residency.noteDocumentChange();
    expect(await residency.suspendIdle(1000)).toEqual({ suspended: true });
  });
  it('does not discard multiple tabs or a page with unsaved form state', async () => {
    const { conditions, residency } = fixture();
    conditions.pageCount = 2;
    expect(await residency.suspendIdle(1000)).toMatchObject({ suspended: false, reason: 'page-state' });
    conditions.pageCount = 1;
    conditions.checkpointable = false;
    expect(await residency.suspendIdle(1000)).toMatchObject({ suspended: false, reason: 'page-state' });
  });
  it('protects unknown page eligibility instead of treating inspection failure as permission to close', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { page, residency, runtime } = fixture();
      page.evaluate.mockRejectedValueOnce(new Error('document unavailable'));
      expect(await residency.suspendIdle(1000)).toMatchObject({ suspended: false, reason: 'page-state' });
      expect(runtime.releaseRuntime).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });
  it('rechecks queued work after the asynchronous page inspection', async () => {
    const { page, residency, runtime } = fixture();
    let finishInspection: (allowed: boolean) => void = () => { throw new Error('not initialized'); };
    page.evaluate.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finishInspection = resolve; }));
    const suspension = residency.suspendIdle(1000);
    await vi.waitFor(() => expect(page.evaluate).toHaveBeenCalled());
    const operation = residency.runOperation(async () => 'new work');
    finishInspection(true);
    expect(await suspension).toMatchObject({ suspended: false, reason: 'busy' });
    expect(await operation).toBe('new work');
    expect(runtime.releaseRuntime).not.toHaveBeenCalled();
  });
  it('updates idle age after actual operations, including failed operations', async () => {
    const { conditions, residency } = fixture();
    conditions.now = 2000;
    await expect(residency.runOperation(async () => { throw new Error('operation failed'); })).rejects.toThrow('operation failed');
    expect(residency.snapshot().lastUsedAtMs).toBe(2000);
    expect(await residency.suspendIdle(1500)).toMatchObject({ suspended: false, reason: 'recently-used' });
  });
  it('retains the restoration checkpoint after failure and retries honestly', async () => {
    const { residency, page } = fixture();
    await residency.suspendIdle(1000);
    page.goto.mockRejectedValueOnce(new Error('restore failed'));
    await expect(residency.getPage()).rejects.toThrow('restore failed');
    expect(residency.snapshot()).toMatchObject({ eligible: false, protection: 'restoring' });
    await residency.getPage();
    expect(page.goto).toHaveBeenCalledTimes(2);
  });
});
