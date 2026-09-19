/**
 * Tool schemas handed to the `code_search` search subagent.
 *
 * Copied from the schema extracted out of the Devin CLI 3000.2.17 binary
 * (`docs/research/devin-fast-context-restricted-exec-tools.json`), including
 * the descriptions, the `oneOf` command union and the quirk that the
 * `restricted_exec` description names only `rg, readfile, tree` while the
 * union also accepts `ls` and `glob`.
 *
 * `command1` is required; up to `maxCommands` slots are offered because the
 * binary builds the schema with a variable count.
 */

/** Command types the `restricted_exec` union accepts. */
export const CODE_SEARCH_COMMAND_TYPES = ['rg', 'readfile', 'tree', 'ls', 'glob'] as const;

export type CodeSearchCommandType = (typeof CODE_SEARCH_COMMAND_TYPES)[number];

/** JSON-schema-shaped tool descriptor for a provider tool-calling request. */
export type CodeSearchToolSchema = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export const CODE_SEARCH_RESTRICTED_EXEC_TOOL = 'restricted_exec';
export const CODE_SEARCH_ANSWER_TOOL = 'answer';

function commandSlotSchema(index: number): Record<string, unknown> {
  return {
    type: 'object',
    description: `Command ${index} to execute. Must be one of: rg, readfile, or tree.`,
    oneOf: [
      {
        properties: {
          type: {
            type: 'string',
            const: 'rg',
            description: 'Search for patterns in files using ripgrep.',
          },
          pattern: { type: 'string', description: 'The regex pattern to search for.' },
          path: { type: 'string', description: 'The path to search in.' },
          include: {
            type: 'array',
            items: { type: 'string' },
            description: 'File patterns to include.',
          },
          exclude: {
            type: 'array',
            items: { type: 'string' },
            description: 'File patterns to exclude.',
          },
        },
        required: ['type', 'pattern', 'path'],
      },
      {
        properties: {
          type: {
            type: 'string',
            const: 'readfile',
            description: 'Read contents of a file with optional line range.',
          },
          file: { type: 'string', description: 'Path to the file to read.' },
          start_line: { type: 'integer', description: 'Starting line number (1-indexed).' },
          end_line: { type: 'integer', description: 'Ending line number (1-indexed).' },
        },
        required: ['type', 'file'],
      },
      {
        properties: {
          type: {
            type: 'string',
            const: 'tree',
            description: 'Display directory structure as a tree.',
          },
          path: { type: 'string', description: 'Path to the directory.' },
          levels: { type: 'integer', description: 'Number of directory levels.' },
        },
        required: ['type', 'path'],
      },
      {
        properties: {
          type: {
            type: 'string',
            const: 'ls',
            description: 'List files in a directory.',
          },
          path: { type: 'string', description: 'Path to the directory.' },
          long_format: { type: 'boolean' },
          all: { type: 'boolean' },
        },
        required: ['type', 'path'],
      },
      {
        properties: {
          type: {
            type: 'string',
            const: 'glob',
            description: 'Find files matching a glob pattern.',
          },
          pattern: { type: 'string' },
          path: { type: 'string' },
          type_filter: { type: 'string', enum: ['file', 'directory', 'all'] },
        },
        required: ['type', 'pattern', 'path'],
      },
    ],
  };
}

/**
 * Build the subagent's two tools. `command2` … `command{maxCommands}` are
 * optional slots, matching the binary's parallel-command batching.
 */
export function buildCodeSearchToolSchemas(maxCommands: number): CodeSearchToolSchema[] {
  const slots = Math.max(1, Math.trunc(maxCommands));
  const properties: Record<string, unknown> = {};
  for (let index = 1; index <= slots; index += 1) {
    properties[`command${index}`] = commandSlotSchema(index);
  }
  return [
    {
      name: CODE_SEARCH_RESTRICTED_EXEC_TOOL,
      description: 'Execute restricted commands (rg, readfile, tree, ls, glob) in parallel.',
      parameters: {
        type: 'object',
        properties,
        required: ['command1'],
      },
    },
    {
      name: CODE_SEARCH_ANSWER_TOOL,
      description: 'Final answer with relevant files and line ranges.',
      parameters: {
        type: 'object',
        properties: {
          answer: { type: 'string', description: 'The final answer in XML format.' },
        },
        required: ['answer'],
      },
    },
  ];
}

/** Whether a model-supplied command type is one the union accepts. */
export function isCodeSearchCommandType(value: unknown): value is CodeSearchCommandType {
  return typeof value === 'string' && (CODE_SEARCH_COMMAND_TYPES as readonly string[]).includes(value);
}
