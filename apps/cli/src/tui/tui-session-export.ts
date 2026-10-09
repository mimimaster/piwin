import { resolve } from 'node:path';
import type { SessionExportData } from '@piwin/contracts';
import { hostData, type TuiHostLink } from './tui-host-link.js';

export type TuiSessionExportOptions = {
  link: TuiHostLink;
  getSessionId: () => string | undefined;
  /** Default directory when the user omits a path (project cwd or process cwd). */
  defaultDir: () => string;
  onHint: (text: string) => void;
  onNotice: (tone: 'info' | 'error', text: string) => void;
};

const USAGE = '用法：/export [md|json|html] [路径]';

/**
 * `/export` — Host renders the active-leaf transcript; this shell only picks
 * format and path. JSON matches the Host transcript message schema.
 */
export class TuiSessionExport {
  public constructor(private readonly options: TuiSessionExportOptions) {}

  public async run(argument: string): Promise<void> {
    const sessionId = this.options.getSessionId();
    if (sessionId === undefined) {
      this.options.onHint('当前还没有会话');
      return;
    }
    const parsed = parseExportArgument(argument);
    if (!parsed.ok) {
      this.options.onHint(parsed.error);
      return;
    }
    if (parsed.allBranches) {
      this.options.onHint('目前只导出当前活动分支（--all-branches 尚未支持）');
      return;
    }
    const outputPath =
      parsed.path === undefined ? undefined : resolve(this.options.defaultDir(), parsed.path);
    const data = hostData<SessionExportData>(
      await this.options.link.request({
        type: 'session/export',
        sessionId,
        format: parsed.format,
        ...(outputPath === undefined ? {} : { outputPath }),
      }),
    );
    const path = data.path;
    if (path === undefined || path.length === 0) {
      this.options.onNotice('error', '导出完成但 Host 未返回路径');
      return;
    }
    this.options.onNotice(
      'info',
      `已导出 ${parsed.format}（${data.byteLength} 字节）\n${path}`,
    );
  }
}

export type ParsedExportArgument =
  | {
      ok: true;
      format: 'md' | 'json' | 'html';
      path?: string;
      allBranches: boolean;
    }
  | { ok: false; error: string };

/** Pure parse of `/export` args so unit tests need no Host. */
export function parseExportArgument(argument: string): ParsedExportArgument {
  const tokens = argument.trim().split(/\s+/).filter((token) => token.length > 0);
  let format: 'md' | 'json' | 'html' = 'md';
  let path: string | undefined;
  let allBranches = false;
  let sawFormat = false;
  for (const token of tokens) {
    if (token === '--all-branches') {
      allBranches = true;
      continue;
    }
    if (token === 'md' || token === 'json' || token === 'html') {
      if (sawFormat && path === undefined) {
        path = token;
        continue;
      }
      format = token;
      sawFormat = true;
      continue;
    }
    if (path !== undefined) {
      return { ok: false, error: USAGE };
    }
    path = token;
  }
  return path === undefined
    ? { ok: true, format, allBranches }
    : { ok: true, format, path, allBranches };
}
