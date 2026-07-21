import Type from 'typebox';
import type { HostToolDefinition } from '@piwin/tools-web';

/**
 * Pi ToolDefinition-compatible shape.
 * Kept loose so we do not force Pi types into every test path.
 */
export type PiCustomToolDefinition = {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
    details: Record<string, unknown>;
  }>;
};

/**
 * Convert a piwin host tool into a Pi customTools entry.
 * Uses the `typebox` package (Pi 0.80 parameter schema requirement).
 */
export function toPiCustomTool(tool: HostToolDefinition): PiCustomToolDefinition {
  const parameters = parametersForHostTool(tool);
  const definition: PiCustomToolDefinition = {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters,
    async execute(toolCallId, params, signal) {
      const text = await tool.execute(params ?? {}, signal);
      const truncated =
        text.length > 120_000 ? `${text.slice(0, 120_000)}\n…[truncated]` : text;
      return {
        content: [{ type: 'text', text: truncated }],
        details: {
          toolName: tool.name,
          toolCallId,
          byteSize: truncated.length,
        },
      };
    },
  };
  if (tool.name === 'web_search' || tool.name === 'web_fetch') {
    definition.promptSnippet = tool.description;
  }
  return definition;
}

export function toPiCustomTools(tools: HostToolDefinition[]): PiCustomToolDefinition[] {
  return tools.map(toPiCustomTool);
}

function parametersForHostTool(tool: HostToolDefinition): unknown {
  if (tool.name === 'web_search') {
    return Type.Object({
      query: Type.String({ description: 'Search query' }),
    });
  }
  if (tool.name === 'web_fetch') {
    return Type.Object({
      url: Type.String({ description: 'HTTP(S) URL to fetch' }),
    });
  }
  if (tool.name === 'piwin_plan_set_step') {
    return Type.Object({
      stepId: Type.String({ description: 'Plan step id' }),
      status: Type.String({ description: 'pending | active | done | skipped' }),
      note: Type.Optional(Type.String({ description: 'Optional short note' })),
    });
  }
  if (tool.name === 'process_start') {
    return Type.Object({
      command: Type.String({ description: 'Executable to run (no shell)' }),
      argv: Type.Array(Type.String(), { description: 'Arguments after executable' }),
      cwd: Type.String({ description: 'Working directory under trusted project' }),
      label: Type.Optional(Type.String({ description: 'Optional UI label' })),
    });
  }
  if (tool.name === 'process_list') {
    return Type.Object({
      sessionId: Type.Optional(Type.String()),
      projectPath: Type.Optional(Type.String()),
    });
  }
  if (tool.name === 'process_logs') {
    return Type.Object({
      processId: Type.String({ description: 'Managed process id' }),
      offset: Type.Optional(Type.Number()),
      limit: Type.Optional(Type.Number()),
    });
  }
  if (tool.name === 'process_stop') {
    return Type.Object({
      processId: Type.String({ description: 'Managed process id' }),
    });
  }
  // MCP / generic tools: free-form object arguments
  return Type.Record(Type.String(), Type.Any());
}
