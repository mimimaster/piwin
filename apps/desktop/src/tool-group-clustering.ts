import type { ToolCardUi } from './chat-reducer';

export type ToolClusterKind =
  | 'explore'
  | 'search'
  | 'read'
  | 'command'
  | 'web'
  | 'edit'
  | 'subagent'
  | 'other';

export type BatchClusterSummary = {
  totalCount: number;
  hasRunning: boolean;
  activeTool?: ToolCardUi;
  hasError: boolean;
  errorCount: number;
  totalDurationMs?: number;
  keyTargets: string[];
  fileCount?: number;
  searchCount?: number;
};

export type ClusteredToolItem =
  | { kind: 'single'; tool: ToolCardUi }
  | {
      kind: 'batch';
      clusterKind: ToolClusterKind;
      tools: ToolCardUi[];
      summary: BatchClusterSummary;
    };

/** Classify a tool into a high-level semantic cluster. */
export function resolveToolClusterKind(tool: ToolCardUi): ToolClusterKind {
  const name = (tool.toolName || '').toLowerCase().trim();
  const verb = (tool.presentation?.actionVerb || '').toLowerCase().trim();
  const kind = tool.presentation?.kind;

  if (tool.presentation?.kind === 'subagent' || name === 'piwin_subagent_run') {
    return 'subagent';
  }

  // 1. Check action verbs from presentation
  if (verb === 'searched' || verb === 'explored') return 'search';
  if (verb === 'read') return 'read';
  if (verb === 'edited') return 'edit';
  if (verb === 'ran command' || verb === 'ran tests' || verb === 'built') return 'command';
  if (verb === 'fetched') return 'web';

  // 2. Check tool name patterns
  if (
    name.includes('grep') ||
    name.includes('search') ||
    name.includes('find') ||
    name.includes('locate')
  ) {
    return 'search';
  }
  if (
    name.includes('glob') ||
    name.includes('list_dir') ||
    name === 'ls' ||
    name.includes('read') ||
    name.includes('view') ||
    name.includes('cat')
  ) {
    return 'read';
  }
  if (
    name.includes('write') ||
    name.includes('edit') ||
    name.includes('replace') ||
    name.includes('patch')
  ) {
    return 'edit';
  }
  if (
    name.includes('bash') ||
    name.includes('shell') ||
    name.includes('command') ||
    name.includes('exec') ||
    name.includes('terminal') ||
    name.includes('test') ||
    name.includes('build')
  ) {
    return 'command';
  }
  if (
    name.includes('web') ||
    name.includes('fetch') ||
    name.includes('browser') ||
    name.includes('url')
  ) {
    return 'web';
  }

  // 3. Fallback to host ToolKind
  switch (kind) {
    case 'filesystem':
      return 'read';
    case 'shell':
    case 'process':
      return 'command';
    case 'web':
      return 'web';
    default:
      return 'other';
  }
}

/** Check if a cluster kind is considered part of the read-only exploratory phase. */
export function isExploratoryKind(kind: ToolClusterKind): boolean {
  return kind === 'explore' || kind === 'read' || kind === 'search' || kind === 'web';
}

/** Extract human-friendly target previews from tools in a batch. */
function extractKeyTargets(tools: ToolCardUi[]): string[] {
  const targets = new Set<string>();

  for (const tool of tools) {
    if (targets.size >= 4) break;
    const kind = resolveToolClusterKind(tool);

    if (kind === 'read' || kind === 'explore') {
      const paths = tool.presentation?.targetPaths ?? [];
      for (const path of paths) {
        const basename = path.split(/[/\\]/).pop()?.trim();
        if (basename) targets.add(basename);
        if (targets.size >= 4) break;
      }
    } else if (kind === 'search') {
      const summary = tool.presentation?.summary?.trim();
      const countTag = tool.presentation?.countTag?.trim();
      if (countTag) {
        targets.add(countTag);
      } else if (summary && !summary.startsWith('{') && !summary.startsWith('[')) {
        targets.add(summary.length > 20 ? `${summary.slice(0, 18)}…` : summary);
      }
    } else if (kind === 'command') {
      const cmd = tool.presentation?.command?.trim();
      if (cmd) {
        const firstPart = cmd.split(/\s+/).slice(0, 2).join(' ');
        if (firstPart) {
          targets.add(firstPart.length > 20 ? `${firstPart.slice(0, 18)}…` : firstPart);
        }
      }
    } else if (kind === 'web') {
      const summary = tool.presentation?.summary?.trim();
      if (summary && !summary.startsWith('{')) {
        targets.add(summary.length > 20 ? `${summary.slice(0, 18)}…` : summary);
      }
    }
  }

  return Array.from(targets);
}

/** Compute aggregate summary for a batch of tools. */
export function computeBatchSummary(
  _clusterKind: ToolClusterKind,
  tools: ToolCardUi[],
): BatchClusterSummary {
  let hasDuration = false;
  let totalDurationMs = 0;
  let errorCount = 0;
  let hasRunning = false;
  let activeTool: ToolCardUi | undefined;

  const uniqueFiles = new Set<string>();
  let searchCount = 0;

  for (const tool of tools) {
    if (typeof tool.presentation?.durationMs === 'number') {
      hasDuration = true;
      totalDurationMs += tool.presentation.durationMs;
    }
    if (tool.status === 'error') {
      errorCount += 1;
    }
    if (tool.status === 'running') {
      hasRunning = true;
      if (!activeTool) {
        activeTool = tool;
      }
    }

    const subKind = resolveToolClusterKind(tool);
    if (subKind === 'search') {
      searchCount += 1;
    }
    const paths = tool.presentation?.targetPaths ?? [];
    for (const p of paths) {
      if (p) uniqueFiles.add(p);
    }
  }

  const fileCount = uniqueFiles.size > 0 ? uniqueFiles.size : tools.length - searchCount;

  return {
    totalCount: tools.length,
    hasRunning,
    ...(activeTool ? { activeTool } : {}),
    hasError: errorCount > 0,
    errorCount,
    ...(hasDuration ? { totalDurationMs } : {}),
    keyTargets: extractKeyTargets(tools),
    fileCount: Math.max(0, fileCount),
    searchCount,
  };
}

/**
 * Cluster consecutive exploratory tool calls (read, search, web) into an 'explore' capsule.
 * Other tools like commands form their own consecutive batches.
 * Edits, subagents, and custom tools remain standalone single items.
 */
export function clusterToolCalls(tools: ToolCardUi[]): ClusteredToolItem[] {
  if (!tools || tools.length === 0) {
    return [];
  }

  const clustered: ClusteredToolItem[] = [];
  let currentBatch: { kind: ToolClusterKind; tools: ToolCardUi[] } | null = null;

  function flushBatch() {
    if (!currentBatch) return;

    if (currentBatch.tools.length >= 2) {
      clustered.push({
        kind: 'batch',
        clusterKind: currentBatch.kind,
        tools: currentBatch.tools,
        summary: computeBatchSummary(currentBatch.kind, currentBatch.tools),
      });
    } else {
      for (const tool of currentBatch.tools) {
        clustered.push({ kind: 'single', tool });
      }
    }
    currentBatch = null;
  }

  for (const tool of tools) {
    const rawKind = resolveToolClusterKind(tool);

    if (isExploratoryKind(rawKind)) {
      // Group all exploratory actions together into a unified 'explore' cluster
      if (currentBatch && currentBatch.kind === 'explore') {
        currentBatch.tools.push(tool);
      } else {
        flushBatch();
        currentBatch = { kind: 'explore', tools: [tool] };
      }
    } else if (rawKind === 'command') {
      // Group consecutive commands together
      if (currentBatch && currentBatch.kind === 'command') {
        currentBatch.tools.push(tool);
      } else {
        flushBatch();
        currentBatch = { kind: 'command', tools: [tool] };
      }
    } else {
      // Edits, subagents, and other side-effect tools are standalone
      flushBatch();
      clustered.push({ kind: 'single', tool });
    }
  }

  flushBatch();
  return clustered;
}
