import { beforeEach, describe, expect, it } from 'vitest';
import {
  getDesktopCopy,
  getDesktopTranslator,
  loadDesktopLocale,
  saveDesktopLocale,
} from './desktop-locale';

describe('desktop locale preference', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem(key: string): string | null {
          return storage.get(key) ?? null;
        },
        setItem(key: string, value: string): void {
          storage.set(key, value);
        },
      },
    });
  });

  it('uses Simplified Chinese until a user explicitly chooses a language', () => {
    expect(loadDesktopLocale()).toBe('zh-CN');
  });

  it('persists a supported locale and returns its matching UI copy', () => {
    saveDesktopLocale('en');

    expect(loadDesktopLocale()).toBe('en');
    expect(getDesktopCopy('en').settings).toBe('Settings');
    expect(getDesktopCopy('zh-CN').settings).toBe('设置');
  });

  it('formats settings model counts in the selected display language', () => {
    expect(getDesktopTranslator('zh-CN').settings.provider.models(2)).toBe('2 个模型');
    expect(getDesktopTranslator('en').settings.provider.models(1)).toBe('1 model');
    expect(getDesktopTranslator('en').settings.provider.models(2)).toBe('2 models');
  });

  it('describes hidden older sessions without paging chrome', () => {
    expect(getDesktopCopy('zh-CN').sidebar.olderSessionsHidden(3)).toBe(
      '还有 3 个更早的会话，用搜索查找',
    );
    expect(getDesktopCopy('en').sidebar.olderSessionsHidden(1)).toBe(
      '1 older session hidden; use search to find them',
    );
    expect(getDesktopCopy('en').sidebar.olderSessionsHidden(2)).toBe(
      '2 older sessions hidden; use search to find them',
    );
  });

  it('provides complete shell and Appearance copy in both display languages', () => {
    expect(getDesktopCopy('zh-CN').titlebar.moreTools).toBe('更多工具');
    expect(getDesktopCopy('zh-CN').sidebar.displayOptions).toBe('显示选项');
    expect(getDesktopCopy('zh-CN').appearance.conversationWidth).toBe('对话宽度');
    expect(getDesktopCopy('en').titlebar.moreTools).toBe('More tools');
    expect(getDesktopCopy('en').sidebar.displayOptions).toBe('Display options');
    expect(getDesktopCopy('en').appearance.conversationWidth).toBe('Conversation Width');
    expect(getDesktopCopy('zh-CN').mobileAccess.title).toBe('手机接入');
    expect(getDesktopCopy('en').mobileAccess.title).toBe('Phone access');
  });

  it('provides interruption copy in both display languages', () => {
    expect(getDesktopCopy('zh-CN').interruption.agentWaiting).toBe('Agent 正等待你的回答');
    expect(getDesktopCopy('zh-CN').interruption.cancelQuestion).toBe('取消问题');
    expect(getDesktopCopy('zh-CN').interruption.allowForSession).toBe('允许本次会话');
    expect(getDesktopCopy('en').interruption.agentWaiting).toBe('Agent is waiting for your answer');
    expect(getDesktopCopy('en').interruption.cancelQuestion).toBe('Cancel question');
    expect(getDesktopCopy('en').interruption.allowForSession).toBe('Allow for this session');
  });
});
