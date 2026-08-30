import { describe, expect, it } from 'vitest';
import {
  resolveSubagentDeliveryPolicy,
  type ResolveSubagentDeliveryPolicyInput,
} from './subagent-delivery-policy.js';

function resolve(
  overrides: Partial<ResolveSubagentDeliveryPolicyInput> &
    Pick<ResolveSubagentDeliveryPolicyInput, 'isolation'>,
) {
  return resolveSubagentDeliveryPolicy({
    source: 'model-tool',
    activateNewIntegrateDefault: false,
    ...overrides,
  });
}

describe('resolveSubagentDeliveryPolicy', () => {
  it('maps omitted fields + readonly to report/none', () => {
    expect(resolve({ isolation: 'readonly' })).toEqual({
      ok: true,
      policy: {
        deliveryIntent: 'report',
        legacyManual: false,
        applyPolicy: 'none',
      },
    });
  });

  it('maps omitted fields + worktree to integrate/none under W1', () => {
    expect(resolve({ isolation: 'worktree' })).toEqual({
      ok: true,
      policy: {
        deliveryIntent: 'integrate',
        legacyManual: false,
        applyPolicy: 'none',
      },
    });
  });

  it('maps explicit auto + worktree to integrate/auto', () => {
    expect(resolve({ isolation: 'worktree', applyPolicy: 'auto' })).toEqual({
      ok: true,
      policy: {
        deliveryIntent: 'integrate',
        legacyManual: false,
        applyPolicy: 'auto',
      },
    });
  });

  it('maps explicit none to legacyManual + none without pretending candidate', () => {
    expect(resolve({ isolation: 'worktree', applyPolicy: 'none' })).toEqual({
      ok: true,
      policy: {
        deliveryIntent: 'integrate',
        legacyManual: true,
        applyPolicy: 'none',
      },
    });
  });

  it('maps explicit applyPolicy explicit to integrate + legacyManual', () => {
    expect(resolve({ isolation: 'worktree', applyPolicy: 'explicit' })).toEqual({
      ok: true,
      policy: {
        deliveryIntent: 'integrate',
        legacyManual: true,
        applyPolicy: 'explicit',
      },
    });
  });

  it('records explicit integrate without flipping W1 applyPolicy to auto', () => {
    expect(resolve({ isolation: 'worktree', deliveryIntent: 'integrate' })).toEqual({
      ok: true,
      policy: {
        deliveryIntent: 'integrate',
        legacyManual: false,
        applyPolicy: 'none',
      },
    });
  });

  it('accepts explicit candidate + worktree as a user candidate', () => {
    expect(resolve({ isolation: 'worktree', deliveryIntent: 'candidate' })).toEqual({
      ok: true,
      policy: {
        deliveryIntent: 'candidate',
        legacyManual: false,
        applyPolicy: 'none',
      },
    });
  });

  it('rejects report + worktree as report-with-write', () => {
    expect(resolve({ isolation: 'worktree', deliveryIntent: 'report' })).toMatchObject({
      ok: false,
      code: 'report-with-write',
    });
  });

  it('rejects integrate + readonly as write-intent-readonly', () => {
    expect(resolve({ isolation: 'readonly', deliveryIntent: 'integrate' })).toMatchObject({
      ok: false,
      code: 'write-intent-readonly',
    });
  });

  it('rejects candidate + readonly as write-intent-readonly', () => {
    expect(resolve({ isolation: 'readonly', deliveryIntent: 'candidate' })).toMatchObject({
      ok: false,
      code: 'write-intent-readonly',
    });
  });

  it('rejects an unknown deliveryIntent from parse', () => {
    expect(resolve({ isolation: 'readonly', deliveryIntent: 'merge' })).toMatchObject({
      ok: false,
      code: 'unknown-intent',
    });
  });

  it('rejects an unknown applyPolicy from parse', () => {
    expect(resolve({ isolation: 'worktree', applyPolicy: 'always' })).toMatchObject({
      ok: false,
      code: 'unknown-apply-policy',
    });
  });

  it('rejects conflicting report+auto from parse', () => {
    expect(
      resolve({ isolation: 'readonly', deliveryIntent: 'report', applyPolicy: 'auto' }),
    ).toMatchObject({ ok: false, code: 'conflicting-fields' });
  });

  it('rejects conflicting integrate+none from parse', () => {
    expect(
      resolve({ isolation: 'worktree', deliveryIntent: 'integrate', applyPolicy: 'none' }),
    ).toMatchObject({ ok: false, code: 'conflicting-fields' });
  });

  it('ignores retainWorktree and does not treat it as skip-integrate', () => {
    const result = resolveSubagentDeliveryPolicy({
      isolation: 'worktree',
      source: 'cli',
      activateNewIntegrateDefault: false,
      retainWorktree: true,
    } as ResolveSubagentDeliveryPolicyInput & { retainWorktree: boolean });
    expect(result).toEqual({
      ok: true,
      policy: {
        deliveryIntent: 'integrate',
        legacyManual: false,
        applyPolicy: 'none',
      },
    });
  });
});
