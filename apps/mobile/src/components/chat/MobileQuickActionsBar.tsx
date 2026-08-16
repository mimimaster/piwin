import type { ReactElement } from 'react';

export type QuickActionItem = {
  id: string;
  label: string;
  icon: string;
  prompt: string;
  isSlashCommand?: boolean | undefined;
};

export type MobileQuickActionsBarProps = {
  onSelectAction: (prompt: string) => void;
};

const QUICK_ACTIONS: QuickActionItem[] = [
  {
    id: 'explain',
    icon: '🔍',
    label: '解释代码',
    prompt: '请详细解释并拆解这段代码的逻辑与架构：\n',
  },
  {
    id: 'find-bugs',
    icon: '🐛',
    label: '排查 Bug',
    prompt: '请检查并分析当前代码中的潜在缺陷、边界条件与异常情况：\n',
  },
  {
    id: 'write-tests',
    icon: '🧪',
    label: '编写单测',
    prompt: '请为上述核心业务逻辑编写完备的单元测试（Unit Tests）：\n',
  },
  {
    id: 'git-commit',
    icon: '📝',
    label: '生成 Commit',
    prompt: '请根据当前的更改内容，生成符合 Conventional Commits 规范的提交信息：\n',
  },
  {
    id: 'cmd-goal',
    icon: '🎯',
    label: '/goal 深度长任务',
    prompt: '/goal ',
    isSlashCommand: true,
  },
  {
    id: 'cmd-browser',
    icon: '🌐',
    label: '/browser 联网检索',
    prompt: '/browser ',
    isSlashCommand: true,
  },
  {
    id: 'cmd-schedule',
    icon: '⏱️',
    label: '/schedule 定时任务',
    prompt: '/schedule ',
    isSlashCommand: true,
  },
  {
    id: 'cmd-learn',
    icon: '🧠',
    label: '/learn 记忆规则',
    prompt: '/learn ',
    isSlashCommand: true,
  },
];

export function MobileQuickActionsBar({
  onSelectAction,
}: MobileQuickActionsBarProps): ReactElement {
  return (
    <div className="modern-quick-actions-bar" role="toolbar" aria-label="快捷提示词与指令">
      {QUICK_ACTIONS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`quick-action-pill ${item.isSlashCommand ? 'accent-pill' : ''}`}
          onClick={() => onSelectAction(item.prompt)}
          aria-label={item.label}
        >
          <span className="pill-icon">{item.icon}</span>
          <span className="pill-label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
