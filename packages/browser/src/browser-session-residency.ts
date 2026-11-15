/** Browser-owned eligibility, mutex rechecks, and bounded URL-only restoration. */
import type { Page } from 'playwright-core';
import type { BrowserIdleSuspensionResult, BrowserResidencyProtection, BrowserResidencySnapshot } from '@piwin/contracts';
import type { BrowserRuntime } from './browser-runtime.js';
import type { BrowserControllerHandle } from './controller.js';
import type { RunExclusive } from './mutex.js';

export function createBrowserSessionResidency(deps: {
  runtime: BrowserRuntime;
  controller: BrowserControllerHandle;
  runExclusive: RunExclusive;
  headless: () => boolean;
  isProtected?: () => boolean;
  now?: () => number;
  onStateChange: () => Promise<void>;
}) {
  const now = deps.now ?? Date.now;
  let lastUsedAtMs = now();
  let pendingOperations = 0;
  let interacted = false;
  let unknownPageState = false;
  let checkpoint: string | undefined;
  let restoring: Promise<Page> | undefined;

  function protection(): BrowserResidencyProtection | undefined {
    const runtime = deps.runtime;
    if (pendingOperations > 0 || deps.isProtected?.() === true) return 'busy';
    if (restoring !== undefined || (checkpoint !== undefined && runtime.peekPage() !== undefined)) return 'restoring';
    if (runtime.hasActiveMirrorLease()) return 'visible';
    const controller = deps.controller.snapshot();
    if (controller.owner !== 'idle' || controller.agentWantsLock) return 'agent';
    if (runtime.pendingDialog() !== undefined) return 'dialog';
    if (runtime.hasPendingDownloads()) return 'download';
    if (runtime.ownership() !== 'owned' || !deps.headless()) return 'external';
    if (interacted) return 'interaction';
    if (unknownPageState || (runtime.peekContext()?.pages().length ?? 0) !== 1) return 'page-state';
    return undefined;
  }

  function snapshot(): BrowserResidencySnapshot {
    const runtime = deps.runtime;
    const resident = !runtime.isClosed() && (runtime.peekContext() !== undefined ||
      runtime.peekPage() !== undefined || runtime.lifecycle() === 'starting' || runtime.lifecycle() === 'recovering');
    const reason = resident ? protection() : undefined;
    return { resident, lastUsedAtMs, eligible: resident && reason === undefined,
      ...(reason === undefined ? {} : { protection: reason }) };
  }

  function trackOperation<T>(operation: () => Promise<T>): Promise<T> {
    pendingOperations += 1;
    lastUsedAtMs = now();
    const finished = (): void => {
      pendingOperations -= 1;
      lastUsedAtMs = now();
    };
    try { return operation().finally(finished); }
    catch (error) { finished(); return Promise.reject(error); }
  }

  function getPage(): Promise<Page> {
    lastUsedAtMs = now();
    if (restoring !== undefined) return restoring;
    if (checkpoint === undefined) return deps.runtime.getPage();
    const url = checkpoint;
    const pending = (async () => {
      const page = await deps.runtime.getPage();
      await page.goto(url, { timeout: 15_000, waitUntil: 'domcontentloaded' });
      checkpoint = undefined;
      await deps.onStateChange();
      return page;
    })();
    restoring = pending;
    return pending.finally(() => {
      if (restoring === pending) restoring = undefined;
    });
  }

  function refusal(idleBeforeMs: number): BrowserIdleSuspensionResult | undefined {
    const current = snapshot();
    if (!current.resident) return { suspended: false, reason: 'not-resident' };
    if (current.protection !== undefined) return { suspended: false, reason: current.protection };
    if (current.lastUsedAtMs > idleBeforeMs) return { suspended: false, reason: 'recently-used' };
    return undefined;
  }

  return {
    snapshot, trackOperation, getPage,
    runOperation: <T>(operation: () => Promise<T>, signal?: AbortSignal) =>
      trackOperation(() => deps.runExclusive(operation, signal)),
    async restoreIfNeeded(): Promise<void> {
      if (checkpoint !== undefined || restoring !== undefined) await getPage();
    },
    noteInteraction(): void { interacted = true; },
    noteDocumentChange(): void { interacted = false; unknownPageState = false; },
    // A new navigation may fail without replacing the current document. Only
    // an observed document change (or explicit restart) clears its protections.
    discardCheckpoint(): void { checkpoint = undefined; },
    suspendIdle(idleBeforeMs: number): Promise<BrowserIdleSuspensionResult> {
      return deps.runExclusive(async () => {
        const refused = refusal(idleBeforeMs);
        if (refused !== undefined) return refused;
        const page = deps.runtime.peekPage();
        if (page === undefined) return { suspended: false, reason: 'not-resident' };
        let url: string;
        try {
          url = await Promise.resolve(page.url());
          if (url.length > 8192 || !/^(https?:\/\/|about:blank$)/.test(url) ||
              await page.evaluate<boolean>(BROWSER_PAGE_CHECKPOINTABILITY_SCRIPT) !== true) {
            unknownPageState = true;
            return { suspended: false, reason: 'page-state' };
          }
        } catch (error) {
          console.warn('[browser] idle page inspection unavailable', error);
          unknownPageState = true;
          return { suspended: false, reason: 'page-state' };
        }
        // New work can queue while evaluate runs. Eligibility and age belong
        // to this same browser-bus transaction, immediately before shutdown.
        const rechecked = refusal(idleBeforeMs);
        if (rechecked !== undefined) return rechecked;
        checkpoint = url;
        await deps.runtime.releaseRuntime();
        await deps.onStateChange();
        return { suspended: true };
      });
    },
  };
}

/** Runs inside the page; no Host objects, dependencies, or form values escape. */
const BROWSER_PAGE_CHECKPOINTABILITY_SCRIPT = String.raw`(() => {
  const fields = document.querySelectorAll('input,textarea,select,[contenteditable="true"]');
  if (fields.length > 256) return false;
  for (const field of fields) {
    if (field instanceof HTMLInputElement) {
      if (field.value !== field.defaultValue || field.checked !== field.defaultChecked ||
          (field.files?.length ?? 0) > 0) return false;
    } else if (field instanceof HTMLTextAreaElement) {
      if (field.value !== field.defaultValue) return false;
    } else if (field instanceof HTMLSelectElement) {
      const options = [...field.options];
      if (options.some((option) => option.defaultSelected)) {
        if (options.some((option) => option.selected !== option.defaultSelected)) return false;
      } else if (field.selectedIndex > 0) return false;
    } else if (field.textContent?.trim()) return false;
  }
  for (const media of document.querySelectorAll('audio,video')) {
    if (media instanceof HTMLMediaElement && !media.paused && !media.ended) return false;
  }
  return true;
})()`;
