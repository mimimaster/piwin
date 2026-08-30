/**
 * Net a path's first-before/last-after from an ordered file-action sequence.
 * A broken before/after chain omits that path and marks coverage incomplete.
 */

export type ComposedFileAction = {
  relativePath: string;
  beforeSha: string | null;
  afterSha: string | null;
  beforeExists: boolean;
  afterExists: boolean;
};

export type ComposeCoverage = 'complete' | 'incomplete';

export function composeFileActions(
  actions: readonly ComposedFileAction[],
): {
  coverage: ComposeCoverage;
  files: readonly ComposedFileAction[];
} {
  if (actions.length === 0) {
    return { coverage: 'complete', files: [] };
  }

  const groups = new Map<string, ComposedFileAction[]>();
  for (const action of actions) {
    const existing = groups.get(action.relativePath);
    if (existing) {
      existing.push(action);
    } else {
      groups.set(action.relativePath, [action]);
    }
  }

  let coverage: ComposeCoverage = 'complete';
  const files: ComposedFileAction[] = [];

  for (const [relativePath, pathActions] of groups) {
    if (!chainIsComplete(pathActions)) {
      coverage = 'incomplete';
      continue;
    }
    const first = pathActions[0];
    const last = pathActions[pathActions.length - 1];
    if (!first || !last) {
      continue;
    }
    if (first.beforeSha === last.afterSha && first.beforeExists === last.afterExists) {
      continue;
    }
    files.push({
      relativePath,
      beforeSha: first.beforeSha,
      afterSha: last.afterSha,
      beforeExists: first.beforeExists,
      afterExists: last.afterExists,
    });
  }

  return { coverage, files };
}

function chainIsComplete(pathActions: readonly ComposedFileAction[]): boolean {
  for (let index = 1; index < pathActions.length; index += 1) {
    const previous = pathActions[index - 1];
    const current = pathActions[index];
    if (!previous || !current) {
      return false;
    }
    if (previous.afterSha !== current.beforeSha || previous.afterExists !== current.beforeExists) {
      return false;
    }
  }
  return true;
}
