import type { HostCommand, HostResponse, PiwinConfig } from '@piwin/contracts';
import { mergeSettingsViewConfig } from './settings/settings-view-config.js';

export async function readProjectedHostConfig(hostClient: {
  supportsCommand?: (type: HostCommand['type']) => boolean;
  request: (command: HostCommand) => Promise<HostResponse>;
}): Promise<PiwinConfig | undefined> {
  if (hostClient.supportsCommand?.('settings/get') === false) {
    return undefined;
  }
  const response = await hostClient.request({ type: 'settings/get' });
  if (!response.success) {
    return undefined;
  }
  const snapshot = (response.data as { snapshot?: { config?: unknown } } | undefined)?.snapshot;
  if (snapshot?.config === undefined) {
    return undefined;
  }
  return mergeSettingsViewConfig(snapshot.config);
}
