/** Stable identity for the merged permission rules frozen by a generation. */

import { createHash } from 'node:crypto';
import type { PermissionRuleSet } from '@piwin/contracts';

/**
 * Compute a content revision for a materialized PermissionRuleSet.
 *
 * The loader and bundled defaults produce deterministic bucket/order shapes;
 * hashing that exact shape makes rule-file changes observable without adding
 * a mutable counter to product state.
 */
export function computePermissionRulesRevision(rules: PermissionRuleSet): string {
  return createHash('sha256').update(JSON.stringify(rules)).digest('hex').slice(0, 12);
}
