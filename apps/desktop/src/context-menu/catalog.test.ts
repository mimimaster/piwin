import { describe, expect, it } from 'vitest';
import { buildContextMenuItems } from './catalog.js';
import type { ContextMenuCapabilities, ContextMenuTarget } from './types.js';

const baseCaps: ContextMenuCapabilities = {
  hasProject: true,
  canReveal: true,
  sideChatAvailable: true,
  applyAvailable: true,
  locale: 'en',
};

function actionIds(target: ContextMenuTarget, caps: ContextMenuCapabilities = baseCaps): string[] {
  return buildContextMenuItems(target, caps)
    .filter((item): item is Extract<typeof item, { type: 'item' }> => item.type === 'item')
    .map((item) => item.id);
}

describe('buildContextMenuItems', () => {
  it('orders file-tree-file primary AI actions first', () => {
    const target: ContextMenuTarget = {
      surface: 'file-tree-file',
      projectPath: '/p',
      relativePath: 'a.ts',
      absolutePath: '/p/a.ts',
      label: 'a.ts',
    };
    expect(actionIds(target).slice(0, 2)).toEqual(['add-to-chat', 'ask-about']);
  });

  it('disables project file actions without project', () => {
    const target: ContextMenuTarget = {
      surface: 'file-tree-file',
      projectPath: '',
      relativePath: 'a.ts',
      absolutePath: '/a.ts',
      label: 'a.ts',
    };
    const items = buildContextMenuItems(target, { ...baseCaps, hasProject: false });
    const add = items.find((item) => item.type === 'item' && item.id === 'add-to-chat');
    expect(add && add.type === 'item' && add.disabled).toBe(true);
  });

  it('builds selection menu with explain/fix', () => {
    const target: ContextMenuTarget = {
      surface: 'selection',
      selectedText: 'const x = 1',
      label: 'sel',
    };
    const ids = actionIds(target);
    expect(ids).toContain('ask-about');
    expect(ids).toContain('explain');
    expect(ids).toContain('fix');
    expect(ids).toContain('add-to-chat');
  });

  it('hides side-chat when unavailable', () => {
    const target: ContextMenuTarget = {
      surface: 'selection',
      selectedText: 'x',
      label: 'sel',
    };
    const ids = actionIds(target, { ...baseCaps, sideChatAvailable: false });
    expect(ids).not.toContain('side-chat');
  });

  it('includes fork only when message capabilities allow', () => {
    const target: ContextMenuTarget = {
      surface: 'message-assistant',
      sessionId: 's1',
      messageId: 'm1',
      text: 'hello',
      label: 'Assistant',
      capabilities: { canRetry: false, canFork: true, canSideChat: true },
    };
    expect(actionIds(target)).toContain('fork');
    expect(actionIds(target)).not.toContain('retry');
  });

  it('hides reveal when unsupported and shows it when available', () => {
    const target: ContextMenuTarget = {
      surface: 'file-tree-file',
      projectPath: '/p',
      relativePath: 'a.ts',
      absolutePath: '/p/a.ts',
      label: 'a.ts',
    };
    expect(actionIds(target, { ...baseCaps, canReveal: false })).not.toContain('reveal');
    expect(actionIds(target, { ...baseCaps, canReveal: true })).toContain('reveal');
  });

  it('localizes labels through en/zh tables while keeping stable action ids', () => {
    const target: ContextMenuTarget = {
      surface: 'selection',
      selectedText: 'x',
      label: 'sel',
    };
    const en = buildContextMenuItems(target, { ...baseCaps, locale: 'en' });
    const zh = buildContextMenuItems(target, { ...baseCaps, locale: 'zh-CN' });
    const enAdd = en.find((item) => item.type === 'item' && item.id === 'add-to-chat');
    const zhAdd = zh.find((item) => item.type === 'item' && item.id === 'add-to-chat');
    expect(enAdd && 'label' in enAdd ? enAdd.label : '').toBe('Add to Chat');
    expect(zhAdd && 'label' in zhAdd ? zhAdd.label : '').toBe('添加到对话');
    expect(enAdd && 'testId' in enAdd ? enAdd.testId : '').toBe(
      zhAdd && 'testId' in zhAdd ? zhAdd.testId : '',
    );
  });
});
