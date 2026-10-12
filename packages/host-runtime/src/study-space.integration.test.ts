import { describe, expect, it } from 'vitest';
import { openStudySpaceFixture } from './study-space.test-fixture.js';

const cards = [
  { model: 'basic', front: 'Why close a file?', back: 'Release descriptors.' },
  { model: 'basic', front: 'Why use finally?', back: 'Release even after errors.' },
];
function systemOf(request: Record<string, unknown>): string {
  const messages = request.messages as Array<{ role: string; content: unknown }>;
  return messages.filter(message => message.role === 'system' || message.role === 'developer').map(message => String(message.content)).join('\n');
}

describe('Study Space with real Pi transports and native Host tools', () => {
  it.each(['sdk', 'rpc'] as const)('%s: teaching -> consented native cards -> rating/undo -> replacement/resume', async mode => {
    const f = await openStudySpaceFixture(mode);
    try {
      await f.prompt('/teacher ta');
      await f.prompt('Explain closing a file briefly.');
      const taRequest = f.requests.at(-1);
      if (!taRequest) throw new Error('No real provider request');
      expect(systemOf(taRequest)).toContain('<study-space role="ta">');
      await f.prompt('/unregistered-command is ordinary text');
      expect(JSON.stringify(f.requests.at(-1))).toContain('Host instructions and history.');
      await f.prompt('/teacher learn file lifecycle');
      let course = await f.course();
      await f.prompt('Diagnose what I know about resource cleanup.');
      await f.tool('study_space', { action: 'profile', expectedRevision: course.revision, profile: 'Beginner who understands opening files', path: ['diagnose', 'cleanup attempt', 'finally exercise'] });
      course = await f.course();
      await f.tool('study_space', { action: 'evidence', expectedRevision: course.revision, prompt: 'Why close a file?', userAnswer: 'It is optional.', assessment: 'Closing releases descriptors; answer misses resource cleanup.', nextPractice: 'Explain finally cleanup.', gap: 'Resource lifetime misunderstood.' }, 'My answer: closing is optional.');
      course = await f.course();
      const evidence = course.evidence.at(-1);
      if (!evidence) throw new Error('Real local evidence tool did not persist');
      await f.tool('study_space', { action: 'intention', expectedRevision: course.revision, evidenceId: evidence.id, cards });
      course = await f.course();
      await f.native('flashcard_batch_create', { cards: cards.map(card => ({ ...card, deck: course.deck })) });
      const nativeItems = await f.services.cardStore.list({ deck: course.deck });
      expect(nativeItems).toHaveLength(2);
      course = await f.course();
      expect(course.intentions[0]?.attempts[0]?.state).toBe('resolved');
      expect(course.intentions[0]?.attempts[0]?.cardIds.sort()).toEqual(nativeItems.map(item => item.id).sort());
      expect(f.dialogs.some(dialog => dialog.kind === 'confirm' && dialog.title.includes('create native cards'))).toBe(true);
      await f.prompt(`/teacher review ${course.courseId}`);
      await f.native('flashcard_study_write', { action: 'start', mode: 'scheduled', scope: { kind: 'deck', deck: course.deck }, resumeExisting: true, idempotencyKey: 'review-start' });
      let snapshot = f.snapshot();
      expect(snapshot.round.controllerIdentity).toBe('agent:study-session');
      expect(snapshot).not.toHaveProperty('nextShell'); expect(snapshot).not.toHaveProperty('roster');
      const current = snapshot.current;
      if (!current?.cardId) throw new Error('No native scheduled card');
      const before = await f.services.coordinator.reviewStates.read(current.cardId);
      await f.prompt(`Ask me only the current question: ${current.front}`);
      course = await f.course();
      await f.tool('study_space', { action: 'evidence', expectedRevision: course.revision, prompt: current.front, userAnswer: 'Release descriptors even on errors.', assessment: 'Correct resource cleanup answer; suggest good.', nextPractice: 'Apply finally in code.', gap: null }, 'My attempt: release descriptors even on errors.');
      await f.native('flashcard_study_write', { action: 'checkpoint', roundId: snapshot.round.roundId, expectedRevision: snapshot.round.revision, controlEpoch: snapshot.round.controlEpoch, entryId: current.entryId, contentVersion: current.contentVersion, face: 'answer', idempotencyKey: 'reveal' });
      snapshot = f.snapshot();
      await f.native('flashcard_study_write', { action: 'rate', roundId: snapshot.round.roundId, expectedRevision: snapshot.round.revision, controlEpoch: snapshot.round.controlEpoch, entryId: current.entryId, contentVersion: current.contentVersion, expectedReviewStateRevision: current.reviewStateRevision ?? 0, rating: 'good', idempotencyKey: 'rating' });
      snapshot = f.snapshot();
      expect((await f.services.coordinator.reviewStates.read(current.cardId))?.reps).toBe((before?.reps ?? 0) + 1);
      expect(f.dialogs.some(dialog => dialog.kind === 'confirm' && dialog.title.endsWith('rate'))).toBe(true);
      await f.native('flashcard_study_write', { action: 'undo', roundId: snapshot.round.roundId, expectedRevision: snapshot.round.revision, controlEpoch: snapshot.round.controlEpoch, targetOperationId: snapshot.round.lastAdvanceOperationId, idempotencyKey: 'undo' });
      expect((await f.services.coordinator.reviewStates.read(current.cardId))?.reps).toBe(before?.reps);
      await f.replace();
      await f.prompt('Ordinary coding after runtime replacement.');
      const replacement = f.requests.at(-1);
      if (!replacement) throw new Error('No replacement provider request');
      expect(systemOf(replacement)).not.toContain('<study-space role=');
      await f.prompt(`/teacher resume ${course.courseId}`);
      await f.prompt('Continue from my saved evidence without replaying native writes.');
      const resumed = f.requests.at(-1);
      if (!resumed) throw new Error('No resumed provider request');
      expect(systemOf(resumed)).toContain('<study-space role="learn">');
      expect(systemOf(resumed)).toContain('Release descriptors even on errors.');
      expect(await f.services.cardStore.list({ deck: course.deck })).toHaveLength(2);
      await f.prompt('/teacher off');
      await f.prompt('Return to ordinary coding.');
      const off = f.requests.at(-1);
      if (!off) throw new Error('No off provider request');
      expect(systemOf(off)).not.toContain('<study-space role=');
    } finally { await f.close(); }
  }, 90000);
});
