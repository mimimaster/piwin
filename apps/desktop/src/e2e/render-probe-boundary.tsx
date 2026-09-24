/**
 * The only production-side door to the render probe.
 *
 * `import.meta.env.VITE_PIWIN_E2E_FIXTURES` is statically `undefined` outside
 * the Playwright build, so both branches below are constant-folded and the
 * `Profiler` module never reaches a production bundle.
 */
import { type ReactElement, type ReactNode } from 'react';
import { RenderProbe } from './render-probe.js';

const fixturesEnabled = import.meta.env.VITE_PIWIN_E2E_FIXTURES === 'true';

export function RenderProbeBoundary(props: { id: string; children: ReactNode }): ReactElement {
  if (!fixturesEnabled) return <>{props.children}</>;
  return <RenderProbe id={props.id}>{props.children}</RenderProbe>;
}
