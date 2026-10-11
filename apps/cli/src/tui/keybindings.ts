import type { KeyId } from '@earendil-works/pi-tui';

/** The shortcuts the TUI owns, ahead of the editor. Everything else is the editor's. */
export const KEYBINDING_ACTIONS = ['sessions', 'history', 'editor', 'pasteImage', 'permission', 'toolOutput'] as const;
export type KeybindingAction = (typeof KEYBINDING_ACTIONS)[number];
export type Keybindings = Readonly<Record<KeybindingAction, KeyId>>;

export const DEFAULT_KEYBINDINGS: Keybindings = {
  sessions: 'ctrl+s',
  history: 'ctrl+r',
  editor: 'ctrl+g',
  pasteImage: 'ctrl+v',
  permission: 'shift+tab',
  toolOutput: 'ctrl+o',
};

export const KEYBINDING_DESCRIPTIONS: Readonly<Record<KeybindingAction, string>> = {
  sessions: '会话',
  history: '历史提示词',
  editor: '用 $EDITOR 编辑',
  pasteImage: '粘贴图片',
  permission: '权限模式',
  toolOutput: '展开工具输出和思考',
};

/** Keys the editor or the terminal needs, or that the TUI handles itself: not rebindable. */
const RESERVED_KEYS: ReadonlySet<string> = new Set([
  'ctrl+c', 'ctrl+d', 'ctrl+z', 'ctrl+a', 'ctrl+e', 'ctrl+k', 'ctrl+u', 'ctrl+w', 'ctrl+y', 'ctrl+b', 'ctrl+f',
  'ctrl+h', 'ctrl+i', 'ctrl+j', 'ctrl+m', 'ctrl+l', 'ctrl+n', 'ctrl+p', 'tab', 'shift+enter',
]);

const MODIFIERS = new Set(['ctrl', 'shift', 'alt', 'super']);
const PLAIN_KEY = /^(?:[a-z0-9]|tab|f(?:[1-9]|1[0-2]))$/;

export type KeybindingProblem = string;

/** A key id the TUI can match, in canonical lowercase, or why not. */
export function parseKeyId(text: string): { key: KeyId } | { error: string } {
  const parts = text.trim().toLowerCase().split('+').map((part) => part.trim());
  const last = parts.pop() ?? '';
  if (!PLAIN_KEY.test(last) || parts.some((part) => !MODIFIERS.has(part)) || new Set(parts).size !== parts.length) {
    return { error: `「${text}」不是可用的按键写法（例：ctrl+s、alt+r、shift+tab、f2）` };
  }
  if (parts.length === 0 && !/^f\d+$/.test(last)) {
    return { error: `「${text}」不带 ctrl/alt 等修饰键，会吞掉正常输入` };
  }
  const key = [...parts, last].join('+');
  if (RESERVED_KEYS.has(key)) return { error: `「${key}」留给编辑器或退出，不能重新绑定` };
  return { key: key as KeyId };
}

/**
 * Defaults, overridden by whatever `keybindings.json` validly says. Every
 * problem is reported and the affected action keeps its default, so a typo
 * costs one shortcut, not the session.
 */
export function resolveKeybindings(configured: unknown): { bindings: Keybindings; problems: KeybindingProblem[] } {
  const problems: KeybindingProblem[] = [];
  const bindings: Record<KeybindingAction, KeyId> = { ...DEFAULT_KEYBINDINGS };
  if (configured === undefined) return { bindings, problems };
  if (typeof configured !== 'object' || configured === null || Array.isArray(configured)) {
    return { bindings, problems: ['keybindings.json 应该是 {"动作": "按键"} 对象，已使用默认快捷键'] };
  }
  for (const [name, value] of Object.entries(configured)) {
    const action = KEYBINDING_ACTIONS.find((candidate) => candidate === name);
    if (action === undefined) {
      problems.push(`keybindings.json 里没有「${name}」这个动作（可用：${KEYBINDING_ACTIONS.join('、')}）`);
      continue;
    }
    const parsed = typeof value === 'string' ? parseKeyId(value) : { error: `「${name}」的值要写成字符串` };
    if ('error' in parsed) problems.push(`${name}：${parsed.error}`);
    else bindings[action] = parsed.key;
  }
  // Two actions on one key cannot both fire; the later one goes back to its default.
  const owners = new Map<string, KeybindingAction>();
  for (const action of KEYBINDING_ACTIONS) {
    const key = bindings[action];
    const owner = owners.get(key);
    if (owner === undefined) {
      owners.set(key, action);
      continue;
    }
    problems.push(`${action} 和 ${owner} 都绑在 ${key} 上，${action} 改回默认 ${DEFAULT_KEYBINDINGS[action]}`);
    bindings[action] = DEFAULT_KEYBINDINGS[action];
    if (owners.has(bindings[action])) problems.push(`默认键 ${bindings[action]} 也被占用，${action} 暂时没有快捷键`);
  }
  return { bindings, problems };
}

/** `ctrl+s` → `Ctrl+S`, for help text. */
export function formatKey(key: KeyId): string {
  return key
    .split('+')
    .map((part) => (part.length <= 2 && !/^f\d+$/.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('+');
}

/** The one-line shortcut summary `/help` ends with, using the keys actually bound. */
export function shortcutHelp(bindings: Keybindings): string {
  const bound = KEYBINDING_ACTIONS.map((action) => `${formatKey(bindings[action])} ${KEYBINDING_DESCRIPTIONS[action]}`);
  return [...bound, '@ 引用文件', '运行中发送即排队', 'Esc 中断', 'Esc Esc 回到更早的提问', 'Ctrl+C 两次退出', 'Shift+Enter 换行'].join(' · ');
}
