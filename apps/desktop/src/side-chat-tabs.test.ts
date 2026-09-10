import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '@piwin/contracts';
import { listSideChatTabs, SIDE_CHAT_DRAFT_TAB_ID } from './side-chat-tabs.js';

function summary(id: string, name: string): SessionSummary {
  return {
    id,
    scope: { kind: 'general' },
    workingDirectory: '/tmp',
    projectPath: '',
    name,
    updatedAt: '2026-09-04T00:00:00.000Z',
    messageCount: 0,
    kind: 'side-chat',
    sideChatRelation: {
      kind: 'side-chat',
      sourceSessionId: 'main-1',
      sourceCapturedAt: '2026-09-04T00:00:00.000Z',
      contextVersion: 1,
      sourceState: 'active',
    },
  };
}

describe('listSideChatTabs', () => {
  it('shows a closable draft tab when there are no side chats', () => {
    expect(listSideChatTabs([], 'en')).toEqual([
      { id: SIDE_CHAT_DRAFT_TAB_ID, label: 'Side chat', closable: true },
    ]);
    expect(listSideChatTabs([], 'zh-CN')[0]?.label).toBe('侧聊');
  });

  it('maps existing side chats to closable tabs', () => {
    const tabs = listSideChatTabs(
      [summary('side-1', 'Side Chat · Main'), summary('side-2', '  ')],
      'en',
    );
    expect(tabs).toEqual([
      { id: 'side-1', label: 'Side Chat · Main', closable: true },
      { id: 'side-2', label: 'Side chat', closable: true },
    ]);
  });
});
