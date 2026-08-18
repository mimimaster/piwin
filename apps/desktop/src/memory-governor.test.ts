// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { globalMemoryGovernor } from './memory-governor';
import { globalHighlightCache } from './syntax/highlight-cache';
import { shouldHighlightCode } from './syntax-highlight';

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
