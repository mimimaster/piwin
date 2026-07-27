/**
 * Host customTools for cross-session memory (CE-MEM).
 * Pure tool descriptors; PermissionPolicy wraps execute at registration.
 */
import type {
  MemoryListFilter,
  MemorySearchQuery,
  MemoryUpdateInput,
  MemoryWriteInput,
  PermissionDecision,
} from '@piwin/contracts';
import type { MemoryStore } from '@piwin/memory';
import type { HostToolDefinition } from '@piwin/tools-web';
import {
  evaluateMemoryPermission,
  resolveNonInteractiveDecision,
  type MemoryPermissionAction,
} from './permission-policy.js';
import type { ToolPermissionGate } from './session-tools.js';

export type BuildMemoryToolsOptions = {
  store: MemoryStore;
  /** When false, returns no tools. */
  enabled: boolean;
  defaultProjectKey?: string;
  requestPermission?: ToolPermissionGate;
};

const MEMORY_TOOL_ACTIONS: Record<string, MemoryPermissionAction> = {
  memory_list: 'memory_list',
  memory_search: 'memory_search',
  memory_read: 'memory_read',
  memory_write: 'memory_write',
  memory_update: 'memory_update',
  memory_delete: 'memory_delete',
  memory_accept: 'memory_accept',
};

export function buildMemoryTools(options: BuildMemoryToolsOptions): HostToolDefinition[] {
  if (!options.enabled) {
    return [];
  }
  const bare = createMemoryToolDefinitions(options.store, options.defaultProjectKey);
  return bare.map((tool) => wrapMemoryToolWithPermission(tool, options.requestPermission));
}

function createMemoryToolDefinitions(
  store: MemoryStore,
  defaultProjectKey?: string,
): HostToolDefinition[] {
  return [
    {
      name: 'memory_list',
      description:
        'List cross-session memories (global and/or project). Returns JSON array of records.',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['global', 'project'], description: 'Optional scope filter' },
          projectKey: { type: 'string', description: 'Project key when scope=project' },
          type: {
            type: 'string',
            enum: ['user', 'feedback', 'project', 'reference', 'daily'],
          },
          limit: { type: 'number' },
        },
      },
      async execute(args) {
        const filter: MemoryListFilter = {};
        if (args.scope === 'global' || args.scope === 'project') filter.scope = args.scope;
        const projectKey =
          typeof args.projectKey === 'string' && args.projectKey
            ? args.projectKey
            : defaultProjectKey;
        if (projectKey && filter.scope === 'project') filter.projectKey = projectKey;
        if (
          args.type === 'user' ||
          args.type === 'feedback' ||
          args.type === 'project' ||
          args.type === 'reference' ||
          args.type === 'daily'
        ) {
          filter.type = args.type;
        }
        if (typeof args.limit === 'number') filter.limit = args.limit;
        const records = await store.list(filter);
        return JSON.stringify(records, null, 2);
      },
    },
    {
      name: 'memory_search',
      description: 'Search memories by keyword. Returns ranked hits with snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          scope: { type: 'string', enum: ['global', 'project'] },
          projectKey: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
      async execute(args) {
        const searchQuery: MemorySearchQuery = {
          query: String(args.query ?? ''),
        };
        if (args.scope === 'global' || args.scope === 'project') searchQuery.scope = args.scope;
        const projectKey =
          typeof args.projectKey === 'string' && args.projectKey
            ? args.projectKey
            : defaultProjectKey;
        if (projectKey) searchQuery.projectKey = projectKey;
        if (typeof args.limit === 'number') searchQuery.limit = args.limit;
        const hits = await store.search(searchQuery);
        return JSON.stringify(hits, null, 2);
      },
    },
    {
      name: 'memory_read',
      description: 'Read a single memory by id.',
      parameters: {
        type: 'object',
        properties: {
          memoryId: { type: 'string' },
        },
        required: ['memoryId'],
      },
      async execute(args) {
        const record = await store.read(String(args.memoryId ?? ''));
        return JSON.stringify(record, null, 2);
      },
    },
    {
      name: 'memory_write',
      description:
        'Write a new memory. Prefer scope=project for project-specific facts; use quote for high confidence.',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['global', 'project'] },
          projectKey: { type: 'string' },
          type: {
            type: 'string',
            enum: ['user', 'feedback', 'project', 'reference', 'daily'],
          },
          title: { type: 'string' },
          content: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low', 'unknown'] },
          quote: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['scope', 'type', 'content'],
      },
      async execute(args) {
        const writeInput: MemoryWriteInput = {
          scope: args.scope === 'project' ? 'project' : 'global',
          type:
            args.type === 'feedback' ||
            args.type === 'project' ||
            args.type === 'reference' ||
            args.type === 'daily'
              ? args.type
              : 'user',
          content: String(args.content ?? ''),
        };
        const projectKey =
          typeof args.projectKey === 'string' && args.projectKey
            ? args.projectKey
            : writeInput.scope === 'project'
              ? defaultProjectKey
              : undefined;
        if (writeInput.scope === 'project') {
          if (!projectKey) {
            throw new Error('projectKey required for project-scoped memory_write');
          }
          writeInput.projectKey = projectKey;
        }
        if (typeof args.title === 'string') writeInput.title = args.title;
        if (
          args.confidence === 'high' ||
          args.confidence === 'medium' ||
          args.confidence === 'low' ||
          args.confidence === 'unknown'
        ) {
          writeInput.confidence = args.confidence;
        }
        if (typeof args.quote === 'string') writeInput.quote = args.quote;
        if (Array.isArray(args.tags)) {
          writeInput.tags = args.tags.filter((item): item is string => typeof item === 'string');
        }
        const record = await store.write(writeInput);
        return JSON.stringify(record, null, 2);
      },
    },
    {
      name: 'memory_update',
      description: 'Update an existing memory by id.',
      parameters: {
        type: 'object',
        properties: {
          memoryId: { type: 'string' },
          title: { type: 'string' },
          content: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low', 'unknown'] },
          quote: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          type: {
            type: 'string',
            enum: ['user', 'feedback', 'project', 'reference', 'daily'],
          },
        },
        required: ['memoryId'],
      },
      async execute(args) {
        const updateInput: MemoryUpdateInput = { id: String(args.memoryId ?? '') };
        if (typeof args.title === 'string') updateInput.title = args.title;
        if (typeof args.content === 'string') updateInput.content = args.content;
        if (typeof args.quote === 'string') updateInput.quote = args.quote;
        if (
          args.confidence === 'high' ||
          args.confidence === 'medium' ||
          args.confidence === 'low' ||
          args.confidence === 'unknown'
        ) {
          updateInput.confidence = args.confidence;
        }
        if (Array.isArray(args.tags)) {
          updateInput.tags = args.tags.filter((item): item is string => typeof item === 'string');
        }
        if (
          args.type === 'user' ||
          args.type === 'feedback' ||
          args.type === 'project' ||
          args.type === 'reference' ||
          args.type === 'daily'
        ) {
          updateInput.type = args.type;
        }
        const record = await store.update(updateInput);
        return JSON.stringify(record, null, 2);
      },
    },
    {
      name: 'memory_delete',
      description: 'Delete a memory by id.',
      parameters: {
        type: 'object',
        properties: {
          memoryId: { type: 'string' },
        },
        required: ['memoryId'],
      },
      async execute(args) {
        const result = await store.delete(String(args.memoryId ?? ''));
        return JSON.stringify(result, null, 2);
      },
    },
    {
      name: 'memory_accept',
      description:
        'Mark a memory as reviewed (accept). Sets reviewedAt and may raise confidence to high.',
      parameters: {
        type: 'object',
        properties: {
          memoryId: { type: 'string' },
        },
        required: ['memoryId'],
      },
      async execute(args) {
        const record = await store.accept(String(args.memoryId ?? ''));
        return JSON.stringify(record, null, 2);
      },
    },
  ];
}

function wrapMemoryToolWithPermission(
  tool: HostToolDefinition,
  requestPermission?: ToolPermissionGate,
): HostToolDefinition {
  const action = MEMORY_TOOL_ACTIONS[tool.name];
  if (!action) {
    return tool;
  }
  return {
    ...tool,
    async execute(args, signal) {
      const detail =
        typeof args.memoryId === 'string'
          ? args.memoryId
          : typeof args.query === 'string'
            ? args.query
            : typeof args.content === 'string'
              ? String(args.content).slice(0, 120)
              : tool.name;
      const evaluation = evaluateMemoryPermission(action, detail);
      let decision: PermissionDecision = evaluation.decision;
      if (decision === 'ask') {
        if (requestPermission) {
          decision = await requestPermission({
            action: `memory:${action}`,
            detail,
            defaultDecision: 'ask',
            ...(signal ? { signal } : {}),
          });
        } else {
          decision = resolveNonInteractiveDecision(evaluation);
        }
      }
      if (decision !== 'allow') {
        throw new Error(
          `Permission ${decision} for ${action}: ${evaluation.reason} (${detail.slice(0, 120)})`,
        );
      }
      return tool.execute(args, signal);
    },
  };
}
