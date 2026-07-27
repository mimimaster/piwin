import { describe, expect, it } from 'vitest';
import { toPermissionPromptUi } from './use-host-bootstrap';

describe('toPermissionPromptUi', () => {
  it('preserves the complete runId from a permission push', () => {
    const prompt = toPermissionPromptUi({
      type: 'permission/request',
      sessionId: 'session-1',
      requestId: 'permission-1',
      runId: 'run-with-full-identity-1234567890',
      action: 'bash',
      detail: 'rm -rf build',
      defaultDecision: 'ask',
    });

    expect(prompt.runId).toBe('run-with-full-identity-1234567890');
  });
});
