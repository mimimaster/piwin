/**
 * Connects the Memory Governor to the Artifact live-host registry.
 * Critical pressure evicts non-forceKeep iframes and holds new ones; moderate
 * does not. Leaving critical lifts the hold but does not remount — the user
 * clicks Load preview.
 */
import { evictNonForceKeepArtifactHosts, setArtifactHostPressureHold } from './artifact-live-host-registry.js';
import { globalMemoryGovernor } from '../notes/memory-governor';

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
    } else {
      setArtifactHostPressureHold(false);
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
