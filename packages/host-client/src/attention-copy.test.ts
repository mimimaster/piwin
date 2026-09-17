import { describe, expect, it } from 'vitest';
import { ATTENTION_COPY_SEGMENT_MAX, formatAttentionNotification } from './attention-copy.js';

describe('formatAttentionNotification', () => {
  it('T24: zh-CN / en five titles', () => {
    expect(ATTENTION_COPY_SEGMENT_MAX).toBe(48);

    expect(
      formatAttentionNotification({
        locale: 'zh-CN',
        kind: 'needs-input',
        source: 'permission',
        projectName: 'piwin',
        sessionTitle: 'fix copy',
      }).title,
    ).toBe('需要你的批准');
    expect(
      formatAttentionNotification({
        locale: 'zh-CN',
        kind: 'needs-input',
        source: 'question',
        projectName: 'piwin',
        sessionTitle: 'fix copy',
      }).title,
    ).toBe('Agent 在等你回答');
    expect(
      formatAttentionNotification({
        locale: 'zh-CN',
        kind: 'turn-complete',
        projectName: 'piwin',
        sessionTitle: 'fix copy',
      }).title,
    ).toBe('已完成');
    expect(
      formatAttentionNotification({
        locale: 'zh-CN',
        kind: 'turn-failed',
        projectName: 'piwin',
        sessionTitle: 'fix copy',
      }).title,
    ).toBe('运行失败');
    expect(
      formatAttentionNotification({ locale: 'zh-CN', kind: 'summary', count: 3 }).title,
    ).toBe('3 个会话需要你');

    expect(
      formatAttentionNotification({
        locale: 'en',
        kind: 'needs-input',
        source: 'permission',
        projectName: 'piwin',
        sessionTitle: 'fix copy',
      }).title,
    ).toBe('Approval needed');
    expect(
      formatAttentionNotification({
        locale: 'en',
        kind: 'needs-input',
        source: 'question',
        projectName: 'piwin',
        sessionTitle: 'fix copy',
      }).title,
    ).toBe('Agent is asking');
    expect(
      formatAttentionNotification({
        locale: 'en',
        kind: 'turn-complete',
        projectName: 'piwin',
        sessionTitle: 'fix copy',
      }).title,
    ).toBe('Finished');
    expect(
      formatAttentionNotification({
        locale: 'en',
        kind: 'turn-failed',
        projectName: 'piwin',
        sessionTitle: 'fix copy',
      }).title,
    ).toBe('Run failed');
    expect(formatAttentionNotification({ locale: 'en', kind: 'summary', count: 3 }).title).toBe(
      '3 sessions need you',
    );
  });

  it('T25: missing session → 未命名会话; General omits project segment', () => {
    expect(
      formatAttentionNotification({
        locale: 'zh-CN',
        kind: 'turn-complete',
        projectName: 'piwin',
      }).body,
    ).toBe('piwin · 未命名会话');
    expect(
      formatAttentionNotification({
        locale: 'en',
        kind: 'turn-complete',
        projectName: 'piwin',
      }).body,
    ).toBe('piwin · Untitled session');

    expect(
      formatAttentionNotification({
        locale: 'zh-CN',
        kind: 'turn-complete',
        projectName: 'General',
        sessionTitle: 'night run',
      }).body,
    ).toBe('night run');
    expect(
      formatAttentionNotification({
        locale: 'zh-CN',
        kind: 'turn-complete',
        sessionTitle: 'night run',
      }).body,
    ).toBe('night run');
    expect(
      formatAttentionNotification({
        locale: 'zh-CN',
        kind: 'needs-input',
        source: 'permission',
        projectName: 'piwin',
        sessionTitle: 'night run',
        permissionAction: 'bash',
      }).body,
    ).toBe('piwin · night run · bash');
  });

  it('T26: 49-char session title truncates to 48 ending with …', () => {
    const sessionTitle = 's'.repeat(49);
    const body = formatAttentionNotification({
      locale: 'zh-CN',
      kind: 'turn-complete',
      projectName: 'piwin',
      sessionTitle,
    }).body;
    const sessionSegment = body.slice('piwin · '.length);
    expect(sessionSegment).toBe(`${'s'.repeat(47)}…`);
    expect(sessionSegment).toHaveLength(48);
    expect(sessionSegment.endsWith('…')).toBe(true);
    expect(
      formatAttentionNotification({
        locale: 'zh-CN',
        kind: 'turn-complete',
        projectName: 'piwin',
        sessionTitle: 's'.repeat(48),
      }).body,
    ).toBe(`piwin · ${'s'.repeat(48)}`);
  });

  it('T27: summary omits approval sentence when k=0; en singular/plural', () => {
    expect(
      formatAttentionNotification({
        locale: 'zh-CN',
        kind: 'summary',
        count: 4,
        needsInputCount: 0,
      }),
    ).toEqual({ title: '4 个会话需要你', body: '' });
    expect(
      formatAttentionNotification({
        locale: 'zh-CN',
        kind: 'summary',
        count: 4,
        needsInputCount: 2,
      }),
    ).toEqual({ title: '4 个会话需要你', body: '有 2 个等待批准' });

    expect(
      formatAttentionNotification({
        locale: 'en',
        kind: 'summary',
        count: 1,
        needsInputCount: 0,
      }),
    ).toEqual({ title: '1 session needs you', body: '' });
    expect(
      formatAttentionNotification({
        locale: 'en',
        kind: 'summary',
        count: 2,
        needsInputCount: 1,
      }),
    ).toEqual({ title: '2 sessions need you', body: '1 waiting for approval' });
  });
});
