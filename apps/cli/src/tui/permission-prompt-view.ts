import type { BackendPermissionOption, PermissionRequestContext, PermissionRiskKind } from '@piwin/contracts';
import { shortenPaths } from './tool-path-display.js';

const KIND_LABEL: Record<PermissionRiskKind, string> = {
  command: '运行命令',
  'file-write': '写文件',
  git: 'Git 操作',
  network: '访问网络',
  mcp: '调用 MCP 工具',
  unknown: '操作',
};

export type PermissionPromptView = {
  title: string;
  message: string;
  /** Choices an external agent supplied; shown as given. */
  backendOptions?: readonly BackendPermissionOption[];
};

/**
 * What a permission question says. The Host's `detail` is a log line for
 * people debugging policy (`ask-all-no-match: python3 x.py`); the structured
 * context carries what a person deciding needs: the command, the files, and
 * whether the action is destructive or leaves the workspace.
 */
export function describePermissionPrompt(
  request: { action: string; detail: string; context?: PermissionRequestContext },
  pathRoots: readonly string[],
): PermissionPromptView {
  const { context } = request;
  if (context === undefined) return { title: `需要确认：${request.action}`, message: request.detail };
  const short = (text: string): string => shortenPaths(text, pathRoots);
  const lines: string[] = [];
  // A file write repeats its path as `command`; the file lines below say it once.
  const paths = context.paths ?? [];
  if (context.command !== undefined && !(context.kind === 'file-write' && paths.length > 0)) {
    lines.push(short(context.command));
    if (context.cwd !== undefined) lines.push(`目录：${short(context.cwd)}`);
  } else if (paths.length === 0) {
    lines.push(short(context.summary));
  }
  for (const path of paths) lines.push(`文件：${short(path)}`);
  if (context.host !== undefined) lines.push(`主机：${context.host}`);
  if (context.destructive === true) lines.push('⚠ 破坏性操作');
  if (context.outsideWorkspace === true) lines.push('⚠ 在项目目录之外');
  if (context.secretRelated === true) lines.push('⚠ 可能涉及密钥');
  const backendOptions = context.backendOptions;
  const hasBackendOptions = backendOptions !== undefined && backendOptions.length > 0;
  if (hasBackendOptions) lines.push(`由 ${context.backendAgentId ?? '外部 agent'} 决定并记住，不写入 piwin 权限规则`);
  return {
    title: `需要确认：${KIND_LABEL[context.kind]}`,
    message: lines.join('\n'),
    ...(hasBackendOptions ? { backendOptions } : {}),
  };
}
