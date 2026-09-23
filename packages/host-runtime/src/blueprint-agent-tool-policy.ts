import type {
  CreateSessionInput,
  HostToolDescriptor,
  PiwinConfig,
  SessionToolFamily,
  SessionToolPolicy,
} from '@piwin/contracts';
import { resolveWebConfig } from '@piwin/tools-web';
import {
  agentArtifactCapability,
  buildHostToolsForPolicy,
  familyHasKnowledgeTools,
  projectModelHostTools,
} from './blueprint-tool-capability.js';
import {
  findConfiguredModel,
  findReadyWebSearchDelegate,
  resolveNativeSearchAdapterSupport,
  resolveSearchRoute,
  shouldExposeExternalWebSearch,
} from './capabilities/search-route-resolver.js';
import { resolveToolPolicyDetails } from './capabilities/tool-policy-resolver.js';
import { isHostToolboxTargetFamily } from './host-toolbox.js';
import type { McpCapabilityBrief } from './mcp-capability-brief.js';
/**
 * Build tool policy from config + scope.
 * Maps product capability exposure to exact tool families + custom tool names.
 */
export function compileToolPolicy(
  config: PiwinConfig,
  input: CreateSessionInput,
  hostToolDescriptors?: readonly HostToolDescriptor[],
  toolNamesFromComposed?: readonly string[],
  trusted?: boolean,
  mcpEnabledServerIds: readonly string[] = [],
  hostToolFamilyIndex?: ReadonlyMap<SessionToolFamily, readonly string[]>,
  mcpBrief?: McpCapabilityBrief,
): {
  tools: SessionToolPolicy;
  searchRoute: import('@piwin/contracts').ResolvedSearchRoute;
  hostToolboxTargetNames: string[];
} {
  // SIDE §6.1: Side Chat compiles a fixed read-only tool profile. It is a
  // product-level session kind, not a subagent capability ceiling, and can
  // never gain write/execute/planning/delegate tools even under a yolo
  // permission preset.
  if (input.sessionKind === 'side-chat') {
    const sideChatTools = buildSideChatToolPolicy(
      config,
      hostToolDescriptors,
      toolNamesFromComposed,
    );
    const configured = findConfiguredModel(config, input.model);
    const searchRoute = resolveSearchRoute({
      model: configured?.model ?? null,
      web: config.web,
      adapter: resolveNativeSearchAdapterSupport(
        configured?.provider.protocol,
        configured?.model.nativeSearchAdapter,
      ),
      externalDelegateReady: Boolean(findReadyWebSearchDelegate(config)),
      // Side chat follows the explicit external-only policy.
      policy: 'external-only',
    });
    const tools = shouldExposeExternalWebSearch(searchRoute)
      ? sideChatTools
      : omitExternalWebSearch(sideChatTools);
    return { tools, searchRoute, hostToolboxTargetNames: [] };
  }
  const capabilityCeiling = input.subagent?.capabilities;

  const resolvedWebConfig = config.web ? resolveWebConfig(config.web) : undefined;
  const configuredModel = findConfiguredModel(config, input.model);
  const searchRoute = resolveSearchRoute({
    model: configuredModel?.model ?? null,
    web: resolvedWebConfig ?? config.web,
    adapter: resolveNativeSearchAdapterSupport(
      configuredModel?.provider.protocol,
      configuredModel?.model.nativeSearchAdapter,
    ),
    externalDelegateReady: Boolean(findReadyWebSearchDelegate(config)),
  });
  // External Host web_search is ready only when the resolved route selected it.
  // Native-selected generations must not advertise the competing tool family.
  const webSearchReady = shouldExposeExternalWebSearch(searchRoute);
  const webFetchReady = resolvedWebConfig !== undefined;

  const resolvedToolPolicy = resolveToolPolicyDetails({
    webSearch: webSearchReady,
    webFetch: resolvedWebConfig !== undefined,
    mcp: true,
    imageGeneration: true,
    process: 'agent',
    browser: 'agent',
    subagents: 'agent',
    notes:
      config.notes?.enabled === false
        ? familyHasKnowledgeTools(hostToolFamilyIndex)
          ? 'agent-read'
          : 'off'
        : 'agent-read-write',
    flashcards:
      input.presentation?.kind === 'doccard-sequence'
        ? 'agent-read'
        : config.flashcards?.enabled === false
          ? 'off'
          : 'agent-create',
    artifact: agentArtifactCapability(config, input).enabled,
    availability: {
      webSearchReady,
      webFetchReady,
      mcpEnabledServerIds: [...mcpEnabledServerIds],
      processReady: config.process?.enabled !== false,
      // Browser and image generation readiness are intersected with the
      // concrete registration index below. The resolver remains pure and
      // does not instantiate either backend.
      browserReady: true,
      imageGenerationReady: true,
      videoGenerationReady: true,
    },
    readonly: input.subagent?.mode === 'readonly',
    ...(capabilityCeiling ? { capabilities: capabilityCeiling } : {}),
    ...(trusted !== undefined ? { trusted } : {}),
    ...(hostToolFamilyIndex ? { availableFamilies: new Set(hostToolFamilyIndex.keys()) } : {}),
    filesystemRead: capabilityCeiling === undefined || capabilityCeiling.includes('read'),
    filesystemWrite: capabilityCeiling === undefined || capabilityCeiling.includes('write'),
    shell: true,
    planning: true,
    delegate: true,
    notesEnabled:
      capabilityCeiling === undefined &&
      (config.notes?.enabled !== false || familyHasKnowledgeTools(hostToolFamilyIndex)),
    flashcardsEnabled: capabilityCeiling === undefined && config.flashcards?.enabled !== false,
    imageGenerationEnabled: capabilityCeiling === undefined,
    videoGeneration: true,
    videoGenerationEnabled: capabilityCeiling === undefined,
    extensionInstall: capabilityCeiling === undefined && config.extensions?.agentInstall !== false,
  });

  const resolvedPolicy = resolvedToolPolicy.policy;
  const customToolNames = hostToolFamilyIndex
    ? resolvedPolicy.enabledFamilies.flatMap((family) => hostToolFamilyIndex.get(family) ?? [])
    : resolvedToolPolicy.customToolNames;

  // Only expose Pi's non-mutating inspection tools to the worker. Product
  // filesystem writes are Host-owned tools and must never use Pi-native edit
  // or write capabilities in the worker.
  const piBuiltinToolNames = resolvedPolicy.piBuiltinToolNames;

  // When the parent provides the composed tool names (the single source of
  // truth from buildSessionHostTools), intersect customToolNames with them.
  // This ensures the blueprint never advertises a tool without a concrete
  // executor (invariant 5). When not provided (test/legacy path), the
  // descriptor filter in buildHostToolsForPolicy still removes names without
  // a matching descriptor.
  const familyDerivedToolNames = customToolNames;
  const effectiveToolNames = toolNamesFromComposed
    ? familyDerivedToolNames.filter((name) => toolNamesFromComposed.includes(name))
    : familyDerivedToolNames;
  const hostToolboxTargetNames = hostToolFamilyIndex
    ? resolvedPolicy.enabledFamilies
        .filter(isHostToolboxTargetFamily)
        .flatMap((family) => hostToolFamilyIndex.get(family) ?? [])
        .sort()
    : [];
  const modelHostTools = projectModelHostTools(
    effectiveToolNames,
    hostToolDescriptors,
    hostToolboxTargetNames,
    resolvedPolicy.enabledFamilies.includes('mcp') ? mcpBrief : undefined,
  );

  return {
    tools: {
      enabledFamilies: resolvedPolicy.enabledFamilies,
      piBuiltinToolNames,
      hostTools: modelHostTools,
      enabledMcpServerIds: [...mcpEnabledServerIds],
    },
    searchRoute,
    hostToolboxTargetNames,
  };
}

function omitExternalWebSearch(policy: SessionToolPolicy): SessionToolPolicy {
  return {
    ...policy,
    enabledFamilies: policy.enabledFamilies.filter((family) => family !== 'web-search'),
    hostTools: policy.hostTools.filter((tool) => tool.name !== 'web_search'),
  };
}

/**
 * SIDE §6.1: exact read-only tool profile for Side Chat sessions.
 *
 * The manifest carries only the Pi built-in read family plus the product
 * filesystem-read host tools. Optional web-search/web-fetch are enabled only
 * when the product web config is on. Write, shell, process, browser, MCP,
 * planning, delegate, notes/flashcard writes, and image generation are
 * explicitly absent — no permission preset can widen this set.
 */
function buildSideChatToolPolicy(
  config: PiwinConfig,
  hostToolDescriptors?: readonly HostToolDescriptor[],
  toolNamesFromComposed?: readonly string[],
): SessionToolPolicy {
  const enabledFamilies: SessionToolFamily[] = ['filesystem-read'];
  const customToolNames: string[] = ['read_file', 'list_directory'];

  // Optional P1: web search/fetch gated by the product web config.
  if (config.web) {
    enabledFamilies.push('web-search', 'web-fetch');
    customToolNames.push('web_search', 'web_fetch');
  }

  const effectiveToolNames = toolNamesFromComposed
    ? customToolNames.filter((name) => toolNamesFromComposed.includes(name))
    : customToolNames;

  return {
    enabledFamilies,
    piBuiltinToolNames: ['read', 'grep', 'find', 'ls'],
    hostTools: buildHostToolsForPolicy(effectiveToolNames, hostToolDescriptors),
    enabledMcpServerIds: [],
  };
}
