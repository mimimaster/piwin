import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostPush, PromptInput, SessionPlan } from '@piwin/contracts';
import {
  inspectSessionPlan,
  openSessionTranscriptStore,
} from '@piwin/session';
import { HostRuntime } from './host-runtime.js';
import {
  getPiwinSessionMediaDir,
  getPiwinSessionPlanPath,
  getPiwinSessionTranscriptDatabasePath,
} from './paths.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function samplePlan(sessionId: string, projectPath: string): SessionPlan {
  const now = new Date().toISOString();
  return {
    id: 'smoke-plan',
    sessionId,
    projectPath,
    status: 'approved',
    title: 'Integrity smoke',
    goal: 'Keep prompting after a torn plan.json',
    steps: [{ id: '1', title: 'Ship', status: 'pending' }],
    revision: 0,
    createdAt: now,
    updatedAt: now,
    source: 'user',
  };
}

async function waitForRunTerminal(
  pushes: HostPush[],
  runId: string,
): Promise<Extract<HostPush, { type: 'run/terminal' }>> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const terminal = [...pushes]
      .reverse()
      .find(
        (message): message is Extract<HostPush, { type: 'run/terminal' }> =>
          message.type === 'run/terminal' && message.run.runId === runId,
      );
    if (terminal) return terminal;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for run/terminal ${runId}`);
}

async function promptUntilTerminal(
  runtime: HostRuntime,
  pushes: HostPush[],
  sessionId: string,
  input: PromptInput,
): Promise<Extract<HostPush, { type: 'run/terminal' }>> {
  const accepted = await runtime.handleCommand({
    type: 'session/prompt',
    sessionId,
    input,
  });
  if (!accepted.success) {
    throw new Error(accepted.error);
  }
  const runId = (accepted.data as { runId: string }).runId;
  return waitForRunTerminal(pushes, runId);
}

describe('session-plan integrity Host smoke', () => {
  it('keeps a follow-up prompt with an image alive when plan.json is torn', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-integrity-smoke-'));
    const projectPath = join(rootDir, 'proj');
    const pushes: HostPush[] = [];
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      onPush: (message) => {
        pushes.push(message);
      },
    });
    try {
      const created = await runtime.handleCommand({
        type: 'session/create',
        input: { projectPath, sessionName: 'integrity-smoke' },
      });
      expect(created.success).toBe(true);
      if (!created.success) throw new Error(created.error);
      const sessionId = (created.data as { sessionId: string }).sessionId;

      const first = await promptUntilTerminal(runtime, pushes, sessionId, {
        text: 'first completed turn',
      });
      expect(first.run.status).toBe('completed');

      const planPath = getPiwinSessionPlanPath(rootDir, sessionId);
      await mkdir(dirname(planPath), { recursive: true });
      const body = `${JSON.stringify(samplePlan(sessionId, projectPath), null, 2)}\n`;
      await writeFile(planPath, `${body}4-429d-acc7-leftover-from-shorter-write"\n`, 'utf8');

      const mediaDir = getPiwinSessionMediaDir(rootDir, sessionId);
      await mkdir(mediaDir, { recursive: true });
      const imagePath = join(mediaDir, 'shot.png');
      await writeFile(imagePath, PNG_1X1);

      const second = await promptUntilTerminal(runtime, pushes, sessionId, {
        text: '这是你干的吗？',
        attachments: [
          {
            id: 'att-shot',
            kind: 'media',
            path: imagePath,
            mimeType: 'image/png',
            name: 'shot.png',
            contentKind: 'image',
            byteSize: PNG_1X1.byteLength,
            source: 'paste',
          },
        ],
      });
      expect(second.run.status).toBe('completed');

      const inspection = await inspectSessionPlan(planPath);
      expect(inspection.kind === 'valid' || inspection.kind === 'recovered').toBe(true);

      await runtime.dispose();

      const store = await openSessionTranscriptStore({
        dbPath: getPiwinSessionTranscriptDatabasePath(rootDir, sessionId),
        sessionId,
        projectPath,
      });
      const messages = await store.listTail(20);
      const firstAssistant = messages.find(
        (message) => message.role === 'assistant' && message.runId === first.run.runId,
      );
      const followUpUser = messages.find(
        (message) => message.role === 'user' && message.text.includes('这是你干的吗？'),
      );
      expect(firstAssistant?.outcome).toBe('completed');
      expect(firstAssistant?.failure).toBeUndefined();
      expect(followUpUser?.attachments?.some((attachment) => attachment.kind === 'media')).toBe(
        true,
      );
      expect(
        messages.some(
          (message) =>
            message.role === 'assistant' &&
            message.runId === first.run.runId &&
            message.failure !== undefined,
        ),
      ).toBe(false);
      store.close();
    } finally {
      await runtime.dispose().catch(() => undefined);
    }
  });

  it('starts an approved draft plan inline without hanging the reserved Run', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-integrity-exec-'));
    const projectPath = join(rootDir, 'proj');
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const created = await runtime.handleCommand({
        type: 'session/create',
        input: { projectPath },
      });
      expect(created.success).toBe(true);
      if (!created.success) throw new Error(created.error);
      const sessionId = (created.data as { sessionId: string }).sessionId;
      const now = new Date().toISOString();
      const set = await runtime.handleCommand({
        type: 'plan/set',
        sessionId,
        expected: null,
        plan: {
          id: 'draft-plan',
          sessionId,
          projectPath,
          status: 'draft',
          title: 'Draft smoke',
          goal: 'Execute atomically',
          steps: [{ id: '1', title: 'Go', status: 'pending' }],
          revision: 0,
          createdAt: now,
          updatedAt: now,
          source: 'user',
        },
      });
      expect(set.success).toBe(true);
      const started = await runtime.handleCommand({
        type: 'plan/execute',
        request: {
          sessionId,
          planId: 'draft-plan',
          mode: 'inline',
          expectedRevision: 0,
          approveDraft: true,
        },
      });
      expect(started.success).toBe(true);
      if (!started.success) throw new Error(started.error);
      expect((started.data as { runId?: string }).runId).toEqual(expect.any(String));
    } finally {
      await runtime.dispose();
    }
  });
});
