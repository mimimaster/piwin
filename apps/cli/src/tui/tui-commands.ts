/** Slash commands the TUI handles itself; anything else is sent to the agent as text. */
export type TuiSlashCommand = {
  name: string;
  description: string;
  /** Unavailable when Desktop embeds the TUI and owns session switching. */
  standaloneOnly?: boolean;
};

export const TUI_SLASH_COMMANDS: readonly TuiSlashCommand[] = [
  { name: 'sessions', description: '切换、搜索、重命名、归档会话', standaloneOnly: true },
  { name: 'new', description: '开始新会话', standaloneOnly: true },
  { name: 'model', description: '选择模型' },
  { name: 'thinking', description: '选择思考强度' },
  { name: 'permission', description: '选择权限模式（询问 / 自动 / 放行）' },
  { name: 'skill', description: '为下一条消息选择技能' },
  { name: 'attach', description: '附加文件或图片：/attach <路径…>' },
  { name: 'paste', description: '附加剪贴板里的图片（Ctrl+V）' },
  { name: 'detach', description: '清空待发送的附件' },
  { name: 'compact', description: '压缩上下文（可附加说明）' },
  { name: 'retry', description: '重新生成上一轮回答' },
  { name: 'rename', description: '重命名当前会话' },
  { name: 'older', description: '加载更早的消息' },
  { name: 'help', description: '查看命令和快捷键' },
  { name: 'quit', description: '退出' },
];

const KNOWN_NAMES: ReadonlySet<string> = new Set(TUI_SLASH_COMMANDS.map((command) => command.name));

/**
 * Only known names are commands. `/etc/hosts 是什么` or a skill-style `/review`
 * stays a normal prompt and reaches the Host untouched.
 */
export function parseSlashCommand(text: string): { name: string; argument: string } | undefined {
  const match = /^\/([a-z]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  const name = match?.[1];
  if (name === undefined || !KNOWN_NAMES.has(name)) return undefined;
  return { name, argument: (match?.[2] ?? '').trim() };
}
