/**
 * CE-SUB-PROF: built-in subagent profiles.
 *
 * Built-ins are host-owned recipes with no hardcoded model. They inherit the
 * parent/default configured model until the user selects a configured model
 * in Settings. Settings overrides merge over these by id.
 *
 * Do not maintain a grocery list of "read-like" tools. Omit `capabilities`
 * and `skillIds` so the child uses the same tool surface as the parent.
 * Isolation is the hard split: readonly scouts cannot mutate; worktree
 * children may. Scout identity ("do not edit") is also in the seed prompt.
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
    description: 'Read-only codebase exploration, symbol discovery, and evidence gathering',
    isolation: 'readonly',
    source: 'builtin',
  },
  {
    id: 'reviewer',
    description: 'Read-only diff analysis, bug finding, and code review',
    isolation: 'readonly',
    source: 'builtin',
  },
  {
    id: 'implementer',
    description: 'Isolated code implementation with write and run permissions in a git worktree',
    isolation: 'worktree',
    source: 'builtin',
  },
  {
    id: 'tester',
    description: 'Isolated test suite execution and test fixture generation in a git worktree',
    isolation: 'worktree',
    source: 'builtin',
  },
];
