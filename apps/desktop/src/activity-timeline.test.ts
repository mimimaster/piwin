import { describe, expect, it } from 'vitest';
import type { ToolCardUi } from './chat-reducer';
import {
  countExploreFiles,
  exploreGroupLabel,
  groupToolsForTimeline,
  isExploreLikeTool,
} from './activity-timeline';

function makeTool(
  overrides: Partial<ToolCardUi> & Pick<ToolCardUi, 'toolCallId' | 'toolName'>,
): ToolCardUi {
  return {
    status: 'done',
    output: '',
    ...overrides,
  };
}

describe('isExploreLikeTool', () => {
  it('treats Read/Searched/Explored verbs as explore', () => {
    expect(
      isExploreLikeTool(
        makeTool({
          toolCallId: '1',
          toolName: 'custom',
          presentation: { kind: 'filesystem', title: 'Read', actionVerb: 'Read' },
        }),
      ),
    ).toBe(true);
    expect(
      isExploreLikeTool(
        makeTool({
          toolCallId: '2',
          toolName: 'custom',
          presentation: { kind: 'filesystem', title: 'Search', actionVerb: 'Searched' },
        }),
      ),
    ).toBe(true);
  });

  it('does not treat shell/edit as explore', () => {
    expect(
      isExploreLikeTool(
        makeTool({
          toolCallId: '3',
          toolName: 'bash',
          presentation: { kind: 'shell', title: 'Bash', actionVerb: 'Ran command' },
        }),
      ),
    ).toBe(false);
    expect(
      isExploreLikeTool(
        makeTool({
          toolCallId: '4',
          toolName: 'write',
          presentation: { kind: 'filesystem', title: 'Write', actionVerb: 'Edited' },
        }),
      ),
    ).toBe(false);
  });
});

describe('groupToolsForTimeline', () => {
  it('keeps a single read as a normal tool row', () => {
    const read = makeTool({
      toolCallId: 'r1',
      toolName: 'read',
      presentation: {
        kind: 'filesystem',
        title: 'Read',
        actionVerb: 'Read',
        targetPaths: ['a.ts'],
      },
    });
    expect(groupToolsForTimeline([read])).toEqual([{ kind: 'tool', tool: read }]);
  });

  it('batches consecutive reads into an explore segment', () => {
    const reads = ['a.ts', 'b.ts', 'c.ts'].map((path, index) =>
      makeTool({
        toolCallId: `r${index}`,
        toolName: 'read',
        presentation: {
          kind: 'filesystem',
          title: 'Read',
          actionVerb: 'Read',
          targetPaths: [path],
        },
      }),
    );
    const shell = makeTool({
      toolCallId: 's1',
      toolName: 'bash',
      presentation: { kind: 'shell', title: 'Bash', actionVerb: 'Ran command' },
    });

    const segments = groupToolsForTimeline([...reads, shell]);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ kind: 'explore', fileCount: 3 });
    expect(segments[0]?.kind === 'explore' && segments[0].tools).toHaveLength(3);
    expect(segments[1]).toEqual({ kind: 'tool', tool: shell });
  });

  it('splits explore batches when a non-explore tool interrupts', () => {
    const readA = makeTool({
      toolCallId: 'a',
      toolName: 'read',
      presentation: {
        kind: 'filesystem',
        title: 'Read',
        actionVerb: 'Read',
        targetPaths: ['a.ts'],
      },
    });
    const readB = makeTool({
      toolCallId: 'b',
      toolName: 'read',
      presentation: {
        kind: 'filesystem',
        title: 'Read',
        actionVerb: 'Read',
        targetPaths: ['b.ts'],
      },
    });
    const shell = makeTool({
      toolCallId: 's',
      toolName: 'bash',
      presentation: { kind: 'shell', title: 'Bash', actionVerb: 'Ran command' },
    });
    const readC = makeTool({
      toolCallId: 'c',
      toolName: 'read',
      presentation: {
        kind: 'filesystem',
        title: 'Read',
        actionVerb: 'Read',
        targetPaths: ['c.ts'],
      },
    });
    const readD = makeTool({
      toolCallId: 'd',
      toolName: 'read',
      presentation: {
        kind: 'filesystem',
        title: 'Read',
        actionVerb: 'Read',
        targetPaths: ['d.ts'],
      },
    });

    const segments = groupToolsForTimeline([readA, readB, shell, readC, readD]);
    expect(segments.map((segment) => segment.kind)).toEqual([
      'explore',
      'tool',
      'explore',
    ]);
  });
});

describe('countExploreFiles / exploreGroupLabel', () => {
  it('counts unique paths', () => {
    const tools = [
      makeTool({
        toolCallId: '1',
        toolName: 'read',
        presentation: {
          kind: 'filesystem',
          title: 'Read',
          actionVerb: 'Read',
          targetPaths: ['a.ts'],
        },
      }),
      makeTool({
        toolCallId: '2',
        toolName: 'read',
        presentation: {
          kind: 'filesystem',
          title: 'Read',
          actionVerb: 'Read',
          targetPaths: ['a.ts', 'b.ts'],
        },
      }),
    ];
    expect(countExploreFiles(tools)).toBe(2);
  });

  it('localizes explore labels', () => {
    expect(exploreGroupLabel({ fileCount: 5, locale: 'en', isActive: false })).toBe(
      'Explored 5 files',
    );
    expect(exploreGroupLabel({ fileCount: 5, locale: 'zh-CN', isActive: false })).toBe(
      '已探查 5 个文件',
    );
    expect(exploreGroupLabel({ fileCount: 2, locale: 'en', isActive: true })).toBe(
      'Exploring... 2 files',
    );
  });
});
