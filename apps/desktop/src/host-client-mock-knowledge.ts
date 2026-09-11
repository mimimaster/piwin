/** Mock `knowledge/*` Host: in-memory bases so the knowledge page and mounts work offline. */
import {
  NOTES_KNOWLEDGE_BASE_ID,
  folderKnowledgeBaseId,
  type HostCommand,
  type HostResponse,
  type KnowledgeBaseSummary,
  type KnowledgeCitation,
} from '@piwin/contracts';
import type { MockHostBackend } from './host-client-mock.js';

type MockKnowledgeState = {
  bases: KnowledgeBaseSummary[];
  mounts: Map<string, string[]>;
};

const states = new WeakMap<MockHostBackend, MockKnowledgeState>();

function mockFolderKey(path: string): string {
  // Two FNV-1a passes give a stable 16-hex key, matching the real id shape.
  let first = 0x811c9dc5;
  let second = 0x01000193;
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x811c9dc5) >>> 0;
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}

function folderBase(
  folderPath: string,
  overrides: Partial<KnowledgeBaseSummary> = {},
): KnowledgeBaseSummary {
  return {
    id: folderKnowledgeBaseId(mockFolderKey(folderPath)),
    kind: 'folder',
    name: folderPath.split('/').filter(Boolean).pop() ?? folderPath,
    folderPath,
    state: 'not-indexed',
    degraded: false,
    documentCount: 0,
    createdAt: '2026-09-01T08:00:00.000Z',
    ...overrides,
  };
}

function stateFor(host: MockHostBackend): MockKnowledgeState {
  const existing = states.get(host);
  if (existing) return existing;
  const created: MockKnowledgeState = {
    bases: [
      {
        id: NOTES_KNOWLEDGE_BASE_ID,
        kind: 'notes',
        name: '笔记',
        state: 'ready',
        degraded: false,
        documentCount: 12,
      },
      folderBase('/Users/mock/Documents/fsrs-papers', {
        state: 'ready',
        documentCount: 18,
        chunkCount: 412,
        lastIndexedAt: '2026-09-10T09:30:00.000Z',
      }),
      folderBase('/Users/mock/Documents/design-notes', { degraded: true }),
    ],
    mounts: new Map(),
  };
  states.set(host, created);
  return created;
}

function ok(id: string, command: HostCommand['type'], data: unknown): HostResponse {
  return { id, type: 'response', command, success: true, data };
}

function fail(id: string, command: HostCommand['type'], error: string): HostResponse {
  return { id, type: 'response', command, success: false, error };
}

function mockCitations(bases: readonly KnowledgeBaseSummary[], query: string): KnowledgeCitation[] {
  const searchable = bases.filter((base) => base.state === 'ready' || base.state === 'partial');
  return searchable.slice(0, 2).map((base, index) => ({
    ref: index + 1,
    baseId: base.id,
    baseName: base.name,
    kind: base.kind,
    ...(base.kind === 'notes'
      ? { title: '复习节奏', noteId: 'note-review-rhythm' }
      : { title: 'fsrs/overview.md', relativePath: 'fsrs/overview.md', startLine: 12, endLine: 18 }),
    text: `与「${query}」相关的片段：稳定性决定下一次复习间隔，难度影响稳定性的增长速度。`,
    score: 0.82 - index * 0.1,
  }));
}

export async function handleMockKnowledgeCommands(
  host: MockHostBackend,
  command: HostCommand,
  id: string,
): Promise<HostResponse | null> {
  const state = stateFor(host);
  switch (command.type) {
    case 'knowledge/bases/list':
      return ok(id, command.type, { bases: state.bases });
    case 'knowledge/bases/add': {
      const next = folderBase(command.folderPath, command.name ? { name: command.name } : {});
      const existing = state.bases.find((base) => base.id === next.id);
      if (!existing) state.bases.push(next);
      return ok(id, command.type, { base: existing ?? next });
    }
    case 'knowledge/bases/rename': {
      const base = state.bases.find((entry) => entry.id === command.baseId);
      if (!base) return fail(id, command.type, `Unknown knowledge base: ${command.baseId}`);
      base.name = command.name;
      return ok(id, command.type, { base });
    }
    case 'knowledge/bases/remove':
      if (command.baseId === NOTES_KNOWLEDGE_BASE_ID) {
        return fail(id, command.type, 'The notes knowledge base cannot be removed');
      }
      state.bases = state.bases.filter((base) => base.id !== command.baseId);
      return ok(id, command.type, { removed: true, baseId: command.baseId });
    case 'knowledge/search': {
      const scoped = command.baseIds
        ? state.bases.filter((base) => command.baseIds?.includes(base.id))
        : state.bases;
      return ok(id, command.type, {
        citations: mockCitations(scoped, command.query),
        degradedBaseIds: scoped.filter((base) => base.degraded).map((base) => base.id),
        skipped: scoped
          .filter((base) => base.state !== 'ready' && base.state !== 'partial')
          .map((base) => ({ baseId: base.id, reason: base.state === 'missing' ? 'missing' : 'not-indexed' })),
      });
    }
    case 'knowledge/open-source': {
      const { citation } = command;
      if (citation.kind === 'notes' && citation.noteId) {
        return ok(id, command.type, { kind: 'notes', noteId: citation.noteId });
      }
      const base = state.bases.find((entry) => entry.id === citation.baseId);
      return ok(id, command.type, {
        kind: 'folder',
        absolutePath: `${base?.folderPath ?? ''}/${citation.relativePath ?? ''}`,
        ...(citation.startLine !== undefined ? { startLine: citation.startLine } : {}),
        opened: false,
      });
    }
    case 'session/set-knowledge-bases': {
      const known = new Set(state.bases.map((base) => base.id));
      const unknown = command.baseIds.find((baseId) => !known.has(baseId));
      if (unknown) return fail(id, command.type, `Unknown knowledge base: ${unknown}`);
      state.mounts.set(command.sessionId, [...command.baseIds]);
      return ok(id, command.type, { sessionId: command.sessionId, baseIds: command.baseIds });
    }
    default:
      return null;
  }
}
