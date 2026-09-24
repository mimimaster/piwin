/**
 * Turn-level render accounting for the live-chain benchmark. Wraps one memo
 * boundary (`TranscriptTurnBody`) in a React `Profiler`, so a sample means the
 * whole turn body actually re-rendered. Row counts come from `noteRowRender`.
 */
import { Profiler, type ProfilerOnRenderCallback, type ReactElement, type ReactNode } from 'react';
import { probeStore } from './render-probe-store.js';

export function RenderProbe(props: { id: string; children: ReactNode }): ReactElement {
  const onRender: ProfilerOnRenderCallback = (_id, phase, actualDuration) => {
    probeStore()?.samples.push({ id: props.id, phase, actualDuration, at: performance.now() });
  };
  return (
    <Profiler id={props.id} onRender={onRender}>
      {props.children}
    </Profiler>
  );
}
