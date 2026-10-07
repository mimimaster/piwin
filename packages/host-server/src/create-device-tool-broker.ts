import { join } from 'node:path';
import { DeviceCapabilityRegistry } from './device-capability-registry.js';
import { DeviceCapabilityStore } from './device-capability-store.js';
import { DeviceToolBroker } from './device-tool-broker.js';

/**
 * Composition-root helper: one broker for HostRuntime and HostServer.
 *
 * Device tools are always part of a Host. Nothing is offered to a model until
 * a paired device advertises a capability, and every read is still decided on
 * that device (user presence, consent, the OS permission), so there is no
 * Host-side switch to turn on first.
 */
export async function createDeviceToolBrokerForHost(piwinRoot: string): Promise<DeviceToolBroker> {
  const store = new DeviceCapabilityStore(join(piwinRoot, 'devices', 'capabilities.json'));
  const registry = new DeviceCapabilityRegistry({ store });
  await registry.load();
  return new DeviceToolBroker({ registry });
}
