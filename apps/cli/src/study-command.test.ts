import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  FlashcardStudyCatalogPage,
  FlashcardStudySnapshot,
  HostCommand,
  HostResponse,
  HostStatusData,
} from '@piwin/contracts';
import { openCliHost } from './cli-host.js';
import {
  bindStudyHostClient,
  CLI_STUDY_NO_MOTION_NOTICE,
  formatStudyCatalogPage,
  formatStudySnapshot,
  runStudyCommand,
  STUDY_VERBS,
  type StudyHostClient,
} from './study-command.js';

const previousUrl = process.env.PIWIN_HOST_URL;
const roots: string[] = [];

afterEach(async () => {
  if (previousUrl === undefined) delete process.env.PIWIN_HOST_URL;
  else process.env.PIWIN_HOST_URL = previousUrl;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function statusData(flashcardStudy: boolean): HostStatusData {
  return {
    mode: 'sdk',
    ready: true,
    mock: true,
    piwinRoot: '/tmp/piwin-test',
    generalWorkspacePath: '/tmp/piwin-test/workspace',
    activeSessionIds: [],
    capabilities: {
      customTools: true,
      mcpLifecycle: true,
      productTranscript: true,
      compaction: false,
      extensions: false,
      prompts: false,
      flashcardStudy,
    },
  };
}

function snapshot(overrides?: Partial<FlashcardStudySnapshot>): FlashcardStudySnapshot {
  return {
    round: {
      roundId: 'round-1',
      schemaVersion: 1,
      mode: 'sequence',
      scope: { kind: 'item', itemId: 'item-1' },
      status: 'active',
      revision: 2,
      controlEpoch: 1,
      controllerIdentity: 'cli',
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
      currentEntryId: 'entry-1',
      face: 'question',
      lastAdvanceOperationId: null,
    },
    current: {
      entryId: 'entry-1',
      itemId: 'item-1',
      contentVersion: 'cv-1',
      model: 'basic',
      deck: 'General',
      face: 'question',
      front: 'What is 2+2?',
      needsReview: false,
    },
    counts: { total: 3, processed: 1, invalidated: 0, remaining: 2 },
    canUndo: false,
    access: { hasControl: true, controllerIdentity: 'cli', controlEpoch: 1 },
    ...overrides,
  };
}

function catalogPage(): FlashcardStudyCatalogPage {
  return {
    tiles: [{ kind: 'set', id: 'seq-1', count: 2, preview: 'Q1' }],
    dueCount: 4,
    newCount: 1,
    unfinishedRounds: [
      {
        roundId: 'round-paused',
        mode: 'sequence',
        scope: { kind: 'sequence', sequenceId: 'seq-1' },
        status: 'paused',
        revision: 5,
        updatedAt: '2026-08-30T00:00:00.000Z',
        counts: { total: 2, processed: 1, invalidated: 0, remaining: 1 },
      },
    ],
    nextCursor: 'cursor-2',
  };
}

function ok(command: HostCommand, data: unknown): HostResponse {
  return { type: 'response', command: command.type, success: true, data };
}

function fail(command: HostCommand, error: string, code?: string): HostResponse {
  return {
    type: 'response',
    command: command.type,
    success: false,
    error,
    ...(code ? { problem: { code } } : {}),
  };
}

function createClient(
  respond: (command: HostCommand, options?: { idempotencyKey?: string }) => HostResponse,
): StudyHostClient & {
  calls: Array<{ command: HostCommand; key?: string }>;
} {
  const calls: Array<{ command: HostCommand; key?: string }> = [];
  return {
    calls,
    handleCommand: async (command, options) => {
      calls.push({
        command,
        ...(options?.idempotencyKey === undefined ? {} : { key: options.idempotencyKey }),
      });
      return respond(command, options);
    },
    dispose: async () => undefined,
  };
}

function supportingClient(
  respond: (command: HostCommand, options?: { idempotencyKey?: string }) => HostResponse,
): ReturnType<typeof createClient> {
  return createClient((command, options) => {
    if (command.type === 'host/status') return ok(command, statusData(true));
    return respond(command, options);
  });
}

describe('study CLI formatters', () => {
  it('prints Host catalog progress without a second library', () => {
    const text = formatStudyCatalogPage(catalogPage());
    expect(text).toContain(CLI_STUDY_NO_MOTION_NOTICE);
    expect(text).toContain('due=4\tnew=1');
    expect(text).toContain('unfinished\tround-paused\tpaused\tsequence\trev=5\tremaining=1');
    expect(text).toContain('tile\tset\tseq-1\t2\tQ1');
    expect(text).toContain('nextCursor\tcursor-2');
  });

  it('prints Host snapshot revision, counts, and current entry', () => {
    const text = formatStudySnapshot(snapshot(), { idempotencyKey: 'key-1' });
    expect(text).toContain(CLI_STUDY_NO_MOTION_NOTICE);
    expect(text).toContain('round\tround-1\trev=2\tepoch=1');
    expect(text).toContain('counts\ttotal=3\tprocessed=1\tremaining=2');
    expect(text).toContain('current\tentry=entry-1\titem=item-1\tface=question');
    expect(text).toContain('What is 2+2?');
    expect(text).not.toContain('back:');
    expect(text).toContain('idempotencyKey\tkey-1');
  });

  it('tells the user to claim explicitly when this CLI does not have control', () => {
    const text = formatStudySnapshot(
      snapshot({
        access: { hasControl: false, controllerIdentity: 'desktop', controlEpoch: 4 },
      }),
    );
    expect(text).toContain('control=no');
    expect(text).toContain('claim is explicit');
    expect(text).toContain('piwin study claim round-1 --revision 2 --epoch 1');
  });
});

describe('study CLI Host protocol', () => {
  it('exposes every study verb', () => {
    expect(STUDY_VERBS).toEqual([
      'catalog',
      'start',
      'get',
      'claim',
      'checkpoint',
      'next',
      'rate',
      'undo',
      'pause',
      'resume',
      'end',
      'operation',
    ]);
  });

  it('refuses an old Host before sending study commands', async () => {
    const client = createClient((command) => {
      if (command.type === 'host/status') return ok(command, statusData(false));
      return ok(command, snapshot());
    });
    await expect(runStudyCommand(client, ['catalog'], () => undefined)).rejects.toThrow(
      /需要更新 Host/,
    );
    expect(client.calls.map((call) => call.command.type)).toEqual(['host/status']);
  });

  it('sends catalog to Host and does not claim', async () => {
    const client = supportingClient((command) => ok(command, catalogPage()));
    const lines: string[] = [];
    await runStudyCommand(client, ['catalog', '--query', 'cache', '--limit', '20'], (line) =>
      lines.push(line),
    );
    expect(client.calls.map((call) => call.command.type)).toEqual([
      'host/status',
      'flashcards/study/catalog',
    ]);
    expect(client.calls[1]?.command).toMatchObject({
      type: 'flashcards/study/catalog',
      query: 'cache',
      limit: 20,
    });
    expect(client.calls[1]?.key).toBeUndefined();
    expect(lines.join('\n')).toContain('due=4');
    expect(lines.join('\n')).toContain('no tear animation');
  });

  it('starts a sequence round on Host without claiming', async () => {
    const client = supportingClient((command) => ok(command, snapshot()));
    await runStudyCommand(
      client,
      ['start', 'sequence', '--sequence', 'seq-1', '--idempotency-key', 'start-1'],
      () => undefined,
    );
    expect(client.calls.map((call) => call.command.type)).toEqual([
      'host/status',
      'flashcards/study/start',
    ]);
    expect(client.calls[1]).toEqual({
      command: {
        type: 'flashcards/study/start',
        mode: 'sequence',
        scope: { kind: 'sequence', sequenceId: 'seq-1' },
        resumeExisting: true,
      },
      key: 'start-1',
    });
  });

  it('get reads the Host snapshot and never claims', async () => {
    const client = supportingClient((command) => ok(command, snapshot()));
    await runStudyCommand(client, ['get', 'round-1'], () => undefined);
    expect(client.calls.map((call) => call.command.type)).toEqual([
      'host/status',
      'flashcards/study/get',
    ]);
    expect(client.calls[1]?.command).toEqual({ type: 'flashcards/study/get', roundId: 'round-1' });
  });

  it('claim is an explicit Host command', async () => {
    const client = supportingClient((command) => ok(command, snapshot()));
    await runStudyCommand(
      client,
      ['claim', 'round-1', '--revision', '2', '--epoch', '1', '--idempotency-key', 'claim-1'],
      () => undefined,
    );
    expect(client.calls[1]).toEqual({
      command: {
        type: 'flashcards/study/claim',
        roundId: 'round-1',
        expectedRevision: 2,
        expectedControlEpoch: 1,
      },
      key: 'claim-1',
    });
  });

  it('checkpoint is the explicit reveal / needsReview path', async () => {
    const client = supportingClient((command) =>
      ok(
        command,
        snapshot({
          current: {
            entryId: 'entry-1',
            itemId: 'item-1',
            contentVersion: 'cv-1',
            model: 'basic',
            deck: 'General',
            face: 'answer',
            front: 'What is 2+2?',
            back: '4',
            needsReview: true,
          },
        }),
      ),
    );
    const lines: string[] = [];
    await runStudyCommand(
      client,
      [
        'checkpoint',
        'round-1',
        '--revision',
        '2',
        '--epoch',
        '1',
        '--entry',
        'entry-1',
        '--content-version',
        'cv-1',
        '--face',
        'answer',
        '--needs-review',
        '--idempotency-key',
        'cp-1',
      ],
      (line) => lines.push(line),
    );
    expect(client.calls[1]?.command).toEqual({
      type: 'flashcards/study/checkpoint',
      roundId: 'round-1',
      expectedRevision: 2,
      controlEpoch: 1,
      entryId: 'entry-1',
      contentVersion: 'cv-1',
      face: 'answer',
      needsReview: true,
    });
    expect(lines.join('\n')).toContain('back:');
    expect(lines.join('\n')).toContain('4');
  });

  it('sends next, rate, undo, pause, resume, end, and operation to Host', async () => {
    const client = supportingClient((command) => {
      if (command.type === 'flashcards/study/operation') {
        return ok(command, { status: 'success', snapshot: snapshot() });
      }
      return ok(command, snapshot());
    });
    const cases: Array<{ argv: string[]; type: string }> = [
      {
        argv: [
          'next',
          'round-1',
          '--revision',
          '2',
          '--epoch',
          '1',
          '--entry',
          'entry-1',
          '--content-version',
          'cv-1',
          '--idempotency-key',
          'next-1',
        ],
        type: 'flashcards/study/next',
      },
      {
        argv: [
          'rate',
          'round-1',
          '--revision',
          '2',
          '--epoch',
          '1',
          '--entry',
          'entry-1',
          '--content-version',
          'cv-1',
          '--rating',
          'good',
          '--review-revision',
          '0',
          '--idempotency-key',
          'rate-1',
        ],
        type: 'flashcards/study/rate',
      },
      {
        argv: [
          'undo',
          'round-1',
          '--revision',
          '3',
          '--epoch',
          '1',
          '--operation',
          'next-1',
          '--idempotency-key',
          'undo-1',
        ],
        type: 'flashcards/study/undo',
      },
      {
        argv: [
          'pause',
          'round-1',
          '--revision',
          '2',
          '--epoch',
          '1',
          '--idempotency-key',
          'pause-1',
        ],
        type: 'flashcards/study/pause',
      },
      {
        argv: [
          'resume',
          'round-1',
          '--revision',
          '3',
          '--epoch',
          '1',
          '--idempotency-key',
          'resume-1',
        ],
        type: 'flashcards/study/resume',
      },
      {
        argv: ['end', 'round-1', '--revision', '3', '--epoch', '1', '--idempotency-key', 'end-1'],
        type: 'flashcards/study/end',
      },
      { argv: ['operation', 'next-1'], type: 'flashcards/study/operation' },
    ];
    for (const item of cases) {
      client.calls.length = 0;
      await runStudyCommand(client, item.argv, () => undefined);
      expect(client.calls.map((call) => call.command.type)).toEqual(['host/status', item.type]);
    }
    const rate = cases[1];
    if (!rate) throw new Error('expected rate case');
    client.calls.length = 0;
    await runStudyCommand(client, rate.argv, () => undefined);
    expect(client.calls[1]?.command).toMatchObject({
      type: 'flashcards/study/rate',
      rating: 'good',
      expectedReviewStateRevision: 0,
    });
  });

  it('hints checkpoint when Host rejects rate', async () => {
    const client = supportingClient((command) =>
      fail(command, 'rate is only accepted on the answer face', 'StudyInvalidCommandError'),
    );
    await expect(
      runStudyCommand(
        client,
        [
          'rate',
          'round-1',
          '--revision',
          '2',
          '--epoch',
          '1',
          '--entry',
          'entry-1',
          '--content-version',
          'cv-1',
          '--rating',
          'good',
          '--review-revision',
          '0',
        ],
        () => undefined,
      ),
    ).rejects.toThrow(/checkpoint --face answer/);
  });

  it('forwards caller-owned keys through bindStudyHostClient', async () => {
    const sent: Array<{ type: string; key?: string }> = [];
    const host = {
      handleCommand: async (command: HostCommand, options?: { idempotencyKey?: string }) => {
        sent.push({
          type: command.type,
          ...(options?.idempotencyKey === undefined ? {} : { key: options.idempotencyKey }),
        });
        if (command.type === 'host/status') return ok(command, statusData(true));
        return ok(command, snapshot());
      },
      dispose: async () => undefined,
    };
    const client = bindStudyHostClient(host);
    await runStudyCommand(
      client,
      ['start', 'scheduled', '--idempotency-key', 'bound-1'],
      () => undefined,
    );
    expect(sent).toEqual([
      { type: 'host/status' },
      { type: 'flashcards/study/start', key: 'bound-1' },
    ]);
  });

  it('rejects path-like round ids before talking to Host', async () => {
    const client = supportingClient((command) => ok(command, snapshot()));
    await expect(runStudyCommand(client, ['get', '../etc'], () => undefined)).rejects.toThrow(
      /Invalid roundId/,
    );
    expect(client.calls.map((call) => call.command.type)).toEqual(['host/status']);
  });
});

describe('study CLI attached Host (in-process stand-in)', () => {
  it('catalog/start/checkpoint/next talk to HostRuntime, not a local StudyService', async () => {
    delete process.env.PIWIN_HOST_URL;
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-cli-study-'));
    roots.push(piwinRoot);
    const host = await openCliHost({ mode: 'sdk', mock: true, piwinRoot });
    const client = bindStudyHostClient(host);
    const log = vi.fn();
    try {
      const created = await client.handleCommand({
        type: 'flashcards/create',
        input: { front: 'Q1', back: 'A1', sequenceId: 'seq-cli', position: 1 },
      });
      expect(created.success).toBe(true);
      const createdData = created.success ? created.data : undefined;
      const first = createdData as { card?: { id?: string } } | undefined;
      await client.handleCommand({
        type: 'flashcards/create',
        input: { front: 'Q2', back: 'A2', sequenceId: 'seq-cli', position: 2 },
      });

      await runStudyCommand(client, ['catalog', '--query', 'Q1'], log);
      expect(log.mock.calls[0]?.[0]).toContain('no tear animation');

      await runStudyCommand(
        client,
        ['start', 'sequence', '--sequence', 'seq-cli', '--idempotency-key', 'cli-start'],
        log,
      );
      const startText = String(log.mock.calls.at(-1)?.[0] ?? '');
      expect(startText).toMatch(/round\tround-/);
      expect(startText).toContain('rev=');
      expect(startText).toContain('counts\t');
      const roundId = /round\t([^\t]+)/.exec(startText)?.[1];
      const revision = Number(/rev=(\d+)/.exec(startText)?.[1]);
      const epoch = Number(/epoch=(\d+)/.exec(startText)?.[1]);
      const entryId = /current\tentry=([^\t]+)/.exec(startText)?.[1];
      const contentVersion = /contentVersion=([^\t\n]+)/.exec(startText)?.[1];
      expect(roundId).toMatch(/^round-/);
      expect(entryId).toBeTruthy();
      expect(contentVersion).toBeTruthy();
      if (!roundId || !entryId || !contentVersion) throw new Error('missing snapshot fields');
      expect(first?.card?.id).toBeTruthy();

      await runStudyCommand(
        client,
        [
          'checkpoint',
          roundId,
          '--revision',
          String(revision),
          '--epoch',
          String(epoch),
          '--entry',
          entryId,
          '--content-version',
          contentVersion,
          '--face',
          'answer',
          '--idempotency-key',
          'cli-cp',
        ],
        log,
      );
      const revealed = String(log.mock.calls.at(-1)?.[0] ?? '');
      expect(revealed).toContain('back:');
      expect(revealed).toContain('A1');
      const afterRev = Number(/rev=(\d+)/.exec(revealed)?.[1]);

      await runStudyCommand(
        client,
        [
          'next',
          roundId,
          '--revision',
          String(afterRev),
          '--epoch',
          String(epoch),
          '--entry',
          entryId,
          '--content-version',
          contentVersion,
          '--idempotency-key',
          'cli-next',
        ],
        log,
      );
      const nextText = String(log.mock.calls.at(-1)?.[0] ?? '');
      expect(nextText).toContain('processed=1');
      expect(nextText).toContain('Q2');

      await runStudyCommand(client, ['operation', 'cli-next'], log);
      expect(String(log.mock.calls.at(-1)?.[0] ?? '')).toContain('operation\tsuccess');
    } finally {
      await client.dispose();
    }
  });
});
