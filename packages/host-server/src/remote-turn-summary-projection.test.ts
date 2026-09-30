import { expect, it } from 'vitest';
import { projectRemoteTurnSummaries } from './remote-turn-summary-projection.js';
import { projectSessionTranscriptPage, projectSessionResume } from './remote-session-projection.js';

const summary = {
  turnId: 'turn-user',
  userMessageId: 'user',
  firstMessageId: 'user',
  revision: 'r1',
  startIndex: 0,
  endIndex: 900,
  toolCount: 934,
  fileCount: 141,
  failureCount: 15,
  elapsedMs: 600000,
};
it('keeps complete counts through remote pages and resume, without extra payloads', () => {
  const page = {
    revision: 'r1',
    totalCount: 900,
    startIndex: 850,
    endIndex: 900,
    messageBytes: 100,
    turnSummaries: [{ ...summary, hostPath: '/Users/private', tools: ['secret output'] }],
  };
  expect(projectSessionTranscriptPage({ status: 'page', messages: [], page }, {})).toMatchObject({
    page: { turnSummaries: [summary] },
  });
  expect(
    projectSessionResume(
      { sessionId: 'session', live: false, messages: [], transcriptPage: page },
      {},
    ),
  ).toMatchObject({ transcriptPage: { turnSummaries: [summary] } });
  expect(JSON.stringify(projectRemoteTurnSummaries(page.turnSummaries))).not.toContain('secret');
  expect(projectRemoteTurnSummaries(Array.from({ length: 100 }, () => summary))).toHaveLength(50);
});
