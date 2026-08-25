import { join } from 'node:path';
import { DeviceCapabilityRegistry } from './device-capability-registry.js';
import { DeviceCapabilityStore } from './device-capability-store.js';
import { DeviceToolBroker } from './device-tool-broker.js';

export function isAppleHealthHostGateEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.PIWIN_EXPERIMENTAL_APPLE_HEALTH === '1';
}

/**
 * Composition-root helper: one broker for HostRuntime and HostServer.
 * Returns undefined when the experimental gate is off.
 */
export async function createDeviceToolBrokerForHost(
  piwinRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DeviceToolBroker | undefined> {
  if (!isAppleHealthHostGateEnabled(env)) {
    return undefined;
  }
  const store = new DeviceCapabilityStore(join(piwinRoot, 'devices', 'capabilities.json'));
  const registry = new DeviceCapabilityRegistry({ store });
  await registry.load();
  return new DeviceToolBroker({ registry });
}
