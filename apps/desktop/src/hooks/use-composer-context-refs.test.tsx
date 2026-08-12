// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { PromptContextRef } from '@piwin/contracts';
import {
  contextRefKey,
  labelForContextRef,
  MAX_PENDING_CONTEXT_REFS,
  useComposerContextRefs,
} from './use-composer-context-refs.js';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ComposerContextRefsApi = ReturnType<typeof useComposerContextRefs>;

function fileRef(relativePath: string, label = relativePath): PromptContextRef {
  return { kind: 'file', projectPath: '/p', relativePath, label };
}

describe('contextRefKey', () => {
  it('dedupes file refs by project/path/lines', () => {
    const a: PromptContextRef = {
      kind: 'file',
      projectPath: '/p',
      relativePath: 'src/a.ts',
      lineStart: 1,
      lineEnd: 2,
      label: 'A',
    };
    const b: PromptContextRef = { ...a, label: 'B' };
    expect(contextRefKey(a)).toBe(contextRefKey(b));
  });

  it('distinguishes selection snapshots', () => {
    const a: PromptContextRef = {
      kind: 'selection',
      snapshotText: 'one',
      label: 's',
    };
    const b: PromptContextRef = {
      kind: 'selection',
      snapshotText: 'two',
      label: 's',
    };
    expect(contextRefKey(a)).not.toBe(contextRefKey(b));
  });
});

describe('labelForContextRef', () => {
  it('falls back to relative path for files', () => {
    const ref: PromptContextRef = {
      kind: 'file',
      projectPath: '/p',
      relativePath: 'src/x.ts',
      label: '  ',
    };
    expect(labelForContextRef(ref)).toBe('src/x.ts');
  });
});

describe('useComposerContextRefs', () => {
  let unmount: (() => void) | null = null;

  afterEach(() => {
    unmount?.();
    unmount = null;
    document.body.innerHTML = '';
  });

  function mount(): () => ComposerContextRefsApi {
    let api: ComposerContextRefsApi | null = null;
    function Harness(): null {
      api = useComposerContextRefs();
      return null;
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(createElement(Harness));
    });
    unmount = () => {
      act(() => {
        root.unmount();
      });
    };
    return () => {
      const current = api;
      if (current === null) {
        throw new Error('hook not mounted');
      }
      return current;
    };
  }

  it('adds a ref and exposes it to the send snapshot', () => {
    const getApi = mount();
    const api = getApi();
    let result: ReturnType<ComposerContextRefsApi['addContextRef']> | undefined;
    act(() => {
      result = api.addContextRef(fileRef('src/a.ts'));
    });

    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    expect(result.deduped).toBe(false);
    expect(getApi().pendingContextRefs).toHaveLength(1);
    expect(getApi().snapshotContextRefs()).toEqual([
      expect.objectContaining({ kind: 'file', relativePath: 'src/a.ts' }),
    ]);
  });

  it('dedupes identical refs and keeps one chip', () => {
    const getApi = mount();
    act(() => getApi().addContextRef(fileRef('src/a.ts')));
    let second: ReturnType<ComposerContextRefsApi['addContextRef']> | undefined;
    act(() => {
      second = getApi().addContextRef(fileRef('src/a.ts', 'other label'));
    });

    expect(second?.ok).toBe(true);
    if (!second?.ok) return;
    expect(second.deduped).toBe(true);
    expect(getApi().pendingContextRefs).toHaveLength(1);
  });

  it('refuses beyond the cap with a notice result', () => {
    const getApi = mount();
    for (let index = 0; index < MAX_PENDING_CONTEXT_REFS; index += 1) {
      let result: ReturnType<ComposerContextRefsApi['addContextRef']> | undefined;
      act(() => {
        result = getApi().addContextRef(fileRef(`f-${index}.ts`));
      });
      expect(result?.ok).toBe(true);
    }
    let overCap: ReturnType<ComposerContextRefsApi['addContextRef']> | undefined;
    act(() => {
      overCap = getApi().addContextRef(fileRef('extra.ts'));
    });
    expect(overCap).toEqual({ ok: false, reason: 'cap' });
    expect(getApi().pendingContextRefs).toHaveLength(MAX_PENDING_CONTEXT_REFS);
  });

  it('removes a ref by key and clears all', () => {
    const getApi = mount();
    let first: ReturnType<ComposerContextRefsApi['addContextRef']> | undefined;
    act(() => {
      first = getApi().addContextRef(fileRef('a.ts'));
    });
    const firstResult = first;
    if (!firstResult?.ok) return;
    act(() => getApi().addContextRef(fileRef('b.ts')));
    act(() => getApi().removeContextRef(firstResult.item.key));

    expect(getApi().pendingContextRefs.map((item) => item.label)).toEqual(['b.ts']);

    act(() => getApi().clearContextRefs());
    expect(getApi().pendingContextRefs).toHaveLength(0);
    expect(getApi().snapshotContextRefs()).toEqual([]);
  });
});
