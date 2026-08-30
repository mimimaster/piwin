import { describe, expect, it } from 'vitest';
import { parseSubagentDeliveryFields } from './subagent-delivery.js';

describe('parseSubagentDeliveryFields', () => {
  it('treats omitted fields as an empty successful parse', () => {
    expect(parseSubagentDeliveryFields({})).toEqual({
      ok: true,
      deliveryIntent: undefined,
      applyPolicy: undefined,
    });
  });

  it('rejects an unknown deliveryIntent', () => {
    const parsed = parseSubagentDeliveryFields({ deliveryIntent: 'merge' });
    expect(parsed).toMatchObject({ ok: false, code: 'unknown-intent' });
  });

  it('rejects an unknown applyPolicy', () => {
    const parsed = parseSubagentDeliveryFields({ applyPolicy: 'always' });
    expect(parsed).toMatchObject({ ok: false, code: 'unknown-apply-policy' });
  });

  it('rejects report+auto as conflicting fields', () => {
    const parsed = parseSubagentDeliveryFields({
      deliveryIntent: 'report',
      applyPolicy: 'auto',
    });
    expect(parsed).toMatchObject({ ok: false, code: 'conflicting-fields' });
  });

  it('rejects integrate+none as conflicting fields', () => {
    const parsed = parseSubagentDeliveryFields({
      deliveryIntent: 'integrate',
      applyPolicy: 'none',
    });
    expect(parsed).toMatchObject({ ok: false, code: 'conflicting-fields' });
  });

  it('rejects candidate+auto as conflicting fields', () => {
    const parsed = parseSubagentDeliveryFields({
      deliveryIntent: 'candidate',
      applyPolicy: 'auto',
    });
    expect(parsed).toMatchObject({ ok: false, code: 'conflicting-fields' });
  });

  it('accepts compatible integrate+auto', () => {
    expect(
      parseSubagentDeliveryFields({ deliveryIntent: 'integrate', applyPolicy: 'auto' }),
    ).toEqual({
      ok: true,
      deliveryIntent: 'integrate',
      applyPolicy: 'auto',
    });
  });

  it('accepts compatible candidate+none', () => {
    expect(
      parseSubagentDeliveryFields({ deliveryIntent: 'candidate', applyPolicy: 'none' }),
    ).toEqual({
      ok: true,
      deliveryIntent: 'candidate',
      applyPolicy: 'none',
    });
  });

  it('accepts compatible report+none', () => {
    expect(
      parseSubagentDeliveryFields({ deliveryIntent: 'report', applyPolicy: 'none' }),
    ).toEqual({
      ok: true,
      deliveryIntent: 'report',
      applyPolicy: 'none',
    });
  });

  it('accepts compatible candidate+explicit', () => {
    expect(
      parseSubagentDeliveryFields({ deliveryIntent: 'candidate', applyPolicy: 'explicit' }),
    ).toEqual({
      ok: true,
      deliveryIntent: 'candidate',
      applyPolicy: 'explicit',
    });
  });
});
