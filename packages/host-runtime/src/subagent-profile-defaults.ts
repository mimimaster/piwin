/**
 * CE-SUB-PROF: built-in subagent profiles.
 *
 * Built-ins are host-owned recipes with no hardcoded model. They inherit the
 * parent/default configured model until the user selects a configured model
 * in Settings. Settings overrides merge over these by id.
 */

import type { SubagentProfile } from '@piwin/contracts';

/** Built-in profile ids. */
export const BUILTIN_SUBAGENT_PROFILE_IDS = [
  'explorer',
  'reviewer',
  'implementer',
  'tester',
] as const;

export const BUILTIN_SUBAGENT_PROFILES: readonly SubagentProfile[] = [
  {
    id: 'explorer',
    description: 'Fast read-only codebase exploration',
    capabilities: ['read'],
    skillIds: [],
    isolation: 'readonly',
    source: 'builtin',
  },
  {
    id: 'reviewer',
    description: 'Read-only code review and analysis',
    capabilities: ['read'],
    skillIds: [],
    isolation: 'readonly',
    source: 'builtin',
  },
  {
    id: 'implementer',
    description: 'Isolated implementation with write and execute',
    capabilities: ['read', 'write', 'execute'],
    isolation: 'worktree',
    source: 'builtin',
  },
  {
    id: 'tester',
    description: 'Isolated test execution and fixture writes',
    capabilities: ['read', 'execute'],
    isolation: 'worktree',
    source: 'builtin',
  },
];
