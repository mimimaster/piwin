/**
 * Pressure may reclaim only inactive session resources. Visible sessions keep
 * their iframe/Shadow DOM, streaming preview and Canvas mounted unchanged.
 */
import { sessionRenderResources } from '../session/session-render-resources.js';
import { globalMemoryGovernor } from '../notes/memory-governor';

let installed = false;
let unsubscribe: (() => void) | null = null;

export function installArtifactMemoryBridge(): void {
  if (installed) {
    return;
  }
  installed = true;
  unsubscribe = globalMemoryGovernor.subscribe((level) => {
    if (level !== 'normal') sessionRenderResources.requestReclaim();
  });
  if (globalMemoryGovernor.getLevel() === 'critical') {
    sessionRenderResources.requestReclaim();
  }
}

export function uninstallArtifactMemoryBridge(): void {
  unsubscribe?.();
  unsubscribe = null;
  installed = false;
}
