import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  HostPush,
  SessionBranchListData,
  SessionBranchSwitchData,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import { HostRuntime } from './host-runtime.js';

/**
 * ADR 0055 end-to-end: branch prompt → invisible sibling → ‹n/m› switch →
 * off-path subtree deletion, all through real Host commands over a real
 * SQLite store with the mock backend.
 */
describe('conversation tree over host commands (ADR 0055)', () => {
  it('branches a prompt, lists branch points, switches, and deletes a subtree', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-conversation-tree-'));
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
        input: { projectPath: '/project', sessionName: 'Tree' },
      });
      expect(created.success).toBe(true);
      if (!created.success) throw new Error(created.error);
      const sessionId = (created.data as { sessionId: string }).sessionId;

      await promptAndSettle(runtime, sessionId, 'turn one original');
      const afterFirst = await waitForMessages(
        runtime,
        sessionId,
        (messages) => doneAssistants(messages) >= 1,
      );
      expect(afterFirst).toHaveLength(2);

      await promptAndSettle(runtime, sessionId, 'turn two original');
      const afterSecond = await waitForMessages(
        runtime,
        sessionId,
        (messages) => doneAssistants(messages) >= 2,
      );
      expect(afterSecond).toHaveLength(4);
      const secondUser = afterSecond[2];
      if (secondUser === undefined || secondUser.role !== 'user') {
        throw new Error('second user turn missing');
      }

      // No fork yet: the tree is a single path.
      const flatList = await runtime.handleCommand({
        type: 'session/branch-list',
        sessionId,
      });
      expect(flatList.success).toBe(true);
      if (!flatList.success) throw new Error(flatList.error);
      expect((flatList.data as SessionBranchListData).branchPoints).toHaveLength(0);

      // Branch prompt: replace "turn two original" with a sibling turn. The
      // command refuses while a run is registered, so settle like a shell does.
      await waitForNoForegroundRun(runtime, sessionId);
      const branched = await runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: { text: 'turn two alternative', branchFromMessageId: secondUser.id },
      });
      expect(branched.success, branched.success ? '' : branched.error).toBe(true);
      const alternativePath = await waitForMessages(
        runtime,
        sessionId,
        (messages) =>
          doneAssistants(messages) >= 2 &&
          messages.some((message) => message.text.includes('turn two alternative')),
      );
      // The active path shows the sibling, never the abandoned branch.
      expect(alternativePath).toHaveLength(4);
      expect(alternativePath.some((message) => message.text === 'turn two original')).toBe(false);

      const listed = await runtime.handleCommand({
        type: 'session/branch-list',
        sessionId,
      });
      expect(listed.success).toBe(true);
      if (!listed.success) throw new Error(listed.error);
      const listData = listed.data as SessionBranchListData;
      expect(listData.branchPoints).toHaveLength(1);
      const point = listData.branchPoints[0];
      if (point === undefined) throw new Error('branch point missing');
      expect(point.anchorMessageId).toBe(afterSecond[1]?.id);
      expect(point.siblings).toHaveLength(2);
      expect(point.activeIndex).toBe(1);
      expect(point.siblings[0]?.preview).toBe('turn two original');
      expect(point.siblings[1]?.preview).toBe('turn two alternative');
      expect(point.siblings[0]?.messageCount).toBe(2);

      // Switch back to the original branch; tail flips wholesale.
      await waitForNoForegroundRun(runtime, sessionId);
      const switched = await runtime.handleCommand({
        type: 'session/branch-switch',
        sessionId,
        targetMessageId: secondUser.id,
        messageProjection: 'tail',
      });
      expect(switched.success).toBe(true);
      if (!switched.success) throw new Error(switched.error);
      const switchData = switched.data as SessionBranchSwitchData;
      if (switchData.status !== 'switched') {
        throw new Error(`expected switched, got ${switchData.status}`);
      }
      expect(switchData.activeLeafMessageId).toBe(afterSecond[3]?.id);
      const originalPath = await waitForMessages(
        runtime,
        sessionId,
        (messages) => messages.some((message) => message.text === 'turn two original'),
      );
      expect(originalPath.some((message) => message.text === 'turn two alternative')).toBe(false);
      expect(
        pushes.filter((message) => message.type === 'session/branch-updated').length,
      ).toBeGreaterThanOrEqual(2);

      // Bad branch targets fail without touching the tree.
      const missingTarget = await runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: { text: 'never lands', branchFromMessageId: 'msg-does-not-exist' },
      });
      expect(missingTarget.success).toBe(false);
      if (missingTarget.success) throw new Error('expected failure');
      expect(missingTarget.error).toContain('branch-target-not-found');
      const assistantTarget = await runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: { text: 'never lands', branchFromMessageId: afterSecond[1]?.id ?? '' },
      });
      expect(assistantTarget.success).toBe(false);
      if (assistantTarget.success) throw new Error('expected failure');
      expect(assistantTarget.error).toContain('branch-target-not-user');

      // Delete the abandoned sibling subtree (off-path): active tail unchanged,
      // fork dissolves.
      const alternativeHead = point.siblings[1]?.headMessageId;
      if (alternativeHead === undefined) throw new Error('alternative head missing');
      const truncated = await runtime.handleCommand({
        type: 'session/truncate-from',
        sessionId,
        messageId: alternativeHead,
        messageProjection: 'tail',
      });
      expect(truncated.success).toBe(true);
      if (!truncated.success) throw new Error(truncated.error);
      expect((truncated.data as { removedCount: number }).removedCount).toBe(2);
      expect((truncated.data as { remainingCount: number }).remainingCount).toBe(4);
      const afterDelete = await runtime.handleCommand({
        type: 'session/branch-list',
        sessionId,
      });
      expect(afterDelete.success).toBe(true);
      if (!afterDelete.success) throw new Error(afterDelete.error);
      expect((afterDelete.data as SessionBranchListData).branchPoints).toHaveLength(0);
      const finalMessages = await waitForMessages(
        runtime,
        sessionId,
        (messages) => messages.length === 4,
      );
      expect(finalMessages.some((message) => message.text === 'turn two original')).toBe(true);
    } finally {
      await runtime.dispose();
    }
  });
});

async function promptAndSettle(
  runtime: HostRuntime,
  sessionId: string,
  text: string,
): Promise<void> {
  const prompted = await runtime.handleCommand({
    type: 'session/prompt',
    sessionId,
    input: { text },
  });
  expect(prompted.success).toBe(true);
  if (!prompted.success) throw new Error(prompted.error);
}

function doneAssistants(messages: readonly SessionTranscriptMessage[]): number {
  return messages.filter((message) => message.role === 'assistant' && message.status === 'done')
    .length;
}

async function waitForNoForegroundRun(runtime: HostRuntime, sessionId: string): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const response = await runtime.handleCommand({ type: 'session/foreground-run', sessionId });
    if (response.success && (response.data as { run: unknown }).run === null) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('foreground run never settled');
}

async function waitForMessages(
  runtime: HostRuntime,
  sessionId: string,
  ready: (messages: SessionTranscriptMessage[]) => boolean,
): Promise<SessionTranscriptMessage[]> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const response = await runtime.handleCommand({ type: 'session/messages', sessionId });
    if (response.success) {
      const messages = (response.data as { messages: SessionTranscriptMessage[] }).messages;
      if (ready(messages)) {
        return messages;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('transcript never reached the expected state');
}
