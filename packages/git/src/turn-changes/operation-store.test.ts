import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { openTurnChangeStore } from './store.js';

const temporaryDirectories: string[] = [];

async function openStore() {
  const rootDir = await mkdtemp(join(tmpdir(), 'piwin-turn-change-op-store-'));
  temporaryDirectories.push(rootDir);
  return openTurnChangeStore({ rootDir });
}

function reserveInput(
  overrides: Partial<Parameters<ReturnType<typeof openTurnChangeStore>['reserveSubagentApply']>[0]> = {},
) {
  return {
    operationId: 'op-1',
    changeSetId: 'cs-apply-1',
    expectedRevision: 1,
    principal: 'host',
    idempotencyKey: 'apply-fp-1',
    requestHash: 'hash-apply-1',
    resultId: 'result-1',
    candidateGroupId: 'group-1',
    ...overrides,
  };
}

describe('subagent-apply reservation store', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('same apply fingerprint replays one operation id', async () => {
    const store = await openStore();
    const first = store.reserveSubagentApply(reserveInput());
    const second = store.reserveSubagentApply(reserveInput({ operationId: 'op-2' }));

    expect(first).toEqual({ outcome: 'created', operationId: 'op-1' });
    expect(second).toEqual({ outcome: 'replay', operationId: 'op-1', status: 'applying' });
    expect(store.getOperation('op-1')?.kind).toBe('subagent-apply');
    store.close();
  });

  it('concurrent same-result and same-group applies produce one writer', async () => {
    const store = await openStore();
    const created = store.reserveSubagentApply(reserveInput());
    const sameResult = store.reserveSubagentApply(
      reserveInput({
        operationId: 'op-2',
        idempotencyKey: 'apply-fp-2',
        requestHash: 'hash-apply-2',
      }),
    );
    const sameGroup = store.reserveSubagentApply(
      reserveInput({
        operationId: 'op-3',
        idempotencyKey: 'apply-fp-3',
        requestHash: 'hash-apply-3',
        resultId: 'result-2',
      }),
    );

    expect(created.outcome).toBe('created');
    expect(sameResult).toMatchObject({ outcome: 'conflict', code: 'already-applied', operationId: 'op-1' });
    expect(sameGroup).toMatchObject({
      outcome: 'conflict',
      code: 'candidate-group-selected',
      operationId: 'op-1',
    });
    store.close();
  });

  it('restart after reservation rejects an overlapping apply', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-turn-change-op-restart-'));
    temporaryDirectories.push(rootDir);
    const first = openTurnChangeStore({ rootDir });
    expect(first.reserveSubagentApply(reserveInput()).outcome).toBe('created');
    first.close();

    const restarted = openTurnChangeStore({ rootDir });
    const overlapping = restarted.reserveSubagentApply(
      reserveInput({
        operationId: 'op-restart',
        idempotencyKey: 'apply-fp-restart',
        requestHash: 'hash-apply-restart',
      }),
    );
    expect(overlapping).toMatchObject({ outcome: 'conflict', code: 'already-applied', operationId: 'op-1' });
    expect(restarted.getSubagentApplyReservation({ resultId: 'result-1' })?.status).toBe('applying');
    restarted.close();
  });

  it('failed pre-write validation releases reservation; needs-repair does not', async () => {
    const store = await openStore();
    expect(store.reserveSubagentApply(reserveInput()).outcome).toBe('created');
    store.releaseSubagentApplyReservation('op-1');
    expect(store.getOperation('op-1')?.status).toBe('rejected');
    expect(store.getSubagentApplyReservation({ resultId: 'result-1' })).toBeUndefined();

    const retried = store.reserveSubagentApply(
      reserveInput({
        operationId: 'op-2',
        idempotencyKey: 'apply-fp-retry',
        requestHash: 'hash-apply-retry',
      }),
    );
    expect(retried).toEqual({ outcome: 'created', operationId: 'op-2' });

    store.updateOperationStatus('op-2', 'needs-repair');
    store.releaseSubagentApplyReservation('op-2');
    expect(store.getOperation('op-2')?.status).toBe('needs-repair');
    expect(
      store.reserveSubagentApply(
        reserveInput({
          operationId: 'op-3',
          idempotencyKey: 'apply-fp-repair',
          requestHash: 'hash-apply-repair',
          resultId: 'result-1',
        }),
      ),
    ).toMatchObject({ outcome: 'conflict', code: 'needs-repair', operationId: 'op-2' });
    expect(
      store.reserveSubagentApply(
        reserveInput({
          operationId: 'op-4',
          idempotencyKey: 'apply-fp-group',
          requestHash: 'hash-apply-group',
          resultId: 'result-other',
        }),
      ),
    ).toMatchObject({ outcome: 'conflict', code: 'needs-repair', operationId: 'op-2' });
    store.close();
  });

  it('records a write-completed fact without operation_file rows', async () => {
    const store = await openStore();
    expect(store.reserveSubagentApply(reserveInput()).outcome).toBe('created');
    store.recordSubagentApplyWriteCompleted('op-1');

    expect(store.hasSubagentApplyWriteCompleted('op-1')).toBe(true);
    expect(store.listOperationFiles('op-1')).toEqual([]);
    expect(store.listSubagentApplyReservations()).toEqual([
      expect.objectContaining({
        operationId: 'op-1',
        resultId: 'result-1',
        status: 'applying',
      }),
    ]);
    store.close();
  });
});
