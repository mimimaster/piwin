/** Pure resolver: capability exposure + availability → SessionToolPolicy (spec §9). */

import type {
  CapabilityExposure,
  FlashcardsAccess,
  NotesAccess,
  SessionToolFamily,
  SessionToolPolicy,
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
};

export type ToolExposureInput = {
  webSearch: boolean;
  webFetch: boolean;
  mcp: boolean;
  imageGeneration: boolean;
  process: CapabilityExposure;
  browser: CapabilityExposure;
  subagents: CapabilityExposure;
  notes: NotesAccess;
  flashcards: FlashcardsAccess;
  availability: ToolBackingAvailability;
};

/** Concrete custom tool names per family. */
export const FAMILY_CUSTOM_TOOLS: Readonly<Record<SessionToolFamily, readonly string[]>> = {
  'filesystem-read': [],
  'filesystem-write': [],
  shell: [],
  'web-search': ['web_search'],
  'web-fetch': ['web_fetch'],
  mcp: ['mcp_gateway'],
  process: ['process_start', 'process_list', 'process_logs', 'process_stop'],
  browser: ['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type'],
  planning: ['piwin_plan_create', 'piwin_plan_set_step'],
  delegate: ['piwin_subagent_run'],
  'notes-read': ['note_search', 'note_list', 'note_read'],
  'notes-write': ['note_write', 'note_update', 'note_delete'],
  'flashcards-read': ['flashcard_list'],
  'flashcards-write': ['flashcard_create', 'flashcard_batch_create', 'flashcard_delete'],
  'image-generation': ['image_gen'],
};

/** Pi built-in tool names mapped from product capabilities (filesystem/shell). */
export const FAMILY_PI_BUILTIN_TOOLS: Readonly<Record<SessionToolFamily, readonly string[]>> = {
  'filesystem-read': ['read', 'grep', 'find', 'ls'],
  'filesystem-write': ['write', 'edit'],
  shell: ['bash'],
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
  'image-generation': [],
};

/**
 * Compile the enabled tool families for a session from configured exposure
 * intersected with backing availability (spec §9.3 resolution order).
 */
export function resolveToolPolicy(input: ToolExposureInput): SessionToolPolicy {
  const enabledFamilies = new Set<SessionToolFamily>();

  // Web search: master AND at least one ready source.
  if (input.webSearch && input.availability.webSearchReady) {
    enabledFamilies.add('web-search');
  }
  // Web fetch: independent master AND ready provider.
  if (input.webFetch && input.availability.webFetchReady) {
    enabledFamilies.add('web-fetch');
  }
  // MCP: master AND at least one enabled server.
  if (input.mcp && input.availability.mcpEnabledServerIds.length > 0) {
    enabledFamilies.add('mcp');
  }
  // Process: exposure 'agent' AND backing service ready.
  if (input.process === 'agent' && input.availability.processReady) {
    enabledFamilies.add('process');
  }
  // Browser: exposure 'agent' AND browser backend available.
  if (input.browser === 'agent' && input.availability.browserReady) {
    enabledFamilies.add('browser');
  }
  // Notes: read level implies at least read; write level implies both.
  if (input.notes === 'agent-read' || input.notes === 'agent-read-write') {
    enabledFamilies.add('notes-read');
  }
  if (input.notes === 'agent-read-write') {
    enabledFamilies.add('notes-write');
  }
  // Flashcards: agent-create implies read (review) + create.
  if (input.flashcards === 'agent-create') {
    enabledFamilies.add('flashcards-read');
    enabledFamilies.add('flashcards-write');
  }
  // Image generation: master AND valid model available.
  if (input.imageGeneration && input.availability.imageGenerationReady) {
    enabledFamilies.add('image-generation');
  }
  // Subagents exposure does not gate tool registration by itself; it gates
  // spawn commands via the session policy.

  const customToolNames = new Set<string>();
  const piBuiltinToolNames = new Set<string>();
  for (const family of enabledFamilies) {
    for (const name of FAMILY_CUSTOM_TOOLS[family]) customToolNames.add(name);
    for (const name of FAMILY_PI_BUILTIN_TOOLS[family]) piBuiltinToolNames.add(name);
  }

  return {
    enabledFamilies: [...enabledFamilies].sort(),
    piBuiltinToolNames: [...piBuiltinToolNames].sort(),
    customToolNames: [...customToolNames].sort(),
    enabledMcpServerIds: input.availability.mcpEnabledServerIds,
  };
}
