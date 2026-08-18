/** Pure resolver: capability exposure + availability → SessionToolPolicy (spec §9). */

import type {
  CapabilityExposure,
  FlashcardsAccess,
  NotesAccess,
  SessionToolFamily,
  SessionToolPolicy,
  SubagentCapability,
} from '@piwin/contracts';

/**
 * Backing-service availability. `false` means the family cannot be enabled
 * even if the configured exposure allows it (e.g. no ready search source).
 */
export type ToolBackingAvailability = {
  webSearchReady: boolean;
  webFetchReady: boolean;
  mcpEnabledServerIds: string[];
  processReady: boolean;
  browserReady: boolean;
  imageGenerationReady: boolean;
  videoGenerationReady: boolean;
};

export type ToolExposureInput = {
  webSearch: boolean;
  webFetch: boolean;
  mcp: boolean;
  imageGeneration: boolean;
  videoGeneration: boolean;
  process: CapabilityExposure;
  browser: CapabilityExposure;
  subagents: CapabilityExposure;
  notes: NotesAccess;
  flashcards: FlashcardsAccess;
  artifact?: boolean;
  availability: ToolBackingAvailability;
  /** Optional child ceiling used by the live Blueprint compiler. */
  capabilities?: readonly SubagentCapability[];
  /** Readonly child mode removes mutating/side-effecting families. */
  readonly?: boolean;
  /** Untrusted projects remove mutating/side-effecting families. */
  trusted?: boolean;
  /** Host registration families available in this generation. */
  availableFamilies?: ReadonlySet<SessionToolFamily>;
  /** Explicit exposure switches for families not represented by legacy settings. */
  filesystemRead?: boolean;
  filesystemWrite?: boolean;
  shell?: boolean;
  planning?: boolean;
  delegate?: boolean;
  notesEnabled?: boolean;
  flashcardsEnabled?: boolean;
  imageGenerationEnabled?: boolean;
  videoGenerationEnabled?: boolean;
};

/** Pi built-in tool names mapped from product capabilities (filesystem/shell). */
export const FAMILY_PI_BUILTIN_TOOLS: Readonly<Record<SessionToolFamily, readonly string[]>> = {
  'filesystem-read': ['read', 'grep', 'ls'],
  // Product writes and shell execution are Host-owned registrations. They are
  // intentionally not delegated to Pi-native tools in the worker.
  'filesystem-write': [],
  shell: [],
  'web-search': [],
  'web-fetch': [],
  mcp: [],
  process: [],
  browser: [],
  planning: [],
  delegate: [],
  'notes-read': [],
  'notes-write': [],
  'flashcards-read': [],
  'flashcards-write': [],
  artifact: [],
  toolbox: [],
  'image-generation': [],
  'video-generation': [],
};

/**
 * Compile the enabled tool families for a session from configured exposure
 * intersected with backing availability (spec §9.3 resolution order).
 */
export type ResolvedToolPolicy = {
  policy: SessionToolPolicy;
  /** Static names for the enabled families; dynamic MCP names are added by Host. */
  customToolNames: string[];
};

export function resolveToolPolicy(input: ToolExposureInput): SessionToolPolicy {
  return resolveToolPolicyDetails(input).policy;
}

export function resolveToolPolicyDetails(input: ToolExposureInput): ResolvedToolPolicy {
  const enabledFamilies = new Set<SessionToolFamily>();
  const capabilities = input.capabilities;
  const hasCapability = (capability: SubagentCapability): boolean =>
    capabilities === undefined || capabilities.includes(capability);
  const canMutate = input.readonly !== true && input.trusted !== false;
  const hasRead = hasCapability('read');
  const hasWrite = hasCapability('write');
  const hasExecute = hasCapability('execute');
  const hasNetwork = hasCapability('network');
  const hasBrowser = hasCapability('browser');
  const hasPlanning = hasCapability('planning');
  const hasDelegate = hasCapability('delegate');
  const hasMcp = hasCapability('mcp');

  if ((input.filesystemRead ?? hasRead) && hasRead) {
    enabledFamilies.add('filesystem-read');
  }
  if ((input.filesystemWrite ?? hasWrite) && hasWrite && canMutate) {
    enabledFamilies.add('filesystem-write');
  }
  if ((input.shell ?? input.process === 'agent') && hasExecute && canMutate) {
    enabledFamilies.add('shell');
  }

  // Web search: master AND at least one ready source.
  if (input.webSearch && input.availability.webSearchReady && hasNetwork) {
    enabledFamilies.add('web-search');
  }
  // Web fetch: independent master AND ready provider.
  if (input.webFetch && input.availability.webFetchReady && hasNetwork) {
    enabledFamilies.add('web-fetch');
  }
  // MCP is a stable gateway family. The gateway remains exposed when there
  // are currently no enabled servers; the Supervisor resolves the selector
  // at call time and reports the current server/tool state.
  // MCP catalog is served through piwin_toolbox. The family stays enabled when
  // the toolbox shell is registered even if no dedicated MCP tool exists, and
  // when there are currently zero enabled servers.
  const mcpCatalogAvailable = input.availableFamilies
    ? input.availableFamilies.has('mcp') ||
      (input.mcp && input.availableFamilies.has('toolbox'))
    : input.availability.mcpEnabledServerIds.length > 0;
  if (input.mcp && hasMcp && mcpCatalogAvailable) {
    enabledFamilies.add('mcp');
  }
  // Process: exposure 'agent' AND backing service ready.
  if (input.process === 'agent' && hasExecute && canMutate && input.availability.processReady) {
    enabledFamilies.add('process');
  }
  // Browser: exposure 'agent' AND browser backend available.
  if (input.browser === 'agent' && hasBrowser && canMutate && input.availability.browserReady) {
    enabledFamilies.add('browser');
  }
  // Notes: read level implies at least read; write level implies both.
  if (
    input.notesEnabled !== false &&
    capabilities === undefined &&
    (input.notes === 'agent-read' || input.notes === 'agent-read-write')
  ) {
    enabledFamilies.add('notes-read');
  }
  if (
    input.notesEnabled !== false &&
    capabilities === undefined &&
    input.notes === 'agent-read-write'
  ) {
    enabledFamilies.add('notes-write');
  }
  // Flashcards: agent-create implies read + write. agent-read is review-only
  // (Doc Cards presentation sessions must not grow a second deck).
  if (
    input.flashcardsEnabled !== false &&
    capabilities === undefined &&
    (input.flashcards === 'agent-create' || input.flashcards === 'agent-read')
  ) {
    enabledFamilies.add('flashcards-read');
  }
  if (
    input.flashcardsEnabled !== false &&
    capabilities === undefined &&
    input.flashcards === 'agent-create'
  ) {
    enabledFamilies.add('flashcards-write');
  }
  if (input.artifact === true && capabilities === undefined) {
    enabledFamilies.add('artifact');
  }
  if (input.availableFamilies?.has('toolbox')) {
    enabledFamilies.add('toolbox');
  }
  // Image generation: master AND valid model available.
  if (
    input.imageGeneration &&
    input.imageGenerationEnabled !== false &&
    capabilities === undefined &&
    input.availability.imageGenerationReady
  ) {
    enabledFamilies.add('image-generation');
  }
  // Video generation: master AND valid model available.
  if (
    input.videoGeneration &&
    input.videoGenerationEnabled !== false &&
    capabilities === undefined &&
    input.availability.videoGenerationReady
  ) {
    enabledFamilies.add('video-generation');
  }
  if ((input.delegate ?? input.subagents === 'agent') && hasDelegate && canMutate) {
    enabledFamilies.add('delegate');
  }
  if ((input.planning ?? false) && hasPlanning) {
    enabledFamilies.add('planning');
  }

  const effectiveFamilies = input.availableFamilies
    ? [...enabledFamilies].filter(
        (family) =>
          input.availableFamilies?.has(family) === true ||
          family === 'artifact' ||
          (family === 'mcp' && input.mcp && input.availableFamilies?.has('toolbox') === true),
      )
    : [...enabledFamilies];

  const piBuiltinToolNames = new Set<string>();
  for (const family of effectiveFamilies) {
    for (const name of FAMILY_PI_BUILTIN_TOOLS[family]) piBuiltinToolNames.add(name);
  }

  const policy: SessionToolPolicy = {
    hostTools: [],
    enabledFamilies: effectiveFamilies.sort(),
    piBuiltinToolNames: [...piBuiltinToolNames],
    enabledMcpServerIds: input.availability.mcpEnabledServerIds,
  };
  // Concrete Host tool names come only from the generation's registration
  // index. Returning an empty compatibility projection here prevents this
  // resolver from becoming a second executable tool manifest.
  return { policy, customToolNames: [] };
}
