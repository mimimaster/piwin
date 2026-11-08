// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { globalMemoryGovernor } from './memory-governor';
import { hasDisposableCache, registerDisposableCache } from './cache-budget';
import { globalHighlightCache } from '../syntax/highlight-cache';
import { shouldHighlightCode } from '../markdown/syntax-highlight';
import {
  clearMermaidDiagramCacheForTests,
  getMermaidDiagramCacheStats,
  readMermaidDiagramSvg,
  rememberMermaidDiagramSvg,
} from '../markdown/mermaid-diagram-cache';
import {
  acquireMediaPreviewUrl,
  getMediaPreviewUrlCacheStats,
  releaseMediaPreviewUrl,
  resetMediaPreviewUrlCacheForTests,
} from '../media/media-preview-url-cache';
import {
  resetArtifactMediaDataUrlCacheForTests,
  trimArtifactMediaDataUrlCache,
} from '../artifact/artifact-session-media';
import {
  createEmptyWarmSessionCache,
  putWarmSessionSnapshot,
  registerWarmCache,
} from '../session/session-warm-cache';
import type { ChatMessageUi } from '../conversation/chat-reducer.js';

describe('MemoryGovernor degradation & recovery', () => {
  it('defaults to normal pressure level', () => {
    globalMemoryGovernor.reset();
    expect(globalMemoryGovernor.getLevel()).toBe('normal');
    expect(globalMemoryGovernor.isHighlightDisabled()).toBe(false);
  });

  it('purges highlight cache when moderate pressure occurs', () => {
    globalMemoryGovernor.reset();
    globalHighlightCache.set('k1', [[{ content: 'test', offset: 0 }]], 20);
    expect(globalHighlightCache.getEntryCount()).toBe(1);

    globalMemoryGovernor.setLevel('moderate');
    expect(globalMemoryGovernor.getLevel()).toBe('moderate');
    expect(globalHighlightCache.getEntryCount()).toBe(0);
  });

  it('switches to safe mode (plain text fallback) on critical pressure', () => {
    globalMemoryGovernor.reset();
    expect(shouldHighlightCode('const a = 1;')).toBe(true);

    globalMemoryGovernor.setLevel('critical');
    expect(globalMemoryGovernor.getLevel()).toBe('critical');
    expect(globalMemoryGovernor.isHighlightDisabled()).toBe(true);
    // Should immediately disable syntax highlighting
    expect(shouldHighlightCode('const a = 1;')).toBe(false);

    // Recovers when pressure returns to normal
    globalMemoryGovernor.reset();
    expect(globalMemoryGovernor.isHighlightDisabled()).toBe(false);
    expect(shouldHighlightCode('const a = 1;')).toBe(true);
  });

  it('tags the document root so the degradation stylesheet engages', () => {
    globalMemoryGovernor.reset();
    expect(document.documentElement.dataset.memoryPressure).toBeUndefined();

    globalMemoryGovernor.setLevel('moderate');
    expect(document.documentElement.dataset.memoryPressure).toBe('moderate');

    globalMemoryGovernor.setLevel('critical');
    expect(document.documentElement.dataset.memoryPressure).toBe('critical');

    globalMemoryGovernor.reset();
    expect(document.documentElement.dataset.memoryPressure).toBeUndefined();
  });

  it('notifies registered listeners of level changes', () => {
    globalMemoryGovernor.reset();
    const levels: string[] = [];
    const unsubscribe = globalMemoryGovernor.subscribe((level) => {
      levels.push(level);
    });

    globalMemoryGovernor.setLevel('moderate');
    globalMemoryGovernor.setLevel('critical');
    globalMemoryGovernor.reset();

    unsubscribe();
    globalMemoryGovernor.setLevel('moderate');

    expect(levels).toEqual(['moderate', 'critical', 'normal']);
  });
});

describe('MemoryGovernor cache budgets (S05)', () => {
  let revoked: string[];
  let unregisterWarm: (() => void) | null;
  let warmCache: ReturnType<typeof createEmptyWarmSessionCache>;

  function msg(id: string, text: string): ChatMessageUi {
    return {
      id,
      role: 'user',
      text,
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
    };
  }

  beforeEach(() => {
    globalMemoryGovernor.reset();
    globalHighlightCache.restoreDefaultBudget();
    globalHighlightCache.clear();
    clearMermaidDiagramCacheForTests();
    resetMediaPreviewUrlCacheForTests();
    resetArtifactMediaDataUrlCacheForTests();
    revoked = [];
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
      revoked.push(String(url));
    });
    warmCache = createEmptyWarmSessionCache();
    unregisterWarm = registerWarmCache({
      get: () => warmCache,
      set: (next) => {
        warmCache = next;
      },
    });
  });

  afterEach(() => {
    unregisterWarm?.();
    unregisterWarm = null;
    globalMemoryGovernor.reset();
    globalHighlightCache.restoreDefaultBudget();
    clearMermaidDiagramCacheForTests();
    resetMediaPreviewUrlCacheForTests();
    resetArtifactMediaDataUrlCacheForTests();
    vi.restoreAllMocks();
  });

  it('every named cache self-registers with the governor', () => {
    for (const name of [
      'warmSessions',
      'highlightCache',
      'mermaidDiagrams',
      'mediaPreviewUrls',
      'artifactMediaDataUrls',
    ]) {
      expect(hasDisposableCache(name)).toBe(true);
    }
  });

  it('canAdmitDisposable is true only at normal pressure', () => {
    expect(globalMemoryGovernor.canAdmitDisposable()).toBe(true);
    globalMemoryGovernor.setLevel('moderate');
    expect(globalMemoryGovernor.canAdmitDisposable()).toBe(false);
    globalMemoryGovernor.setLevel('critical');
    expect(globalMemoryGovernor.canAdmitDisposable()).toBe(false);
    globalMemoryGovernor.reset();
    expect(globalMemoryGovernor.canAdmitDisposable()).toBe(true);
  });

  it('moderate clears highlight contents and caps its refill at 2 MiB', () => {
    const tokens = [[{ content: 'a'.repeat(50), offset: 0 }]];
    globalHighlightCache.set('k1', tokens, 80);
    globalMemoryGovernor.setLevel('moderate');
    expect(globalHighlightCache.getEntryCount()).toBe(0);

    // Refill under the reclaim budget (2 MiB): a 10 MiB-estimated entry is
    // rejected while small entries are admitted again.
    globalHighlightCache.set('small', tokens, 80);
    expect(globalHighlightCache.get('small')).not.toBeNull();
    globalHighlightCache.set('huge', [[{ content: 'b'.repeat(50), offset: 0 }]], 2 * 1024 * 1024);
    expect(globalHighlightCache.get('huge')).toBeNull();
  });

  it('moderate→critical drives every registered trim', async () => {
    // Fill each cache to a visible level.
    warmCache = putWarmSessionSnapshot(warmCache, {
      sessionId: 'warm-1',
      messages: [msg('m1', 'warm')],
      transcriptWindow: null,
      outline: [],
      runRecordsById: {},
      walkthroughsByMessageId: {},
      contextUsage: null,
      touchedAt: Date.now() - 200,
    });
    warmCache = putWarmSessionSnapshot(warmCache, {
      sessionId: 'warm-2',
      messages: [msg('m2', 'warmer')],
      transcriptWindow: null,
      outline: [],
      runRecordsById: {},
      walkthroughsByMessageId: {},
      contextUsage: null,
      touchedAt: Date.now() - 100,
    });
    rememberMermaidDiagramSvg('graph TD', 'dark', '<svg>1</svg>');
    const held = await acquireMediaPreviewUrl('media-1', async () => 'blob:media-1');
    releaseMediaPreviewUrl(held);

    expect(warmCache.order).toHaveLength(2);
    expect(getMermaidDiagramCacheStats().svgEntries).toBe(1);
    expect(getMediaPreviewUrlCacheStats().idle).toBe(1);

    // Moderate: warm union trims to 1, mermaid flushes, idle tail revoked.
    globalMemoryGovernor.setLevel('moderate');
    expect(warmCache.order).toEqual(['warm-2']);
    expect(getMermaidDiagramCacheStats().svgEntries).toBe(0);
    expect(getMediaPreviewUrlCacheStats().idle).toBe(0);
    expect(revoked).toContain('blob:media-1');

    // Refill to prove the refill caps hold, then go critical.
    warmCache = putWarmSessionSnapshot(warmCache, {
      sessionId: 'warm-3',
      messages: [msg('m3', 'x')],
      transcriptWindow: null,
      outline: [],
      runRecordsById: {},
      walkthroughsByMessageId: {},
      contextUsage: null,
    });
    rememberMermaidDiagramSvg('graph TD', 'dark', '<svg>2</svg>');
    globalMemoryGovernor.setLevel('critical');
    expect(warmCache.order).toEqual([]);
    expect(getMermaidDiagramCacheStats().svgEntries).toBe(0);

    // Critical admits nothing new.
    rememberMermaidDiagramSvg('graph TD', 'dark', '<svg>3</svg>');
    expect(readMermaidDiagramSvg('graph TD', 'dark')).toBeNull();
  });

  it('returning to normal restores budgets so entries are admitted again', () => {
    globalMemoryGovernor.setLevel('critical');
    rememberMermaidDiagramSvg('graph TD', 'dark', '<svg>1</svg>');
    globalMemoryGovernor.setLevel('normal');
    rememberMermaidDiagramSvg('graph TD', 'dark', '<svg>2</svg>');
    expect(readMermaidDiagramSvg('graph TD', 'dark')).toBe('<svg>2</svg>');
    globalHighlightCache.set('k1', [[{ content: 'x', offset: 0 }]], 10);
    expect(globalHighlightCache.get('k1')).not.toBeNull();
  });

  it('a registered warm cache handle gets re-trimmed on later transitions', () => {
    globalMemoryGovernor.setLevel('moderate');
    warmCache = putWarmSessionSnapshot(warmCache, {
      sessionId: 'late-1',
      messages: [msg('m1', 'late')],
      transcriptWindow: null,
      outline: [],
      runRecordsById: {},
      walkthroughsByMessageId: {},
      contextUsage: null,
    });
    warmCache = putWarmSessionSnapshot(warmCache, {
      sessionId: 'late-2',
      messages: [msg('m2', 'later')],
      transcriptWindow: null,
      outline: [],
      runRecordsById: {},
      walkthroughsByMessageId: {},
      contextUsage: null,
    });
    globalMemoryGovernor.setLevel('critical');
    expect(warmCache.order).toEqual([]);
  });

  it('artifact media cache trim is wired through the registry', () => {
    // Observable via the probe: replacing the registration under the same
    // name receives the governor push. Restore afterwards.
    const applied: Array<unknown> = [];
    registerDisposableCache({
      name: 'artifactMediaDataUrls',
      applyBudget(budget) {
        applied.push(budget);
      },
    });
    globalMemoryGovernor.setLevel('moderate');
    globalMemoryGovernor.setLevel('critical');
    // First push is the level that was live at registration; the two
    // transitions push the moderate and critical rows after it.
    expect(applied).toHaveLength(3);
    expect(applied[1]).toMatchObject({ evictAll: true, maxEntries: 32 });
    expect(applied[2]).toMatchObject({ evictAll: true, maxEntries: 0, maxBytes: 0 });
    // Restore the real module registration for later tests.
    registerDisposableCache({
      name: 'artifactMediaDataUrls',
      applyBudget: trimArtifactMediaDataUrlCache,
    });
  });
});
