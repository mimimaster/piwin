import { describe, expect, it } from 'vitest';
import { parseGitLogRecords } from './commit-graph.js';

describe('parseGitLogRecords', () => {
  it('parses pretty format records', () => {
    const stdout =
      'abc123\x1fabc\x1fdef456 parent2\x1fAda\x1f2026-07-20T00:00:00+00:00\x1fInitial commit\x1e' +
      'def456\x1fdef\x1f\x1fBob\x1f2026-07-19T00:00:00+00:00\x1fRoot\x1e';
    const nodes = parseGitLogRecords(stdout);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({
      hash: 'abc123',
      shortHash: 'abc',
      subject: 'Initial commit',
      authorName: 'Ada',
    });
    expect(nodes[0]?.parentHashes).toEqual(['def456', 'parent2']);
    expect(nodes[1]?.parentHashes).toEqual([]);
  });
});
