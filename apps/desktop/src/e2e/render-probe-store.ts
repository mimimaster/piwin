/**
 * Dev-only render-accounting store. No React import: a production build
 * constant-folds `VITE_PIWIN_E2E_FIXTURES` to false, so every function here
 * collapses to an empty body and nothing but a no-op call survives.
 */
export type RenderProbeSample = {
  id: string;
  phase: 'mount' | 'update' | 'nested-update';
  actualDuration: number;
  at: number;
};

export type RenderProbeStore = {
  samples: RenderProbeSample[];
  mark: () => number;
  since: (cursor: number) => RenderProbeSample[];
  clear: () => void;
};

const STORE_KEY = '__piwinRenderProbe';
const fixturesEnabled = import.meta.env.VITE_PIWIN_E2E_FIXTURES === 'true';

export function probeStore(): RenderProbeStore | null {
  if (!fixturesEnabled || typeof window === 'undefined') return null;
  return (window as unknown as Record<string, RenderProbeStore | undefined>)[STORE_KEY] ?? null;
}

export function installRenderProbe(): RenderProbeStore {
  const store: RenderProbeStore = {
    samples: [],
    mark: () => store.samples.length,
    since: (cursor) => store.samples.slice(cursor),
    clear: () => {
      store.samples = [];
    },
  };
  if (fixturesEnabled && typeof window !== 'undefined') {
    (window as unknown as Record<string, RenderProbeStore>)[STORE_KEY] = store;
  }
  return store;
}

/**
 * Counts one row render. Called from inside `ChatMessageRowContent`, behind its
 * memo comparison — so a sample exists exactly when the row really re-rendered,
 * not when its parent merely re-created the element.
 */
export function noteRowRender(messageId: string): void {
  probeStore()?.samples.push({
    id: `row:${messageId}`,
    phase: 'update',
    actualDuration: 0,
    at: performance.now(),
  });
}
