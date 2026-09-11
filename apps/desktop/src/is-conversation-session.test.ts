import { describe, expect, it } from 'vitest';
import { isConversationSessionChrome } from './is-conversation-session';

describe('isConversationSessionChrome', () => {
  it('keeps the chat pane as Conversation', () => {
    expect(isConversationSessionChrome({ kind: 'general' }, 'chat')).toBe(true);
  });

  it('treats No Repo (code pane, general scope) as an agent workspace', () => {
    expect(isConversationSessionChrome({ kind: 'general' }, 'code')).toBe(false);
  });

  it('treats project folders as agent in both panes', () => {
    const project = { kind: 'project' as const, projectPath: '/tmp/repo' };
    expect(isConversationSessionChrome(project, 'chat')).toBe(false);
    expect(isConversationSessionChrome(project, 'code')).toBe(false);
  });
});
