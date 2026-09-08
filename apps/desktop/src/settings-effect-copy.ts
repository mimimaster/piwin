/**
 * Shared copy for when a settings change becomes effective.
 *
 * Three product tiers (formal language only):
 * 1. immediate — available at once
 * 2. next-session / after-current-task — deferred by design
 * 3. host-restart — Host process must restart
 */
import type { DesktopLocale } from './desktop-locale';

export type SettingsEffectTier =
  | 'immediate'
  | 'next-session'
  | 'after-current-task'
  | 'host-restart';

function isChinese(locale: DesktopLocale): boolean {
  return locale === 'zh-CN';
}

/** Short clause describing when the change takes effect. */
export function settingsEffectClause(
  locale: DesktopLocale,
  tier: SettingsEffectTier,
): string {
  if (isChinese(locale)) {
    switch (tier) {
      case 'immediate':
        return '更改已生效，可立即使用。';
      case 'next-session':
        return '更改将在新会话中生效。';
      case 'after-current-task':
        return '更改将在当前任务结束后生效。';
      case 'host-restart':
        return '更改需重启 Host 后才能完全生效。';
    }
  }
  switch (tier) {
    case 'immediate':
      return 'The change has taken effect and is available immediately.';
    case 'next-session':
      return 'The change will take effect in new sessions.';
    case 'after-current-task':
      return 'The change will take effect after the current task finishes.';
    case 'host-restart':
      return 'The Host must be restarted before the change can take full effect.';
  }
}

/** “Saved” + effect clause. */
export function settingsSavedWithEffect(
  locale: DesktopLocale,
  tier: SettingsEffectTier,
  subject?: string,
): string {
  const effect = settingsEffectClause(locale, tier);
  if (isChinese(locale)) {
    const head = subject?.trim() ? `${subject.trim()}已保存。` : '已保存。';
    return `${head}${effect}`;
  }
  const head = subject?.trim() ? `${subject.trim()} has been saved. ` : 'Saved. ';
  return `${head}${effect}`;
}

export function skillInstalledEffectMessage(
  locale: DesktopLocale,
  skillId: string,
  detail?: string,
): string {
  const slash = `/${skillId}`;
  if (isChinese(locale)) {
    const where = detail?.trim() ? `安装位置：${detail.trim()}。` : '';
    return `技能 ${skillId} 已安装。${where}可通过 ${slash} 立即调用。${settingsEffectClause(locale, 'immediate')}`;
  }
  const where = detail?.trim() ? ` Location: ${detail.trim()}.` : '';
  return `Skill ${skillId} has been installed.${where} It can be invoked immediately with ${slash}. ${settingsEffectClause(locale, 'immediate')}`;
}

export function mcpConfigSavedEffectMessage(locale: DesktopLocale, path?: string): string {
  if (isChinese(locale)) {
    const where = path?.trim() ? `（${path.trim()}）` : '';
    return `MCP 配置已保存${where}。${settingsEffectClause(locale, 'immediate')}`;
  }
  const where = path?.trim() ? ` (${path.trim()})` : '';
  return `MCP configuration has been saved${where}. ${settingsEffectClause(locale, 'immediate')}`;
}

export function extensionEnabledEffectMessage(
  locale: DesktopLocale,
  extensionName: string,
  appliedToSession: boolean,
): string {
  if (isChinese(locale)) {
    if (appliedToSession) {
      return `扩展「${extensionName}」已更新。${settingsEffectClause(locale, 'after-current-task')}`;
    }
    return `扩展「${extensionName}」已更新。${settingsEffectClause(locale, 'next-session')}`;
  }
  if (appliedToSession) {
    return `Extension “${extensionName}” has been updated. ${settingsEffectClause(locale, 'after-current-task')}`;
  }
  return `Extension “${extensionName}” has been updated. ${settingsEffectClause(locale, 'next-session')}`;
}

export function extensionInstalledEffectMessage(
  locale: DesktopLocale,
  targetPath: string,
): string {
  if (isChinese(locale)) {
    return `扩展已安装到 ${targetPath}。${settingsEffectClause(locale, 'next-session')}`;
  }
  return `The extension has been installed at ${targetPath}. ${settingsEffectClause(locale, 'next-session')}`;
}

export function extensionSyncedAndApplyRequestedMessage(locale: DesktopLocale): string {
  if (isChinese(locale)) {
    return `已从磁盘同步扩展，并已请求应用到当前会话。${settingsEffectClause(locale, 'after-current-task')}`;
  }
  return `Extensions have been synchronized from disk and an apply request has been submitted for the current session. ${settingsEffectClause(locale, 'after-current-task')}`;
}

export function permissionModeSavedEffectMessage(locale: DesktopLocale): string {
  return settingsSavedWithEffect(
    locale,
    'next-session',
    isChinese(locale) ? '运行模式' : 'Run mode',
  );
}

export function permissionRevokedEffectMessage(locale: DesktopLocale): string {
  if (isChinese(locale)) {
    return `已撤销该记住的权限。${settingsEffectClause(locale, 'immediate')}`;
  }
  return `The remembered permission has been revoked. ${settingsEffectClause(locale, 'immediate')}`;
}

export function hooksSavedEffectMessage(locale: DesktopLocale, enabled: boolean): string {
  if (isChinese(locale)) {
    if (!enabled) {
      return '钩子配置已保存，但事件钩子尚未启用，因此不会在选定时机执行。';
    }
    return `钩子配置已保存。${settingsEffectClause(locale, 'immediate')}`;
  }
  if (!enabled) {
    return 'Hook configuration has been saved, but event hooks are not enabled, so they will not run at the selected moments.';
  }
  return `Hook configuration has been saved. ${settingsEffectClause(locale, 'immediate')}`;
}

export function hooksArmedEffectMessage(locale: DesktopLocale, enabled: boolean): string {
  if (isChinese(locale)) {
    return enabled
      ? `事件钩子已启用。${settingsEffectClause(locale, 'immediate')}`
      : '事件钩子已关闭。已保存的钩子在重新启用前不会执行。';
  }
  return enabled
    ? `Event hooks have been enabled. ${settingsEffectClause(locale, 'immediate')}`
    : 'Event hooks have been disabled. Saved hooks will not run until they are enabled again.';
}
