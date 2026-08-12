import type { HostToolRegistration } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import {
  createImmediateSafetyPredicate,
  isToolBlockedByRestriction,
} from './immediate-safety-gate.js';

function registration(family: HostToolRegistration['family']): HostToolRegistration {
  return {
    descriptor: {
      name: `test-${family}`,
      description: 'test tool',
      parameters: { type: 'object', properties: {} },
    },
    family,
    permissionSpec: {
      action: `test:${family}`,
      risk: 'network',
      rememberable: false,
      subjectBuilder: () => ({ kind: 'tool', action: `test:${family}` }),
    },
    execute: async () => ({ ok: true, output: 'ok' }),
  };
}

describe('immediate safety gate', () => {
  it('blocks only the exact revoked Web capability', () => {
    expect(isToolBlockedByRestriction('web-search', registration('web-search'))).toBe(true);
    expect(isToolBlockedByRestriction('web-search', registration('web-fetch'))).toBe(false);
  });

  it('does not fall back to domain-wide blocking when exact restrictions are empty', () => {
    const predicate = createImmediateSafetyPredicate({
      getPendingDomains: () => ['web'],
      getPendingRestrictions: () => [],
    });

    expect(
      predicate(
        registration('web-search'),
        {},
        {
          sessionId: 'session-1',
          runtimeGenerationId: 'generation-1',
          runId: 'run-1',
          toolCallId: 'tool-call-1',
          toolName: 'test-web-search',
        },
      ),
    ).toBeNull();
  });
});
