import { describe, expect, it } from 'vitest';
import type { HostCommand, HostPush } from './ipc.js';
import {
  KNOWLEDGE_CITATIONS_DETAILS_KIND,
  NOTES_KNOWLEDGE_BASE_ID,
  folderKnowledgeBaseId,
  hostSupportsKnowledgeBases,
  parseKnowledgeBaseId,
  readKnowledgeToolDetails,
  type KnowledgeCitation,
} from './knowledge-base.js';

const citation: KnowledgeCitation = {
  ref: 1,
  baseId: 'folder:0123456789abcdef',
  baseName: 'docs',
  kind: 'folder',
  title: 'guide/intro.md',
  relativePath: 'guide/intro.md',
  startLine: 12,
  text: 'Spaced repetition schedules reviews.',
};

describe('knowledge base ids', () => {
  it('round-trips folder ids through folderKey', () => {
    const id = folderKnowledgeBaseId('0123456789abcdef');
    expect(id).toBe('folder:0123456789abcdef');
    expect(parseKnowledgeBaseId(id)).toEqual({ kind: 'folder', folderKey: '0123456789abcdef' });
  });

  it('parses the built-in notes id', () => {
    expect(parseKnowledgeBaseId(NOTES_KNOWLEDGE_BASE_ID)).toEqual({ kind: 'notes' });
  });

  it('rejects malformed ids', () => {
    expect(parseKnowledgeBaseId('folder:')).toBeNull();
    expect(parseKnowledgeBaseId('folder:../../etc')).toBeNull();
    expect(parseKnowledgeBaseId('folder:0123456789ABCDEF')).toBeNull();
    expect(parseKnowledgeBaseId('notes:default')).toBeNull();
  });
});

describe('readKnowledgeToolDetails', () => {
  it('accepts citation details', () => {
    const details = readKnowledgeToolDetails({
      kind: KNOWLEDGE_CITATIONS_DETAILS_KIND,
      citations: [citation],
      degradedBaseIds: ['folder:0123456789abcdef'],
    });
    expect(details?.citations[0]?.ref).toBe(1);
    expect(details?.degradedBaseIds).toEqual(['folder:0123456789abcdef']);
  });

  it('defaults missing degradedBaseIds and rejects other tool details', () => {
    expect(
      readKnowledgeToolDetails({ kind: KNOWLEDGE_CITATIONS_DETAILS_KIND, citations: [] })
        ?.degradedBaseIds,
    ).toEqual([]);
    expect(readKnowledgeToolDetails({ cardId: 'c1' })).toBeNull();
    expect(readKnowledgeToolDetails(null)).toBeNull();
  });
});

describe('knowledge base IPC shapes', () => {
  it('composes into HostCommand and HostPush', () => {
    const list: HostCommand = { type: 'knowledge/bases/list' };
    const search: HostCommand = { type: 'knowledge/search', query: 'fsrs', limit: 5 };
    const mount: HostCommand = {
      type: 'session/set-knowledge-bases',
      sessionId: 's1',
      baseIds: [NOTES_KNOWLEDGE_BASE_ID],
    };
    const open: HostCommand = { type: 'knowledge/open-source', citation, openFile: true };
    const push: HostPush = { type: 'knowledge/bases-changed', bases: [] };
    expect([list.type, search.type, mount.type, open.type, push.type]).toEqual([
      'knowledge/bases/list',
      'knowledge/search',
      'session/set-knowledge-bases',
      'knowledge/open-source',
      'knowledge/bases-changed',
    ]);
  });

  it('gates on the host capability flag', () => {
    expect(hostSupportsKnowledgeBases({ knowledgeBases: true })).toBe(true);
    expect(hostSupportsKnowledgeBases({})).toBe(false);
    expect(hostSupportsKnowledgeBases(undefined)).toBe(false);
  });
});
