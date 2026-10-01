import { describe, expect, it } from 'vitest';
import {
  FUSION_SCHEME_ID,
  REVIEWED_DELIVERY_REVIEWER_ROLE,
  REVIEWED_DELIVERY_SCHEME_ID,
  REVIEWED_DELIVERY_WORKER_ROLE,
  resolveOrchestrationScheme,
} from '@piwin/contracts';
import { resolveSchemeDeliveryLock } from './scheme-delivery-lock.js';

function scheme(id: string) {
  return resolveOrchestrationScheme({ maxConcurrency: 4, maxTasksPerRun: 8 }, id);
}

describe('resolveSchemeDeliveryLock', () => {
  it('locks the Reviewed Delivery worker to an explicit candidate', () => {
    expect(
      resolveSchemeDeliveryLock(scheme(REVIEWED_DELIVERY_SCHEME_ID), REVIEWED_DELIVERY_WORKER_ROLE),
    ).toEqual({ deliveryIntent: 'candidate', applyPolicy: 'explicit' });
  });

  it('leaves other roles and schemes to their own policy', () => {
    expect(
      resolveSchemeDeliveryLock(scheme(REVIEWED_DELIVERY_SCHEME_ID), REVIEWED_DELIVERY_REVIEWER_ROLE),
    ).toBeUndefined();
    expect(resolveSchemeDeliveryLock(scheme(FUSION_SCHEME_ID), 'worker')).toBeUndefined();
    expect(resolveSchemeDeliveryLock(undefined, REVIEWED_DELIVERY_WORKER_ROLE)).toBeUndefined();
  });

  it('does not honor a lock written by Settings on a custom worker', () => {
    const custom = resolveOrchestrationScheme(
      {
        schemes: [
          {
            id: 'my-worker',
            name: 'Mine',
            description: 'custom',
            systemPreamble: 'custom',
            exposeSpawnMetadata: false,
            waitPolicy: 'await-all',
            members: [
              {
                role: REVIEWED_DELIVERY_WORKER_ROLE,
                description: 'writes',
                behavior: { deliveryLock: 'candidate-explicit' },
              },
            ],
          },
        ],
      },
      'my-worker',
    );
    expect(resolveSchemeDeliveryLock(custom, REVIEWED_DELIVERY_WORKER_ROLE)).toBeUndefined();
  });
});
