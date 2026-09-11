import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_CITATIONS_DETAILS_KIND,
  type KnowledgeCitation,
  type ToolPresentation,
} from '@piwin/contracts';
import type { ChatMessageUi, ToolCardUi } from '../chat-reducer';
import { collectKnowledgeCitations } from './knowledge-citation-collect.js';
import {
  citationsForRefs,
  citedKnowledgeRefs,
  knowledgeCitationHref,
  knowledgeCitationLocation,
  linkKnowledgeCitationMarkers,
  parseKnowledgeCitationHref,
  type KnowledgeCitationIndex,
} from './knowledge-citations.js';

function citation(ref: number, overrides: Partial<KnowledgeCitation> = {}): KnowledgeCitation {
  return {
    ref,
    baseId: 'folder:0123456789abcdef',
    baseName: 'docs',
    kind: 'folder',
    title: `doc-${ref}.md`,
    relativePath: `doc-${ref}.md`,
    text: `passage ${ref}`,
    ...overrides,
  };
}

function knowledgeTool(
  citations: KnowledgeCitation[],
  status: ToolCardUi['status'] = 'done',
): ToolCardUi {
  const presentation: ToolPresentation = {
    kind: 'other',
    title: 'knowledge_search',
    knowledge: { kind: KNOWLEDGE_CITATIONS_DETAILS_KIND, citations, degradedBaseIds: [] },
  };
  return {
    toolCallId: `call-${citations[0]?.ref ?? 0}`,
    toolName: 'knowledge_search',
    status,
    output: '',
    presentation,
  };
}

function message(tools: ToolCardUi[]): ChatMessageUi {
  return {
    id: 'm1',
    role: 'assistant',
    text: '',
    thinking: '',
    tools,
    attachments: [],
    status: 'done',
  };
}

const index: KnowledgeCitationIndex = new Map([
  [1, citation(1)],
  [2, citation(2)],
]);

describe('collectKnowledgeCitations', () => {
  it('indexes citations from completed knowledge tools, first ref wins', () => {
    const collected = collectKnowledgeCitations(
      message([
        knowledgeTool([citation(1), citation(2)]),
        knowledgeTool([citation(2, { title: 'later.md' }), citation(3)]),
      ]),
    );
    expect([...collected.keys()]).toEqual([1, 2, 3]);
    expect(collected.get(2)?.title).toBe('doc-2.md');
  });

  it('ignores running tools and tools without knowledge presentation', () => {
    const plain: ToolCardUi = { toolCallId: 'c', toolName: 'read_file', status: 'done', output: '' };
    expect(collectKnowledgeCitations(message([knowledgeTool([citation(1)], 'running'), plain])).size).toBe(0);
  });

  it('prefers turn-level tools when provided', () => {
    const collected = collectKnowledgeCitations(message([]), [knowledgeTool([citation(4)])]);
    expect([...collected.keys()]).toEqual([4]);
  });
});

describe('linkKnowledgeCitationMarkers', () => {
  it('links resolved single and grouped markers', () => {
    expect(linkKnowledgeCitationMarkers('Stability drives intervals [1]. See [1, 2].', index)).toBe(
      `Stability drives intervals [1](${knowledgeCitationHref(1)}). See [1](${knowledgeCitationHref(1)})[2](${knowledgeCitationHref(2)}).`,
    );
  });

  it('leaves unresolved, partial, and non-marker brackets alone', () => {
    const text = 'Missing [9], partial [1, 9], link [1](https://x.test), def [2]: y, note[^1], ![1], [label][1], \\[1]';
    expect(linkKnowledgeCitationMarkers(text, index)).toBe(text);
  });

  it('does not touch code fences or inline code', () => {
    const text = ['Real [1]', '```ts', 'const a = xs[1];', '```', 'inline `arr[2]` and [2]'].join('\n');
    const linked = linkKnowledgeCitationMarkers(text, index);
    expect(linked).toContain(`Real [1](${knowledgeCitationHref(1)})`);
    expect(linked).toContain('const a = xs[1];');
    expect(linked).toContain('`arr[2]`');
    expect(linked).toContain(`and [2](${knowledgeCitationHref(2)})`);
  });

  it('treats an unclosed streaming fence as code', () => {
    expect(linkKnowledgeCitationMarkers('```\nxs[1]', index)).toBe('```\nxs[1]');
  });

  it('returns the input untouched when nothing can resolve', () => {
    expect(linkKnowledgeCitationMarkers('Plain [1]', new Map())).toBe('Plain [1]');
  });
});

describe('citation helpers', () => {
  it('lists cited refs in first-appearance order outside code', () => {
    const refs = citedKnowledgeRefs('B [2], A [1], again [2], code `[1]`, unknown [7]', index);
    expect(refs).toEqual([2, 1]);
    expect(citationsForRefs(index, [2, 7]).map((entry) => entry.ref)).toEqual([2]);
  });

  it('round-trips citation hrefs', () => {
    expect(parseKnowledgeCitationHref(knowledgeCitationHref(12))).toBe(12);
    expect(parseKnowledgeCitationHref('https://example.test/12')).toBeNull();
    expect(parseKnowledgeCitationHref(undefined)).toBeNull();
  });

  it('formats line and page locations', () => {
    expect(knowledgeCitationLocation(citation(1, { startLine: 3 }))).toBe('L3');
    expect(knowledgeCitationLocation(citation(1, { startLine: 3, endLine: 9 }))).toBe('L3–9');
    expect(knowledgeCitationLocation(citation(1, { pageStart: 4, pageEnd: 5, startLine: 1 }))).toBe('p.4–5');
    expect(knowledgeCitationLocation(citation(1))).toBeNull();
  });
});
