import { describe, expect, it, vi } from 'vitest';
import type { HostPush, SessionContextSnapshot, SessionResumeData } from '@piwin/contracts';
import { MockHostBackend } from './host-client-mock';

async function createSession(backend: MockHostBackend): Promise<string> {
  const created = await backend.handle(
    { type: 'session/create', input: { scope: { kind: 'general' } } },
    'create-context',
  );
  expect(created.success).toBe(true);
  if (!created.success) throw new Error(created.error);
  return (created.data as { sessionId: string }).sessionId;
}

describe('MockHostBackend context telemetry', () => {
  it('returns an explicit snapshot from session/context-get', async () => {
    const backend = new MockHostBackend(
      () => {},
      () => 'sdk',
    );
    const sessionId = await createSession(backend);
    const response = await backend.handle({ type: 'session/context-get', sessionId }, 'context-get');
    expect(response.success).toBe(true);
    if (!response.success) throw new Error(response.error);
    const snapshot = response.data as SessionContextSnapshot;
    expect(snapshot.sessionId).toBe(sessionId);
    expect(snapshot.revision).toBeGreaterThanOrEqual(1);
    expect(snapshot.occupancy.kind).toBe('unknown');
  });

  it('includes contextSnapshot and lastRequestUsage on resume', async () => {
    const backend = new MockHostBackend(
      () => {},
      () => 'sdk',
    );
    const sessionId = await createSession(backend);
    const response = await backend.handle({ type: 'session/resume', sessionId }, 'resume');
    expect(response.success).toBe(true);
    if (!response.success) throw new Error(response.error);
    const resume = response.data as SessionResumeData;
    expect(resume).toHaveProperty('contextSnapshot');
    expect(resume).toHaveProperty('lastRequestUsage');
    expect(resume.contextSnapshot.sessionId).toBe(sessionId);
    expect(resume.lastRequestUsage).toBeNull();
  });

  it('pushes session/context-updated with evidence after a mock reply', async () => {
    const pushes: HostPush[] = [];
    const backend = new MockHostBackend(
      (message) => {
        pushes.push(message);
      },
      () => 'sdk',
    );
    const sessionId = await createSession(backend);
    const prompted = await backend.handle(
      { type: 'session/prompt', sessionId, input: { text: 'hello mock context' } },
      'prompt',
    );
    expect(prompted.success).toBe(true);
    await vi.waitFor(() => {
      expect(pushes.some((push) => push.type === 'session/context-updated')).toBe(true);
    });
    const updated = pushes.find((push) => push.type === 'session/context-updated');
    expect(updated?.type).toBe('session/context-updated');
    if (updated?.type !== 'session/context-updated') {
      throw new Error('expected session/context-updated');
    }
    expect(updated.sessionId).toBe(sessionId);
    expect(updated.snapshot.responseEvidence.currentRunHasResponse).toBe(true);
    expect(updated.snapshot.occupancy.kind).toBe('known');
    expect(updated.snapshot.phase).toBe('idle');
  });
});
