import type { ToolCardUi } from './chat-reducer';

export type ToolClusterKind =
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

/** Extract human-friendly target previews from tools in a batch. */
function extractKeyTargets(clusterKind: ToolClusterKind, tools: ToolCardUi[]): string[] {
  const targets = new Set<string>();

  for (const tool of tools) {
    if (targets.size >= 3) break;

    if (clusterKind === 'read') {
      const paths = tool.presentation?.targetPaths ?? [];
      for (const path of paths) {
        const basename = path.split(/[/\\]/).pop()?.trim();
        if (basename) targets.add(basename);
        if (targets.size >= 3) break;
      }
    } else if (clusterKind === 'search') {
      const summary = tool.presentation?.summary?.trim();
      const countTag = tool.presentation?.countTag?.trim();
      if (countTag) {
        targets.add(countTag);
      } else if (summary && !summary.startsWith('{') && !summary.startsWith('[')) {
        targets.add(summary.length > 20 ? `${summary.slice(0, 18)}…` : summary);
      }
    } else if (clusterKind === 'command') {
      const cmd = tool.presentation?.command?.trim();
      if (cmd) {
        // Extract command name / first couple arguments
        const firstPart = cmd.split(/\s+/).slice(0, 2).join(' ');
        if (firstPart) {
          targets.add(firstPart.length > 20 ? `${firstPart.slice(0, 18)}…` : firstPart);
        }
      }
    } else if (clusterKind === 'web') {
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
  clusterKind: ToolClusterKind,
  tools: ToolCardUi[],
): BatchClusterSummary {
  let hasDuration = false;
  let totalDurationMs = 0;
  let errorCount = 0;
  let hasRunning = false;
  let activeTool: ToolCardUi | undefined;

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
  }

  return {
    totalCount: tools.length,
    hasRunning,
    ...(activeTool ? { activeTool } : {}),
    hasError: errorCount > 0,
    errorCount,
    ...(hasDuration ? { totalDurationMs } : {}),
    keyTargets: extractKeyTargets(clusterKind, tools),
  };
}

const BATCHABLE_KINDS = new Set<ToolClusterKind>(['search', 'read', 'command', 'web']);

/**
 * Cluster consecutive tool calls of the same category into a batch capsule.
 * Isolated single calls or non-batchable tools (like subagents or edits) remain single.
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
    const clusterKind = resolveToolClusterKind(tool);

    if (BATCHABLE_KINDS.has(clusterKind)) {
      if (currentBatch && currentBatch.kind === clusterKind) {
        currentBatch.tools.push(tool);
      } else {
        flushBatch();
        currentBatch = { kind: clusterKind, tools: [tool] };
      }
    } else {
      flushBatch();
      clustered.push({ kind: 'single', tool });
    }
  }

  flushBatch();
  return clustered;
}
