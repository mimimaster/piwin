/**
 * Display catalog for Settings → Shortcuts.
 * Mirrors the live bindings in use-desktop-shortcuts + command palette (⌘K).
 * Display-only — changing labels here does not rebind keys.
 */
import type { DesktopCommandId } from './desktop-commands';

export type ShortcutGroupId = 'recommended' | 'navigation' | 'chat-panes' | 'panels' | 'run';

export type ShortcutCatalogEntry = {
  id: string;
  /** Optional link to a command-palette id (palette itself is not a command id). */
  commandId?: DesktopCommandId | 'palette';
  titleEn: string;
  titleZh: string;
  /**
   * Chord written with Apple modifier glyphs (⌘ ⇧ ⌥ ⌃).
   * Non-Apple platforms remap glyphs at render time.
   */
  chord: string;
  /** Optional distinct chord where macOS's Control and Command would collapse to one Ctrl. */
  pcChord?: string;
};

export type ShortcutCatalogGroup = {
  id: ShortcutGroupId;
  labelEn: string;
  labelZh: string;
  entries: readonly ShortcutCatalogEntry[];
};

/**
 * Grouped shortcut list shown in Settings.
 * Order within each group is intentional (most common first).
 */
export const SHORTCUT_CATALOG: readonly ShortcutCatalogGroup[] = [
  {
    id: 'recommended',
    labelEn: 'Recommended',
    labelZh: '推荐',
    entries: [
      {
        id: 'palette',
        commandId: 'palette',
        titleEn: 'Open Command Palette',
        titleZh: '打开命令面板',
        chord: '⌘K',
      },
      {
        id: 'new-session',
        commandId: 'new-session',
        titleEn: 'New Session',
        titleZh: '新建会话',
        chord: '⌘N',
      },
      {
        id: 'search-sessions',
        commandId: 'search-sessions',
        titleEn: 'Search Sessions',
        titleZh: '搜索会话',
        chord: '⇧⌘F',
      },
      {
        id: 'focus-composer',
        commandId: 'focus-composer',
        titleEn: 'Focus Composer',
        titleZh: '聚焦输入框',
        chord: '⌘L',
      },
      {
        id: 'open-settings',
        commandId: 'open-settings',
        titleEn: 'Open Settings',
        titleZh: '打开设置',
        chord: '⌘,',
      },
    ],
  },
  {
    id: 'navigation',
    labelEn: 'Navigation',
    labelZh: '导航',
    entries: [
      {
        id: 'open-workspace',
        commandId: 'open-workspace',
        titleEn: 'Open Workspace',
        titleZh: '打开工作区',
        chord: '⌘O',
      },
      {
        id: 'toggle-sidebar',
        commandId: 'toggle-sidebar',
        titleEn: 'Toggle Sidebar',
        titleZh: '切换侧边栏',
        chord: '⌘B',
      },
      {
        id: 'toggle-right-panel',
        commandId: 'toggle-right-panel',
        titleEn: 'Toggle Right Panel',
        titleZh: '切换右侧面板',
        chord: '⌘\\',
      },
      {
        id: 'switch-tab-1',
        commandId: 'switch-tab-1',
        titleEn: 'Switch to Files',
        titleZh: '切换到文件',
        chord: '⌘1',
      },
      {
        id: 'switch-tab-2',
        commandId: 'switch-tab-2',
        titleEn: 'Switch to Terminal',
        titleZh: '切换到终端',
        chord: '⌘2',
      },
      {
        id: 'switch-tab-3',
        commandId: 'switch-tab-3',
        titleEn: 'Switch to Changes',
        titleZh: '切换到变更',
        chord: '⌘3',
      },
      {
        id: 'switch-tab-4',
        commandId: 'switch-tab-4',
        titleEn: 'Switch to Browser',
        titleZh: '切换到浏览器',
        chord: '⌘4',
      },
      {
        id: 'switch-tab-5',
        commandId: 'switch-tab-5',
        titleEn: 'Switch to Document',
        titleZh: '切换到文档',
        chord: '⌘5',
      },
    ],
  },
  {
    id: 'chat-panes',
    labelEn: 'Chat panes',
    labelZh: 'Chat 分窗',
    entries: [
      {
        id: 'pane-split-right',
        titleEn: 'Split active Chat right',
        titleZh: '向右拆分当前 Chat',
        chord: '⌘D',
      },
      {
        id: 'pane-split-down',
        titleEn: 'Split active Chat down',
        titleZh: '向下拆分当前 Chat',
        chord: '⇧⌘D',
      },
      {
        id: 'pane-focus-previous',
        titleEn: 'Focus previous Chat',
        titleZh: '聚焦上一个 Chat',
        chord: '⌘[',
      },
      {
        id: 'pane-focus-next',
        titleEn: 'Focus next Chat',
        titleZh: '聚焦下一个 Chat',
        chord: '⌘]',
      },
      {
        id: 'pane-focus-direction',
        titleEn: 'Focus Chat by direction',
        titleZh: '按方向聚焦 Chat',
        chord: '⌥⌘Arrow',
      },
      {
        id: 'pane-resize',
        titleEn: 'Resize active Chat',
        titleZh: '调整当前 Chat 大小',
        chord: '⌃⌘Arrow',
        pcChord: '⇧⌥⌘Arrow',
      },
      {
        id: 'pane-maximize',
        titleEn: 'Maximize or restore Chat',
        titleZh: '最大化或恢复 Chat',
        chord: '⇧⌘Enter',
      },
      {
        id: 'pane-close',
        titleEn: 'Close supplementary Chat pane',
        titleZh: '关闭附加 Chat 窗格',
        chord: '⌥⌘W',
      },
    ],
  },
  {
    id: 'panels',
    labelEn: 'Panels',
    labelZh: '面板',
    entries: [
      {
        id: 'toggle-inspector',
        commandId: 'toggle-inspector',
        titleEn: 'Toggle Inspector',
        titleZh: '切换检查器',
        chord: '⇧⌘I',
      },
      {
        id: 'open-activity',
        commandId: 'open-activity',
        titleEn: 'Open Terminal',
        titleZh: '打开终端',
        chord: '⌘J',
      },
    ],
  },
  {
    id: 'run',
    labelEn: 'Run',
    labelZh: '运行',
    entries: [
      {
        id: 'stop-run',
        commandId: 'stop-run',
        titleEn: 'Stop Run',
        titleZh: '停止运行',
        chord: '⌘.',
      },
    ],
  },
] as const;

const APPLE_MODIFIER_GLYPHS = new Set(['⌘', '⇧', '⌥', '⌃']);

/**
 * Split an Apple-style chord string into display tokens.
 * Examples: "⇧⌘F" → ["⇧", "⌘", "F"], "⌘," → ["⌘", ","], "⌘\\" → ["⌘", "\\"]
 */
export function splitShortcutChord(chord: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < chord.length) {
    const character = chord[index]!;
    if (APPLE_MODIFIER_GLYPHS.has(character)) {
      tokens.push(character);
      index += 1;
      continue;
    }
    // Remaining substring is the key (may be multi-character, e.g. "F5")
    tokens.push(chord.slice(index));
    break;
  }
  return tokens;
}

export type ShortcutDisplayPlatform = 'apple' | 'pc';

/** Prefer Apple glyphs on macOS / iOS; Ctrl/Alt/Shift wording elsewhere. */
export function detectShortcutDisplayPlatform(
  userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  platform: string = typeof navigator !== 'undefined' ? navigator.platform : '',
): ShortcutDisplayPlatform {
  if (/Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS|Macintosh|iPhone|iPad/i.test(userAgent)) {
    return 'apple';
  }
  return 'pc';
}

function remapTokenForPlatform(token: string, displayPlatform: ShortcutDisplayPlatform): string {
  if (displayPlatform === 'apple') {
    return token;
  }
  if (token === '⌘' || token === '⌃') {
    return 'Ctrl';
  }
  if (token === '⌥') {
    return 'Alt';
  }
  if (token === '⇧') {
    return 'Shift';
  }
  return token;
}

/** Tokens ready for keycap rendering on the current platform. */
export function formatShortcutChordTokens(
  chord: string,
  displayPlatform: ShortcutDisplayPlatform = detectShortcutDisplayPlatform(),
): string[] {
  return splitShortcutChord(chord).map((token) => remapTokenForPlatform(token, displayPlatform));
}

/** Flat list of every catalog entry (for tests / search later). */
export function listShortcutCatalogEntries(): ShortcutCatalogEntry[] {
  return SHORTCUT_CATALOG.flatMap((group) => [...group.entries]);
}
