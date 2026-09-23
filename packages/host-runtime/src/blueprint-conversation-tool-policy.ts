import type {
  CreateSessionInput,
  HostToolDescriptor,
  PiwinConfig,
  ResolvedSearchRoute,
  SessionToolFamily,
  SessionToolPolicy,
} from '@piwin/contracts';
import { resolveWebConfig } from '@piwin/tools-web';
import {
  conversationArtifactCapability,
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

/** The slice of the compile options the Conversation policy compiler reads. */
export type ConversationToolPolicyCompileOptions = {
  hostToolDescriptors?: readonly HostToolDescriptor[];
  hostToolFamilyIndex?: ReadonlyMap<SessionToolFamily, readonly string[]>;
};
/** Toolbox target families a pure-chat session may route to (spec §7.1). */
const CONVERSATION_TOOLBOX_FAMILIES: ReadonlySet<SessionToolFamily> = new Set([
  'flashcards-read',
  'flashcards-write',
  'image-generation',
  'video-generation',
]);

export function compileConversationToolPolicy(
  config: PiwinConfig,
  input: CreateSessionInput,
  options: ConversationToolPolicyCompileOptions,
): {
  tools: SessionToolPolicy;
  searchRoute: ResolvedSearchRoute;
  hostToolboxTargetNames: string[];
} {
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
  const webSearchReady = shouldExposeExternalWebSearch(searchRoute);
  const webFetchReady = resolvedWebConfig !== undefined;
  const flashcardsEnabled = config.flashcards?.enabled !== false;
  const flashcardsAccess =
    input.presentation?.kind === 'doccard-sequence'
      ? 'agent-read'
      : flashcardsEnabled
        ? 'agent-create'
        : 'off';

  const resolvedToolPolicy = resolveToolPolicyDetails({
    webSearch: webSearchReady,
    webFetch: webFetchReady,
    mcp: false,
    imageGeneration: true,
    videoGeneration: true,
    process: 'off',
    browser: 'off',
    subagents: 'off',
    notes: familyHasKnowledgeTools(options.hostToolFamilyIndex) ? 'agent-read' : 'off',
    flashcards: flashcardsAccess,
    artifact: conversationArtifactCapability(config).enabled,
    availability: {
      webSearchReady,
      webFetchReady,
      mcpEnabledServerIds: [],
      processReady: false,
      browserReady: false,
      imageGenerationReady: true,
      videoGenerationReady: true,
    },
    filesystemRead: false,
    filesystemWrite: false,
    shell: false,
    planning: false,
    delegate: false,
    notesEnabled: familyHasKnowledgeTools(options.hostToolFamilyIndex),
    flashcardsEnabled: flashcardsEnabled && flashcardsAccess !== 'off',
    imageGenerationEnabled: true,
    videoGenerationEnabled: true,
    extensionInstall: config.extensions?.agentInstall !== false,
    ...(options.hostToolFamilyIndex
      ? { availableFamilies: new Set(options.hostToolFamilyIndex.keys()) }
      : {}),
  });

  const resolvedPolicy = resolvedToolPolicy.policy;
  const hostToolFamilyIndex = options.hostToolFamilyIndex;
  const customToolNames = hostToolFamilyIndex
    ? resolvedPolicy.enabledFamilies.flatMap((family) => hostToolFamilyIndex.get(family) ?? [])
    : resolvedToolPolicy.customToolNames;
  const composedToolNames = options.hostToolDescriptors?.map((descriptor) => descriptor.name);
  const effectiveToolNames = composedToolNames
    ? customToolNames.filter((name) => composedToolNames.includes(name))
    : customToolNames;

  const hostToolboxTargetNames = hostToolFamilyIndex
    ? resolvedPolicy.enabledFamilies
        .filter((family) => CONVERSATION_TOOLBOX_FAMILIES.has(family))
        .flatMap((family) => hostToolFamilyIndex.get(family) ?? [])
        .sort()
    : [];
  const modelHostTools = projectModelHostTools(
    effectiveToolNames,
    options.hostToolDescriptors,
    hostToolboxTargetNames,
  );

  return {
    tools: {
      enabledFamilies: resolvedPolicy.enabledFamilies,
      piBuiltinToolNames: resolvedPolicy.piBuiltinToolNames,
      hostTools: modelHostTools,
      enabledMcpServerIds: [],
    },
    searchRoute,
    hostToolboxTargetNames,
  };
}
