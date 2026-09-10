import type { ReactElement } from 'react';
import { EmptyState } from '@piwin/ui-kit';
import { IconCommentPlus } from './shell-icons.js';

export type SideChatEmptyStateProps = {
  locale: 'zh-CN' | 'en';
  hasMainSession: boolean;
};

export function sideChatEmptyCopy(props: SideChatEmptyStateProps): {
  title: string;
  description: string;
} {
  if (props.locale === 'zh-CN') {
    return {
      title: '侧聊',
      description: props.hasMainSession
        ? '针对当前会话提问。侧聊是只读的，可以搜索和读取文件，但不能修改它们。'
        : '先打开一个主会话，再针对它的上下文提问。',
    };
  }
  return {
    title: 'Side chat',
    description: props.hasMainSession
      ? 'Ask about this session. Side chat is read-only — it can search and read files, but cannot change them.'
      : 'Open a main session first, then ask about its context.',
  };
}

export function SideChatEmptyState(props: SideChatEmptyStateProps): ReactElement {
  const copy = sideChatEmptyCopy(props);
  return (
    <div className="side-chat-empty-state">
      <EmptyState
        testId="side-chat-empty"
        title={copy.title}
        description={copy.description}
        visual={<IconCommentPlus width={28} height={28} />}
      />
    </div>
  );
}
