import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage, SessionTurnSummary } from '@piwin/contracts';
import {
  mapTranscriptMessagesToUi,
  reuseUnchangedTranscriptMessages,
} from './chat-reducer-transcript.js';
import { groupTranscriptTurns, registerTranscriptTurnIds } from './transcript-turns.js';
import { projectTurnWorkDisclosure } from './turn-work-disclosure-model.js';

const summary: SessionTurnSummary = {
  turnId: 'turn-user',
  firstMessageId: 'user',
  userMessageId: 'user',
  revision: 'r1',
  startIndex: 0,
  endIndex: 200,
  toolCount: 934,
  fileCount: 141,
  failureCount: 15,
  elapsedMs: 600000,
};
function rows(start: number, end: number) {
  const messages: SessionTranscriptMessage[] = Array.from({ length: end - start }, (_, offset) => ({
    id: `m-${start + offset}`,
    role: 'assistant',
    status: 'done',
    text: '',
    createdAt: new Date().toISOString(),
    runId: 'run',
    tools: [{ toolCallId: `t-${start + offset}`, toolName: 'bash', status: 'done', output: '' }],
  }));
  return mapTranscriptMessagesToUi(messages, {
    page: {
      revision: 'r1',
      totalCount: 200,
      startIndex: start,
      endIndex: end,
      messageBytes: 100,
      turnSummaries: [summary],
    },
  });
}
function project(messages: ReturnType<typeof rows>, live = false) {
  const turn = groupTranscriptTurns(messages)[0];
  if (!turn) throw new Error('expected turn');
  return projectTurnWorkDisclosure({
    turn,
    runRecordsById: {},
    activeRunId: live ? 'run' : null,
    currentTurnStreaming: live,
  });
}

describe('complete Host turn summary in Desktop', () => {
  it('keeps totals, elapsed time and canonical identity through prepend and eviction with no overlap', () => {
    const tail = rows(160, 200);
    const before = project(tail);
    const after = project([...rows(110, 160), ...tail]);
    expect(before).toMatchObject({
      toolCount: 934,
      fileCount: 141,
      failureCount: 15,
      elapsedMs: 600000,
    });
    expect(after).toMatchObject({
      toolCount: 934,
      fileCount: 141,
      failureCount: 15,
      elapsedMs: 600000,
    });
    const registry = registerTranscriptTurnIds(groupTranscriptTurns(tail));
    expect(groupTranscriptTurns(rows(0, 50), registry)[0]?.id).toBe('turn-user');
  });

  it('uses current local progress while the run is live', () => {
    expect(project(rows(160, 200), true)).toMatchObject({
      live: true,
      toolCount: 40,
      failureCount: 0,
    });
  });

  it('refreshes unchanged message objects when Host totals change', () => {
    const current = rows(160, 200);
    const updated = current.map((message) => ({
      ...message,
      turnSummary: { ...summary, toolCount: 935, revision: 'r2' },
    }));
    expect(reuseUnchangedTranscriptMessages(current, updated)[0]?.turnSummary?.toolCount).toBe(935);
    expect(reuseUnchangedTranscriptMessages(current, rows(160, 200))[0]).toBe(current[0]);
  });

  it('falls back to local totals for legacy Hosts', () => {
    const legacy = rows(160, 200).map(({ turnSummary: omitted, ...message }) => message);
    expect(project(legacy)).toMatchObject({ toolCount: 40, failureCount: 0 });
  });
});
