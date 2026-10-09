import { describe, expect, it } from 'vitest';
import { describeWalkthroughFailure } from './walkthrough-failure.js';

describe('describeWalkthroughFailure', () => {
  it('translates a refused request that carries the Host error as JSON', () => {
    const text = describeWalkthroughFailure(
      JSON.stringify({ code: 'model-unavailable', message: 'No model is available for this message.' }),
    );
    expect(text).toContain('没有可用的模型');
    expect(text).not.toContain('{');
  });

  it('translates a pushed failure by its code', () => {
    expect(describeWalkthroughFailure({ code: 'provider-timeout', message: 'timed out' })).toBe(
      '模型服务响应超时，稍后再试',
    );
  });

  it('keeps the Host message for a code it does not know', () => {
    expect(describeWalkthroughFailure({ code: 'brand-new', message: 'Something new' })).toBe('Something new');
    expect(describeWalkthroughFailure(JSON.stringify({ code: 'brand-new', message: 'Something new' }))).toBe(
      'Something new',
    );
  });

  it('passes plain text through', () => {
    expect(describeWalkthroughFailure('Walkthrough is disabled')).toBe('Walkthrough is disabled');
  });
});
