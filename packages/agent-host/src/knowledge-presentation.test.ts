import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_CITATIONS_DETAILS_KIND, type KnowledgeCitation } from '@piwin/contracts';
import { mapToolExecutionEndEvent } from './tool-event-map.js';
import { buildToolPresentation } from './tool-presentation.js';

const citation: KnowledgeCitation = {
  ref: 1,
  baseId: 'folder:0123456789abcdef',
  baseName: 'docs',
  kind: 'folder',
  title: 'guide/intro.md',
  relativePath: 'guide/intro.md',
  startLine: 3,
  text: 'FSRS schedules reviews by stability.',
};

const details = {
  kind: KNOWLEDGE_CITATIONS_DETAILS_KIND,
  citations: [citation],
  degradedBaseIds: [],
};

describe('knowledge tool presentation', () => {
  it('attaches citations from knowledge_search details', () => {
    const presentation = buildToolPresentation({ toolName: 'knowledge_search', details });
    expect(presentation.knowledge?.citations).toEqual([citation]);
  });

  it('attaches citations from knowledge_read details', () => {
    const presentation = buildToolPresentation({ toolName: 'knowledge_read', details });
    expect(presentation.knowledge?.citations[0]?.ref).toBe(1);
  });

  it('ignores knowledge_list and unrelated tools carrying the same shape', () => {
    expect(buildToolPresentation({ toolName: 'knowledge_list', details }).knowledge).toBeUndefined();
    expect(buildToolPresentation({ toolName: 'read_file', details }).knowledge).toBeUndefined();
  });

  it('omits citations when details are not knowledge citations', () => {
    const presentation = buildToolPresentation({
      toolName: 'knowledge_search',
      details: { kind: 'other', citations: [citation] },
    });
    expect(presentation.knowledge).toBeUndefined();
  });

  it('carries citations through tool/end event mapping', () => {
    const [event] = mapToolExecutionEndEvent({
      toolCallId: 'call-1',
      toolName: 'knowledge_search',
      result: { content: [{ type: 'text', text: '[1] docs · guide/intro.md:3' }], details },
    });
    if (event?.type !== 'tool/end') throw new Error('expected a tool/end event');
    expect(event.presentation?.knowledge?.citations).toEqual([citation]);
  });
});
