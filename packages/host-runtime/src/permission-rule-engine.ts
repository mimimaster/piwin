/**
 * Permission rule engine (ADR 0019 §1).
 *
 * Pure function that evaluates a PermissionSubject against a PermissionRuleSet
 * using deny→ask→allow order, first-match-wins within a tier.
 */

import type { PermissionRule, PermissionRuleSet, PermissionSubject } from '@piwin/contracts';

/**
 * Match a bash command against a glob pattern.
 *
 * NOT shell-semantic: this is a simple string matcher with `*` wildcard
 * support. The `*` matches any sequence of characters (including spaces) and
 * is case-insensitive.
 *
 * For bundled rules that require regex precision, patterns starting with
 * `re:` are treated as regular expressions (case-insensitive). This is a
 * pragmatic choice to preserve non-regression while keeping the public API
 * glob-based for user-configurable rules.
 *
 * @param pattern - Glob pattern (or `re:`-prefixed regex for bundled rules)
 * @param command - The bash command to match
 * @returns true if the pattern matches the command
 */
export function matchBashGlob(pattern: string, command: string): boolean {
  const normalizedCommand = command.trim();
  if (!normalizedCommand) {
    return false;
  }

  // Check for regex prefix (bundled rules).
  // Invalid regex is a developer bug in bundled/user rules and must surface
  // loudly rather than silently degrading to a literal match (AGENTS.md §3.3).
  if (pattern.startsWith('re:')) {
    const regexPattern = pattern.slice(3);
    const regex = new RegExp(regexPattern, 'i');
    return regex.test(normalizedCommand);
  }

  // Simple glob matching with * wildcard
  const normalizedPattern = pattern.trim().toLowerCase();
  const normalizedCommandLower = normalizedCommand.toLowerCase();

  // Exact match
  if (normalizedPattern === normalizedCommandLower) {
    return true;
  }

  // Wildcard matching
  const patternParts = normalizedPattern.split('*');
  if (patternParts.length === 1) {
    // No wildcard, exact match only
    return false;
  }

  // Check if the command starts with the first part
  if (!normalizedCommandLower.startsWith(patternParts[0]!)) {
    return false;
  }

  // Check if the command ends with the last part (if not empty)
  const lastPart = patternParts[patternParts.length - 1];
  if (lastPart && lastPart.length > 0 && !normalizedCommandLower.endsWith(lastPart)) {
    return false;
  }

  // For simple patterns like "npm run *", just check prefix
  // This is a simplified glob matcher that works for the common cases
  if (patternParts.length === 2) {
    const prefix = patternParts[0]!;
    const suffix = patternParts[1]!;
    if (suffix.length === 0) {
      // Pattern ends with *, just check prefix
      return normalizedCommandLower.startsWith(prefix);
    }
    // Check both prefix and suffix
    return normalizedCommandLower.startsWith(prefix) && normalizedCommandLower.endsWith(suffix);
  }

  // For more complex patterns with multiple *, check all parts in order
  let commandIndex = 0;
  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i]!;
    if (part.length === 0) {
      continue; // Empty part between **
    }

    const partIndex = normalizedCommandLower.indexOf(part, commandIndex);
    if (partIndex === -1) {
      return false;
    }
    commandIndex = partIndex + part.length;
  }

  // If the last part is empty, we don't need to check end
  if (patternParts[patternParts.length - 1]!.length === 0) {
    return true;
  }

  // Check that we matched to the end
  return commandIndex >= normalizedCommandLower.length;
}

/**
 * Match a file path against a glob pattern.
 *
 * Supports `*` (matches within a single path segment) and `**` (matches any
 * number of path segments). Patterns are expected to be absolute paths with
 * `~` already expanded to the home directory by the loader. A literal `~` in
 * the pattern is treated as a literal character and will not match real
 * (expanded) paths, which surfaces loader bugs rather than masking them.
 *
 * @param pattern - Glob pattern with `*` and `**` support
 * @param absPath - Absolute path to match
 * @returns true if the pattern matches the path
 */
export function matchPathGlob(pattern: string, absPath: string): boolean {
  const normalizedPattern = pattern.trim();
  const normalizedPath = absPath.trim();

  if (!normalizedPattern || !normalizedPath) {
    return false;
  }

  // Exact match
  if (normalizedPattern === normalizedPath) {
    return true;
  }

  const patternParts = normalizedPattern.split('/');
  const pathParts = normalizedPath.split('/');

  // Helper to match a single pattern segment against a path segment
  const matchSegment = (patternSeg: string, pathSeg: string): boolean => {
    if (patternSeg === '**') {
      return true; // ** is handled at the segment list level
    }
    if (patternSeg === '*') {
      return pathSeg.length > 0;
    }
    if (patternSeg.includes('*') && !patternSeg.includes('**')) {
      // Simple glob within segment
      const regexPattern = patternSeg.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
      return new RegExp(`^${regexPattern}$`).test(pathSeg);
    }
    return patternSeg === pathSeg;
  };

  // Recursive matcher for segment lists
  const matchSegments = (patternIdx: number, pathIdx: number): boolean => {
    // If we've consumed all pattern segments
    if (patternIdx >= patternParts.length) {
      return pathIdx >= pathParts.length;
    }

    const patternSeg = patternParts[patternIdx]!;

    // Handle ** - matches zero or more segments
    if (patternSeg === '**') {
      // Try matching zero segments
      if (matchSegments(patternIdx + 1, pathIdx)) {
        return true;
      }
      // Try matching one or more segments
      if (pathIdx < pathParts.length) {
        return matchSegments(patternIdx, pathIdx + 1);
      }
      return false;
    }

    // If we've consumed all path segments but have pattern left
    if (pathIdx >= pathParts.length) {
      return false;
    }

    const pathSeg = pathParts[pathIdx]!;

    // Match current segment
    if (matchSegment(patternSeg, pathSeg)) {
      return matchSegments(patternIdx + 1, pathIdx + 1);
    }

    return false;
  };

  return matchSegments(0, 0);
}

/**
 * Match a hostname against a glob pattern.
 *
 * Supports `*` as a wildcard for subdomains. Case-insensitive.
 * A pattern like `*.example.com` matches `api.example.com` but NOT `example.com`.
 *
 * @param pattern - Host glob pattern
 * @param host - Hostname to match
 * @returns true if the pattern matches the host
 */
export function matchHostGlob(pattern: string, host: string): boolean {
  const normalizedPattern = pattern.trim().toLowerCase();
  const normalizedHost = host.trim().toLowerCase();

  if (!normalizedPattern || !normalizedHost) {
    return false;
  }

  // Exact match
  if (normalizedPattern === normalizedHost) {
    return true;
  }

  // Wildcard matching for subdomains
  if (normalizedPattern.startsWith('*.')) {
    const suffix = normalizedPattern.slice(2);
    // Must have at least one subdomain before the suffix
    return normalizedHost.endsWith('.' + suffix) && normalizedHost !== suffix;
  }

  // Simple * anywhere in the pattern
  if (normalizedPattern.includes('*')) {
    const regexPattern = normalizedPattern.replace(/\*/g, '.*').replace(/\./g, '\\.');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(normalizedHost);
  }

  return false;
}

/**
 * Test whether a single rule's target matches a subject.
 *
 * Rules whose target kind differs from the subject kind never match. For kinds
 * without a pattern field (`web-search`, `git`, `process`, `notes-mutate`), any
 * rule of the same kind matches.
 */
function ruleMatchesSubject(rule: PermissionRule, subject: PermissionSubject): boolean {
  if (rule.target.kind !== subject.kind) {
    return false;
  }

  switch (rule.target.kind) {
    case 'bash':
      return subject.kind === 'bash' && matchBashGlob(rule.target.pattern, subject.command);
    case 'file-write':
      return subject.kind === 'file-write' && matchPathGlob(rule.target.pathGlob, subject.path);
    case 'web-fetch':
      return subject.kind === 'web-fetch' && matchHostGlob(rule.target.hostGlob, subject.host);
    case 'web-search':
    case 'git':
    case 'process':
    case 'notes-mutate':
      // For these kinds, any rule of the same kind matches
      // (they don't have pattern fields)
      return true;
  }
}

/**
 * Find the first rule that matches the subject, scanning tiers in deny → ask →
 * allow order. Returns `undefined` when no rule matches.
 *
 * Exposed so callers (e.g. `permission-policy.ts`) can surface the matching
 * rule's `reason` alongside its decision.
 */
export function findMatchingRule(
  subject: PermissionSubject,
  rules: PermissionRuleSet,
): PermissionRule | undefined {
  for (const rule of rules.deny) {
    if (ruleMatchesSubject(rule, subject)) {
      return rule;
    }
  }
  for (const rule of rules.ask) {
    if (ruleMatchesSubject(rule, subject)) {
      return rule;
    }
  }
  for (const rule of rules.allow) {
    if (ruleMatchesSubject(rule, subject)) {
      return rule;
    }
  }
  return undefined;
}

/**
 * Evaluate a subject against a rule set.
 *
 * Evaluation order: deny → ask → allow. First match wins within a tier.
 * Specificity does not override tier order. Rules whose target kind does not
 * match the subject kind are ignored.
 *
 * @param input - Subject and rules to evaluate
 * @returns 'allow' | 'ask' | 'deny' | 'no-match'
 */
export function evaluateRules(input: {
  subject: PermissionSubject;
  rules: PermissionRuleSet;
}): 'allow' | 'ask' | 'deny' | 'no-match' {
  const { subject, rules } = input;
  const matched = findMatchingRule(subject, rules);
  if (!matched) {
    return 'no-match';
  }
  return matched.decision;
}
