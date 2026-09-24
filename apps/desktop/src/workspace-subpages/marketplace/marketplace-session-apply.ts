/**
 * Extension changes reach a live session only through `extensions/apply` at a
 * run boundary. This module issues that request and turns the Host's answer
 * into truthful user copy — "installed" is never reported as "live".
 */
import type { ExtensionsApplyData, HostCommand, HostResponse } from '@piwin/contracts';
import type { DesktopLocale } from '../../desktop-locale.js';
import type { MarketplaceToast } from './marketplace-types.js';

export type SessionApplyOutcome =
  | { kind: 'no-session' }
  | { kind: 'active' }
  | { kind: 'queued' }
  | { kind: 'new-sessions' }
  | { kind: 'failed'; error: string };

export async function applyExtensionsToSession(
  request: (command: HostCommand) => Promise<HostResponse>,
  sessionId: string | null | undefined,
): Promise<SessionApplyOutcome> {
  if (!sessionId) return { kind: 'no-session' };
  const response = await request({ type: 'extensions/apply', sessionId, when: 'after-current-run' });
  if (!response.success) return { kind: 'failed', error: response.error };
  const data = response.data as ExtensionsApplyData;
  switch (data.state) {
    case 'active':
      return { kind: 'active' };
    case 'new-sessions-only':
      return { kind: 'new-sessions' };
    case 'pending':
    case 'waiting-current-run':
      return { kind: 'queued' };
  }
}

export function describeExtensionChange(
  name: string,
  change: 'installed' | 'removed' | 'enabled' | 'disabled',
  outcome: SessionApplyOutcome,
  locale: DesktopLocale | undefined,
): MarketplaceToast {
  const zh = locale === 'zh-CN';
  const verb = {
    installed: zh ? '已安装' : 'installed',
    removed: zh ? '已卸载' : 'removed',
    enabled: zh ? '已启用' : 'enabled',
    disabled: zh ? '已停用' : 'disabled',
  }[change];
  const title = zh ? `[${name}] ${verb}` : `[${name}] ${verb}`;
  switch (outcome.kind) {
    case 'active':
      return {
        type: 'success',
        title,
        text: zh ? '当前会话已按新能力重建运行时。' : 'The current session runtime now reflects it.',
      };
    case 'queued':
      return {
        type: 'info',
        title,
        text: zh
          ? '当前任务结束后同步到本会话。'
          : 'Applies to this session when the current run finishes.',
      };
    case 'new-sessions':
    case 'no-session':
      return {
        type: 'success',
        title,
        text: zh ? '新会话会按此生效。' : 'New sessions will pick this up.',
      };
    case 'failed':
      return {
        type: 'warning',
        title,
        text: zh
          ? `但同步到当前会话失败：${outcome.error}`
          : `but applying it to this session failed: ${outcome.error}`,
      };
  }
}
