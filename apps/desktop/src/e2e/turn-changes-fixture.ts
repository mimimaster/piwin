/**
 * ?e2eTurnChanges=1 — one project session whose single turn changed two
 * files, plus an in-memory turn-change Host so the real card, panel and
 * conflict view run end to end: undo → 本轮已撤销 → 恢复改动 → a conflict →
 * 查看冲突 → 重新检查.
 *
 * `window.__piwinTurnChanges.editAfterTurn()` simulates an outside edit to
 * src/login.ts, so the next undo is refused until `.clear()` undoes it.
 * Fixture only: the production mock does not answer turn-changes/*.
 */
import type {
  HostCommand,
  HostResponse,
  SessionTranscriptMessage,
  TurnChangeFileEntry,
  TurnChangeSummary,
} from '@piwin/contracts';
import type { MockHostBackend } from '../host-client-mock.js';

const PROJECT = '/mock/piwin';
export const TURN_CHANGES_SESSION_ID = 'fixture-turn-changes';
const RUN_ID = 'run-turn-changes';
const CHANGE_SET_ID = 'cs-e2e';
const WORKSPACE_ID = 'ws-e2e';

const FILES: TurnChangeFileEntry[] = [
  { fileId: 'f-login', relativePath: 'src/login.ts', kind: 'modified', additions: 3, deletions: 1, binary: false },
  { fileId: 'f-test', relativePath: 'tests/login.test.ts', kind: 'added', additions: 4, deletions: 0, binary: false },
];

const PATCH: Record<string, string> = {
  'f-login': '--- a/src/login.ts\n+++ b/src/login.ts\n@@ -1,2 +1,4 @@\n-export const login = () => false;\n+export function login(user: string): boolean {\n+  return user.length > 0;\n+}\n',
  'f-test': '--- /dev/null\n+++ b/tests/login.test.ts\n@@ -0,0 +1,4 @@\n+import { login } from "../src/login";\n+test("empty user", () => {\n+  expect(login("")).toBe(false);\n+});\n',
};

type FixtureState = { disposition: 'applied' | 'undone'; editedAfter: boolean; operations: number };

function transcript(): SessionTranscriptMessage[] {
  return [
    {
      id: 'tc-u1',
      role: 'user',
      text: '给登录加个校验，并补测试',
      createdAt: '2026-09-30T10:00:00.000Z',
      status: 'done',
    },
    {
      id: 'tc-a1',
      role: 'assistant',
      text: '已加上用户名校验，并新增了一个测试。',
      createdAt: '2026-09-30T10:00:05.000Z',
      status: 'done',
      runId: RUN_ID,
    },
  ];
}

function summary(state: FixtureState): TurnChangeSummary {
  const applied = state.disposition === 'applied';
  return {
    changeSetId: CHANGE_SET_ID,
    attemptId: 'att-e2e',
    sessionId: TURN_CHANGES_SESSION_ID,
    workspaceId: WORKSPACE_ID,
    userMessageId: 'tc-u1',
    runIds: [RUN_ID],
    revision: 1,
    captureState: 'ready',
    disposition: state.disposition,
    fileCount: FILES.length,
    additions: 7,
    deletions: 1,
    binaryFileCount: 0,
    coverageComplete: true,
    undo: applied ? { allowed: true } : { allowed: false, reason: 'direction-unavailable' },
    redo: applied ? { allowed: false, reason: 'direction-unavailable' } : { allowed: true },
    expiresAt: '2026-10-30T10:00:05.000Z',
    latestOperationId: state.operations > 0 ? `op-${String(state.operations)}` : null,
    incompleteReason: null,
    excludedPaths: [],
  };
}

function ok(id: string, command: HostCommand, data: unknown): HostResponse {
  return { id, type: 'response', command: command.type, success: true, data };
}

/** Answers turn-changes/* for the fixture; null for anything else. */
function handleTurnChanges(
  host: MockHostBackend,
  state: FixtureState,
  command: HostCommand,
  id: string,
): HostResponse | null {
  const push = (): void =>
    host.emitPush({
      type: 'turn-changes/updated',
      workspaceId: WORKSPACE_ID,
      changeSetId: CHANGE_SET_ID,
      revision: 1,
      summary: summary(state),
    });
  switch (command.type) {
    case 'turn-changes/list-by-runs':
      return ok(id, command, {
        summaries:
          command.sessionId === TURN_CHANGES_SESSION_ID && command.runIds.includes(RUN_ID) ? [summary(state)] : [],
      });
    case 'turn-changes/files':
      return ok(id, command, { changeSetId: CHANGE_SET_ID, revision: 1, files: FILES, nextCursor: null });
    case 'turn-changes/diff': {
      const file = FILES.find((entry) => entry.fileId === command.fileId);
      if (!file) return null;
      const current = command.against === 'current';
      return ok(id, command, {
        ...file,
        changeSetId: CHANGE_SET_ID,
        revision: 1,
        ...(current ? { against: 'current' } : {}),
        patch: current
          ? '--- a/src/login.ts\n+++ b/src/login.ts\n@@ -1,3 +1,3 @@\n export function login(user: string): boolean {\n-  return user.length > 0;\n+  return user.trim().length > 0;\n }\n'
          : (PATCH[file.fileId] ?? ''),
      });
    }
    case 'turn-changes/check':
      return ok(id, command, {
        changeSetId: CHANGE_SET_ID,
        revision: 1,
        direction: command.direction,
        availability: state.editedAfter
          ? {
              allowed: false,
              reason: 'files-changed',
              affectedPaths: ['src/login.ts'],
              conflicts: [{ relativePath: 'src/login.ts', laterTurns: [] }],
            }
          : { allowed: true },
      });
    case 'turn-changes/undo':
    case 'turn-changes/redo': {
      state.operations += 1;
      const operationId = `op-${String(state.operations)}`;
      if (state.editedAfter) {
        return ok(id, command, {
          operationId,
          status: 'rejected',
          reason: 'files-changed',
          affectedPaths: ['src/login.ts'],
          conflicts: [{ relativePath: 'src/login.ts', laterTurns: [] }],
        });
      }
      state.disposition = command.type === 'turn-changes/undo' ? 'undone' : 'applied';
      push();
      return ok(id, command, { operationId, status: 'succeeded' });
    }
    case 'turn-changes/operations':
      return ok(id, command, { workspaceId: WORKSPACE_ID, operations: [], nextCursor: null });
    default:
      return null;
  }
}

export function seedTurnChangesHost(host: MockHostBackend): void {
  const createdAt = '2026-09-30T10:00:00.000Z';
  host.mockProjects.set(PROJECT, { path: PROJECT, trust: 'trusted', createdAt, lastOpenedAt: createdAt });
  host.mockGitCurrentBranches.set(PROJECT, 'main');
  host.sessions.set(TURN_CHANGES_SESSION_ID, {
    projectPath: PROJECT,
    scope: { kind: 'project', projectPath: PROJECT },
    workingDirectory: PROJECT,
    name: '登录校验 · 本轮撤销',
    nameSource: 'user',
    updatedAt: createdAt,
    events: [],
    transcript: transcript(),
  });
  const state: FixtureState = { disposition: 'applied', editedAfter: false, operations: 0 };
  host.extraCommandHandlers.push((command, id) => handleTurnChanges(host, state, command, id));
  (window as Window & { __piwinTurnChanges?: unknown }).__piwinTurnChanges = {
    editAfterTurn: () => {
      state.editedAfter = true;
    },
    clear: () => {
      state.editedAfter = false;
    },
  };
}
