import type { ToolCardUi } from './chat-reducer';
import { resolveToolClusterKind, type ToolClusterKind, type BatchClusterSummary } from './tool-group-clustering';

function isArgsDumpText(text: string | undefined): boolean {
  const trimmed = text?.trim() ?? '';
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

export function formatActiveToolLabel(tool: ToolCardUi, isChinese: boolean): string {
  const presentation = tool.presentation;
  // Streaming summaries can still be a half-parsed args dump (`{"pattern":…`).
  const summary = isArgsDumpText(presentation?.summary) ? undefined : presentation?.summary?.trim();
  const target =
    presentation?.targetPaths?.[0] ||
    summary ||
    presentation?.command?.trim() ||
    presentation?.title ||
    tool.toolName;
  const clusterKind = resolveToolClusterKind(tool);

  if (clusterKind === 'read') {
    return isChinese ? `正在读取: ${target}` : `Reading ${target}`;
  }
  if (clusterKind === 'search') {
    return isChinese ? `正在检索: ${target}` : `Searching ${target}`;
  }
  if (clusterKind === 'web') {
    return isChinese ? `正在抓取: ${target}` : `Fetching ${target}`;
  }
  if (clusterKind === 'command') {
    return isChinese ? `正在执行: ${target}` : `Running ${target}`;
  }
  return isChinese ? `正在执行: ${target}` : `Executing ${target}`;
}

/**
 * One collapsed-title wording shared by both capsule variants (within-message
 * batch + cross-message explore flow) so the transcript never shows two
 * different phrasings for the same idea.
 */
export function formatExploreCapsuleTitle(input: {
  fileCount: number;
  searchCount: number;
  totalCount: number;
  live: boolean;
  isChinese: boolean;
}): string {
  if (input.live) {
    return input.isChinese ? '正在探索代码库' : 'Exploring codebase';
  }
  const files = input.fileCount;
  const searches = input.searchCount;
  if (input.isChinese) {
    if (files > 0 && searches > 0) return `探索了 ${files} 个文件 · ${searches} 次搜索`;
    if (files > 0) return `探索了 ${files} 个文件`;
    if (searches > 0) return `搜索了 ${searches} 处代码`;
    return `探索了 ${input.totalCount} 项`;
  }
  if (files > 0 && searches > 0) {
    return `Explored ${files} file${files === 1 ? '' : 's'} · ${searches} search${
      searches === 1 ? '' : 'es'
    }`;
  }
  if (files > 0) return `Explored ${files} file${files === 1 ? '' : 's'}`;
  if (searches > 0) return `Searched ${searches} location${searches === 1 ? '' : 's'}`;
  return `Explored ${input.totalCount} items`;
}

/** Proto: `<b>探索了 N 个文件</b><span>· M 次搜索</span>` — bold lead, quiet rest. */
export function exploreFlowTitleParts(
  group: {
    fileCount: number;
    searchCount: number;
    totalCount?: number;
    toolCount?: number;
    isLive?: boolean;
    cancelledCount?: number;
    errorCount?: number;
  },
  isChinese: boolean,
): { lead: string; rest: string | null } {
  const isLive = Boolean(group.isLive);
  const totalCount = group.totalCount ?? group.toolCount ?? 0;
  if (!isLive && (group.cancelledCount ?? 0) > 0 && (group.errorCount ?? 0) === 0) {
    return { lead: isChinese ? '已停止' : 'Stopped', rest: null };
  }
  if (isLive) {
    return {
      lead: formatExploreCapsuleTitle({
        fileCount: group.fileCount,
        searchCount: group.searchCount,
        totalCount,
        live: true,
        isChinese,
      }),
      rest: null,
    };
  }
  const files = group.fileCount;
  const searches = group.searchCount;
  if (isChinese) {
    if (files > 0 && searches > 0) {
      return { lead: `探索了 ${files} 个文件`, rest: ` · ${searches} 次搜索` };
    }
    return {
      lead: formatExploreCapsuleTitle({
        fileCount: files,
        searchCount: searches,
        totalCount,
        live: false,
        isChinese,
      }),
      rest: null,
    };
  }
  if (files > 0 && searches > 0) {
    return {
      lead: `Explored ${files} file${files === 1 ? '' : 's'}`,
      rest: ` · ${searches} search${searches === 1 ? '' : 'es'}`,
    };
  }
  return {
    lead: formatExploreCapsuleTitle({
      fileCount: files,
      searchCount: searches,
      totalCount,
      live: false,
      isChinese,
    }),
    rest: null,
  };
}

export function getBatchTitle(
  kind: ToolClusterKind,
  summary: BatchClusterSummary,
  isChinese: boolean,
): string {
  const count = summary.totalCount;

  if (kind === 'explore' || kind === 'read' || kind === 'search') {
    return formatExploreCapsuleTitle({
      fileCount: summary.fileCount ?? 0,
      searchCount: summary.searchCount ?? 0,
      totalCount: count,
      live: false,
      isChinese,
    });
  }

  if (isChinese) {
    switch (kind) {
      case 'command':
        return `执行了 ${count} 条排查命令`;
      case 'web':
        return `进行了 ${count} 次网络检索与抓取`;
      default:
        return `执行了 ${count} 项操作`;
    }
  }

  switch (kind) {
    case 'command':
      return `Executed ${count} diagnostic commands`;
    case 'web':
      return `Fetched ${count} web resources`;
    default:
      return `Executed ${count} actions`;
  }
}

export function getRunningBatchTitle(
  kind: ToolClusterKind,
  summary: BatchClusterSummary,
  isChinese: boolean,
): string {
  if (kind === 'explore' || kind === 'read' || kind === 'search') {
    return formatExploreCapsuleTitle({
      fileCount: summary.fileCount ?? 0,
      searchCount: summary.searchCount ?? 0,
      totalCount: summary.totalCount,
      live: true,
      isChinese,
    });
  }

  if (isChinese) {
    return `正在执行 ${summary.totalCount} 项操作…`;
  }
  return `Executing ${summary.totalCount} actions…`;
}

