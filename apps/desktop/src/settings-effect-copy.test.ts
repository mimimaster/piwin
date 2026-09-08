import { describe, expect, it } from 'vitest';
import {
  extensionEnabledEffectMessage,
  mcpConfigSavedEffectMessage,
  permissionModeSavedEffectMessage,
  settingsEffectClause,
  settingsSavedWithEffect,
  skillInstalledEffectMessage,
} from './settings-effect-copy.js';

describe('settingsEffectClause', () => {
  it('uses formal Chinese for each tier', () => {
    expect(settingsEffectClause('zh-CN', 'immediate')).toBe('更改已生效，可立即使用。');
    expect(settingsEffectClause('zh-CN', 'next-session')).toBe('更改将在新会话中生效。');
    expect(settingsEffectClause('zh-CN', 'after-current-task')).toBe(
      '更改将在当前任务结束后生效。',
    );
    expect(settingsEffectClause('zh-CN', 'host-restart')).toBe(
      '更改需重启 Host 后才能完全生效。',
    );
  });

  it('uses formal English for each tier', () => {
    expect(settingsEffectClause('en', 'immediate')).toBe(
      'The change has taken effect and is available immediately.',
    );
    expect(settingsEffectClause('en', 'next-session')).toBe(
      'The change will take effect in new sessions.',
    );
    expect(settingsEffectClause('en', 'after-current-task')).toBe(
      'The change will take effect after the current task finishes.',
    );
    expect(settingsEffectClause('en', 'host-restart')).toBe(
      'The Host must be restarted before the change can take full effect.',
    );
  });
});

describe('composed effect messages', () => {
  it('states skill install is immediately invocable', () => {
    expect(skillInstalledEffectMessage('zh-CN', 'demo-skill')).toContain('/demo-skill');
    expect(skillInstalledEffectMessage('zh-CN', 'demo-skill')).toContain('可立即使用');
    expect(skillInstalledEffectMessage('en', 'demo-skill')).toContain('/demo-skill');
    expect(skillInstalledEffectMessage('en', 'demo-skill')).toContain('immediately');
  });

  it('states MCP save is immediate and permission save is next-session', () => {
    expect(mcpConfigSavedEffectMessage('zh-CN', '~/.piwin/mcp.json')).toContain('可立即使用');
    expect(permissionModeSavedEffectMessage('zh-CN')).toContain('新会话');
    expect(permissionModeSavedEffectMessage('en')).toContain('new sessions');
  });

  it('states extension apply after the current task when requested', () => {
    expect(extensionEnabledEffectMessage('zh-CN', 'goal', true)).toContain('当前任务结束');
    expect(extensionEnabledEffectMessage('en', 'goal', false)).toContain('new sessions');
  });

  it('composes a saved subject with an effect clause', () => {
    expect(settingsSavedWithEffect('zh-CN', 'next-session', 'Artifact 设置')).toBe(
      'Artifact 设置已保存。更改将在新会话中生效。',
    );
  });
});
