import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type {
  JobKind,
  JobLifetime,
  JobCleanupResult,
  JobLogChunk,
  JobRecord,
  JobStopResult,
  JobTerminalReason,
} from '@piwin/contracts';

import { createJobRegistry, type JobRegistryEvent, type JobPolicy } from './job-registry.js';
import type { JobLogStore } from './job-log-store.js';
import type {
  ProcessSpawnInput,
  ProcessSupervisor,
  SupervisedProcess,
} from './process-supervisor.js';

// ---------------------------------------------------------------------------
// Test helpers: mock process supervisor, mock log store, fake child process
// ---------------------------------------------------------------------------

/** A controllable fake ChildProcess backed by an EventEmitter. */
interface FakeChild extends ChildProcess {
  emitStdout(data: string): void;
  emitStderr(data: string): void;
  emitError(error: Error): void;
  emitClose(code: number | null): void;
}

function createFakeChild(pid: number): FakeChild {
  const stdout = new EventEmitter() as EventEmitter & {
    writable: boolean;
    write: (chunk: Buffer) => boolean;
  };
  const stderr = new EventEmitter() as EventEmitter & {
    writable: boolean;
    write: (chunk: Buffer) => boolean;
  };
  stdout.writable = true;
  stdout.write = (chunk: Buffer) => {
    stdout.emit('data', chunk);
    return true;
  };
  stderr.writable = true;
  stderr.write = (chunk: Buffer) => {
    stderr.emit('data', chunk);
    return true;
  };

  const bus = new EventEmitter();

  const child = {
    pid,
    exitCode: null,
    signalCode: null,
    killed: false,
    connected: true,
    stdin: null,
    stdout,
    stderr,
    stdio: [null, stdout, stderr],
    eventNames: bus.eventNames.bind(bus),
    on: bus.on.bind(bus),
    once: bus.once.bind(bus),
    off: bus.off.bind(bus),
    emit: bus.emit.bind(bus),
    addListener: bus.addListener.bind(bus),
    removeListener: bus.removeListener.bind(bus),
    removeAllListeners: bus.removeAllListeners.bind(bus),
    listeners: bus.listeners.bind(bus),
    kill: vi.fn((_signal?: string) => {
      (child as { killed: boolean }).killed = true;
      return true;
    }),
    send: vi.fn(),
    disconnect: vi.fn(),
    unref: vi.fn(),
    ref: vi.fn(),
    emitStdout(data: string): void {
      stdout.emit('data', Buffer.from(data, 'utf8'));
    },
    emitStderr(data: string): void {
      stderr.emit('data', Buffer.from(data, 'utf8'));
    },
    emitError(error: Error): void {
      bus.emit('error', error);
    },
    emitClose(code: number | null): void {
      (child as { exitCode: number | null }).exitCode = code;
      bus.emit('close', code);
    },
  } as unknown as FakeChild;

  return child;
}

/** A mock ProcessSupervisor that returns fake child processes. */
function createMockSupervisor(): ProcessSupervisor & {
  children: FakeChild[];
  spawnCalls: ProcessSpawnInput[];
  stopCalls: SupervisedProcess[];
  trackedTargets: Set<SupervisedProcess>;
  disposed: boolean;
  nextPid: number;
  /** Inject a child for the next spawn call (or auto-create). */
  pendingChild: FakeChild | null;
  /** Set to make the next spawn throw. */
  spawnError: Error | null;
  /** Set to make the next stop throw. */
  stopError: Error | null;
} {
  let pidCounter = 1000;
  const tracked = new Set<SupervisedProcess>();

  const mock: ProcessSupervisor & {
    children: FakeChild[];
    spawnCalls: ProcessSpawnInput[];
    stopCalls: SupervisedProcess[];
    trackedTargets: Set<SupervisedProcess>;
    disposed: boolean;
    nextPid: number;
    pendingChild: FakeChild | null;
    spawnError: Error | null;
    stopError: Error | null;
  } = {
    children: [],
    spawnCalls: [],
    stopCalls: [],
    trackedTargets: tracked,
    disposed: false,
    nextPid: 1000,
    pendingChild: null,
    spawnError: null,
    stopError: null,

    async spawn(input: ProcessSpawnInput): Promise<SupervisedProcess> {
      mock.spawnCalls.push(input);
      if (mock.spawnError) {
        const error = mock.spawnError;
        mock.spawnError = null;
        throw error;
      }
      const pid = mock.pendingChild?.pid ?? ++pidCounter;
      const child = mock.pendingChild ?? createFakeChild(pid);
      mock.pendingChild = null;
      mock.children.push(child);

      const supervised: SupervisedProcess = {
        processId: child.pid!,
        processGroupId: child.pid!,
        child,
      };
      tracked.add(supervised);
      child.on('close', () => {
        tracked.delete(supervised);
      });
      return supervised;
    },

    async stop(target: SupervisedProcess): Promise<void> {
      mock.stopCalls.push(target);
      if (mock.stopError) {
        const error = mock.stopError;
        mock.stopError = null;
        throw error;
      }
      tracked.delete(target);
      // Signal the fake child that it was killed.
      (target.child as unknown as { killed: boolean }).killed = true;
    },

    async dispose(): Promise<void> {
      mock.disposed = true;
      tracked.clear();
    },
  };

  return mock;
}

/** A mock JobLogStore for deterministic log testing. */
function createMockLogStore(): JobLogStore & {
  appendCalls: Array<{ jobId: string; stream: string; text: string }>;
  readCalls: number;
  disposed: boolean;
  /** Pre-seeded chunks per job. */
  seeded: Map<string, JobLogChunk[]>;
  /** Override latest cursor per job. */
  cursors: Map<string, number>;
} {
  const mock: JobLogStore & {
    appendCalls: Array<{ jobId: string; stream: string; text: string }>;
    readCalls: number;
    disposed: boolean;
    seeded: Map<string, JobLogChunk[]>;
    cursors: Map<string, number>;
  } = {
    appendCalls: [],
    readCalls: 0,
    disposed: false,
    seeded: new Map(),
    cursors: new Map(),

    append(jobId: string, stream: 'stdout' | 'stderr' | 'system', text: string): string {
      mock.appendCalls.push({ jobId, stream, text });
      const chunks = mock.seeded.get(jobId) ?? [];
      const cursor = chunks.length > 0 ? chunks[chunks.length - 1]!.cursor + 1 : 1;
      const chunk: JobLogChunk = {
        jobId,
        stream,
        text,
        at: new Date().toISOString(),
        cursor,
      };
      chunks.push(chunk);
      mock.seeded.set(jobId, chunks);
      mock.cursors.set(jobId, cursor);
      return text;
    },

    read(input: {
      jobId: string;
      afterCursor?: number;
      maxBytes?: number;
    }): {
      chunks: JobLogChunk[];
      nextCursor: number;
      hasMore: boolean;
    } {
      mock.readCalls++;
      const afterCursor = input.afterCursor ?? 0;
      const maxBytes = input.maxBytes ?? 256 * 1024;
      const chunks = mock.seeded.get(input.jobId) ?? [];
      const eligible: JobLogChunk[] = [];
      let accumulated = 0;
      for (const chunk of chunks) {
        if (chunk.cursor <= afterCursor) continue;
        if (accumulated + chunk.text.length > maxBytes && eligible.length > 0) {
          break;
        }
        eligible.push(chunk);
        accumulated += chunk.text.length;
      }
      if (eligible.length === 0) {
        return { chunks: [], nextCursor: afterCursor, hasMore: false };
      }
      const last = eligible[eligible.length - 1]!;
      const lastIdx = chunks.indexOf(last);
      const hasMore = lastIdx < chunks.length - 1;
      return { chunks: eligible, nextCursor: last.cursor, hasMore };
    },

    getLatestCursor(jobId: string): number {
      return mock.cursors.get(jobId) ?? 0;
    },

    clear(jobId: string): void {
      mock.seeded.delete(jobId);
      mock.cursors.delete(jobId);
    },

    dispose(): void {
      mock.disposed = true;
      mock.seeded.clear();
      mock.cursors.clear();
    },
  };

  return mock;
}

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

interface Fixture {
  registry: ReturnType<typeof createJobRegistry>;
  supervisor: ReturnType<typeof createMockSupervisor>;
  logStore: ReturnType<typeof createMockLogStore>;
  events: JobRegistryEvent[];
  trustedDir: string;
  createId: () => string;
}

async function createFixture(options?: {
  maxJobs?: number;
  logThrottleMs?: number;
  getJobPolicy?: () => JobPolicy;
}): Promise<Fixture> {
  const trustedDir = await mkdtemp(join(tmpdir(), 'piwin-job-test-'));
  const supervisor = createMockSupervisor();
  const logStore = createMockLogStore();
  const events: JobRegistryEvent[] = [];
  let idCounter = 0;
  const createId = (): string => `job-${++idCounter}`;

  const registry = createJobRegistry({
    maxJobs: options?.maxJobs ?? 8,
    ...(options?.getJobPolicy ? { getJobPolicy: options.getJobPolicy } : {}),
    logThrottleMs: options?.logThrottleMs ?? 10,
    now: () => new Date('2025-01-01T00:00:00Z'),
    createId,
    getTrustedProjectRoots: () => [trustedDir],
    onEvent: (event) => {
      events.push(event);
    },
    logStore,
    processSupervisor: supervisor,
  });

  return { registry, supervisor, logStore, events, trustedDir, createId };
}

function baseStartInput(overrides?: Partial<{
  kind: 'command' | 'service';
  lifetime: 'run' | 'session' | 'host';
  command: string;
  argv: string[];
  cwd: string;
  ownerRunId: string;
  ownerSessionId: string;
  ownerProjectPath: string;
  label: string;
}>): {
  kind: JobKind;
  lifetime: JobLifetime;
  command: string;
  argv: string[];
  cwd: string;
  ownerRunId?: string;
  ownerSessionId?: string;
  ownerProjectPath?: string;
  label?: string;
} {
  return {
    kind: 'command',
    lifetime: 'host',
    command: 'echo',
    argv: ['hello'],
    cwd: '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JobRegistry', () => {
  // -- start: basic --------------------------------------------------------

  describe('start() basic', () => {
    it('starts a command job and returns a record with correct fields', async () => {
      const { registry, supervisor, trustedDir } = await createFixture();
      const record = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: ['--version'],
        cwd: trustedDir,
        label: 'test-job',
      });

      expect(record.jobId).toBe('job-1');
      expect(record.kind).toBe('command');
      expect(record.lifetime).toBe('host');
      expect(record.command).toBe('node');
      expect(record.argv).toEqual(['--version']);
      expect(record.status).toBe('running');
      expect(record.startedAt).toBe('2025-01-01T00:00:00.000Z');
      expect(record.label).toBe('test-job');
      expect(record.processId).toBe(1001);
      expect(record.processGroupId).toBe(1001);
      expect(record.latestLogCursor).toBe(0);
      expect(supervisor.spawnCalls).toHaveLength(1);
      expect(supervisor.spawnCalls[0]!.command).toBe('node');
    });

    it('clones argv so mutations on the input do not affect the record', async () => {
      const { registry, trustedDir } = await createFixture();
      const argv = ['--version'];
      const record = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv,
        cwd: trustedDir,
      });
      argv.push('extra');
      expect(record.argv).toEqual(['--version']);
    });
  });

  // -- start: validation ---------------------------------------------------

  describe('start() validation', () => {
    it('rejects missing command', async () => {
      const { registry, trustedDir } = await createFixture();
      await expect(
        registry.start({
          kind: 'command',
          lifetime: 'host',
          command: '',
          argv: [],
          cwd: trustedDir,
        }),
      ).rejects.toThrow(/command is required/);
    });

    it('rejects non-array argv', async () => {
      const { registry, trustedDir } = await createFixture();
      await expect(
        registry.start({
          kind: 'command',
          lifetime: 'host',
          command: 'node',
          argv: 'not-an-array' as unknown as string[],
          cwd: trustedDir,
        }),
      ).rejects.toThrow(/argv must be an array/);
    });

    it('rejects missing cwd', async () => {
      const { registry } = await createFixture();
      await expect(
        registry.start({
          kind: 'command',
          lifetime: 'host',
          command: 'node',
          argv: [],
          cwd: '',
        }),
      ).rejects.toThrow(/cwd is required/);
    });

    it('rejects run lifetime without ownerRunId', async () => {
      const { registry, trustedDir } = await createFixture();
      await expect(
        registry.start({
          kind: 'command',
          lifetime: 'run',
          command: 'node',
          argv: [],
          cwd: trustedDir,
        }),
      ).rejects.toThrow(/run lifetime requires ownerRunId/);
    });

    it('rejects session lifetime without ownerSessionId', async () => {
      const { registry, trustedDir } = await createFixture();
      await expect(
        registry.start({
          kind: 'command',
          lifetime: 'session',
          command: 'node',
          argv: [],
          cwd: trustedDir,
        }),
      ).rejects.toThrow(/session lifetime requires ownerSessionId/);
    });

    it('rejects cwd outside trusted roots', async () => {
      const { registry } = await createFixture();
      await expect(
        registry.start({
          kind: 'command',
          lifetime: 'host',
          command: 'node',
          argv: [],
          cwd: tmpdir(),
        }),
      ).rejects.toThrow(/outside trusted/);
    });
  });

  // -- start: maxJobs ------------------------------------------------------

  describe('start() maxJobs', () => {
    it('rejects when maxJobs limit reached', async () => {
      const { registry, trustedDir } = await createFixture({ maxJobs: 1 });
      const first = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });
      expect(first.status).toBe('running');
      await expect(
        registry.start({
          kind: 'command',
          lifetime: 'host',
          command: 'node',
          argv: [],
          cwd: trustedDir,
        }),
      ).rejects.toThrow(/maxJobs reached/);
    });

    it('allows new jobs after a slot is freed by termination', async () => {
      const { registry, supervisor, trustedDir } = await createFixture({ maxJobs: 1 });
      const first = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });
      // Simulate natural exit
      const child = supervisor.children[0]!;
      child.emitClose(0);
      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 30));
      // Slot should be free now
      const second = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });
      expect(second.status).toBe('running');
      expect(second.jobId).toBe('job-2');
    });
  });

  // -- start: policy -------------------------------------------------------

  describe('start() policy', () => {
    it('rejects starts when the Host policy disables Jobs', async () => {
      const { registry, trustedDir } = await createFixture({
        getJobPolicy: () => ({ enabled: false, maxActiveJobs: 8 }),
      });
      await expect(
        registry.start({
          kind: 'command',
          lifetime: 'host',
          command: 'node',
          argv: [],
          cwd: trustedDir,
        }),
      ).rejects.toThrow(/disabled by settings/);
    });

    it('applies maxActiveJobs from the Host policy', async () => {
      const { registry, trustedDir } = await createFixture({
        getJobPolicy: () => ({ enabled: true, maxActiveJobs: 1 }),
      });
      await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });
      await expect(
        registry.start({
          kind: 'command',
          lifetime: 'host',
          command: 'node',
          argv: [],
          cwd: trustedDir,
        }),
      ).rejects.toThrow(/maxJobs reached/);
    });

    it('reads the policy for every start, so tightening applies immediately', async () => {
      let currentPolicy: JobPolicy = { enabled: true, maxActiveJobs: 8 };
      const { registry, trustedDir } = await createFixture({
        getJobPolicy: () => currentPolicy,
      });
      await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });

      // Tighten to capacity 1: the next start must be rejected even though
      // the registry was constructed with a larger default.
      currentPolicy = { enabled: true, maxActiveJobs: 1 };
      await expect(
        registry.start({
          kind: 'command',
          lifetime: 'host',
          command: 'node',
          argv: [],
          cwd: trustedDir,
        }),
      ).rejects.toThrow(/maxJobs reached/);

      // Disabling the policy blocks further starts entirely.
      currentPolicy = { enabled: false, maxActiveJobs: 8 };
      await expect(
        registry.start({
          kind: 'command',
          lifetime: 'host',
          command: 'node',
          argv: [],
          cwd: trustedDir,
        }),
      ).rejects.toThrow(/disabled by settings/);

      // Existing running jobs are untouched by the tightening.
      const listed = await registry.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]!.status).toBe('running');
    });
  });

  // -- list ----------------------------------------------------------------

  describe('list()', () => {
    it('returns all jobs when no filter is provided', async () => {
      const { registry, trustedDir } = await createFixture();
      await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'a',
        argv: [],
        cwd: trustedDir,
      });
      await registry.start({
        kind: 'service',
        lifetime: 'host',
        command: 'b',
        argv: [],
        cwd: trustedDir,
      });
      const all = await registry.list();
      expect(all).toHaveLength(2);
    });

    it('filters by status (single)', async () => {
      const { registry, supervisor, trustedDir } = await createFixture();
      const r1 = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'a',
        argv: [],
        cwd: trustedDir,
      });
      await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'b',
        argv: [],
        cwd: trustedDir,
      });
      // Terminate first job
      supervisor.children[0]!.emitClose(0);
      await new Promise((resolve) => setTimeout(resolve, 30));

      const running = await registry.list({ status: 'running' });
      expect(running).toHaveLength(1);
      expect(running[0]!.jobId).toBe(r1.jobId === 'job-1' ? 'job-2' : 'job-1');
    });

    it('filters by status (array)', async () => {
      const { registry, supervisor, trustedDir } = await createFixture();
      await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'a',
        argv: [],
        cwd: trustedDir,
      });
      await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'b',
        argv: [],
        cwd: trustedDir,
      });
      // Terminate first job
      supervisor.children[0]!.emitClose(0);
      await new Promise((resolve) => setTimeout(resolve, 30));

      const filtered = await registry.list({ status: ['exited', 'failed'] });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.status).toBe('exited');
    });

    it('filters by kind', async () => {
      const { registry, trustedDir } = await createFixture();
      await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'a',
        argv: [],
        cwd: trustedDir,
      });
      await registry.start({
        kind: 'service',
        lifetime: 'host',
        command: 'b',
        argv: [],
        cwd: trustedDir,
      });
      const services = await registry.list({ kind: 'service' });
      expect(services).toHaveLength(1);
      expect(services[0]!.kind).toBe('service');
    });

    it('filters by lifetime', async () => {
      const { registry, trustedDir } = await createFixture();
      await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'a',
        argv: [],
        cwd: trustedDir,
      });
      await registry.start({
        kind: 'command',
        lifetime: 'session',
        command: 'b',
        argv: [],
        cwd: trustedDir,
        ownerSessionId: 'sess-1',
      });
      const sessionJobs = await registry.list({ lifetime: 'session' });
      expect(sessionJobs).toHaveLength(1);
      expect(sessionJobs[0]!.lifetime).toBe('session');
    });

    it('filters by ownerRunId', async () => {
      const { registry, trustedDir } = await createFixture();
      await registry.start({
        kind: 'command',
        lifetime: 'run',
        command: 'a',
        argv: [],
        cwd: trustedDir,
        ownerRunId: 'run-1',
      });
      await registry.start({
        kind: 'command',
        lifetime: 'run',
        command: 'b',
        argv: [],
        cwd: trustedDir,
        ownerRunId: 'run-2',
      });
      const filtered = await registry.list({ ownerRunId: 'run-1' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.ownerRunId).toBe('run-1');
    });

    it('filters by ownerSessionId', async () => {
      const { registry, trustedDir } = await createFixture();
      await registry.start({
        kind: 'command',
        lifetime: 'session',
        command: 'a',
        argv: [],
        cwd: trustedDir,
        ownerSessionId: 'sess-a',
      });
      await registry.start({
        kind: 'command',
        lifetime: 'session',
        command: 'b',
        argv: [],
        cwd: trustedDir,
        ownerSessionId: 'sess-b',
      });
      const filtered = await registry.list({ ownerSessionId: 'sess-a' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.ownerSessionId).toBe('sess-a');
    });

    it('filters by ownerProjectPath', async () => {
      const { registry, trustedDir } = await createFixture();
      await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'a',
        argv: [],
        cwd: trustedDir,
        ownerProjectPath: '/proj-a',
      });
      await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'b',
        argv: [],
        cwd: trustedDir,
        ownerProjectPath: '/proj-b',
      });
      const filtered = await registry.list({ ownerProjectPath: '/proj-a' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.ownerProjectPath).toBe('/proj-a');
    });
  });

  // -- get -----------------------------------------------------------------

  describe('get()', () => {
    it('returns the record for an existing job', async () => {
      const { registry, trustedDir } = await createFixture();
      const started = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });
      const record = await registry.get(started.jobId);
      expect(record).toBeDefined();
      expect(record!.jobId).toBe(started.jobId);
      expect(record!.command).toBe('node');
    });

    it('returns undefined for a non-existent job', async () => {
      const { registry } = await createFixture();
      const record = await registry.get('does-not-exist');
      expect(record).toBeUndefined();
    });
  });

  // -- readLogs ------------------------------------------------------------

  describe('readLogs()', () => {
    it('returns chunks with monotonic cursors', async () => {
      const { registry, logStore, trustedDir } = await createFixture();
      const started = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });
      // Manually seed the log store.
      // Note: start() already appended a system "started" log at cursor 1.
      logStore.append(started.jobId, 'stdout', 'first line\n');
      logStore.append(started.jobId, 'stderr', 'second line\n');
      logStore.append(started.jobId, 'stdout', 'third line\n');

      // start() appended a system "started" log at cursor 1.
      // afterCursor defaults to 0 (exclusive), so cursor 1 is included.
      // We get the system log (cursor 1) + 3 manually appended chunks at cursors 2, 3, 4.
      const result = await registry.readLogs({ jobId: started.jobId });
      expect(result.chunks).toHaveLength(4);
      expect(result.chunks[0]!.cursor).toBe(1);
      expect(result.chunks[1]!.cursor).toBe(2);
      expect(result.chunks[2]!.cursor).toBe(3);
      expect(result.chunks[3]!.cursor).toBe(4);
      expect(result.nextCursor).toBe(4);
      expect(result.hasMore).toBe(false);
    });

    it('supports pagination via afterCursor', async () => {
      const { registry, logStore, trustedDir } = await createFixture();
      const started = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });
      for (let index = 0; index < 5; index++) {
        logStore.append(started.jobId, 'stdout', `line-${index}\n`);
      }

      // Cursors: 1=system, 2-6=manual lines (line-0 through line-4)
      // Skip the system log (afterCursor=1) and read first 2 manual lines.
      const first = await registry.readLogs({
        jobId: started.jobId,
        afterCursor: 1,
        maxBytes: 'line-0\nline-1\n'.length,
      });
      expect(first.chunks).toHaveLength(2);
      expect(first.nextCursor).toBe(3);
      expect(first.hasMore).toBe(true);

      // Read from afterCursor=2 (get cursors 3, 4)
      const second = await registry.readLogs({
        jobId: started.jobId,
        afterCursor: 3,
        maxBytes: 'line-2\nline-3\n'.length,
      });
      expect(second.chunks).toHaveLength(2);
      expect(second.chunks[0]!.cursor).toBe(4);
      expect(second.nextCursor).toBe(5);
      expect(second.hasMore).toBe(true);

      // Read remaining (cursor 6)
      const third = await registry.readLogs({
        jobId: started.jobId,
        afterCursor: 5,
      });
      expect(third.chunks).toHaveLength(1);
      expect(third.chunks[0]!.cursor).toBe(6);
      expect(third.hasMore).toBe(false);
    });

    it('respects maxBytes limit', async () => {
      const { registry, logStore, trustedDir } = await createFixture();
      const started = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });
      logStore.append(started.jobId, 'stdout', 'AAAA\n');
      logStore.append(started.jobId, 'stdout', 'BBBB\n');
      logStore.append(started.jobId, 'stdout', 'CCCC\n');

      // Skip the system "started" log (cursor 1) to test maxBytes on manual chunks.
      const result = await registry.readLogs({
        jobId: started.jobId,
        afterCursor: 1,
        maxBytes: 5, // Only fits first chunk (5 bytes)
      });
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0]!.text).toBe('AAAA\n');
      expect(result.hasMore).toBe(true);
    });

    it('returns empty for a job with no logs', async () => {
      const { registry, trustedDir } = await createFixture();
      const started = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });
      // start() appends a system "started" log at cursor 1, so a default
      // read (afterCursor=0) returns that one chunk.
      const result = await registry.readLogs({ jobId: started.jobId });
      expect(result.chunks).toHaveLength(1);
      expect(result.nextCursor).toBe(1);
      expect(result.hasMore).toBe(false);
    });
  });

  // -- stop ----------------------------------------------------------------

  describe('stop()', () => {
    it('gracefully stops a running job', async () => {
      const { registry, supervisor, trustedDir } = await createFixture();
      const started = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });
      const result = await registry.stop(started.jobId, 'user-stop');
      expect(result.job.status).toBe('cancelled');
      expect(result.job.terminalReason).toBe('user-stop');
      expect(result.cleanup.stoppedJobIds).toContain(started.jobId);
      expect(result.cleanup.alreadyTerminalJobIds).toHaveLength(0);
      expect(supervisor.stopCalls).toHaveLength(1);
    });

    it('is idempotent on an already-terminal job', async () => {
      const { registry, supervisor, trustedDir } = await createFixture();
      const started = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });
      // Let it exit naturally
      supervisor.children[0]!.emitClose(0);
      await new Promise((resolve) => setTimeout(resolve, 30));

      const result = await registry.stop(started.jobId, 'user-stop');
      expect(result.cleanup.stoppedJobIds).toHaveLength(0);
      expect(result.cleanup.alreadyTerminalJobIds).toContain(started.jobId);
      expect(supervisor.stopCalls).toHaveLength(0);
    });

    it('marks terminal correctly on natural exit (exit code 0)', async () => {
      const { registry, supervisor, trustedDir } = await createFixture();
      const started = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });
      supervisor.children[0]!.emitClose(0);
      await new Promise((resolve) => setTimeout(resolve, 30));

      const record = await registry.get(started.jobId);
      expect(record!.status).toBe('exited');
      expect(record!.exitCode).toBe(0);
      expect(record!.terminalReason).toBe('completed');
      expect(record!.endedAt).toBeDefined();
    });

    it('marks terminal correctly on natural failure (non-zero exit)', async () => {
      const { registry, supervisor, trustedDir } = await createFixture();
      const started = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });
      supervisor.children[0]!.emitClose(1);
      await new Promise((resolve) => setTimeout(resolve, 30));

      const record = await registry.get(started.jobId);
      expect(record!.status).toBe('failed');
      expect(record!.exitCode).toBe(1);
      expect(record!.terminalReason).toBe('failed');
    });

    it('marks terminal on process error event', async () => {
      const { registry, supervisor, trustedDir } = await createFixture();
      const started = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });
      supervisor.children[0]!.emitError(new Error('ENOENT'));
      await new Promise((resolve) => setTimeout(resolve, 30));

      const record = await registry.get(started.jobId);
      expect(record!.status).toBe('failed');
      expect(record!.terminalReason).toBe('process-error');
      expect(record!.lastError).toBe('ENOENT');
    });

    it('throws for a non-existent job', async () => {
      const { registry } = await createFixture();
      await expect(registry.stop('nope', 'user-stop')).rejects.toThrow(/job not found/);
    });

    it('reports failure when supervisor.stop throws', async () => {
      const { registry, supervisor, trustedDir } = await createFixture();
      const started = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });
      supervisor.stopError = new Error('kill failed');
      const result = await registry.stop(started.jobId, 'user-stop');
      expect(result.cleanup.failedJobIds).toContain(started.jobId);
      expect(result.job.status).toBe('failed');
      expect(result.job.terminalReason).toBe('stop-failed');
      expect(supervisor.trackedTargets.size).toBe(1);
    });

    it('stops a service before terminalizing a readiness timeout', async () => {
      const { registry, supervisor, events, trustedDir } = await createFixture();
      const started = await registry.start({
        kind: 'service',
        lifetime: 'host',
        command: 'service',
        argv: [],
        cwd: trustedDir,
        readinessProbe: { type: 'tcp', port: 1, timeoutMs: 10 },
      });

      await new Promise((resolve) => setTimeout(resolve, 40));

      const record = await registry.get(started.jobId);
      expect(supervisor.stopCalls).toHaveLength(1);
      expect(supervisor.children[0]!.killed).toBe(true);
      expect(record!.status).toBe('failed');
      expect(record!.terminalReason).toBe('readiness-failed');
      expect(record!.lastError).toBe('readiness probe timeout');
      expect(events.filter((event) => event.type === 'job/exited')).toHaveLength(1);

      // A late close event must not replace the readiness failure.
      supervisor.children[0]!.emitClose(0);
      const unchanged = await registry.get(started.jobId);
      expect(unchanged!.status).toBe('failed');
      expect(unchanged!.terminalReason).toBe('readiness-failed');
    });

    it('retains the failed stop record and terminal log cursor', async () => {
      const { registry, supervisor, logStore, trustedDir } = await createFixture();
      const started = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'command',
        argv: [],
        cwd: trustedDir,
      });
      supervisor.stopError = new Error('exit not confirmed');

      const result = await registry.stop(started.jobId, 'user-stop');
      expect(result.job.status).toBe('failed');
      expect(result.job.terminalReason).toBe('stop-failed');
      expect(result.job.latestLogCursor).toBe(logStore.getLatestCursor(started.jobId));
      const logs = await registry.readLogs({ jobId: started.jobId });
      expect(logs.chunks.at(-1)?.text).toContain('stop failed: exit not confirmed');
    });

    it('treats signal termination as a failed natural exit', async () => {
      const { registry, supervisor, trustedDir } = await createFixture();
      const started = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'command',
        argv: [],
        cwd: trustedDir,
      });

      supervisor.children[0]!.emitClose(null);
      await new Promise((resolve) => setTimeout(resolve, 30));

      const record = await registry.get(started.jobId);
      expect(record!.status).toBe('failed');
      expect(record!.terminalReason).toBe('failed');
      expect(record!.exitCode).toBeNull();
    });
  });

  // -- stopByRun -----------------------------------------------------------

  describe('stopByRun()', () => {
    it('stops all jobs with matching ownerRunId', async () => {
      const { registry, trustedDir } = await createFixture();
      const jobA = await registry.start({
        kind: 'command',
        lifetime: 'run',
        command: 'a',
        argv: [],
        cwd: trustedDir,
        ownerRunId: 'run-x',
      });
      const jobB = await registry.start({
        kind: 'command',
        lifetime: 'run',
        command: 'b',
        argv: [],
        cwd: trustedDir,
        ownerRunId: 'run-x',
      });
      await registry.start({
        kind: 'command',
        lifetime: 'run',
        command: 'c',
        argv: [],
        cwd: trustedDir,
        ownerRunId: 'run-y',
      });

      const result = await registry.stopByRun('run-x', 'run-completed');
      expect(result.stoppedJobIds).toHaveLength(2);
      expect(result.stoppedJobIds).toContain(jobA.jobId);
      expect(result.stoppedJobIds).toContain(jobB.jobId);
      expect(result.alreadyTerminalJobIds).toHaveLength(0);

      const recordA = await registry.get(jobA.jobId);
      expect(recordA!.status).toBe('cancelled');
      expect(recordA!.terminalReason).toBe('run-completed');
    });

    it('does not stop jobs with different ownerRunId', async () => {
      const { registry, trustedDir } = await createFixture();
      const jobOther = await registry.start({
        kind: 'command',
        lifetime: 'run',
        command: 'c',
        argv: [],
        cwd: trustedDir,
        ownerRunId: 'run-y',
      });
      await registry.start({
        kind: 'command',
        lifetime: 'run',
        command: 'a',
        argv: [],
        cwd: trustedDir,
        ownerRunId: 'run-x',
      });

      await registry.stopByRun('run-x', 'run-completed');
      const record = await registry.get(jobOther.jobId);
      expect(record!.status).toBe('running');
    });

    it('reports already-terminal jobs', async () => {
      const { registry, supervisor, trustedDir } = await createFixture();
      const jobA = await registry.start({
        kind: 'command',
        lifetime: 'run',
        command: 'a',
        argv: [],
        cwd: trustedDir,
        ownerRunId: 'run-z',
      });
      // Terminate jobA
      supervisor.children[0]!.emitClose(0);
      await new Promise((resolve) => setTimeout(resolve, 30));

      const result = await registry.stopByRun('run-z', 'run-completed');
      expect(result.stoppedJobIds).toHaveLength(0);
      expect(result.alreadyTerminalJobIds).toContain(jobA.jobId);
    });
  });

  // -- stopBySession -------------------------------------------------------

  describe('stopBySession()', () => {
    it('stops all jobs with matching ownerSessionId', async () => {
      const { registry, trustedDir } = await createFixture();
      const jobA = await registry.start({
        kind: 'command',
        lifetime: 'session',
        command: 'a',
        argv: [],
        cwd: trustedDir,
        ownerSessionId: 'sess-1',
      });
      await registry.start({
        kind: 'command',
        lifetime: 'session',
        command: 'b',
        argv: [],
        cwd: trustedDir,
        ownerSessionId: 'sess-2',
      });

      const result = await registry.stopBySession('sess-1', 'session-closed');
      expect(result.stoppedJobIds).toHaveLength(1);
      expect(result.stoppedJobIds).toContain(jobA.jobId);
      const record = await registry.get(jobA.jobId);
      expect(record!.terminalReason).toBe('session-closed');
    });

    it('never reports terminal jobs owned by other scopes', async () => {
      const { registry, supervisor, trustedDir } = await createFixture();
      // A terminal job belonging to a different session must not appear in
      // this session's cleanup result (scoped-owner predicate runs first).
      const otherSessionJob = await registry.start({
        kind: 'command',
        lifetime: 'session',
        command: 'other',
        argv: [],
        cwd: trustedDir,
        ownerSessionId: 'sess-other',
      });
      supervisor.children[0]!.emitClose(0);
      await new Promise((resolve) => setTimeout(resolve, 30));

      const result = await registry.stopBySession('sess-1', 'session-closed');
      expect(result.alreadyTerminalJobIds).not.toContain(otherSessionJob.jobId);
      expect(result.requestedJobIds).not.toContain(otherSessionJob.jobId);
    });
  });

  // -- dispose -------------------------------------------------------------

  describe('dispose()', () => {
    it('stops all active jobs and returns cleanup result', async () => {
      const { registry, trustedDir } = await createFixture();
      const jobA = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'a',
        argv: [],
        cwd: trustedDir,
      });
      const jobB = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'b',
        argv: [],
        cwd: trustedDir,
      });

      const result = await registry.dispose();
      expect(result.stoppedJobIds).toHaveLength(2);
      expect(result.stoppedJobIds).toContain(jobA.jobId);
      expect(result.stoppedJobIds).toContain(jobB.jobId);
      expect(result.alreadyTerminalJobIds).toHaveLength(0);
    });

    it('reports already-terminal jobs in dispose result', async () => {
      const { registry, supervisor, trustedDir } = await createFixture();
      const jobA = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'a',
        argv: [],
        cwd: trustedDir,
      });
      supervisor.children[0]!.emitClose(0);
      await new Promise((resolve) => setTimeout(resolve, 30));

      const result = await registry.dispose();
      expect(result.stoppedJobIds).toHaveLength(0);
      expect(result.alreadyTerminalJobIds).toContain(jobA.jobId);
    });

    it('disposes the supervisor and log store', async () => {
      const { registry, supervisor, logStore, trustedDir } = await createFixture();
      await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'a',
        argv: [],
        cwd: trustedDir,
      });
      await registry.dispose();
      expect(supervisor.disposed).toBe(true);
      expect(logStore.disposed).toBe(true);
    });

    it('returns empty result when called twice', async () => {
      const { registry, trustedDir } = await createFixture();
      await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'a',
        argv: [],
        cwd: trustedDir,
      });
      await registry.dispose();
      const second = await registry.dispose();
      expect(second.stoppedJobIds).toHaveLength(0);
      expect(second.alreadyTerminalJobIds).toHaveLength(0);
    });

    it('rejects start after dispose', async () => {
      const { registry, trustedDir } = await createFixture();
      await registry.dispose();
      await expect(
        registry.start({
          kind: 'command',
          lifetime: 'host',
          command: 'a',
          argv: [],
          cwd: trustedDir,
        }),
      ).rejects.toThrow(/disposed/);
    });
  });

  // -- wait ----------------------------------------------------------------

  describe('wait()', () => {
    it('resolves when the job terminates naturally', async () => {
      const { registry, supervisor, trustedDir } = await createFixture();
      const started = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });

      // Emit close after a short delay
      setTimeout(() => supervisor.children[0]!.emitClose(0), 20);

      const controller = new AbortController();
      const record = await registry.wait(
        { jobId: started.jobId, timeoutMs: 5000 },
        controller.signal,
      );
      expect(record.status).toBe('exited');
      expect(record.exitCode).toBe(0);
    });

    it('resolves immediately for an already-terminal job', async () => {
      const { registry, supervisor, trustedDir } = await createFixture();
      const started = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });
      supervisor.children[0]!.emitClose(0);
      await new Promise((resolve) => setTimeout(resolve, 30));

      const controller = new AbortController();
      const record = await registry.wait(
        { jobId: started.jobId, timeoutMs: 5000 },
        controller.signal,
      );
      expect(record.status).toBe('exited');
    });

    it('rejects on timeout', async () => {
      const { registry, trustedDir } = await createFixture();
      const started = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });

      const controller = new AbortController();
      await expect(
        registry.wait({ jobId: started.jobId, timeoutMs: 50 }, controller.signal),
      ).rejects.toThrow(/timeout/);
    });

    it('rejects when aborted', async () => {
      const { registry, trustedDir } = await createFixture();
      const started = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });

      const controller = new AbortController();
      const waitPromise = registry.wait(
        { jobId: started.jobId, timeoutMs: 5000 },
        controller.signal,
      );
      controller.abort();
      await expect(waitPromise).rejects.toThrow(/aborted/);
    });

    it('throws for a non-existent job', async () => {
      const { registry } = await createFixture();
      const controller = new AbortController();
      await expect(
        registry.wait({ jobId: 'nope' }, controller.signal),
      ).rejects.toThrow(/job not found/);
    });
  });

  // -- Terminal immutability -----------------------------------------------

  describe('terminal immutability', () => {
    it('terminal record does not change after terminalization', async () => {
      const { registry, supervisor, trustedDir } = await createFixture();
      const started = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });
      supervisor.children[0]!.emitClose(0);
      await new Promise((resolve) => setTimeout(resolve, 30));

      const recordBefore = await registry.get(started.jobId);
      expect(recordBefore!.status).toBe('exited');

      // Attempt to stop the already-terminal job — should not change the record
      await registry.stop(started.jobId, 'user-stop');
      const recordAfter = await registry.get(started.jobId);

      expect(recordAfter!.status).toBe('exited');
      expect(recordAfter!.terminalReason).toBe('completed');
      expect(recordAfter!.exitCode).toBe(0);
      expect(recordAfter!.endedAt).toBe(recordBefore!.endedAt);
    });

    it('failed record does not change on subsequent stop', async () => {
      const { registry, supervisor, trustedDir } = await createFixture();
      const started = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });
      supervisor.children[0]!.emitClose(1);
      await new Promise((resolve) => setTimeout(resolve, 30));

      const before = await registry.get(started.jobId);
      await registry.stop(started.jobId, 'user-stop');
      const after = await registry.get(started.jobId);

      expect(after!.status).toBe('failed');
      expect(after!.exitCode).toBe(before!.exitCode);
      expect(after!.endedAt).toBe(before!.endedAt);
      expect(after!.terminalReason).toBe(before!.terminalReason);
    });
  });

  // -- Event emission ------------------------------------------------------

  describe('event emission', () => {
    it('emits job/started and job/updated on start', async () => {
      const { registry, events, trustedDir } = await createFixture();
      await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });

      const types = events.map((event) => event.type);
      expect(types).toContain('job/started');
      expect(types).toContain('job/updated');
      const startedEvent = events.find((event) => event.type === 'job/started');
      expect(startedEvent).toBeDefined();
      if (startedEvent!.type === 'job/started') {
        expect(startedEvent!.job.command).toBe('node');
        expect(startedEvent!.job.status).toBe('running');
      }
    });

    it('emits job/exited on natural termination', async () => {
      const { registry, supervisor, events, trustedDir } = await createFixture();
      await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });
      events.length = 0;
      supervisor.children[0]!.emitClose(0);
      await new Promise((resolve) => setTimeout(resolve, 30));

      const types = events.map((event) => event.type);
      expect(types).toContain('job/exited');
      const exitedEvent = events.find((event) => event.type === 'job/exited');
      if (exitedEvent!.type === 'job/exited') {
        expect(exitedEvent!.job.status).toBe('exited');
        expect(exitedEvent!.job.exitCode).toBe(0);
      }
    });

    it('emits job/updated on stop', async () => {
      const { registry, events, trustedDir } = await createFixture();
      const started = await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });
      events.length = 0;
      await registry.stop(started.jobId, 'user-stop');

      const types = events.map((event) => event.type);
      expect(types).toContain('job/updated');
      // Should also emit job/exited
      expect(types).toContain('job/exited');
    });

    it('emits job/log when stdout data arrives', async () => {
      const { registry, supervisor, events, trustedDir } = await createFixture({
        logThrottleMs: 10,
      });
      await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });
      // Wait for the system "started" log to flush first so it doesn't
      // merge with stdout text in the same throttle window.
      await new Promise((resolve) => setTimeout(resolve, 50));
      events.length = 0;
      // Emit stdout data twice: the first chunk triggers a stream switch
      // from system→stdout and may be flushed under the old stream label.
      // The second chunk will be correctly flushed as 'stdout'.
      supervisor.children[0]!.emitStdout('hello world\n');
      await new Promise((resolve) => setTimeout(resolve, 50));
      supervisor.children[0]!.emitStdout('second line\n');
      await new Promise((resolve) => setTimeout(resolve, 50));

      const logEvents = events.filter(
        (event) => event.type === 'job/log' && 'chunk' in event && event.chunk.stream === 'stdout',
      );
      expect(logEvents.length).toBeGreaterThanOrEqual(1);
      if (logEvents[0]!.type === 'job/log') {
        expect(logEvents[0]!.chunk.stream).toBe('stdout');
      }
      // At least one log event should contain the stdout text.
      const allLogEvents = events.filter((event) => event.type === 'job/log');
      const allText = allLogEvents
        .map((event) => (event.type === 'job/log' ? event.chunk.text : ''))
        .join('');
      expect(allText).toContain('hello world');
    });

    it('emits job/log for stderr data', async () => {
      const { registry, supervisor, events, trustedDir } = await createFixture({
        logThrottleMs: 10,
      });
      await registry.start({
        kind: 'command',
        lifetime: 'host',
        command: 'node',
        argv: [],
        cwd: trustedDir,
      });
      // Wait for the system "started" log to flush first.
      await new Promise((resolve) => setTimeout(resolve, 50));
      events.length = 0;
      // Emit stderr data twice: the first chunk triggers a stream switch
      // and may be flushed under the old stream label.
      // The second chunk will be correctly flushed as 'stderr'.
      supervisor.children[0]!.emitStderr('error output\n');
      await new Promise((resolve) => setTimeout(resolve, 50));
      supervisor.children[0]!.emitStderr('second error\n');
      await new Promise((resolve) => setTimeout(resolve, 50));

      const logEvents = events.filter(
        (event) => event.type === 'job/log' && 'chunk' in event && event.chunk.stream === 'stderr',
      );
      expect(logEvents.length).toBeGreaterThanOrEqual(1);
      if (logEvents[0]!.type === 'job/log') {
        expect(logEvents[0]!.chunk.stream).toBe('stderr');
      }
      // At least one log event should contain the stderr text.
      const allLogEvents = events.filter((event) => event.type === 'job/log');
      const allText = allLogEvents
        .map((event) => (event.type === 'job/log' ? event.chunk.text : ''))
        .join('');
      expect(allText).toContain('error output');
    });
  });
});

// ---------------------------------------------------------------------------
// Persistence + reconciliation tests
// ---------------------------------------------------------------------------

/** A mock JobRecordStore for deterministic persistence testing. */
function createMockRecordStore(): import('./job-record-store.js').JobRecordStore & {
  savedRecords: Map<string, JobRecord>;
  removedJobIds: string[];
  disposed: boolean;
  /** Pre-seed records for reconciliation tests. */
  seeded: JobRecord[];
} {
  const savedRecords = new Map<string, JobRecord>();
  const mock = {
    savedRecords,
    removedJobIds: [] as string[],
    disposed: false,
    seeded: [] as JobRecord[],

    save(record: JobRecord): void {
      savedRecords.set(record.jobId, { ...record, argv: [...record.argv] });
    },
    loadAll(): JobRecord[] {
      // On first load, return seeded records. Subsequent loads return
      // the current savedRecords map (which includes reconciled updates).
      if (mock.seeded.length > 0 && savedRecords.size === 0) {
        return [...mock.seeded];
      }
      return Array.from(savedRecords.values()).map((record) => ({
        ...record,
        argv: [...record.argv],
      }));
    },
    remove(jobId: string): void {
      savedRecords.delete(jobId);
      mock.removedJobIds.push(jobId);
    },
    async dispose(): Promise<void> {
      mock.disposed = true;
    },
  };
  return mock;
}

describe('JobRegistry persistence + reconciliation', () => {
  it('marks active persisted records as interrupted on startup', async () => {
    const recordStore = createMockRecordStore();
    recordStore.seeded = [
      {
        jobId: 'old-running',
        kind: 'command',
        lifetime: 'host',
        command: 'serve',
        argv: ['--port', '3000'],
        cwd: '/tmp',
        status: 'running',
        startedAt: '2025-01-01T00:00:00.000Z',
        latestLogCursor: 5,
      },
      {
        jobId: 'old-exited',
        kind: 'command',
        lifetime: 'host',
        command: 'build',
        argv: [],
        cwd: '/tmp',
        status: 'exited',
        startedAt: '2025-01-01T00:00:00.000Z',
        exitCode: 0,
        terminalReason: 'completed',
        endedAt: '2025-01-01T00:01:00.000Z',
        latestLogCursor: 3,
      },
    ];

    const trustedDir = await mkdtemp(join(tmpdir(), 'piwin-job-test-'));
    const supervisor = createMockSupervisor();
    const logStore = createMockLogStore();
    const registry = createJobRegistry({
      now: () => new Date('2025-01-02T00:00:00Z'),
      createId: () => 'new-job-1',
      getTrustedProjectRoots: () => [trustedDir],
      logStore,
      processSupervisor: supervisor,
      recordStore,
    });

    const all = await registry.list();
    expect(all).toHaveLength(2);

    const oldRunning = await registry.get('old-running');
    expect(oldRunning!.status).toBe('interrupted');
    expect(oldRunning!.terminalReason).toBe('host-restarted');
    expect(oldRunning!.endedAt).toBe('2025-01-02T00:00:00.000Z');
    // No PID reattachment — processId should be preserved from the record
    // but supervised should be null (no live process).
    expect(supervisor.spawnCalls).toHaveLength(0);

    const oldExited = await registry.get('old-exited');
    expect(oldExited!.status).toBe('exited');
    expect(oldExited!.terminalReason).toBe('completed');

    // The interrupted record should be persisted back to the store.
    expect(recordStore.savedRecords.get('old-running')!.status).toBe('interrupted');
    expect(recordStore.savedRecords.get('old-running')!.terminalReason).toBe('host-restarted');
  });

  it('marks starting/ready/stopping records as interrupted too', async () => {
    const recordStore = createMockRecordStore();
    recordStore.seeded = [
      {
        jobId: 'job-starting',
        kind: 'command',
        lifetime: 'host',
        command: 'a',
        argv: [],
        cwd: '/tmp',
        status: 'starting',
        startedAt: '2025-01-01T00:00:00.000Z',
        latestLogCursor: 0,
      },
      {
        jobId: 'job-ready',
        kind: 'service',
        lifetime: 'host',
        command: 'b',
        argv: [],
        cwd: '/tmp',
        status: 'ready',
        startedAt: '2025-01-01T00:00:00.000Z',
        latestLogCursor: 0,
      },
      {
        jobId: 'job-stopping',
        kind: 'command',
        lifetime: 'host',
        command: 'c',
        argv: [],
        cwd: '/tmp',
        status: 'stopping',
        startedAt: '2025-01-01T00:00:00.000Z',
        latestLogCursor: 0,
      },
    ];

    const trustedDir = await mkdtemp(join(tmpdir(), 'piwin-job-test-'));
    const registry = createJobRegistry({
      getTrustedProjectRoots: () => [trustedDir],
      logStore: createMockLogStore(),
      processSupervisor: createMockSupervisor(),
      recordStore,
    });

    const starting = await registry.get('job-starting');
    expect(starting!.status).toBe('interrupted');
    expect(starting!.terminalReason).toBe('host-restarted');

    const ready = await registry.get('job-ready');
    expect(ready!.status).toBe('interrupted');
    expect(ready!.terminalReason).toBe('host-restarted');

    const stopping = await registry.get('job-stopping');
    expect(stopping!.status).toBe('interrupted');
    expect(stopping!.terminalReason).toBe('host-restarted');
  });

  it('persists new records to the store on start', async () => {
    const recordStore = createMockRecordStore();
    const trustedDir = await mkdtemp(join(tmpdir(), 'piwin-job-test-'));
    const supervisor = createMockSupervisor();
    const registry = createJobRegistry({
      createId: () => 'job-new',
      getTrustedProjectRoots: () => [trustedDir],
      logStore: createMockLogStore(),
      processSupervisor: supervisor,
      recordStore,
    });

    await registry.start({
      kind: 'command',
      lifetime: 'host',
      command: 'echo',
      argv: ['hi'],
      cwd: trustedDir,
    });

    expect(recordStore.savedRecords.get('job-new')).toBeDefined();
    expect(recordStore.savedRecords.get('job-new')!.status).toBe('running');
    expect(recordStore.savedRecords.get('job-new')!.command).toBe('echo');
  });

  it('persists terminal records on natural exit', async () => {
    const recordStore = createMockRecordStore();
    const trustedDir = await mkdtemp(join(tmpdir(), 'piwin-job-test-'));
    const supervisor = createMockSupervisor();
    const registry = createJobRegistry({
      createId: () => 'job-exit',
      getTrustedProjectRoots: () => [trustedDir],
      logStore: createMockLogStore(),
      processSupervisor: supervisor,
      recordStore,
    });

    await registry.start({
      kind: 'command',
      lifetime: 'host',
      command: 'echo',
      argv: [],
      cwd: trustedDir,
    });

    supervisor.children[0]!.emitClose(0);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const persisted = recordStore.savedRecords.get('job-exit')!;
    expect(persisted.status).toBe('exited');
    expect(persisted.exitCode).toBe(0);
    expect(persisted.terminalReason).toBe('completed');
  });

  it('persists records on stop', async () => {
    const recordStore = createMockRecordStore();
    const trustedDir = await mkdtemp(join(tmpdir(), 'piwin-job-test-'));
    const supervisor = createMockSupervisor();
    const registry = createJobRegistry({
      createId: () => 'job-stop',
      getTrustedProjectRoots: () => [trustedDir],
      logStore: createMockLogStore(),
      processSupervisor: supervisor,
      recordStore,
    });

    await registry.start({
      kind: 'command',
      lifetime: 'host',
      command: 'echo',
      argv: [],
      cwd: trustedDir,
    });

    await registry.stop('job-stop', 'user-stop');

    const persisted = recordStore.savedRecords.get('job-stop')!;
    expect(persisted.status).toBe('cancelled');
    expect(persisted.terminalReason).toBe('user-stop');
  });

  it('disposes the record store on registry dispose', async () => {
    const recordStore = createMockRecordStore();
    const trustedDir = await mkdtemp(join(tmpdir(), 'piwin-job-test-'));
    const registry = createJobRegistry({
      getTrustedProjectRoots: () => [trustedDir],
      logStore: createMockLogStore(),
      processSupervisor: createMockSupervisor(),
      recordStore,
    });

    await registry.dispose();
    expect(recordStore.disposed).toBe(true);
  });

  it('works without a recordStore (in-memory only, unchanged behavior)', async () => {
    const trustedDir = await mkdtemp(join(tmpdir(), 'piwin-job-test-'));
    const supervisor = createMockSupervisor();
    const registry = createJobRegistry({
      createId: () => 'job-mem',
      getTrustedProjectRoots: () => [trustedDir],
      logStore: createMockLogStore(),
      processSupervisor: supervisor,
      // No recordStore — behavior should be unchanged.
    });

    const record = await registry.start({
      kind: 'command',
      lifetime: 'host',
      command: 'echo',
      argv: [],
      cwd: trustedDir,
    });
    expect(record.status).toBe('running');

    // List should work fine.
    const all = await registry.list();
    expect(all).toHaveLength(1);

    // Dispose should work without error.
    await registry.dispose();
  });

  it('reconciled interrupted records are visible in list()', async () => {
    const recordStore = createMockRecordStore();
    recordStore.seeded = [
      {
        jobId: 'reconciled-job',
        kind: 'service',
        lifetime: 'host',
        command: 'dev-server',
        argv: ['--port', '8080'],
        cwd: '/tmp',
        status: 'ready',
        startedAt: '2025-01-01T00:00:00.000Z',
        latestLogCursor: 10,
      },
    ];

    const trustedDir = await mkdtemp(join(tmpdir(), 'piwin-job-test-'));
    const registry = createJobRegistry({
      getTrustedProjectRoots: () => [trustedDir],
      logStore: createMockLogStore(),
      processSupervisor: createMockSupervisor(),
      recordStore,
    });

    const interrupted = await registry.list({ status: 'interrupted' });
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0]!.jobId).toBe('reconciled-job');
    expect(interrupted[0]!.status).toBe('interrupted');
  });
});
