/** Register only the providers claimed by the Host-selected OAuth extensions. */
import { canRegisterExtensionProvider } from './extension-provider-ownership.js';
import type { SubscriptionExtensionEntry } from './subscription-auth.js';

export type SubscriptionResourceLoader = new (options: Record<string, unknown>) => {
  reload(): Promise<void>;
  getExtensions(): {
    errors: Array<{ path: string; error: string }>;
    runtime: {
      pendingProviderRegistrations: Array<{ name: string; config: object; extensionPath?: string }>;
    };
  };
};

export async function registerSubscriptionExtensions(
  runtime: {
    registerProvider(id: string, config: object): void;
    refresh(options: { allowNetwork: boolean; providers?: string[] }): Promise<unknown>;
  },
  loaderClass: SubscriptionResourceLoader | undefined,
  agentDir: string,
  entries: readonly SubscriptionExtensionEntry[],
  providerNames?: Map<string, string>,
): Promise<void> {
  if (!entries.length) return;
  if (!loaderClass)
    throw new Error('Pi extension resource loader is unavailable for subscription auth');
  const loader = new loaderClass({
    cwd: agentDir,
    agentDir,
    additionalExtensionPaths: entries.map((entry) => entry.entryPath),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  if (loaded.errors.length > 0) {
    throw new Error(
      `Provider extension failed to load: ${loaded.errors[0]?.error ?? 'unknown error'}`,
    );
  }
  const claimedIds = new Set(entries.map((entry) => entry.providerId));
  const owners = entries.map((entry) => ({
    path: entry.entryPath,
    modelProviderId: entry.providerId,
  }));
  for (const registration of loaded.runtime.pendingProviderRegistrations) {
    if (
      !claimedIds.has(registration.name) ||
      !canRegisterExtensionProvider(registration.name, registration.extensionPath, owners)
    )
      continue;
    runtime.registerProvider(registration.name, registration.config);
    const name = (registration.config as { name?: unknown }).name;
    if (typeof name === 'string' && name.trim()) providerNames?.set(registration.name, name.trim());
  }
  await runtime.refresh({ allowNetwork: false, providers: [...claimedIds] });
}
