import type { SessionIndexRecord } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import type { AgentCliOwnershipController } from '../native-cli-ownership.js';
import { applyExternalAgentMetadata } from './grok-catalog-sync.js';

const REFRESH_INTERVAL_MS = 2_000;
type Watch = { stopped: boolean; timer?: ReturnType<typeof setTimeout>; pending?: Promise<void> };

/** Observes native actors without opening their sessions or reconciling/deleting catalog rows. */
export class NativeCliCatalogObserver {
  private readonly watches = new Map<string, Watch>();
  constructor(
    private readonly deps: HostRuntimeKernel,
    private readonly ownership: AgentCliOwnershipController,
  ) {}

  start(record: SessionIndexRecord): void {
    if (this.watches.has(record.id) || record.backend?.backendSessionId === undefined) return;
    const { agentId, backendSessionId } = record.backend;
    const workingDirectory = record.workingDirectory ?? record.projectPath;
    const watch: Watch = { stopped: false };
    this.watches.set(record.id, watch);
    const current = (): boolean => !watch.stopped && this.watches.get(record.id) === watch;
    const refresh = (): void => {
      if (!current()) return;
      watch.pending = (async () => {
        const backend = this.deps.externalAgents;
        if (backend === undefined) return;
        const observed = await backend.observeNativeSession(agentId, {
          backendSessionId,
          workingDirectory,
        });
        const metadata =
          observed ??
          (await backend.listCatalog(agentId)).find(
            (entry) => entry.backendSessionId === backendSessionId,
          );
        if (!current() || metadata === undefined) return;
        if (metadata.lastChangeUnixMs !== undefined)
          this.deps.externalCatalogChanges.set(backendSessionId, metadata.lastChangeUnixMs);
        await applyExternalAgentMetadata(this.deps, record.id, metadata, current);
        if (current() && observed !== undefined)
          this.ownership.setNativeActivity(record.id, observed.activity);
      })()
        .catch((error: unknown) => {
          if (current())
            this.deps.push({
              type: 'host/log',
              level: 'warn',
              message: `Native session observation failed: ${formatError(error)}`,
            });
        })
        .finally(() => {
          if (current()) {
            watch.timer = setTimeout(refresh, REFRESH_INTERVAL_MS);
            watch.timer.unref();
          }
        });
    };
    refresh();
  }

  stop(sessionId: string): void {
    const watch = this.watches.get(sessionId);
    if (watch === undefined) return;
    watch.stopped = true;
    if (watch.timer !== undefined) clearTimeout(watch.timer);
    this.watches.delete(sessionId);
  }

  async dispose(): Promise<void> {
    const watches = [...this.watches.values()];
    for (const sessionId of this.watches.keys()) this.stop(sessionId);
    await Promise.all(watches.map((watch) => watch.pending));
  }
}
