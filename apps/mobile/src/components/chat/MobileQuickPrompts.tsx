import type { ReactElement } from 'react';

export type MobileQuickPromptsProps = {
  onSelectPrompt: (promptText: string) => void;
  projectName?: string | undefined;
};

const SUGGESTIONS = [
  {
    icon: '🔍',
    title: '分析当前项目',
    prompt: '请分析当前工作区的项目结构和核心模块，告诉我主要功能与依赖关系。',
  },
  {
    icon: '🐛',
    title: '排查报错与日志',
    prompt: '检查最近的代码运行日志，找出报错原因并提供修复方案。',
  },
  {
    icon: '🧪',
    title: '编写自动化测试',
    prompt: '为当前修改的模块补充完善的单元测试，确保边界用例覆盖。',
  },
  {
    icon: '⚡',
    title: '重构与性能优化',
    prompt: '审查代码架构，提出可以提升性能和减少冗余的重构方案。',
  },
];

export function MobileQuickPrompts({
  onSelectPrompt,
  projectName,
}: MobileQuickPromptsProps): ReactElement {
  return (
    <div className="mobile-quick-prompts-container">
      <div className="mobile-chat-hero">
        <div className="mobile-chat-hero-icon">✦</div>
        <h2 className="mobile-chat-hero-title">Piwin Coding Agent</h2>
        <p className="mobile-chat-hero-subtitle">
          {projectName ? `已挂载项目：${projectName}` : '连接 Host 执行全栈开发、工具调用与代码重构'}
        </p>
      </div>

      <div className="mobile-quick-prompts-grid">
        {SUGGESTIONS.map((item) => (
          <button
            key={item.title}
            type="button"
            className="mobile-quick-prompt-card"
            onClick={() => onSelectPrompt(item.prompt)}
          >
            <span className="mobile-quick-prompt-icon">{item.icon}</span>
            <div className="mobile-quick-prompt-info">
              <span className="mobile-quick-prompt-title">{item.title}</span>
              <span className="mobile-quick-prompt-snippet">{item.prompt}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
