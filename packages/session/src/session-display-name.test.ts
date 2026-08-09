import { describe, expect, it } from 'vitest';
import {
  filterListableSessions,
  isLegacyInternalSessionName,
  isPlaceholderSessionName,
  sessionHasListName,
} from './session-display-name.js';

describe('isPlaceholderSessionName', () => {
  it('detects empty and host placeholders', () => {
    expect(isPlaceholderSessionName(undefined)).toBe(true);
    expect(isPlaceholderSessionName('')).toBe(true);
    expect(isPlaceholderSessionName('session-ab12cd34')).toBe(true);
    expect(isPlaceholderSessionName('session-sdk-mscy')).toBe(true);
    expect(isPlaceholderSessionName('New chat')).toBe(true);
    expect(isPlaceholderSessionName('新会话')).toBe(true);
  });

  it('rejects real titles', () => {
    expect(isPlaceholderSessionName('iCloud隐藏邮箱转发设置')).toBe(false);
    expect(isPlaceholderSessionName('Fix login')).toBe(false);
  });
});

describe('isLegacyInternalSessionName', () => {
  it('recognizes titles leaked from old model-facing prompt wrappers', () => {
    expect(isLegacyInternalSessionName('[piwin-mode:agent] [piwin-… - 4')).toBe(true);
    expect(isLegacyInternalSessionName('[piwin-prompt-meta kind="mode:agent"]')).toBe(true);
    expect(isLegacyInternalSessionName('[piwin-skill:create-skill] generate docs')).toBe(true);
    expect(isLegacyInternalSessionName('Operating contract for this turn: Success')).toBe(true);
  });

  it('does not classify ordinary user titles as internal', () => {
    expect(isLegacyInternalSessionName('排查 piwin 会话命名')).toBe(false);
    expect(isLegacyInternalSessionName('Fix [piwin-mode] parser support')).toBe(false);
    expect(isLegacyInternalSessionName(undefined)).toBe(false);
  });
});

describe('sessionHasListName', () => {
  it('hides unnamed and placeholder sessions', () => {
    expect(sessionHasListName({})).toBe(false);
    expect(sessionHasListName({ name: 'session-sdk-mscy' })).toBe(false);
    expect(sessionHasListName({ name: 'session-sdk-mscy', nameSource: 'default' })).toBe(false);
  });

  it('shows text/llm/user/auto names when real', () => {
    expect(sessionHasListName({ name: '这是什么', nameSource: 'text' })).toBe(true);
    expect(sessionHasListName({ name: 'Hide My Email', nameSource: 'llm' })).toBe(true);
    expect(sessionHasListName({ name: 'My rename', nameSource: 'user' })).toBe(true);
    expect(sessionHasListName({ name: 'iCloud隐藏邮箱转发设置', nameSource: 'auto' })).toBe(true);
  });

  it('shows legacy real names without source', () => {
    expect(sessionHasListName({ name: 'Pelican SVG' })).toBe(true);
  });
});

describe('filterListableSessions', () => {
  it('drops placeholder rows', () => {
    const input = [
      { id: 'a', name: 'session-sdk-a' },
      { id: 'b', name: 'Real title', nameSource: 'text' as const },
    ];
    expect(filterListableSessions(input).map((item) => item.id)).toEqual(['b']);
  });
});
