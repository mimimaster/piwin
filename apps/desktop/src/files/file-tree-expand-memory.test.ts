// @vitest-environment happy-dom
/**
 * Unit tests for file-tree expand-state persistence (Task 7).
 *
 * Verifies per-project localStorage round-trip, isolation between
 * projects, malformed-JSON resilience, and the 200-path cap.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { loadExpandedPaths, saveExpandedPaths } from './file-tree-expand-memory';

describe('file-tree-expand-memory', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips expanded paths per project', () => {
    saveExpandedPaths('/a', ['src', 'src/components']);
    expect([...loadExpandedPaths('/a')].sort()).toEqual(['src', 'src/components']);
    expect(loadExpandedPaths('/b').size).toBe(0);
  });

  it('different projects have separate state', () => {
    saveExpandedPaths('/a', ['src']);
    saveExpandedPaths('/b', ['docs', 'docs/guides']);
    expect([...loadExpandedPaths('/a')]).toEqual(['src']);
    expect([...loadExpandedPaths('/b')].sort()).toEqual(['docs', 'docs/guides']);
  });

  it('handles malformed JSON', () => {
    localStorage.setItem('piwin.fileTree.expanded.v1', '{bad json');
    expect(loadExpandedPaths('/a').size).toBe(0);
  });

  it('caps at 200 paths (extra paths dropped)', () => {
    const paths = Array.from({ length: 250 }, (_, i) => `path-${i}`);
    saveExpandedPaths('/a', paths);
    expect(loadExpandedPaths('/a').size).toBe(200);
  });
});
