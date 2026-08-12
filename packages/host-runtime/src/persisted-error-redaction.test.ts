import { describe, expect, it } from 'vitest';
import {
  createPersistedFailure,
  HOST_INTERRUPTED_FAILURE,
  redactPersistedMessage,
} from './persisted-error-redaction.js';

describe('persisted error redaction', () => {
  it('removes bearer tokens and API key values', () => {
    const message = redactPersistedMessage(
      'request failed with Authorization: Bearer sk-live-0123456789abcdef and x-api-key: secret-value-123',
    );
    expect(message).not.toContain('sk-live-0123456789abcdef');
    expect(message).not.toContain('secret-value-123');
    expect(message).toContain('<redacted>');
  });

  it('removes secrets from URL query strings', () => {
    const message = redactPersistedMessage(
      'fetch failed for https://example.com/v1?key=super-secret-token&model=gpt',
    );
    expect(message).not.toContain('super-secret-token');
    expect(message).toContain('key=<redacted>');
  });

  it('replaces product-owned absolute paths with placeholders', () => {
    const rootDir = '/home/tester/.piwin';
    const message = redactPersistedMessage(
      `worktree /home/tester/.piwin/worktrees/subagent-x/ failed to remove`,
      { rootDirs: [rootDir] },
    );
    expect(message).not.toContain('/home/tester/.piwin');
    expect(message).toContain('<piwin-path>');
  });

  it('bounds message length', () => {
    const long = 'x'.repeat(2_000);
    const message = redactPersistedMessage(long);
    expect(message.length).toBeLessThanOrEqual(600);
  });

  it('builds a stable failure projection from an arbitrary error', () => {
    const failure = createPersistedFailure(new Error('boom: token=abc123def456'), {
      kind: 'provider',
      code: 'subagent-provider-request-failed',
      phase: 'execution',
      retryable: true,
    });
    expect(failure).toMatchObject({
      kind: 'provider',
      code: 'subagent-provider-request-failed',
      phase: 'execution',
      retryable: true,
    });
    expect(failure.message).not.toContain('abc123def456');
  });

  it('provides the shared host-interrupted failure', () => {
    expect(HOST_INTERRUPTED_FAILURE).toMatchObject({
      kind: 'host-interrupted',
      code: 'subagent-host-restarted',
      retryable: true,
    });
  });
});
