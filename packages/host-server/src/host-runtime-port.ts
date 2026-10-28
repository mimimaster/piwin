import type { HostRuntime } from '@piwin/host-runtime';

/** The slice of HostRuntime a Host server drives; tests supply a fake. */
export type HostRuntimePort = Pick<
  HostRuntime,
  'handleCommand' | 'attachPushSink' | 'attachBrowserFrameSink'
> & {
  runWithDevicePrincipal?: HostRuntime['runWithDevicePrincipal'];
  /** Present when the runtime keeps background health summaries (ADR 0062 M2). */
  healthSummarySync?: HostRuntime['healthSummarySync'];
  /** Present on runtimes that can run the terminal shell for phones (ADR 0102). */
  runsEmbeddedTui?: HostRuntime['runsEmbeddedTui'];
};
