/**
 * Connects the Memory Governor to the Artifact live-host registry.
 * Critical pressure evicts non-forceKeep iframes; moderate does not.
 * Returning to normal does not remount — the user clicks Load preview.
 */
import { evictNonForceKeepArtifactHosts } from '@piwin/artifact';
import { globalMemoryGovernor } from './memory-governor';

let installed = false;
let unsubscribe: (() => void) | null = null;

export function installArtifactMemoryBridge(): void {
  if (installed) {
    return;
  }
  installed = true;
  unsubscribe = globalMemoryGovernor.subscribe((level) => {
    if (level === 'critical') {
      evictNonForceKeepArtifactHosts();
    }
  });
  if (globalMemoryGovernor.getLevel() === 'critical') {
    evictNonForceKeepArtifactHosts();
  }
}

export function uninstallArtifactMemoryBridge(): void {
  unsubscribe?.();
  unsubscribe = null;
  installed = false;
}
