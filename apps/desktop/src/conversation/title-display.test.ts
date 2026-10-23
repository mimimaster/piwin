import { describe, expect, it } from 'vitest';
import { buildTitlebarTooltip, isPlaceholderSessionName } from './title-display';

describe('buildTitlebarTooltip', () => {
  it('joins project and session with thin separator', () => {
    expect(buildTitlebarTooltip('piwin', 'Fix auth')).toBe('piwin / Fix auth');
  });

  it('returns session only when project missing', () => {
    expect(buildTitlebarTooltip(undefined, 'Fix auth')).toBe('Fix auth');
    expect(buildTitlebarTooltip('', 'Fix auth')).toBe('Fix auth');
  });

  it('returns project only when session empty', () => {
    expect(buildTitlebarTooltip('piwin', '')).toBe('piwin');
  });
});

describe('isPlaceholderSessionName', () => {
  it('detects host placeholder ids and default labels', () => {
    expect(isPlaceholderSessionName('session-ab12cd34')).toBe(true);
    expect(isPlaceholderSessionName('session-sdk-mscy')).toBe(true);
    expect(isPlaceholderSessionName('New chat')).toBe(true);
    expect(isPlaceholderSessionName('新会话')).toBe(true);
    expect(isPlaceholderSessionName('素笺')).toBe(true);
    expect(isPlaceholderSessionName('Clean Slate')).toBe(true);
    expect(isPlaceholderSessionName(undefined)).toBe(true);
  });

  it('rejects real titles', () => {
    expect(isPlaceholderSessionName('Walkthrough 交付')).toBe(false);
    expect(isPlaceholderSessionName('Auth / OAuth fix')).toBe(false);
    expect(isPlaceholderSessionName('iCloud隐藏邮箱转发设置')).toBe(false);
  });
});
