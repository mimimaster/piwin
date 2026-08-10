/**
 * Normalize free-form "install by ID" input from the Desktop Pet panel.
 * Accepts bare slugs and common CLI paste forms so users can paste either.
 */
import { isPetSlug } from './sources/install-manifest.js';

export type ParsedPetInstallInput =
  | { kind: 'slug'; slug: string }
  | { kind: 'error'; message: string };

const COMMAND_PATTERNS: RegExp[] = [
  // npx [--yes|-y] codex-pets[@ver] add <slug>
  /(?:npx|npm\s+exec)\s+(?:--yes\s+|-y\s+)?codex-pets(?:@[\w.-]+)?\s+add\s+["']?([a-z0-9][a-z0-9_-]*)["']?/i,
  // npx [--yes|-y] codexpethub[@ver] install <slug>
  /(?:npx|npm\s+exec)\s+(?:--yes\s+|-y\s+)?codexpethub(?:@[\w.-]+)?\s+install\s+["']?([a-z0-9][a-z0-9_-]*)["']?/i,
  // codex-pets add <slug>  (without npx)
  /(?:^|\s)codex-pets(?:@[\w.-]+)?\s+add\s+["']?([a-z0-9][a-z0-9_-]*)["']?/i,
  // codexpethub install <slug>
  /(?:^|\s)codexpethub(?:@[\w.-]+)?\s+install\s+["']?([a-z0-9][a-z0-9_-]*)["']?/i,
];

/**
 * Extract a pet slug from:
 * - `guga`
 * - `npx codex-pets add guga`
 * - `npx codexpethub install guga`
 * - quoted variants / @version package tags
 */
export function parsePetInstallInput(raw: string): ParsedPetInstallInput {
  const trimmed = raw.trim().replace(/^['"]|['"]$/g, '');
  if (!trimmed) {
    return { kind: 'error', message: 'empty pet install input' };
  }

  for (const pattern of COMMAND_PATTERNS) {
    const match = trimmed.match(pattern);
    const captured = match?.[1]?.trim();
    if (captured && isPetSlug(captured)) {
      return { kind: 'slug', slug: captured.toLowerCase() };
    }
  }

  // Bare slug (no spaces / no protocol)
  if (!trimmed.includes('://') && !trimmed.includes(' ') && isPetSlug(trimmed)) {
    return { kind: 'slug', slug: trimmed.toLowerCase() };
  }

  // Looks like a command paste that we failed to parse
  if (/\bnpx\b|codex-pets|codexpethub/i.test(trimmed)) {
    return {
      kind: 'error',
      message:
        'could not parse pet id from command — try the bare id only (e.g. guga)',
    };
  }

  return {
    kind: 'error',
    message: `invalid pet id: ${trimmed} (use alphanumeric id with -/_ , or paste: npx codex-pets add <id>)`,
  };
}
