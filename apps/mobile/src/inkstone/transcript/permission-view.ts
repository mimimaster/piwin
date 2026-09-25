import type { PermissionRiskKind } from '@piwin/contracts';
import type { RemotePermissionRequest } from '../../mobile-transcript.js';

/** Seal card copy, built only from Host-normalized `PermissionRequestContext`. */
export interface PermissionView {
  requestId: string;
  kindLabel: string;
  tool: string;
  target: string | undefined;
  /** Host prose, dropped when it only repeats the target. */
  detail: string | undefined;
  facts: string[];
  destructive: boolean;
}

const KIND_LABELS: Record<PermissionRiskKind, string> = {
  command: '运行命令',
  'file-write': '写入文件',
  git: 'Git 操作',
  network: '网络访问',
  mcp: 'MCP 工具',
  unknown: '工具调用',
};

export function describePermission(request: RemotePermissionRequest): PermissionView {
  const context = request.context;
  const target =
    context?.command ??
    context?.mcpTool?.selector ??
    context?.paths?.[0] ??
    context?.host ??
    undefined;
  const facts: string[] = [];
  if (context?.reason !== undefined && context.reason.length > 0) facts.push(`规则 · ${context.reason}`);
  if (context?.outsideWorkspace === true) facts.push('工作区外');
  if (context?.secretRelated === true) facts.push('涉及密钥');
  if (context?.mcpTool !== undefined) facts.push(`风险 · ${context.mcpTool.risk}`);
  if (context?.branch !== undefined) facts.push(`分支 · ${context.branch}`);
  if ((context?.paths?.length ?? 0) > 1) facts.push(`${context?.paths?.length ?? 0} 个路径`);
  if (context?.cwd !== undefined) facts.push(`目录 · ${context.cwd}`);
  return {
    requestId: request.requestId,
    kindLabel: KIND_LABELS[context?.kind ?? 'unknown'],
    tool: request.action,
    target,
    detail: redundantDetail(request.detail, target, context?.summary) ? undefined : request.detail,
    facts,
    destructive: context?.destructive === true,
  };
}

function redundantDetail(detail: string, target: string | undefined, summary: string | undefined): boolean {
  const trimmed = detail.trim();
  if (trimmed.length === 0) return true;
  if (target !== undefined && trimmed.includes(target)) return true;
  return summary !== undefined && trimmed === summary.trim();
}
