import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStudyServices, resetStudyCoordinatorsForTests } from '@piwin/flashcards';
import type { FlashcardStudySnapshot, HostToolExecutionContext, ToolResult } from '@piwin/contracts';
import { buildFlashcardStudyTools } from './flashcard-study-tools.js';
import { toStudyChangedPush } from './commands/flashcard-study-commands.js';
import { buildSessionHostTools, descriptorsFromTools } from './tools/build-session-host-tools.js';
import { createSessionHostToolExecutionPort } from './tools/session-host-tool-port.js';
import { createPermissiveToolAdmission } from './tools/tool-admission.js';

const roots: string[] = [];
const context: HostToolExecutionContext = { sessionId: 'session-1', runtimeGenerationId: 'gen-1', runId: 'run-1', toolName: 'flashcard_study_write' };
afterEach(async () => {
  resetStudyCoordinatorsForTests();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
function data<T>(result: ToolResult): T {
  if (!result.ok || !result.output) throw new Error(JSON.stringify(result));
  return JSON.parse(result.output) as T;
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'native-study-tools-')); roots.push(root);
  const pushes: unknown[] = [];
  const services = createStudyServices({ piwinRoot: root, hooks: { onApplied: event => { pushes.push(toStudyChangedPush(event)); } } });
  const item = await services.cardStore.create({ model: 'basic', deck: 'course', front: 'Q1', back: 'A1' });
  await services.cardStore.create({ model: 'basic', deck: 'course', front: 'Q2', back: 'next-secret' });
  const getStudyService = vi.fn(async () => services.study);
  const tools = buildFlashcardStudyTools({ getStudyService });
  const readTool = tools.find(tool => tool.descriptor.name === 'flashcard_study_read');
  const writeTool = tools.find(tool => tool.descriptor.name === 'flashcard_study_write');
  if (!readTool || !writeTool) throw new Error('Study registrations missing');
  const read = (args: Record<string, unknown>, actor = context) => readTool.execute(args, new AbortController().signal, actor);
  const write = (args: Record<string, unknown>, actor = context) => writeTool.execute(args, new AbortController().signal, actor);
  const start = () => write({ action: 'start', mode: 'scheduled', scope: { kind: 'deck', deck: 'course' }, resumeExisting: true, idempotencyKey: 'start' });
  return { root, pushes, services, item, getStudyService, readTool, writeTool, read, write, start };
}
function fields(snapshot: FlashcardStudySnapshot) {
  return { roundId: snapshot.round.roundId, expectedRevision: snapshot.round.revision, controlEpoch: snapshot.round.controlEpoch };
}
function current(snapshot: FlashcardStudySnapshot) {
  if (!snapshot.current) throw new Error('No current card');
  return snapshot.current;
}

describe('native scheduled study tools', () => {
  it('rates once, broadcasts summary only, and undo restores native FSRS', async () => {
    const f = await fixture();
    let snapshot = data<FlashcardStudySnapshot>(await f.start());
    expect(snapshot.round.controllerIdentity).toBe('agent:session-1');
    expect(snapshot).not.toHaveProperty('nextShell'); expect(snapshot).not.toHaveProperty('roster');
    expect(JSON.stringify(snapshot)).not.toContain('next-secret');
    const card = current(snapshot);
    if (!card.cardId) throw new Error('No scheduled card ID');
    const before = await f.services.coordinator.reviewStates.read(card.cardId);
    snapshot = data(await f.write({ action: 'checkpoint', ...fields(snapshot), entryId: card.entryId, contentVersion: card.contentVersion, face: 'answer', idempotencyKey: 'reveal' }));
    const rate = { action: 'rate', ...fields(snapshot), entryId: card.entryId, contentVersion: card.contentVersion, rating: 'good', expectedReviewStateRevision: card.reviewStateRevision ?? 0, idempotencyKey: 'rate' };
    const rated = data<FlashcardStudySnapshot>(await f.write(rate));
    const after = await f.services.coordinator.reviewStates.read(card.cardId);
    expect(after?.reps).toBe((before?.reps ?? 0) + 1);
    const pushCount = f.pushes.length;
    expect(data(await f.write(rate))).toEqual(rated);
    expect(f.pushes).toHaveLength(pushCount);
    expect(await f.services.coordinator.reviewStates.read(card.cardId)).toEqual(after);
    expect(await f.write({ ...rate, rating: 'easy' })).toMatchObject({ ok: false, details: { reason: 'StudyOperationConflictError' } });
    expect(data(await f.read({ action: 'operation', idempotencyKey: 'rate' }))).toEqual({ status: 'success', snapshot: rated });
    const native = await f.services.study.get(rated.round.roundId, 'agent:session-1');
    expect(native.round).toEqual(rated.round);
    if (!rated.round.lastAdvanceOperationId) throw new Error('No undo operation');
    await f.write({ action: 'undo', ...fields(rated), targetOperationId: rated.round.lastAdvanceOperationId, idempotencyKey: 'undo' });
    const restored = await f.services.coordinator.reviewStates.read(card.cardId);
    expect(restored?.reps).toBe(before?.reps); expect(restored?.due).toBe(before?.due);
    for (const push of f.pushes) expect(Object.keys(push as object).sort()).toEqual(['reason', 'revision', 'roundId', 'type']);
  });

  it.each(['claim', 'checkpoint', 'rate', 'undo', 'pause', 'resume', 'end'])('rejects sequence %s BEFORE mutation', async action => {
    const f = await fixture();
    const snapshot = await f.services.study.start({ mode: 'sequence', scope: { kind: 'item', itemId: f.item.id }, controllerIdentity: 'device-a', idempotencyKey: 'sequence' });
    const card = current(snapshot);
    const args: Record<string, unknown> = { action, ...fields(snapshot), idempotencyKey: `sequence-${action}` };
    if (action === 'claim') { delete args.controlEpoch; args.expectedControlEpoch = snapshot.round.controlEpoch; }
    if (action === 'checkpoint' || action === 'rate') Object.assign(args, { entryId: card.entryId, contentVersion: card.contentVersion });
    if (action === 'checkpoint') args.face = 'answer';
    if (action === 'rate') Object.assign(args, { rating: 'good', expectedReviewStateRevision: 0 });
    if (action === 'undo') args.targetOperationId = 'prior';
    const count = f.pushes.length;
    expect(await f.write(args)).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(await f.services.study.get(snapshot.round.roundId, 'device-a')).toEqual(snapshot);
    expect(f.pushes).toHaveLength(count);
    expect(await f.read({ action: 'get', roundId: snapshot.round.roundId })).toMatchObject({ ok: false });
  });

  it('isolates keys by product session and never auto-claims an existing round', async () => {
    const f = await fixture(); const first = data<FlashcardStudySnapshot>(await f.start());
    const other = { ...context, sessionId: 'session-2' };
    expect(data(await f.read({ action: 'operation', idempotencyKey: 'start' }, other))).toEqual({ status: 'not-found' });
    const resumed = data<FlashcardStudySnapshot>(await f.write({ action: 'start', mode: 'scheduled', scope: { kind: 'deck', deck: 'course' }, resumeExisting: true, idempotencyKey: 'start' }, other));
    expect(resumed.round.roundId).toBe(first.round.roundId); expect(resumed.access.hasControl).toBe(false);
    const claimed = data<FlashcardStudySnapshot>(await f.write({ action: 'claim', roundId: first.round.roundId, expectedRevision: resumed.round.revision, expectedControlEpoch: resumed.round.controlEpoch, idempotencyKey: 'claim' }, other));
    expect(claimed.round.controlEpoch).toBe(first.round.controlEpoch + 1);
    expect(await f.write({ action: 'pause', ...fields(claimed), idempotencyKey: 'lost' })).toMatchObject({ ok: false, details: { reason: 'StudyControlLostError' } });
  });

  it('validates authority before permission and observes abort after the provider/preflight awaits', async () => {
    const f = await fixture();
    const bad = { action: 'start', mode: 'scheduled', scope: { kind: 'all' }, idempotencyKey: 'bad', principal: 'other' };
    expect(await f.writeTool.prepareArgs?.(bad, context, new AbortController().signal)).toMatchObject({ ok: false });
    expect(await f.write(bad)).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(f.getStudyService).not.toHaveBeenCalled();
    const snapshot = data<FlashcardStudySnapshot>(await f.start());
    const controller = new AbortController();
    const get = f.services.study.get;
    const paused = vi.spyOn(f.services.study, 'pause');
    vi.spyOn(f.services.study, 'get').mockImplementation(async (...args) => { const value = await get(...args); controller.abort(); return value; });
    expect(await f.writeTool.execute({ action: 'pause', ...fields(snapshot), idempotencyKey: 'aborted' }, controller.signal, context)).toMatchObject({ ok: false, code: 'aborted' });
    expect(paused).not.toHaveBeenCalled();
  });

  it('rejects stale revision, content, and review-state CAS', async () => {
    const f = await fixture(); const snapshot = data<FlashcardStudySnapshot>(await f.start()); const card = current(snapshot);
    expect(await f.write({ action: 'pause', ...fields(snapshot), expectedRevision: 999, idempotencyKey: 'stale-revision' })).toMatchObject({ ok: false, details: { reason: 'StudyRevisionConflictError' } });
    expect(await f.write({ action: 'checkpoint', ...fields(snapshot), entryId: card.entryId, contentVersion: 'wrong', face: 'answer', idempotencyKey: 'stale-content' })).toMatchObject({ ok: false, details: { reason: 'StudyContentChangedError' } });
    const revealed = data<FlashcardStudySnapshot>(await f.write({ action: 'checkpoint', ...fields(snapshot), entryId: card.entryId, contentVersion: card.contentVersion, face: 'answer', idempotencyKey: 'reveal' }));
    expect(await f.write({ action: 'rate', ...fields(revealed), entryId: card.entryId, contentVersion: card.contentVersion, rating: 'good', expectedReviewStateRevision: 999, idempotencyKey: 'stale-review' })).toMatchObject({ ok: false });
  });

  it('composes lazy Toolbox targets, retains generation/Run admission and native shared state', async () => {
    const f = await fixture();
    const tools = await buildSessionHostTools({ sessionId: context.sessionId, piwinRoot: f.root, getCardStore: async () => f.services.cardStore, getStudyService: f.getStudyService });
    expect(descriptorsFromTools(tools).map(tool => tool.name)).toContain('piwin_toolbox');
    expect(descriptorsFromTools(tools).map(tool => tool.name)).not.toContain('flashcard_study_write');
    const port = createSessionHostToolExecutionPort({ isSessionKnown: () => true, getRuntimeGenerationId: () => 'gen-1', isRunAdmitted: run => run === 'run-1' });
    port.registerActiveGeneration('session-1', 'gen-1', tools, createPermissiveToolAdmission());
    port.restrictGeneration('session-1', 'gen-1', descriptorsFromTools(tools).map(tool => tool.name), ['flashcard_study_read', 'flashcard_study_write']);
    const input = { ...context, toolName: 'piwin_toolbox', arguments: { action: 'call', target: 'flashcard_study_write', arguments: { action: 'start', mode: 'scheduled', scope: { kind: 'deck', deck: 'course' }, idempotencyKey: 'via-toolbox' } } };
    const result = await port.execute(input, new AbortController().signal);
    const snapshot = data<FlashcardStudySnapshot>(result);
    expect((await f.services.study.get(snapshot.round.roundId, 'agent:session-1')).round).toEqual(snapshot.round);
    expect(await port.execute({ ...input, runtimeGenerationId: 'old' }, new AbortController().signal)).toMatchObject({ ok: false, code: 'tool-not-available' });
    expect(await port.execute({ ...input, runId: 'wrong' }, new AbortController().signal)).toMatchObject({ ok: false, code: 'tool-not-available' });
  });
});
