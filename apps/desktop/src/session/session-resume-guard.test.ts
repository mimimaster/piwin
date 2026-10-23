import { describe, expect, it } from 'vitest';
import {
  beginResumeRequest,
  bumpSelectionEpoch,
  createSessionSelectionGuard,
  resetGuardHostInstance,
  resumeTicketMatches,
  selectSessionForResume,
  takeIfResumeCurrent,
} from './session-resume-guard.js';

describe('session resume selection guard (T03, T04)', () => {
  it('T03: old resume after New does not match messages/model/occupancy side effects', () => {
    let guard = createSessionSelectionGuard('host-a');
    guard = selectSessionForResume(guard, 'session-old', 'host-a');
    const started = beginResumeRequest(guard, 'session-old');
    guard = started.guard;

    guard = bumpSelectionEpoch(guard, { selectedSessionId: null });

    expect(resumeTicketMatches(guard, started.ticket)).toBe(false);
    expect(guard.selectedSessionId).toBeNull();
  });

  it('T04: A→B→A keeps only the current epoch; failed/stale B does not apply', () => {
    let guard = createSessionSelectionGuard('host-a');
    guard = selectSessionForResume(guard, 'session-a', 'host-a');
    const resumeA1 = beginResumeRequest(guard, 'session-a');
    guard = resumeA1.guard;

    guard = selectSessionForResume(guard, 'session-b', 'host-a');
    const resumeB = beginResumeRequest(guard, 'session-b');
    guard = resumeB.guard;

    guard = selectSessionForResume(guard, 'session-a', 'host-a');
    const resumeA2 = beginResumeRequest(guard, 'session-a');
    guard = resumeA2.guard;

    expect(resumeTicketMatches(guard, resumeA1.ticket)).toBe(false);
    expect(resumeTicketMatches(guard, resumeB.ticket)).toBe(false);
    expect(resumeTicketMatches(guard, resumeA2.ticket)).toBe(true);
  });

  it('T04: same session in-flight resumes keep only the latest request id', () => {
    let guard = createSessionSelectionGuard('host-a');
    guard = selectSessionForResume(guard, 'session-a', 'host-a');
    const first = beginResumeRequest(guard, 'session-a');
    guard = first.guard;
    const second = beginResumeRequest(guard, 'session-a');
    guard = second.guard;

    expect(first.ticket.selectionEpoch).toBe(second.ticket.selectionEpoch);
    expect(resumeTicketMatches(guard, first.ticket)).toBe(false);
    expect(resumeTicketMatches(guard, second.ticket)).toBe(true);
  });

  it('draft restore / New bump blocks late composer-profile restore', () => {
    let guard = createSessionSelectionGuard('host-a');
    guard = selectSessionForResume(guard, 'session-old', 'host-a');
    const started = beginResumeRequest(guard, 'session-old');
    guard = started.guard;
    guard = bumpSelectionEpoch(guard, { selectedSessionId: null });

    expect(
      takeIfResumeCurrent(guard, started.ticket, {
        model: { providerId: 'openai', modelId: 'gpt' },
      }),
    ).toBeNull();
  });

  it('HostInstance change invalidates in-flight tickets without Date.now ordering', () => {
    let guard = createSessionSelectionGuard('host-a');
    guard = selectSessionForResume(guard, 'session-a', 'host-a');
    const started = beginResumeRequest(guard, 'session-a');
    guard = started.guard;
    guard = resetGuardHostInstance(guard, 'host-b');

    expect(resumeTicketMatches(guard, started.ticket)).toBe(false);
    expect(guard.hostInstanceId).toBe('host-b');
    expect(guard.selectionEpoch).toBeGreaterThan(started.ticket.selectionEpoch);
  });
});
