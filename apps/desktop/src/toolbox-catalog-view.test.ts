import { describe, expect, it } from 'vitest';
import type { ToolCardUi } from './chat-reducer';
import {
  resolveToolboxCatalogView,
  toolboxCatalogResultMeta,
} from './toolbox-catalog-view';

function toolbox(partial: Partial<ToolCardUi> & { inputPreview?: string; actionVerb?: string }): ToolCardUi {
  const { inputPreview, actionVerb, ...rest } = partial;
  return {
    toolCallId: 'tb',
    toolName: 'piwin_toolbox',
    status: 'done',
    output: '',
    presentation: {
      kind: 'mcp',
      title: 'Tool catalog',
      actionVerb: actionVerb ?? 'Tool discovery',
      ...(inputPreview !== undefined ? { inputPreview } : {}),
    },
    ...rest,
  };
}

describe('resolveToolboxCatalogView', () => {
  it('projects a search into query + tool ids', () => {
    const view = resolveToolboxCatalogView(
      toolbox({
        inputPreview: '{"query":"library","action":"search"}',
        output: JSON.stringify(
          { tools: [{ id: 'flashcard_create' }, { id: 'library_search' }], truncated: false },
          null,
          2,
        ),
      }),
    );
    expect(view).toMatchObject({
      action: 'search',
      subject: 'library',
      hitIds: ['flashcard_create', 'library_search'],
      partial: false,
    });
    expect(view && toolboxCatalogResultMeta(view, 'done', 'zh-CN')).toBe('找到 2 个');
  });

  it('recovers ids from clipped JSON and marks the count as a floor', () => {
    const view = resolveToolboxCatalogView(
      toolbox({
        inputPreview: '{"query":"library","action":"search"}',
        output: '{\n  "tools": [\n    { "id": "flashcard_create", "source": "host", "description": "Crea',
      }),
    );
    expect(view?.hitIds).toEqual(['flashcard_create']);
    expect(view && toolboxCatalogResultMeta(view, 'done', 'en')).toBe('1+ found');
  });

  it('reads describe and status results', () => {
    const describe = resolveToolboxCatalogView(
      toolbox({
        inputPreview: '{"action":"describe","target":"github.create_issue"}',
        output: JSON.stringify({ name: 'github.create_issue', description: 'Create an issue\nMore' }),
      }),
    );
    expect(describe).toMatchObject({
      action: 'describe',
      subject: 'github.create_issue',
      description: 'Create an issue',
    });
    const status = resolveToolboxCatalogView(
      toolbox({
        actionVerb: 'MCP status',
        output: JSON.stringify({ servers: [{ serverId: 'github', status: 'ready' }] }),
      }),
    );
    expect(status?.servers).toEqual([{ serverId: 'github', state: 'ready' }]);
  });

  it('keeps toolbox calls and other tools on the normal row', () => {
    expect(
      resolveToolboxCatalogView(toolbox({ inputPreview: '{"action":"call","target":"x.y"}' })),
    ).toBeNull();
    expect(resolveToolboxCatalogView({ ...toolbox({}), toolName: 'read' })).toBeNull();
  });
});
