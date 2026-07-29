/**
 * Bundled permission rule defaults (ADR 0019 §3.1).
 *
 * These are the safety baseline rules that ship with the product. They are
 * merged with user-configured rules at session start. Bundled deny and ask
 * rules cannot be allowed away by lower layers (tier order).
 */

import { homedir } from 'node:os';
import type { PermissionRule, PermissionRuleSet } from '@piwin/contracts';
import { createEmptyRuleSet } from '@piwin/contracts';

/**
 * Bundled deny rules for bash commands.
 *
 * These patterns preserve the existing DENY_PATTERNS from permission-policy.ts
 * with stable reason strings for non-regression. Complex patterns use the `re:`
 * prefix to indicate regex matching.
 */
export const BUNDLED_DENY: PermissionRule[] = [
  {
    target: { kind: 'bash', pattern: 're:curl\\s+[^\\n|]*\\|\\s*(?:ba)?sh' },
    decision: 'deny',
    reason: 'pipe-to-shell',
  },
  {
    target: { kind: 'bash', pattern: 're:wget\\s+[^\\n|]*\\|\\s*(?:ba)?sh' },
    decision: 'deny',
    reason: 'wget-pipe-shell',
  },
  {
    target: { kind: 'bash', pattern: '*mkfs*' },
    decision: 'deny',
    reason: 'mkfs',
  },
  {
    target: { kind: 'bash', pattern: 're:dd\\s+if=.+\\s+of=/dev/' },
    decision: 'deny',
    reason: 'disk-destroy',
  },
  {
    target: {
      kind: 'bash',
      pattern:
        're:\\brm\\s+(-[a-zA-Z]*r[a-zA-Z]*f|-rf|-fr)\\s+(\\/\\s*$|\\/\\*\\s*$|\\/~\\s*$|~\\s*$)',
    },
    decision: 'deny',
    reason: 'rm-root',
  },
  {
    target: { kind: 'bash', pattern: 're::\\(\\)\\s*\\{\\s*:\\|:\\s*&\\s*\\}\\s*;\\s*:' },
    decision: 'deny',
    reason: 'fork-bomb',
  },
  {
    target: { kind: 'bash', pattern: 're:\\b(shutdown|reboot|halt|poweroff)\\b' },
    decision: 'deny',
    reason: 'shutdown',
  },
  {
    target: { kind: 'bash', pattern: 're:curl\\s+[^\\n;|&]*\\|\\s*(?:python|perl|ruby|node)\\b' },
    decision: 'deny',
    reason: 'curl-eval',
  },
  // File-write deny rules for secret paths (ADR 0019 §3.1).
  // The `~` in pathGlobs is expanded by createBundledRuleSet() before matching.
  {
    target: { kind: 'file-write', pathGlob: '~/.piwin/**' },
    decision: 'deny',
    reason: 'piwin-config',
  },
  {
    target: { kind: 'file-write', pathGlob: '~/.ssh/**' },
    decision: 'deny',
    reason: 'secret-ssh',
  },
  {
    target: { kind: 'file-write', pathGlob: '**/.env' },
    decision: 'deny',
    reason: 'secret-env',
  },
  {
    target: { kind: 'file-write', pathGlob: '**/.env.*' },
    decision: 'deny',
    reason: 'secret-env',
  },
  {
    target: { kind: 'file-write', pathGlob: '**/*.pem' },
    decision: 'deny',
    reason: 'secret-key',
  },
  {
    target: { kind: 'file-write', pathGlob: '**/*.key' },
    decision: 'deny',
    reason: 'secret-key',
  },
  {
    target: { kind: 'file-write', pathGlob: '**/id_rsa' },
    decision: 'deny',
    reason: 'secret-ssh',
  },
  {
    target: { kind: 'file-write', pathGlob: '**/id_ed25519' },
    decision: 'deny',
    reason: 'secret-ssh',
  },
  {
    target: { kind: 'file-write', pathGlob: '**/credentials.json' },
    decision: 'deny',
    reason: 'secret-credentials',
  },
  {
    target: { kind: 'file-write', pathGlob: '**/secrets.*' },
    decision: 'deny',
    reason: 'secret-file',
  },
];

/**
 * Bundled ask rules for bash commands.
 *
 * These patterns preserve the existing ASK_PATTERNS from permission-policy.ts
 * with stable reason strings for non-regression. Complex patterns use the `re:`
 * prefix to indicate regex matching.
 */
export const BUNDLED_ASK_BASH: PermissionRule[] = [
  {
    target: { kind: 'bash', pattern: 're:\\brm\\s+(-[a-zA-Z]*r[a-zA-Z]*f|-rf|-fr)\\b' },
    decision: 'ask',
    reason: 'rm-recursive-force',
  },
  {
    target: { kind: 'bash', pattern: '*sudo*' },
    decision: 'ask',
    reason: 'sudo',
  },
  {
    target: { kind: 'bash', pattern: 're:\\bgit\\s+push\\b[^\\n]*\\s--force\\b' },
    decision: 'ask',
    reason: 'force-push',
  },
  {
    target: { kind: 'bash', pattern: 're:\\bgit\\s+push\\b[^\\n]*\\s--force-with-lease\\b' },
    decision: 'ask',
    reason: 'force-with-lease',
  },
  {
    target: {
      kind: 'bash',
      pattern: 're:(?:^|[;&|])\\s*(?:tee|cp|mv|echo|cat)\\b[^\\n]*\\.env\\b',
    },
    decision: 'ask',
    reason: 'write-env',
  },
  {
    target: { kind: 'bash', pattern: 're:\\bchmod\\s+(-R\\s+)?777\\b' },
    decision: 'ask',
    reason: 'chmod-777',
  },
];

/**
 * Bundled ask rules for file-write operations.
 *
 * Includes the ~/.config/** pattern to protect sensitive config directories.
 * The pattern uses ~ which is expanded by createBundledRuleSet() before matching.
 */
export const BUNDLED_ASK_FILE_WRITE: PermissionRule[] = [
  {
    target: { kind: 'file-write', pathGlob: '~/.config/**' },
    decision: 'ask',
    reason: 'config-write',
  },
];

/**
 * Bundled allow rules for safe bash command prefixes.
 *
 * These are visible safe commands that are useful mainly under ask-all mode.
 * They provide a baseline of safe operations that users can rely on.
 */
export const BUNDLED_ALLOW: PermissionRule[] = [
  {
    target: { kind: 'bash', pattern: 'ls *' },
    decision: 'allow',
    reason: 'safe-ls',
  },
  {
    target: { kind: 'bash', pattern: 'cat *' },
    decision: 'allow',
    reason: 'safe-cat',
  },
  {
    target: { kind: 'bash', pattern: 'head *' },
    decision: 'allow',
    reason: 'safe-head',
  },
  {
    target: { kind: 'bash', pattern: 'tail *' },
    decision: 'allow',
    reason: 'safe-tail',
  },
  {
    target: { kind: 'bash', pattern: 'grep *' },
    decision: 'allow',
    reason: 'safe-grep',
  },
  {
    target: { kind: 'bash', pattern: 'rg *' },
    decision: 'allow',
    reason: 'safe-rg',
  },
  {
    target: { kind: 'bash', pattern: 'git status' },
    decision: 'allow',
    reason: 'safe-git-status',
  },
  {
    target: { kind: 'bash', pattern: 'git diff *' },
    decision: 'allow',
    reason: 'safe-git-diff',
  },
  {
    target: { kind: 'bash', pattern: 'git log *' },
    decision: 'allow',
    reason: 'safe-git-log',
  },
  {
    target: { kind: 'bash', pattern: 'pnpm test' },
    decision: 'allow',
    reason: 'safe-pnpm-test',
  },
  {
    target: { kind: 'bash', pattern: 'pnpm typecheck' },
    decision: 'allow',
    reason: 'safe-pnpm-typecheck',
  },
  {
    target: { kind: 'bash', pattern: 'npm test' },
    decision: 'allow',
    reason: 'safe-npm-test',
  },
];

/**
 * Expand ~ to the home directory in a pathGlob pattern.
 *
 * @param pattern - Pattern possibly starting with ~
 * @returns Pattern with ~ expanded to home directory
 */
function expandHomeDir(pattern: string): string {
  if (pattern.startsWith('~/')) {
    return homedir() + pattern.slice(1);
  }
  return pattern;
}

/**
 * Create the complete bundled rule set.
 *
 * Combines all bundled deny, ask, and allow rules into a single PermissionRuleSet.
 * Expands ~ to the home directory in pathGlob patterns before returning.
 *
 * @returns The bundled rule set with ~ expanded
 */
export function createBundledRuleSet(): PermissionRuleSet {
  const rules = createEmptyRuleSet();

  // Expand ~ in file-write pathGlob patterns for deny rules, then add them.
  const expandedDenyRules: PermissionRule[] = BUNDLED_DENY.map((rule) => {
    if (rule.target.kind !== 'file-write') {
      return rule;
    }
    return {
      ...rule,
      target: {
        kind: 'file-write',
        pathGlob: expandHomeDir(rule.target.pathGlob),
      },
    };
  });
  rules.deny.push(...expandedDenyRules);

  rules.ask.push(...BUNDLED_ASK_BASH);

  // Expand ~ in file-write pathGlob patterns for ask rules.
  const expandedFileWriteRules: PermissionRule[] = BUNDLED_ASK_FILE_WRITE.map((rule) => {
    if (rule.target.kind !== 'file-write') {
      return rule;
    }
    return {
      ...rule,
      target: {
        kind: 'file-write',
        pathGlob: expandHomeDir(rule.target.pathGlob),
      },
    };
  });
  rules.ask.push(...expandedFileWriteRules);

  rules.allow.push(...BUNDLED_ALLOW);
  return rules;
}
