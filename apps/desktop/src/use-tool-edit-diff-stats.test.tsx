// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DiffCardRequest } from './diff-card';
import {
  clearToolEditDiffStatsCacheForTests,
  MAX_TOOL_EDIT_DIFF_STATS_CACHE_ENTRIES,
  toolEditDiffStatsCacheSizeForTests,
  useToolEditDiffStats,
} from './use-tool-edit-diff-stats';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function StatsProbe(props: { path: string; request: DiffCardRequest }): ReactElement {
  const stats = useToolEditDiffStats({
    enabled: true,
    projectPath: '/repo',
    path: props.path,
    request: props.request,
    fallback: undefined,
  });
  return <span data-testid="stats">{stats ? `+${stats.added} -${stats.removed}` : 'none'}</span>;
}

describe('useToolEditDiffStats', () => {
  let container: HTMLElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    clearToolEditDiffStatsCacheForTests();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  function requestReturning(additions: () => number): DiffCardRequest {
    return vi.fn(async () => ({
      success: true,
      data: { diff: { additions: additions(), deletions: 0 } },
    })) as unknown as DiffCardRequest;
  }

  async function mount(path: string, request: DiffCardRequest): Promise<string | null> {
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(<StatsProbe path={path} request={request} />);
    });
    return container.textContent;
  }

  it('reuses a fresh answer and refetches once it has aged out', async () => {
    let additions = 3;
    const request = requestReturning(() => additions);

    expect(await mount('a.ts', request)).toBe('+3 -0');
    additions = 9;
    expect(await mount('a.ts', request)).toBe('+3 -0');
    expect(request).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(15_001);
    expect(await mount('a.ts', request)).toBe('+9 -0');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('caps the number of remembered files', async () => {
    const request = requestReturning(() => 1);
    for (let index = 0; index < MAX_TOOL_EDIT_DIFF_STATS_CACHE_ENTRIES + 5; index += 1) {
      await mount(`file-${index}.ts`, request);
    }
    expect(toolEditDiffStatsCacheSizeForTests()).toBe(MAX_TOOL_EDIT_DIFF_STATS_CACHE_ENTRIES);
  });
});
