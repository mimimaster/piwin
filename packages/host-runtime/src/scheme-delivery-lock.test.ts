import { describe, expect, it } from 'vitest';
import {
  FUSION_SCHEME_ID,
  REVIEWED_DELIVERY_REVIEWER_ROLE,
  REVIEWED_DELIVERY_SCHEME_ID,
  REVIEWED_DELIVERY_WORKER_ROLE,
} from '@piwin/contracts';
import { resolveSchemeDeliveryLock } from './scheme-delivery-lock.js';

describe('resolveSchemeDeliveryLock', () => {
  it('locks the Reviewed Delivery worker to an explicit candidate', () => {
    expect(
      resolveSchemeDeliveryLock({ schemeId: REVIEWED_DELIVERY_SCHEME_ID }, REVIEWED_DELIVERY_WORKER_ROLE),
    ).toEqual({ deliveryIntent: 'candidate', applyPolicy: 'explicit' });
  });

  it('leaves other roles and schemes to their own policy', () => {
    expect(
      resolveSchemeDeliveryLock({ schemeId: REVIEWED_DELIVERY_SCHEME_ID }, REVIEWED_DELIVERY_REVIEWER_ROLE),
    ).toBeUndefined();
    expect(resolveSchemeDeliveryLock({ schemeId: FUSION_SCHEME_ID }, 'worker')).toBeUndefined();
    expect(resolveSchemeDeliveryLock(undefined, REVIEWED_DELIVERY_WORKER_ROLE)).toBeUndefined();
  });
});
