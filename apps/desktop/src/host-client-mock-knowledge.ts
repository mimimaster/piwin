/** Mock `knowledge/*` Host: in-memory bases so the knowledge page and mounts work offline. */
import {
  NOTES_KNOWLEDGE_BASE_ID,
  WIKI_KNOWLEDGE_BASE_ID,
  folderKnowledgeBaseId,
  type HostCommand,
  type HostResponse,
  type KnowledgeBaseSummary,
  type KnowledgeCitation,
} from '@piwin/contracts';
import type { MockHostBackend } from './host-client-mock.js';

type MockWikiConcept = {
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  updatedAt: string;
  relativePath: string;
  aliases?: string[];
  links: string[];
  content: string;
};

type MockKnowledgeState = {
  bases: KnowledgeBaseSummary[];
  mounts: Map<string, string[]>;
  /** Seeded from MOCK_WIKI_CONCEPTS; distillation appends to it. */
  concepts: MockWikiConcept[];
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

const MOCK_WIKI_CONCEPTS = [
  {
    slug: 'llm-wiki-architecture',
    title: 'LLM-Wiki Architecture',
    summary: 'Andrej Karpathy 提出的个人百科知识工程模式，将生肉材料编译为熟肉双链维基。',
    tags: ['ai', 'architecture', 'knowledge'],
    updatedAt: '2026-09-11T12:00:00.000Z',
    relativePath: 'concepts/llm-wiki-architecture.md',
    aliases: ['Karpathy Wiki', 'LLM-Wiki'],
    links: ['fsrs-algorithm', 'spaced-repetition'],
    content: `# LLM-Wiki 架构

> 源自 Andrej Karpathy 的个人知识管理研究。

LLM-Wiki 将海量、杂乱的原始信源（raw sources）通过 Agent 的持续提炼，转化为原子化的概念词条（Concepts），并在概念之间建立丰富的 \`[[双向超链接]]\`。

## 核心支柱
1. **生熟隔离**：信源（Raw）保持只读与可追溯，熟肉（Concepts）持续迭代。
2. **双向漫游**：每个词条通过超链接与其他概念交织，例如 [[FSRS 算法|fsrs-algorithm]] 与 [[间隔重复理论|spaced-repetition]]。
3. **健康巡检**：定期执行 Lint，修复失效链接与孤立词条。
`,
  },
  {
    slug: 'fsrs-algorithm',
    title: 'FSRS 算法',
    summary: '现代自由间隔重复调度算法（Free Spaced Repetition Scheduler），超越经典 SM-2。',
    tags: ['algorithm', 'learning', 'fsrs'],
    updatedAt: '2026-09-10T16:00:00.000Z',
    relativePath: 'concepts/fsrs-algorithm.md',
    aliases: ['FSRS-4.5', 'FSRS'],
    links: ['spaced-repetition', 'llm-wiki-architecture'],
    content: `# FSRS 算法

FSRS（Free Spaced Repetition Scheduler）是新一代间隔重复算法，基于记忆的稳定性（Stability）与可提取性（Retrievability）建模。

## 与传统算法对比
相较于 SuperMemo 2 (SM-2)，FSRS 能更精确地预测遗忘曲线，大幅降低复习负担。

在知识中心中，FSRS 闪卡可直接由 [[LLM-Wiki 架构|llm-wiki-architecture]] 概念词条一键提取生成。参见 [[间隔重复理论|spaced-repetition]]。
`,
  },
  {
    slug: 'spaced-repetition',
    title: '间隔重复理论',
    summary: '利用遗忘曲线规律在记忆衰减的临界点进行强化提取的学习认知科学理论。',
    tags: ['learning', 'cognitive-science'],
    updatedAt: '2026-09-09T10:00:00.000Z',
    relativePath: 'concepts/spaced-repetition.md',
    aliases: ['Spaced Repetition', '间隔复习'],
    links: ['fsrs-algorithm'],
    content: `# 间隔重复理论

间隔重复是一种经过实验心理学广泛验证的高效学习技术，其核心思想是在遗忘曲线的关键转折点主动唤起记忆。

现代实践通常借助算法引擎进行自动化调度，例如 [[FSRS 算法|fsrs-algorithm]]。
`,
  },
];

function stateFor(host: MockHostBackend): MockKnowledgeState {
  const existing = states.get(host);
  if (existing) return existing;
  const created: MockKnowledgeState = {
    bases: [
      {
        id: WIKI_KNOWLEDGE_BASE_ID,
        kind: 'wiki',
        name: 'Wiki',
        state: 'ready',
        degraded: false,
        documentCount: MOCK_WIKI_CONCEPTS.length,
        folderPath: '/Users/mock/.piwin/wiki',
      },
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
    concepts: MOCK_WIKI_CONCEPTS.map((concept) => ({ ...concept })),
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
    case 'knowledge/wiki/overview':
      return ok(id, command.type, {
        indexContent: `# Knowledge Index\n\n${state.concepts
          .map((concept) => `- [[${concept.title}]]`)
          .join('\n')}`,
        logSnippet: '# Wiki Log\n\n- [2026-09-11] Compiled initial concepts',
        concepts: state.concepts.map(({ content: _c, aliases: _a, links: _l, ...rest }) => rest),
        totalConcepts: state.concepts.length,
      });
    case 'knowledge/wiki/concept': {
      const slug = (command as { slug?: string }).slug ?? '';
      const match = state.concepts.find(
        (c) =>
          c.slug === slug ||
          c.slug.toLowerCase() === slug.toLowerCase() ||
          c.title.toLowerCase() === slug.toLowerCase(),
      );
      if (!match) return fail(id, command.type, `Concept not found: ${slug}`);
      return ok(id, command.type, { concept: match });
    }
    case 'knowledge/wiki/distill': {
      const baseId = (command as { baseId: string }).baseId;
      const base = state.bases.find((entry) => entry.id === baseId);
      if (!base) return fail(id, command.type, `Unknown knowledge base: ${baseId}`);
      const topic = (command as { topic?: string }).topic?.trim();
      const title = topic || `${base.name} 核心概念`;
      const slug =
        title
          .toLowerCase()
          .trim()
          .replace(/[^\p{L}\p{N}]+/gu, '-')
          .replace(/^-+|-+$/g, '') || 'untitled';
      const concept: MockWikiConcept = {
        slug,
        title,
        summary: `从「${base.name}」的切片提炼的概念综述。`,
        tags: ['distilled'],
        updatedAt: new Date().toISOString(),
        relativePath: `concepts/${slug}.md`,
        links: state.concepts.slice(0, 1).map((entry) => entry.title),
        content: `本词条由 mock Host 从「${base.name}」的索引切片合成。\n\n真实 Host 下，这里是模型基于检索到的原始切片去重、交叉验证后写出的正文，并以 [[双向链接]] 关联既有概念。`,
      };
      state.concepts = [concept, ...state.concepts.filter((entry) => entry.slug !== slug)];
      const wikiBase = state.bases.find((entry) => entry.kind === 'wiki');
      if (wikiBase) wikiBase.documentCount = state.concepts.length;
      return ok(id, command.type, {
        concept,
        baseId,
        sourcePaths: ['mock/slice-1.md', 'mock/slice-2.md'],
      });
    }
    default:
      return null;
  }
}
