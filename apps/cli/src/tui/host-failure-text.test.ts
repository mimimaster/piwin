import { describe, expect, it } from 'vitest';
import { describeHostFailure } from './host-failure-text.js';

describe('describeHostFailure', () => {
  it('explains a dropped connection and where the text went', () => {
    expect(describeHostFailure('Host transport is not open')).toContain('已放回输入框');
  });

  it('names the request that timed out', () => {
    expect(describeHostFailure('Host request timed out: session/prompt')).toBe('Host 没有及时回应（session/prompt），稍后再试');
  });

  it('recognises a refused connection', () => {
    expect(describeHostFailure('connect ECONNREFUSED 127.0.0.1:8790')).toContain('连不上 Host');
  });

  it('says an archived session has to be restored first', () => {
    expect(describeHostFailure('Archived session must be restored before activation: session-1')).toContain('/unarchive');
  });

  it('says a session that is gone is gone', () => {
    expect(describeHostFailure('Unknown session: s1')).toContain('不存在');
  });

  it('leaves the Host’s own refusals alone', () => {
    expect(describeHostFailure('Run is already finished')).toBe('Run is already finished');
  });
});
