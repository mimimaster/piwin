/**
 * Managed extension install shared by curated entries and registry hits: stage
 * the revision, then enable it. The user already confirmed Host-user execution
 * in the install dialog, which is the activation consent ADR 0047 requires.
 */
import type {
  ExtensionInstallSource,
  ExtensionsInstallData,
  HostCommand,
  HostResponse,
} from '@piwin/contracts';

export type MarketplaceRequest = (command: HostCommand) => Promise<HostResponse>;

export class MarketplaceRequestError extends Error {
  override readonly name = 'MarketplaceRequestError';
}

export async function sendMarketplaceCommand(
  request: MarketplaceRequest,
  command: HostCommand,
): Promise<unknown> {
  const response = await request(command);
  if (!response.success) throw new MarketplaceRequestError(response.error);
  return response.data;
}

export async function installAndEnableManagedExtension(
  request: MarketplaceRequest,
  source: ExtensionInstallSource,
  options: { name?: string; onEnabling?: () => void } = {},
): Promise<ExtensionsInstallData> {
  const installed = (await sendMarketplaceCommand(request, {
    type: 'extensions/install',
    source,
    ...(options.name ? { name: options.name } : {}),
  })) as ExtensionsInstallData;
  if (installed.configuredEnabled !== true) {
    options.onEnabling?.();
    await sendMarketplaceCommand(request, {
      type: 'extensions/set_enabled',
      extensionId: installed.extensionId,
      enabled: true,
    });
  }
  return installed;
}
