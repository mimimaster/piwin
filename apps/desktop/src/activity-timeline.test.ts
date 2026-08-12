import { describe, expect, it } from 'vitest';
import type { ToolCardUi } from './chat-reducer';
import {
  classifyToolHistoryCategory,
  countExploreFiles,
  exploreGroupLabel,
  extractSearchInfo,
  formatFilePillPath,
  groupToolsByHistoryCategory,
  groupToolsForTimeline,
  isExploreLikeTool,
  toolHistoryCategoryLabel,
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
    expect(segments.map((segment) => segment.kind)).toEqual(['explore', 'tool', 'explore']);
  });
});

describe('tool history categories', () => {
  it('maps normalized tool actions into stable rollup categories', () => {
    const fixtures: Array<[ToolCardUi, string]> = [
      [
        makeTool({
          toolCallId: 'read',
          toolName: 'read_file',
          presentation: { kind: 'filesystem', title: 'Read', actionVerb: 'Read' },
        }),
        'explore',
      ],
      [
        makeTool({
          toolCallId: 'edit',
          toolName: 'write_file',
          presentation: { kind: 'filesystem', title: 'Write', actionVerb: 'Edited' },
        }),
        'edit',
      ],
      [
        makeTool({
          toolCallId: 'command',
          toolName: 'bash',
          presentation: { kind: 'shell', title: 'Bash', actionVerb: 'Ran command' },
        }),
        'command',
      ],
      [
        makeTool({
          toolCallId: 'web',
          toolName: 'web_fetch',
          presentation: { kind: 'web', title: 'Fetch', actionVerb: 'Fetched' },
        }),
        'web',
      ],
      [
        makeTool({
          toolCallId: 'mcp',
          toolName: 'mcp__docs__lookup',
          presentation: { kind: 'mcp', title: 'Lookup', actionVerb: 'MCP call' },
        }),
        'mcp',
      ],
      [
        makeTool({
          toolCallId: 'image',
          toolName: 'image_gen',
          presentation: { kind: 'other', title: 'Image', actionVerb: 'Generated image' },
        }),
        'generation',
      ],
      [
        makeTool({
          toolCallId: 'delegate',
          toolName: 'subagent_run',
          presentation: { kind: 'other', title: 'Delegate', actionVerb: 'Delegated' },
        }),
        'delegate',
      ],
    ];

    for (const [tool, expected] of fixtures) {
      expect(classifyToolHistoryCategory(tool)).toBe(expected);
    }
  });

  it('groups tools in stable category order while preserving order within a category', () => {
    const commandA = makeTool({ toolCallId: 'command-a', toolName: 'bash' });
    const read = makeTool({ toolCallId: 'read', toolName: 'read_file' });
    const commandB = makeTool({ toolCallId: 'command-b', toolName: 'run_bash' });

    const groups = groupToolsByHistoryCategory([commandA, read, commandB]);
    expect(groups.map((group) => group.category)).toEqual(['explore', 'command']);
    expect(groups[1]?.tools.map((tool) => tool.toolCallId)).toEqual(['command-a', 'command-b']);
    expect(toolHistoryCategoryLabel('explore', 'zh-CN')).toBe('读取与搜索');
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
    expect(exploreGroupLabel({ fileCount: 2, locale: 'en', isActive: true })).toBe(
      'Exploring... 2 files',
    );
  });
});

describe('search helpers', () => {
  it('extracts search query, directory, and matched files', () => {
    const tool = makeTool({
      toolCallId: 's1',
      toolName: 'grep_search',
      presentation: {
        kind: 'filesystem',
        title: 'Search',
        actionVerb: 'Searched',
        summary: 'McpPanel|McpServerEditorDialog',
        inputPreview: JSON.stringify({
          Query: 'McpPanel|McpServerEditorDialog',
          SearchPath: '/workspace/apps/desktop',
          Includes: ['*.test.{ts,tsx}'],
        }),
        output: {
          text: JSON.stringify([
            { file: 'apps/desktop/src/composer-dock.test.tsx' },
            { file: 'apps/desktop/src/composer-plus-menu.test.tsx' },
          ]),
        },
      },
    });

    const info = extractSearchInfo(tool, '/workspace');
    expect(info.query).toBe('McpPanel|McpServerEditorDialog');
    expect(info.dir).toBe('apps/desktop');
    expect(info.pattern).toBe('*.test.{ts,tsx}');
    expect(info.count).toBe(2);
    expect(info.matchedFiles).toEqual([
      'apps/desktop/src/composer-dock.test.tsx',
      'apps/desktop/src/composer-plus-menu.test.tsx',
    ]);
  });

  it('formats file pill display path with leading slash relative to search dir', () => {
    const formatted = formatFilePillPath(
      'apps/desktop/src/composer-dock.test.tsx',
      'apps/desktop',
      '/workspace',
    );
    expect(formatted.absolutePath).toBe('/workspace/apps/desktop/src/composer-dock.test.tsx');
    expect(formatted.relativePath).toBe('apps/desktop/src/composer-dock.test.tsx');
    expect(formatted.displayPath).toBe('/src/composer-dock.test.tsx');
  });
});
