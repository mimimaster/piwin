/**
 * Override Pi's builtin `grep` so a path-prefixed glob matches.
 *
 * Why (2026-09-28, session-muk44phu-f37m4mrt): Pi runs
 * `rg --glob <glob> -- <pattern> <absolute search path>` without setting the
 * child's cwd, and ripgrep anchors a slash-containing glob to its own process
 * cwd. The Host process cwd is the app bundle
 * (`/Applications/piwin.app/Contents/Resources/host`), so a glob such as
 * `packages/host-runtime/src/**\/*.ts` silently returned "No matches found"
 * for content that existed (38 of 51 grep calls in that Run; 87 of 93
 * path-prefixed greps across recent sessions). The model saw `read` and
 * `grep` contradict each other and kept re-reading files instead of acting.
 *
 * Pi's own `find` tool already solves the same anchoring by prefixing `**\/`
 * onto slash-containing patterns; this applies that rule to `grep` without
 * forking Pi. Custom tools overwrite builtins by name in Pi's registry, and
 * `excludeTools` still applies, so the override only exists when the session
 * policy grants `grep`.
 */

export type GrepToolParams = {
  pattern: string;
  path?: string;
  glob?: string;
  [key: string]: unknown;
};

/**
 * Make a slash-containing glob independent of the ripgrep process cwd.
 * Basename globs (`*.ts`), already-floating globs (`**\/…`), and absolute
 * globs are left alone. A negated glob keeps its `!`.
 */
export function anchorGrepGlob(glob: string | undefined): string | undefined {
  if (glob === undefined) return undefined;
  const trimmed = glob.trim();
  const negated = trimmed.startsWith('!');
  const body = (negated ? trimmed.slice(1) : trimmed).replace(/^(\.\/)+/, '');
  if (!body.includes('/') || body.startsWith('/') || body.startsWith('**/') || body === '**') {
    return glob;
  }
  return `${negated ? '!' : ''}**/${body}`;
}

type PiToolDefinition = {
  name: string;
  execute: (toolCallId: string, params: GrepToolParams, ...rest: unknown[]) => unknown;
  [key: string]: unknown;
};

export function createCwdAnchoredPiGrepToolDefinition(input: {
  cwd: string;
  piModule: Record<string, unknown>;
}): PiToolDefinition | null {
  const createGrepToolDefinition = input.piModule.createGrepToolDefinition;
  if (typeof createGrepToolDefinition !== 'function') {
    return null;
  }
  const base = (createGrepToolDefinition as (cwd: string) => unknown)(input.cwd);
  if (!isPiToolDefinition(base)) {
    return null;
  }
  return {
    ...base,
    execute: (toolCallId, params, ...rest) => {
      const glob = anchorGrepGlob(params.glob);
      const anchored: GrepToolParams =
        glob === undefined || glob === params.glob ? params : { ...params, glob };
      return base.execute(toolCallId, anchored, ...rest);
    },
  };
}

export function mergeCwdAnchoredGrepTool(
  customTools: unknown[] | undefined,
  input: { cwd: string; piModule: Record<string, unknown> },
): unknown[] | undefined {
  // A Host-owned `grep` (if a policy ever registers one) must keep winning.
  if (customTools?.some((tool) => isNamed(tool, 'grep'))) {
    return customTools;
  }
  const grep = createCwdAnchoredPiGrepToolDefinition(input);
  if (!grep) {
    return customTools;
  }
  return [...(customTools ?? []), grep];
}

function isPiToolDefinition(value: unknown): value is PiToolDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { name?: unknown }).name === 'grep' &&
    typeof (value as { execute?: unknown }).execute === 'function'
  );
}

function isNamed(tool: unknown, name: string): boolean {
  return typeof tool === 'object' && tool !== null && (tool as { name?: unknown }).name === name;
}
