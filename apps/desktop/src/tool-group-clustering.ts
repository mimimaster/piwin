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

/** Split `grep_search` / `readFile` / `web-fetch` into lowercase word tokens. */
function toolNameTokens(toolName: string): string[] {
  return toolName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/**
 * Classify a tool into a high-level semantic cluster.
 *
 * Host `actionVerb` / `kind` win. Name matching is a legacy fallback and works
 * on whole tokens: substring matching folded `send_notification` (cat),
 * `code_review` (view) and `browser_click` (browser) into read-only explore
 * capsules, hiding side effects inside a collapsed "探索了 N 项".
 */
export function resolveToolClusterKind(tool: ToolCardUi): ToolClusterKind {
  const name = (tool.toolName || '').toLowerCase().trim();
  const verb = (tool.presentation?.actionVerb || '').toLowerCase().trim();
  const kind = tool.presentation?.kind;

  if (kind === 'subagent' || name === 'piwin_subagent_run') {
    return 'subagent';
  }

  // 1. Host-authored action verbs
  if (verb === 'searched' || verb === 'explored') return 'search';
  if (verb === 'read') return 'read';
  if (verb === 'edited') return 'edit';
  if (verb === 'ran command' || verb === 'ran tests' || verb === 'built') return 'command';
  if (verb === 'fetched') return 'web';

  // 2. Host kinds that are never read-only exploration, whatever the name says
  if (kind === 'shell' || kind === 'process') return 'command';
  if (
    kind === 'mcp' ||
    kind === 'git' ||
    kind === 'image' ||
    kind === 'video' ||
    kind === 'health' ||
    verb.startsWith('mcp') ||
    verb.startsWith('git') ||
    name.startsWith('mcp__') ||
    name.includes('.')
  ) {
    return 'other';
  }

  // 3. Legacy name tokens
  const tokens = toolNameTokens(tool.toolName || '');
  const hasToken = (...words: string[]): boolean => words.some((word) => tokens.includes(word));
  // Browser automation clicks/types/navigates: side effects, not exploration.
  if (hasToken('browser', 'playwright', 'puppeteer', 'git')) return 'other';
  if (hasToken('grep', 'rg', 'ripgrep', 'search', 'find', 'locate')) return 'search';
  if (hasToken('glob', 'ls', 'dir', 'tree', 'read', 'view', 'cat')) return 'read';
  if (hasToken('write', 'edit', 'editor', 'multiedit', 'replace', 'patch')) return 'edit';
  if (hasToken('bash', 'shell', 'command', 'cmd', 'exec', 'terminal', 'test', 'tests', 'build')) {
    return 'command';
  }
  if (hasToken('web', 'websearch', 'webfetch', 'fetch', 'url', 'http')) return 'web';

  // 4. Fallback to host ToolKind
  switch (kind) {
    case 'filesystem':
      return 'read';
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

/**
 * Distinct files an explore group actually read. Search/explore targets are
 * directories and glob patterns (`src`, `**` globs), not files, and a failed
 * read explored nothing.
 */
export function countExploredFiles(tools: readonly ToolCardUi[]): number {
  const files = new Set<string>();
  for (const tool of tools) {
    if (tool.status === 'error' || resolveToolClusterKind(tool) !== 'read') continue;
    const paths = (tool.presentation?.targetPaths ?? []).filter((path) => path.trim().length > 0);
    if (paths.length === 0) {
      files.add(`call:${tool.toolCallId}`);
      continue;
    }
    for (const path of paths) files.add(path);
  }
  return files.size;
}

/**
 * Tool-busy time for a group. Parallel calls overlap, so summing `durationMs`
 * reported three parallel 2s reads as 6s. Timestamped calls merge as a union
 * of intervals; calls with only `durationMs` are added as-is.
 */
export function summarizeToolBusyMs(tools: readonly ToolCardUi[]): number | undefined {
  const intervals: Array<{ start: number; end: number }> = [];
  let untimedMs = 0;
  let hasDuration = false;
  for (const tool of tools) {
    const presentation = tool.presentation;
    const start = presentation?.startedAt ? Date.parse(presentation.startedAt) : Number.NaN;
    const end = presentation?.endedAt ? Date.parse(presentation.endedAt) : Number.NaN;
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      intervals.push({ start, end });
      hasDuration = true;
    } else if (typeof presentation?.durationMs === 'number') {
      untimedMs += presentation.durationMs;
      hasDuration = true;
    }
  }
  if (!hasDuration) return undefined;
  intervals.sort((left, right) => left.start - right.start);
  let busyMs = 0;
  let open: { start: number; end: number } | undefined;
  for (const interval of intervals) {
    if (open && interval.start <= open.end) {
      open.end = Math.max(open.end, interval.end);
      continue;
    }
    if (open) busyMs += open.end - open.start;
    open = { ...interval };
  }
  if (open) busyMs += open.end - open.start;
  return busyMs + untimedMs;
}

/** Compute aggregate summary for a batch of tools. */
export function computeBatchSummary(
  _clusterKind: ToolClusterKind,
  tools: ToolCardUi[],
): BatchClusterSummary {
  let errorCount = 0;
  let hasRunning = false;
  let activeTool: ToolCardUi | undefined;
  let searchCount = 0;

  for (const tool of tools) {
    if (tool.status === 'error' && tool.presentation?.error?.category !== 'cancelled') {
      errorCount += 1;
    }
    if (tool.status === 'running') {
      hasRunning = true;
      if (!activeTool) {
        activeTool = tool;
      }
    }
    if (resolveToolClusterKind(tool) === 'search') {
      searchCount += 1;
    }
  }

  const totalDurationMs = summarizeToolBusyMs(tools);

  return {
    totalCount: tools.length,
    hasRunning,
    ...(activeTool ? { activeTool } : {}),
    hasError: errorCount > 0,
    errorCount,
    ...(totalDurationMs !== undefined ? { totalDurationMs } : {}),
    keyTargets: extractKeyTargets(tools),
    fileCount: countExploredFiles(tools),
    searchCount,
  };
}

/**
 * Cluster consecutive exploratory tool calls (read, search, web) into an 'explore' capsule.
 * Commands, edits, subagents, and custom tools remain standalone single items
 * so each shell row stays a collapsed "Ran …" line and edits stay clickable.
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
    } else {
      // Commands, edits, subagents, and other side-effect tools are standalone
      flushBatch();
      clustered.push({ kind: 'single', tool });
    }
  }

  flushBatch();
  return clustered;
}
