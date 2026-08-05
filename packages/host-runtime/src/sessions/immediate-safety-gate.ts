/**
 * Immediate safety gate (repair spec WP2).
 *
 * The controller records which Settings domains changed after the active
 * runtime generation was created. A subset of those domains *tightens*
 * safety immediately: new side-effect calls against the old generation must
 * fail closed without waiting for the replacement candidate to compile.
 *
 * This module maps a pending tightening domain to the tool families/risks it
 * blocks, and builds the port-level `ToolDisablePredicate`. Read-only tools
 * are never blocked; already-running calls are never interrupted.
 */

import type {
  HostToolExecutionContext,
  HostToolRegistration,
  PermissionRiskKind,
  SessionToolFamily,
  SettingsDomain,
} from '@piwin/contracts';
import { isImmediateTighteningDomain } from '@piwin/contracts';
import type { ToolDisablePredicate } from '../tools/host-tool-execution-router.js';

/**
 * Decide whether `domain`'s tightening blocks `registration`.
 *
 * When the affected scope cannot be determined precisely (e.g. an MCP server
 * was removed but we cannot map every selector), we fail closed toward the
 * larger affected set rather than allowing a side effect through.
 */
export function isToolBlockedByTightening(
  domain: SettingsDomain,
  registration: HostToolRegistration,
): boolean {
  const spec = registration.permissionSpec;
  if (spec.readOnly === true) {
    // Read-only queries continue during tightening (repair spec WP2.3).
    return false;
  }
  const family = registration.family;
  const risk: PermissionRiskKind = spec.risk;

  switch (domain) {
    case 'permissions':
      // Any non-read-only permissionSpec is blocked when the permission
      // policy tightens (rules, preset, mode, allowlists).
      return true;
    case 'web':
      return (
        family === 'web-search' ||
        family === 'web-fetch' ||
        family === 'browser' ||
        risk === 'network'
      );
    case 'process':
      return family === 'process' || risk === 'command';
    case 'notes':
      return family === 'notes-write';
    case 'flashcards':
      return family === 'flashcards-write';
    case 'subagents':
      return family === 'delegate';
    case 'mcp':
      // Removed / disabled / trust-tightened servers cannot be mapped per
      // selector here; fail closed for the whole mcp family.
      return family === 'mcp';
    default:
      return false;
  }
}

export type ImmediateSafetyGateState = {
  /** Domains that changed since the active generation was created. */
  pendingDomains: readonly SettingsDomain[];
};

export type BuildImmediateSafetyPredicateOptions = {
  /** Read the live pending tightening domains for a session. */
  getPendingDomains: (sessionId: string) => readonly SettingsDomain[];
};

/**
 * Build the production safety predicate. The predicate reads the controller's
 * live state on every call — a settings change updates the gate immediately,
 * without waiting for the candidate generation to compile.
 */
export function createImmediateSafetyPredicate(
  options: BuildImmediateSafetyPredicateOptions,
): ToolDisablePredicate {
  return (registration, _args, context: HostToolExecutionContext) => {
    const pendingDomains = options.getPendingDomains(context.sessionId);
    for (const domain of pendingDomains) {
      if (!isImmediateTighteningDomain(domain)) {
        continue;
      }
      if (isToolBlockedByTightening(domain, registration)) {
        return {
          domain,
          message: `${domain} settings tightened; this tool is disabled until the runtime generation is rebuilt`,
        };
      }
    }
    return null;
  };
}

/** Convenience helper for tests / diagnostics: tightening domains only. */
export function immediateTighteningDomains(domains: readonly SettingsDomain[]): SettingsDomain[] {
  return domains.filter(isImmediateTighteningDomain);
}

export type { SessionToolFamily };
