/**
 * Huge-turn fixture: the shape of session-mulfw200-k0ysmfzv (2026-09-30) — one
 * settled agent turn of 620 steps and ~880 tool calls, where every edit and
 * write carries its own inline patch and most steps carry a paragraph of
 * reasoning. The older fixtures used bash-only chains, which never exercised
 * the diff cards that dominated opening that turn's 已工作 fold.
 *
 * Tool mix per ten steps follows the real turn: six shell calls, two edits,
 * one read, one write. Content is synthetic.
 *
 * Installed only when `VITE_PIWIN_E2E_FIXTURES=true` and `?e2eHugeTurn=1`.
 */
import type { SessionToolCardView, SessionTranscriptMessage } from '@piwin/contracts';
import type { MockHostBackend } from '../host-client-mock.js';

const PROJECT = '/mock/piwin';
export const HUGE_TURN_SESSION_ID = 'fixture-huge-turn';
export const HUGE_TURN_TITLE = '巨型单轮 · 620 步 / 880 工具';
export const HUGE_TURN_STEP_COUNT = 620;
const RUN_ID = 'run-huge-turn';

const REASONING =
  '先确认调用方传进来的是不是同一个引用，再看比较函数有没有在热路径上新建数组；如果两边都没问题，就回头核对测试夹具。';

const FILES = [
  'packages/host-runtime/src/commands/session-turn-executor.ts',
  'apps/desktop/src/chat-thread.tsx',
  'apps/desktop/src/tool-call-card.tsx',
  'packages/contracts/src/turn-change.ts',
  'apps/cli/src/turn-command.ts',
];

function fileFor(step: number): string {
  return FILES[step % FILES.length] ?? FILES[0] ?? 'a.ts';
}

function patchFor(path: string, step: number, lines: number): string {
  const body: string[] = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${step},${lines} +${step},${lines + 2} @@`,
  ];
  for (let line = 0; line < lines; line += 1) {
    const code = `  const value${line} = resolveTurnState(input.step${step}, options.limit ?? ${line});`;
    body.push(line % 4 === 0 ? `-${code}` : line % 4 === 1 ? `+${code}` : ` ${code}`);
  }
  body.push(`+  // step ${step}: keep the cached projection`, `+  return value0;`);
  return `${body.join('\n')}\n`;
}

function shellTool(id: string, step: number): SessionToolCardView {
  const command =
    step % 3 === 0
      ? `cd packages/host-runtime && npx tsc -p tsconfig.json --noEmit 2>&1 | head -20`
      : `rg -n "resolveTurnState" apps packages | head -${20 + (step % 30)}`;
  return {
    toolCallId: id,
    toolName: 'bash',
    status: 'done',
    runId: RUN_ID,
    output: Array.from({ length: 24 }, (_, line) => `src/file-${line}.ts:${step + line}: match`).join('\n'),
    presentation: { kind: 'shell', title: 'bash', command, durationMs: 300 + step, exitCode: 0 },
  };
}

function editTool(id: string, step: number, write: boolean): SessionToolCardView {
  const path = fileFor(step);
  const lines = 12 + (step % 28);
  const patch = patchFor(path, step, lines);
  return {
    toolCallId: id,
    toolName: write ? 'write_file' : 'edit',
    status: 'done',
    runId: RUN_ID,
    output: write ? `wrote ${lines} lines` : `edited ${path}`,
    presentation: {
      kind: 'filesystem',
      title: write ? 'write_file' : 'edit',
      actionVerb: 'Edited',
      targetPaths: [path],
      changedPaths: [path],
      durationMs: 40,
      fileChange: {
        path,
        status: write ? 'added' : 'modified',
        additions: Math.ceil(lines / 4) + 2,
        deletions: Math.ceil(lines / 4),
        binary: false,
        patch,
      },
    },
  };
}

function readTool(id: string, step: number): SessionToolCardView {
  const path = fileFor(step);
  return {
    toolCallId: id,
    toolName: 'read',
    status: 'done',
    runId: RUN_ID,
    output: Array.from({ length: 60 }, (_, line) => `${line + 1}\texport const line${line} = ${step};`).join('\n'),
    presentation: {
      kind: 'filesystem',
      title: 'read',
      targetPaths: [path],
      lineRange: `${step}-${step + 60}`,
      countTag: '60 行',
      durationMs: 20,
    },
  };
}

function toolsFor(id: string, step: number): SessionToolCardView[] {
  const slot = step % 10;
  const first =
    slot <= 5
      ? shellTool(`${id}-t1`, step)
      : slot <= 7
        ? editTool(`${id}-t1`, step, false)
        : slot === 8
          ? readTool(`${id}-t1`, step)
          : editTool(`${id}-t1`, step, true);
  // Roughly 880 calls over 620 steps: every third step fires a second shell call.
  return step % 3 === 1 ? [first, shellTool(`${id}-t2`, step)] : [first];
}

export function buildHugeTurnTranscript(): SessionTranscriptMessage[] {
  const start = Date.parse('2026-09-29T15:00:00.000Z');
  const messages: SessionTranscriptMessage[] = [
    {
      id: 'huge-u01',
      role: 'user',
      text: '把 turn change 的封存和撤销做完，CLI 和桌面端一起改',
      createdAt: new Date(start).toISOString(),
      status: 'done',
    },
  ];
  for (let step = 0; step < HUGE_TURN_STEP_COUNT; step += 1) {
    const last = step === HUGE_TURN_STEP_COUNT - 1;
    const id = `huge-a${String(step + 1).padStart(3, '0')}`;
    const createdAt = new Date(start + (step + 1) * 15_000).toISOString();
    messages.push({
      id,
      role: 'assistant',
      status: 'done',
      outcome: 'completed',
      createdAt,
      runId: RUN_ID,
      ...(step === 0 ? { startedAt: createdAt } : {}),
      ...(last ? { endedAt: createdAt } : {}),
      text: last
        ? '### 完成\n\n封存、撤销与 CLI 命令都已落地，测试通过。'
        : step % 7 === 0
          ? `第 ${step + 1} 步：核对 ${fileFor(step)} 的调用方。`
          : '',
      thinking: REASONING.repeat(1 + (step % 9)),
      tools: last ? [] : toolsFor(id, step),
    });
  }
  return messages;
}

export function seedHugeTurnHost(host: MockHostBackend): void {
  const createdAt = '2026-09-29T15:00:00.000Z';
  host.mockProjects.set(PROJECT, {
    path: PROJECT,
    trust: 'trusted',
    createdAt,
    lastOpenedAt: createdAt,
  });
  host.mockGitCurrentBranches.set(PROJECT, 'main');
  host.sessions.set(HUGE_TURN_SESSION_ID, {
    projectPath: PROJECT,
    scope: { kind: 'project', projectPath: PROJECT },
    workingDirectory: PROJECT,
    name: HUGE_TURN_TITLE,
    nameSource: 'user',
    updatedAt: '2026-09-30T02:24:45.000Z',
    events: [],
    transcript: buildHugeTurnTranscript(),
  });
}
