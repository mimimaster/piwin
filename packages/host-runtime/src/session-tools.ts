import type { HostToolRegistration, WebConfig } from '@piwin/contracts';
import { createWebToolDefinitions } from '@piwin/tools-web';
import type { WebRuntimeCredentials } from '@piwin/tools-web';
import type { WebSearchModelDelegate } from '@piwin/tools-web';

export type SessionToolRegistration = {
  tools: HostToolRegistration[];
};

export type BuildSessionToolsOptions = {
  webConfig?: WebConfig;
  /** Host-resolved secrets kept in memory and never written into WebConfig. */
  webCredentials?: WebRuntimeCredentials;
  /** Optional configured model that exclusively backs Host `web_search`. */
  webSearchDelegate?: WebSearchModelDelegate;
};

function isBuildOptions(value: unknown): value is BuildSessionToolsOptions {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return 'webConfig' in value || 'webCredentials' in value || 'webSearchDelegate' in value;
}

/**
 * Build host-owned tools to attach to a Pi session.
 * Web executors are returned as registrations; the Host router admits them
 * before any network operation starts.
 */
export function buildSessionTools(
  options: BuildSessionToolsOptions | WebConfig = {},
): SessionToolRegistration {
  if (isBuildOptions(options)) {
    return {
      tools: createWebToolDefinitions(
        options.webConfig,
        options.webCredentials,
        options.webSearchDelegate,
      ),
    };
  }
  return { tools: createWebToolDefinitions(options as WebConfig) };
}
