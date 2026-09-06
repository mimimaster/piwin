import { describe, expect, it } from 'vitest';
import { buildContextMenuItems } from './catalog.js';
import type { ContextMenuCapabilities, ContextMenuTarget } from './types.js';

const baseCaps: ContextMenuCapabilities = {
  hasProject: true,
  canReveal: true,
  sideChatAvailable: true,
  applyAvailable: true,
  canSendPreset: true,
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

  it('builds selection menu without quote-in-composer; explain/fix live under More', () => {
    const target: ContextMenuTarget = {
      surface: 'selection',
      selectedText: 'const x = 1',
      label: 'sel',
    };
    const items = buildContextMenuItems(target, baseCaps);
    const ids = actionIds(target);
    expect(ids[0]).toBe('generate-flashcard');
    expect(ids).toContain('ask-about');
    expect(ids).not.toContain('quote-in-composer');
    const more = items.find(
      (item): item is Extract<typeof item, { type: 'submenu' }> =>
        item.type === 'submenu' && item.id === 'more',
    );
    const childIds = more?.children
      .filter((child): child is Extract<typeof child, { type: 'item' }> => child.type === 'item')
      .map((child) => child.id);
    expect(childIds).toEqual(expect.arrayContaining(['explain', 'fix']));
  });

  it('hides side-chat when unavailable', () => {
    const target: ContextMenuTarget = {
      surface: 'selection',
      selectedText: 'x',
      label: 'sel',
    };
    const items = buildContextMenuItems(target, { ...baseCaps, sideChatAvailable: false });
    const more = items.find(
      (item): item is Extract<typeof item, { type: 'submenu' }> =>
        item.type === 'submenu' && item.id === 'more',
    );
    const childIds = more?.children
      .filter((child): child is Extract<typeof child, { type: 'item' }> => child.type === 'item')
      .map((child) => child.id);
    expect(childIds).not.toContain('side-chat');
  });

  it('disables generate-flashcard when preset send is unavailable', () => {
    const target: ContextMenuTarget = {
      surface: 'selection',
      selectedText: '依赖数组',
      label: 'sel',
    };
    const enItems = buildContextMenuItems(target, { ...baseCaps, canSendPreset: false });
    const enGen = enItems.find((item) => item.type === 'item' && item.id === 'generate-flashcard');
    expect(enGen && enGen.type === 'item' && enGen.disabled).toBe(true);
    expect(enGen && enGen.type === 'item' ? enGen.label : '').toContain('requires an active chat');

    const zhItems = buildContextMenuItems(target, {
      ...baseCaps,
      canSendPreset: false,
      locale: 'zh-CN',
    });
    const zhGen = zhItems.find((item) => item.type === 'item' && item.id === 'generate-flashcard');
    expect(zhGen && zhGen.type === 'item' && zhGen.disabled).toBe(true);
    expect(zhGen && zhGen.type === 'item' ? zhGen.label : '').toContain('会话未就绪');
    expect(zhGen && zhGen.type === 'item' ? zhGen.label : '').toMatch(/（.*）/);
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
    expect(actionIds(target)).toContain('truncate-after');
  });

  it('shows reveal disabled when unsupported and enabled when available', () => {
    const target: ContextMenuTarget = {
      surface: 'file-tree-file',
      projectPath: '/p',
      relativePath: 'a.ts',
      absolutePath: '/p/a.ts',
      label: 'a.ts',
    };
    const hidden = buildContextMenuItems(target, { ...baseCaps, canReveal: false });
    const reveal = hidden.find((item) => item.type === 'item' && item.id === 'reveal');
    expect(reveal && reveal.type === 'item' && reveal.disabled).toBe(true);
    expect(actionIds(target, { ...baseCaps, canReveal: true })).toContain('reveal');
  });

  it('path-chip offers Save As and Reveal when caps allow', () => {
    const target: ContextMenuTarget = {
      surface: 'path-chip',
      projectPath: '/p',
      relativePath: 'a.zip',
      absolutePath: '/p/a.zip',
      label: 'a.zip',
    };
    expect(
      actionIds(target, { ...baseCaps, canSaveAs: true, canReveal: true }),
    ).toEqual(
      expect.arrayContaining(['open', 'save-as', 'copy-absolute-path', 'reveal']),
    );
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

  it('puts review/tests under a More submenu for file-tree-file (CM-16)', () => {
    const target: ContextMenuTarget = {
      surface: 'file-tree-file',
      projectPath: '/p',
      relativePath: 'a.ts',
      absolutePath: '/p/a.ts',
      label: 'a.ts',
    };
    const items = buildContextMenuItems(target, baseCaps);
    const more = items.find(
      (item): item is Extract<typeof item, { type: 'submenu' }> =>
        item.type === 'submenu' && item.id === 'more',
    );
    expect(more).toBeDefined();
    const childIds = more?.children
      .filter((child): child is Extract<typeof child, { type: 'item' }> => child.type === 'item')
      .map((child) => child.id);
    expect(childIds).toEqual(['explain', 'review', 'tests']);
    // Root menu must not exceed 8 visible items (separators excluded).
    const rootItems = items.filter((item) => item.type === 'item').length;
    expect(rootItems).toBeLessThanOrEqual(8);
  });

  it('hides the More submenu without a project', () => {
    const target: ContextMenuTarget = {
      surface: 'file-tree-file',
      projectPath: '',
      relativePath: 'a.ts',
      absolutePath: '/a.ts',
      label: 'a.ts',
    };
    const items = buildContextMenuItems(target, { ...baseCaps, hasProject: false });
    expect(items.some((item) => item.type === 'submenu')).toBe(false);
  });

  it('shows open-changed-files for message surfaces only when available (CM-15)', () => {
    const target: ContextMenuTarget = {
      surface: 'message-assistant',
      sessionId: 's1',
      messageId: 'm1',
      text: 'hello',
      label: 'Assistant',
      capabilities: { canRetry: false, canFork: true, canSideChat: true },
    };
    expect(actionIds(target, { ...baseCaps, openChangedFilesAvailable: true })).toContain(
      'open-changed-files',
    );
    expect(actionIds(target, { ...baseCaps, openChangedFilesAvailable: false })).not.toContain(
      'open-changed-files',
    );
  });

  it('disables Host file open/apply when the remote ceiling omits project/read-file', () => {
    const target: ContextMenuTarget = {
      surface: 'code-block',
      selectedText: 'const x = 1',
      relativePath: 'src/a.ts',
      label: 'a.ts',
    };
    const items = buildContextMenuItems(target, { ...baseCaps, applyAvailable: false });
    const apply = items.find((item) => item.type === 'item' && item.id === 'apply-to-file');
    const open = items.find((item) => item.type === 'item' && item.id === 'open');
    expect(apply && apply.type === 'item' && apply.disabled).toBe(true);
    expect(open && open.type === 'item' && open.disabled).toBe(true);
  });

  it('selection menu includes generate-flashcard as the first action (target order)', () => {
    const target: ContextMenuTarget = {
      surface: 'selection',
      selectedText: '依赖数组',
      label: 'sel',
    };
    const items = buildContextMenuItems(target, baseCaps);
    const structure = items.map((item) => {
      if (item.type === 'separator') return 'separator';
      if (item.type === 'submenu') return item.id;
      return item.id;
    });
    expect(structure).toEqual([
      'generate-flashcard',
      'add-to-chat',
      'ask-about',
      'separator',
      'copy',
      'more',
    ]);
    const more = items.find(
      (item): item is Extract<typeof item, { type: 'submenu' }> =>
        item.type === 'submenu' && item.id === 'more',
    );
    expect(more).toBeDefined();
    const childIds = more?.children
      .filter((child): child is Extract<typeof child, { type: 'item' }> => child.type === 'item')
      .map((child) => child.id);
    expect(childIds).toEqual(['explain', 'fix', 'side-chat', 'copy-as-ref']);
  });

  it('localizes generate-flashcard labels in zh and en', () => {
    const target: ContextMenuTarget = {
      surface: 'selection',
      selectedText: '依赖数组',
      label: 'sel',
    };
    const en = buildContextMenuItems(target, { ...baseCaps, locale: 'en' });
    const zh = buildContextMenuItems(target, { ...baseCaps, locale: 'zh-CN' });
    const enGen = en.find(
      (item): item is Extract<(typeof en)[number], { type: 'item' }> =>
        item.type === 'item' && item.id === 'generate-flashcard',
    );
    const zhGen = zh.find(
      (item): item is Extract<(typeof zh)[number], { type: 'item' }> =>
        item.type === 'item' && item.id === 'generate-flashcard',
    );
    expect(enGen?.label ?? '').toBe('Generate flashcard');
    expect(zhGen?.label ?? '').toBe('生成闪卡');
    expect(enGen?.testId ?? '').toBe('context-menu-generate-flashcard');
    expect(zhGen?.testId ?? '').toBe('context-menu-generate-flashcard');
  });
});
