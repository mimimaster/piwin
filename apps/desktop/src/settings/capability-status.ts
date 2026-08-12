/**
 * Capability status model (spec §13.1): separates configured/effective/loaded/running.
 *
 * - configured: what the user saved in Settings.
 * - effective: what the Host resolves after trust/availability.
 * - loaded: whether the current Agent Runtime schema contains the capability.
 * - running: whether the backing service is currently up.
 *
 * Pure — no host/fs access — so Settings pages can render state distinctly and
 * the MCP switch never masquerades as Running.
 */
import type { PiwinConfig, SessionRuntimeStatus } from '@piwin/contracts';
import { isModelEnabled, isProviderEnabled, modelSupportsCapability } from '@piwin/contracts';

export type CapabilityStateKind = 'configured' | 'effective' | 'loaded' | 'running';

export type CapabilityStatus = {
  /** Stable key shared by UI rows (e.g. 'webSearch', 'mcp', 'process'). */
  key: string;
  configured: 'off' | 'on' | 'manual-only' | 'agent';
  /** True when the Host would actually expose the capability to the Agent. */
  effective: boolean;
  /** True when the current live runtime schema includes it (false when stale). */
  loaded: boolean;
  /** True when the backing service is running. */
  running: boolean;
  /** Human-readable reason when effective differs from configured. */
  note?: string;
};

export type CapabilityStatusInput = {
  config: PiwinConfig;
  /** Current runtime status of the active session (undefined when none). */
  runtimeStatus: SessionRuntimeStatus | undefined;
  /** MCP/Process/Browser service health snapshots. */
  services?: {
    mcpRunning: boolean;
    processRunning: boolean;
    browserRunning: boolean;
  };
};

/**
 * Resolve the four-state model for the Agent-facing capabilities. Effective
 * mirrors the Host SessionToolPolicy: an off family is never effective; a
 * stale runtime reports loaded=false so the UI can show Pending Changes.
 */
export function resolveCapabilityStatuses(input: CapabilityStatusInput): CapabilityStatus[] {
  const { config, runtimeStatus, services } = input;
  const stale = runtimeStatus?.state === 'stale';
  const webConfig = config.web;
  const searchSourcesReady =
    (webConfig?.searchSources ?? []).filter((source) => source.enabled).length > 0;
  const delegateRef = webConfig?.searchDelegateModel;
  const delegateProvider = delegateRef
    ? config.providers.find(
        (provider) =>
          isProviderEnabled(provider) &&
          provider.id === delegateRef.providerId &&
          provider.protocol === delegateRef.protocol,
      )
    : undefined;
  const delegateModel = delegateProvider?.models.find(
    (model) => model.id === delegateRef?.modelId && isModelEnabled(model),
  );
  const delegateReady = Boolean(
    delegateModel && modelSupportsCapability(delegateModel, 'native-web-search'),
  );
  const mcpRunning = services?.mcpRunning === true;
  const processRunning = services?.processRunning === true;
  const browserRunning = services?.browserRunning === true;

  const searchProviderOff = webConfig?.searchProvider === 'none';
  const searchConfigured = Boolean(delegateRef) || !searchProviderOff;
  const searchEffective = delegateRef ? delegateReady : !searchProviderOff && searchSourcesReady;

  const rows: CapabilityStatus[] = [
    {
      key: 'webSearch',
      configured: searchConfigured ? 'on' : 'off',
      effective: searchEffective,
      loaded: !stale,
      running: true,
      ...(!searchConfigured
        ? { note: 'No search provider configured' }
        : delegateRef && !delegateReady
          ? { note: 'Configured web_search delegate model is unavailable' }
          : !delegateRef && !searchSourcesReady
            ? { note: 'No enabled search source is ready' }
            : {}),
    },
    {
      key: 'mcp',
      configured: 'on',
      effective: mcpRunning,
      loaded: !stale,
      running: mcpRunning,
      ...(mcpRunning ? {} : { note: 'No enabled MCP server is running' }),
    },
    {
      key: 'process',
      configured: config.process?.enabled === false ? 'off' : 'on',
      effective: config.process?.enabled !== false,
      loaded: !stale,
      running: processRunning,
    },
    {
      key: 'browser',
      configured: 'on',
      effective: browserRunning,
      loaded: !stale,
      running: browserRunning,
      ...(browserRunning ? {} : { note: 'Browser session not started' }),
    },
    {
      key: 'imageGeneration',
      configured: config.imageGeneration ? 'on' : 'off',
      effective: Boolean(config.imageGeneration),
      loaded: !stale,
      running: true,
    },
    {
      key: 'subagents',
      configured: 'on',
      effective: true,
      loaded: !stale,
      running: true,
    },
  ];
  return rows;
}
