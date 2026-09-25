import { describe, expect, it } from 'vitest';
import { extractUserFacingBody, readPlanActionMarker } from './user-facing-text.js';

describe('extractUserFacingBody', () => {
  it('drops artifact advisory blocks, closed or cut off', () => {
    expect(
      extractUserFacingBody(
        '[piwin-artifact-host-theme]\nSending client theme: light.\n[/piwin-artifact-host-theme]\n画一只鹈鹕',
      ),
    ).toBe('画一只鹈鹕');
    expect(extractUserFacingBody('[piwin-artifact-host-theme]\nSending client theme: li')).toBe('');
  });

  it('drops injected context tags and the operating contract', () => {
    expect(
      extractUserFacingBody(
        '<context_ref path="a.ts">x</context_ref>\n修一下这个\nOperating contract for this turn: be brief',
      ),
    ).toBe('修一下这个');
  });

  it('drops a closed plan context block but keeps the user text after it', () => {
    expect(
      extractUserFacingBody('[piwin plan context v2 — follow this plan]\nTitle: Internal\n[end plan context]\n用户摘要'),
    ).toBe('用户摘要');
  });

  it('keeps only the request inside a skill wrapper', () => {
    expect(extractUserFacingBody('[piwin-skill:writing-plans]\nFollow the skill.\n---\n真实请求')).toBe('真实请求');
  });

  it('renders plan handoffs as an action', () => {
    const text = '[piwin-plan-execute:inline v2] Plan: 整理文档\nGoal: …\nExecute this plan directly.';
    expect(extractUserFacingBody(text)).toBe('执行计划：整理文档');
    expect(readPlanActionMarker(text)).toEqual({ kind: 'inline', title: '整理文档' });
    expect(readPlanActionMarker('普通消息')).toBeUndefined();
  });
});
