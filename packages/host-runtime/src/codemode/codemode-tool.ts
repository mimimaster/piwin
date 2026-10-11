/**
 * Host-owned `piwin_codemode` registration.
 *
 * Nested calls go through the real session port with a host-built
 * script-readonly restriction. Model arguments cannot supply that context.
 */

import {
  CODEMODE_TOOL_NAME,
  type CodemodeConfig,
  type HostToolExecutionInput,
  type HostToolExecutionResult,
  type HostToolRegistration,
  type ToolResult,
} from '@piwin/contracts';
import {
  parseCodemodeSource,
  type CodemodeEngineTool,
  runCodemodeScript,
} from '@piwin/agent-host';
import { normalizeGenerationToolCallId } from '@piwin/agent-host';
import { compileAdmittedScriptTools } from './script-readonly-admission.js';

export const HOST_TOOLBOX_CALL_NAME = 'piwin_toolbox';

export type CodemodeSurfaceReader = {
  execute(input: HostToolExecutionInput, signal: AbortSignal): Promise<HostToolExecutionResult>;
  readActiveRegistrations(
    sessionId: string,
    runtimeGenerationId: string,
  ):
    | {
        direct: readonly HostToolRegistration[];
        toolboxTargets: readonly HostToolRegistration[];
      }
    | undefined;
};

export function buildCodemodeTool(input: {
  config: CodemodeConfig;
  port: CodemodeSurfaceReader;
}): HostToolRegistration {
  return {
    descriptor: {
      name: CODEMODE_TOOL_NAME,
      description: codemodeDescription(),
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description:
              'JavaScript async function body. Call admitted read-only tools as await tools.<name>(args). Use tools.piwin_toolbox for bounded discovery and calls. store/load do not persist.',
          },
        },
        required: ['code'],
        additionalProperties: false,
      },
    },
    family: 'codemode',
    permissionSpec: {
      action: 'codemode:run',
      risk: 'unknown',
      rememberable: false,
      readOnly: true,
    },
    fileEffect: { kind: 'none' },
    async execute(args, signal, context): Promise<ToolResult> {
      if (!context.toolCallId) {
        return {
          ok: false,
          code: 'invalid-input',
          message: 'codemode requires a host tool call id',
        };
      }
      const code = args.code;
      if (typeof code !== 'string' || code.trim().length === 0) {
        return { ok: false, code: 'invalid-input', message: 'codemode code must be a non-empty string' };
      }
      let source: string;
      let timeoutMs = input.config.timeoutMs;
      try {
        const parsed = parseCodemodeSource(code);
        source = parsed.code;
        if (parsed.options.timeoutMs !== undefined) {
          timeoutMs = Math.min(input.config.timeoutMs, parsed.options.timeoutMs);
        }
      } catch (error) {
        return {
          ok: false,
          code: 'invalid-input',
          message: error instanceof Error ? error.message : 'invalid codemode source',
        };
      }
      const surface = input.port.readActiveRegistrations(context.sessionId, context.runtimeGenerationId);
      if (!surface) {
        return {
          ok: false,
          code: 'tool-not-available',
          message: 'codemode generation surface is not registered',
        };
      }
      const compiled = compileAdmittedScriptTools(
        [...surface.direct, ...surface.toolboxTargets],
        input.config.maxTools,
      );
      const admittedNames = compiled.admitted.map((tool) => tool.descriptor.name);
      const nested: Array<{
        name: string;
        toolCallId: string;
        parentToolCallId: string;
        status: 'ok' | 'error' | 'cancelled';
      }> = [];
      let ordinal = 0;
      const engineTools: CodemodeEngineTool[] = compiled.admitted.map((tool) => ({
        name: tool.descriptor.name,
        description: tool.descriptor.description,
        inputSchema: tool.descriptor.parameters,
        execute: (toolArgs, toolContext) =>
          dispatchNested({
            port: input.port,
            context,
            parentToolCallId: context.toolCallId ?? '',
            toolName: tool.descriptor.name,
            toolArgs,
            signal: toolContext.signal,
            admittedNames,
            nested,
            nextOrdinal: () => {
              ordinal += 1;
              return ordinal;
            },
          }),
      }));
      if (surface.direct.some((tool) => tool.descriptor.name === HOST_TOOLBOX_CALL_NAME)) {
        engineTools.push({
          name: HOST_TOOLBOX_CALL_NAME,
          description: 'Search, describe, or call an admitted read-only tool or read-only MCP tool.',
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              query: { type: 'string' },
              target: { type: 'string' },
              arguments: { type: 'object' },
              limit: { type: 'number' },
            },
            required: ['action'],
          },
          execute: (toolArgs, toolContext) =>
            dispatchNested({
              port: input.port,
              context,
              parentToolCallId: context.toolCallId ?? '',
              toolName: HOST_TOOLBOX_CALL_NAME,
              toolArgs,
              signal: toolContext.signal,
              admittedNames,
              nested,
              nextOrdinal: () => {
                ordinal += 1;
                return ordinal;
              },
            }),
        });
      }
      const result = await runCodemodeScript({
        code: source,
        tools: engineTools,
        limits: {
          timeoutMs,
          memoryLimitBytes: input.config.memoryLimitBytes,
          maxCalls: input.config.maxCalls,
          maxConcurrency: input.config.maxConcurrency,
          maxOutputChars: input.config.maxOutputChars,
        },
        signal,
      });
      const details = {
        calls: nested,
        invocationLocalStore: true,
        ...(compiled.omittedNames.length > 0 ? { omittedTools: compiled.omittedNames } : {}),
        ...(result.truncated ? { truncated: true } : {}),
      };
      if (!result.ok) {
        const kind = result.error?.kind;
        return {
          ok: false,
          code: kind === 'aborted' ? 'aborted' : 'execution-failed',
          message: result.error?.message ?? 'codemode failed',
          cancelled: kind === 'aborted',
          details: { ...details, ...(kind ? { reason: kind } : {}) },
        };
      }
      return { ok: true, output: result.outputText, details };
    },
  };
}

async function dispatchNested(input: {
  port: CodemodeSurfaceReader;
  context: { sessionId: string; runtimeGenerationId: string; runId: string };
  parentToolCallId: string;
  toolName: string;
  toolArgs: unknown;
  signal: AbortSignal;
  admittedNames: readonly string[];
  nested: Array<{
    name: string;
    toolCallId: string;
    parentToolCallId: string;
    status: 'ok' | 'error' | 'cancelled';
  }>;
  nextOrdinal: () => number;
}): Promise<unknown> {
  if (input.signal.aborted) {
    throw new Error('codemode call aborted before start');
  }
  const toolCallId = normalizeGenerationToolCallId(
    {
      sessionId: input.context.sessionId,
      runtimeGenerationId: input.context.runtimeGenerationId,
    },
    `${input.parentToolCallId}\u0000codemode\u0000${input.nextOrdinal()}`,
  );
  const record = isRecord(input.toolArgs) ? input.toolArgs : {};
  const result = await input.port.execute(
    {
      sessionId: input.context.sessionId,
      runtimeGenerationId: input.context.runtimeGenerationId,
      runId: input.context.runId,
      toolCallId,
      toolName: input.toolName,
      arguments: record,
      scriptInvocation: {
        kind: 'script-readonly',
        parentToolCallId: input.parentToolCallId,
        admittedToolNames: input.admittedNames,
      },
    },
    input.signal,
  );
  const status = result.ok
    ? input.signal.aborted
      ? 'cancelled'
      : 'ok'
    : result.code === 'aborted'
      ? 'cancelled'
      : 'error';
  input.nested.push({
    name: input.toolName,
    toolCallId,
    parentToolCallId: input.parentToolCallId,
    status,
  });
  if (!result.ok) {
    throw new Error(result.message);
  }
  if (result.scriptPayload?.isError === true) {
    throw new Error(result.output || 'tool error');
  }
  if (result.scriptPayload && Object.prototype.hasOwnProperty.call(result.scriptPayload, 'structuredContent')) {
    return result.scriptPayload.structuredContent;
  }
  return result.output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function codemodeDescription(): string {
  return [
    'Run a read-only JavaScript script. The code is an async function body: await and return work.',
    'Callable surface: await tools.<name>(args) for each admitted read-only Host tool, and await tools.piwin_toolbox({ action, query, target, arguments, limit }) for discovery and calls.',
    'Only compiled read-only tools are callable. Shell, browser, process, write, and unknown tools fail. MCP tools require annotations.readOnlyHint true; an absent hint is denied in scripts only.',
    'store and load are invocation-local and are not persisted. Nested codemode, images, and classifiers are not available.',
    'Tool errors reject inside the script. The model sees only the bounded script output, not nested payloads.',
  ].join(' ');
}
