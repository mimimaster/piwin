import type { AgentEvent, ToolPresentation } from '@piwin/contracts';
import {
  boundToolOutput,
  buildToolPresentation,
  parseShellStatusLine,
  resolvePresentedToolInvocation,
} from './tool-presentation.js';
import {
  extractToolResultAttachments,
  extractToolResultHealthDetails,
  extractToolResultText,
} from './tool-result-extract.js';
import { normalizeToolOutputTruncation } from './tool-output-truncation.js';
import { asRecord, readNestedId, readString } from './pi-event-read.js';

export type ToolPresentationSeed = {
  effectiveToolName: string;
  effectiveArgs?: unknown;
  routedToolName?: string;
  startPresentation: ToolPresentation;
};

export function mapToolExecutionStartEvent(
  event: Record<string, unknown>,
  activeMessageId?: string | null,
  lastAssistantMessageId?: string | null,
): AgentEvent[] {
  const toolCallId = readString(event.toolCallId) ?? readString(event.id) ?? 'unknown';
  const toolName = readString(event.toolName) ?? readString(event.name) ?? 'unknown';
  const args = readToolCallArgs(event);
  const invocation = resolvePresentedToolInvocation(toolName, args);
  const presentation = buildToolPresentation({
    toolName: invocation.effectiveToolName,
    ...(invocation.effectiveArgs !== undefined ? { args: invocation.effectiveArgs } : {}),
    ...(invocation.routedToolName !== undefined
      ? { routedToolName: invocation.routedToolName }
      : {}),
  });
  const responseMessageId = resolveResponseMessageId(
    event,
    activeMessageId,
    lastAssistantMessageId,
  );
  return [
    {
      type: 'tool/start',
      toolCallId,
      toolName,
      ...(responseMessageId !== undefined ? { responseMessageId } : {}),
      presentation,
    },
  ];
}

export function mapToolExecutionUpdateEvent(
  event: Record<string, unknown>,
  activeMessageId?: string | null,
  lastAssistantMessageId?: string | null,
): AgentEvent[] {
  const toolCallId = readString(event.toolCallId) ?? readString(event.id) ?? 'unknown';
  const rawDelta =
    readString(event.delta) ??
    readString(event.output) ??
    extractToolResultText(event.partialResult) ??
    '';
  const delta = boundToolOutput(rawDelta).text;
  const responseMessageId = resolveResponseMessageId(
    event,
    activeMessageId,
    lastAssistantMessageId,
  );
  return [
    {
      type: 'tool/update',
      toolCallId,
      delta,
      ...(responseMessageId !== undefined ? { responseMessageId } : {}),
    },
  ];
}

export function mapToolExecutionEndEvent(
  event: Record<string, unknown>,
  activeMessageId?: string | null,
  lastAssistantMessageId?: string | null,
): AgentEvent[] {
  const toolCallId = readString(event.toolCallId) ?? readString(event.id) ?? 'unknown';
  const result = asRecord(event.result);
  const isError =
    typeof event.isError === 'boolean' ? event.isError : Boolean(event.error ?? result?.isError);
  const toolName = readString(event.toolName) ?? readString(event.name) ?? 'unknown';
  const outputText =
    readString(event.output) ??
    extractToolResultText(event.result) ??
    readString(event.delta) ??
    undefined;
  const exitCode =
    typeof event.exitCode === 'number'
      ? event.exitCode
      : typeof event.exit_code === 'number'
        ? event.exit_code
        : undefined;
  const args = readToolCallArgs(event);
  const invocation = resolvePresentedToolInvocation(toolName, args);
  const healthFields = extractToolResultHealthDetails(result?.details ?? event.details);
  const truncation = normalizeToolOutputTruncation(
    result?.details ?? event.details,
    invocation.effectiveArgs,
    invocation.effectiveToolName,
  );
  const resultDetails = result?.details ?? event.details;
  const presentation = buildToolPresentation({
    toolName: invocation.effectiveToolName,
    isError,
    ...(invocation.effectiveArgs !== undefined ? { args: invocation.effectiveArgs } : {}),
    ...(invocation.routedToolName !== undefined
      ? { routedToolName: invocation.routedToolName }
      : {}),
    ...(outputText !== undefined ? { outputText } : {}),
    ...(resultDetails !== undefined ? { details: resultDetails } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(healthFields.health !== undefined ? { health: healthFields.health } : {}),
    ...(healthFields.sensitivity !== undefined ? { sensitivity: healthFields.sensitivity } : {}),
    ...(truncation !== undefined ? { truncation } : {}),
  });
  // Pi's bash reports no exit code: a clean finish is 0, a failure carries it
  // in its trailing status line.
  if (presentation.exitCode === undefined && presentation.kind === 'shell') {
    const status = isError && outputText !== undefined ? parseShellStatusLine(outputText) : null;
    if (!isError) {
      presentation.exitCode = 0;
    } else if (status?.kind === 'exit') {
      presentation.exitCode = status.code;
    }
  }
  const attachments = extractToolResultAttachments(result?.details ?? event.details);
  const responseMessageId = resolveResponseMessageId(
    event,
    activeMessageId,
    lastAssistantMessageId,
  );
  return [
    {
      type: 'tool/end',
      toolCallId,
      isError,
      ...(responseMessageId !== undefined ? { responseMessageId } : {}),
      ...(attachments ? { attachments } : {}),
      presentation,
    },
  ];
}

export function enrichMappedToolEvent(
  event: AgentEvent,
  raw: Record<string, unknown>,
  state: {
    toolNamesById: Map<string, string>;
    presentationSeedsByToolId: Map<string, ToolPresentationSeed>;
    responseMessageIdsByToolId: Map<string, string>;
    rawToolOutputById: Map<string, string>;
  },
): AgentEvent {
  if (event.type === 'tool/start') {
    state.toolNamesById.set(event.toolCallId, event.toolName);
    const args = readToolCallArgs(raw);
    const invocation = resolvePresentedToolInvocation(event.toolName, args);
    const startPresentation = buildToolPresentation({
      toolName: invocation.effectiveToolName,
      ...(invocation.effectiveArgs !== undefined ? { args: invocation.effectiveArgs } : {}),
      ...(invocation.routedToolName !== undefined
        ? { routedToolName: invocation.routedToolName }
        : {}),
    });
    state.presentationSeedsByToolId.set(event.toolCallId, {
      effectiveToolName: invocation.effectiveToolName,
      ...(invocation.effectiveArgs !== undefined
        ? { effectiveArgs: invocation.effectiveArgs }
        : {}),
      ...(invocation.routedToolName !== undefined
        ? { routedToolName: invocation.routedToolName }
        : {}),
      startPresentation,
    });
    if (event.responseMessageId !== undefined) {
      state.responseMessageIdsByToolId.set(event.toolCallId, event.responseMessageId);
    }
    state.rawToolOutputById.set(event.toolCallId, '');
    return { ...event, presentation: startPresentation };
  }
  if (event.type === 'tool/update') {
    const rawDelta =
      typeof raw.delta === 'string'
        ? raw.delta
        : typeof raw.output === 'string'
          ? raw.output
          : (extractToolResultText(raw.partialResult) ?? event.delta);
    const fullOutput = `${state.rawToolOutputById.get(event.toolCallId) ?? ''}${rawDelta}`;
    const boundedOutput = boundToolOutput(fullOutput).text;
    state.rawToolOutputById.set(event.toolCallId, boundedOutput);
    const toolName = state.toolNamesById.get(event.toolCallId) ?? 'unknown';
    const seed = state.presentationSeedsByToolId.get(event.toolCallId);
    const responseMessageId =
      event.responseMessageId ?? state.responseMessageIdsByToolId.get(event.toolCallId);
    if (responseMessageId !== undefined) {
      state.responseMessageIdsByToolId.set(event.toolCallId, responseMessageId);
    }
    return {
      ...event,
      presentation: mergeSeededToolPresentation(
        seed?.startPresentation,
        buildToolPresentation({
          toolName: seed?.effectiveToolName ?? toolName,
          ...(seed?.routedToolName !== undefined ? { routedToolName: seed.routedToolName } : {}),
          outputText: boundedOutput,
        }),
      ),
      ...(responseMessageId !== undefined ? { responseMessageId } : {}),
    };
  }
  if (event.type === 'tool/end') {
    const toolName = state.toolNamesById.get(event.toolCallId) ?? 'unknown';
    const seed = state.presentationSeedsByToolId.get(event.toolCallId);
    const accumulated = state.rawToolOutputById.get(event.toolCallId) ?? '';
    const rawResult = asRecord(raw.result);
    const resultDetails = rawResult?.details ?? raw.details;
    const truncation =
      normalizeToolOutputTruncation(
        resultDetails,
        seed?.effectiveArgs ?? readToolCallArgs(raw),
        seed?.effectiveToolName ?? toolName,
      ) ?? event.presentation?.output?.truncation;
    const responseMessageId =
      event.responseMessageId ?? state.responseMessageIdsByToolId.get(event.toolCallId);
    state.toolNamesById.delete(event.toolCallId);
    state.presentationSeedsByToolId.delete(event.toolCallId);
    state.responseMessageIdsByToolId.delete(event.toolCallId);
    state.rawToolOutputById.delete(event.toolCallId);
    const existingOutput = event.presentation?.output?.text;
    if (existingOutput && existingOutput.length > 0) {
      return {
        ...event,
        ...(responseMessageId !== undefined ? { responseMessageId } : {}),
        presentation: mergeSeededToolPresentation(
          seed?.startPresentation,
          seed
            ? buildToolPresentation({
                toolName: seed.effectiveToolName,
                ...(seed.routedToolName !== undefined
                  ? { routedToolName: seed.routedToolName }
                  : {}),
                isError: event.isError,
                outputText: existingOutput,
                ...(resultDetails !== undefined ? { details: resultDetails } : {}),
                ...(truncation !== undefined ? { truncation } : {}),
                ...(event.presentation?.exitCode !== undefined
                  ? { exitCode: event.presentation.exitCode }
                  : {}),
              })
            : event.presentation!,
        ),
      };
    }
    if (accumulated.length > 0) {
      return {
        ...event,
        ...(responseMessageId !== undefined ? { responseMessageId } : {}),
        presentation: mergeSeededToolPresentation(
          seed?.startPresentation,
          buildToolPresentation({
            toolName: seed?.effectiveToolName ?? toolName,
            ...(seed?.routedToolName !== undefined ? { routedToolName: seed.routedToolName } : {}),
            isError: event.isError,
            outputText: accumulated,
            ...(resultDetails !== undefined ? { details: resultDetails } : {}),
            ...(truncation !== undefined ? { truncation } : {}),
          }),
        ),
      };
    }
    return {
      ...event,
      ...(responseMessageId !== undefined ? { responseMessageId } : {}),
      ...(event.presentation !== undefined
        ? {
            presentation: mergeSeededToolPresentation(seed?.startPresentation, event.presentation),
          }
        : {}),
    };
  }
  return event;
}

export function mergeSeededToolPresentation(
  seed: ToolPresentation | undefined,
  lifecycle: ToolPresentation,
): ToolPresentation {
  if (!seed) {
    return lifecycle;
  }
  const isError = lifecycle.error !== undefined;
  const merged: ToolPresentation = {
    ...seed,
    ...lifecycle,
    kind: seed.kind,
    title: seed.title,
    ...(seed.routedToolName !== undefined ? { routedToolName: seed.routedToolName } : {}),
    ...(seed.summary !== undefined ? { summary: seed.summary } : {}),
    ...(seed.inputPreview !== undefined ? { inputPreview: seed.inputPreview } : {}),
    ...(seed.command !== undefined ? { command: seed.command } : {}),
    ...(seed.targetPaths !== undefined ? { targetPaths: seed.targetPaths } : {}),
  };
  if (isError) {
    delete merged.changedPaths;
  } else if (seed.changedPaths !== undefined && merged.changedPaths === undefined) {
    merged.changedPaths = seed.changedPaths;
  }
  return merged;
}

export function readToolCallArgs(event: Record<string, unknown>): unknown {
  const nested = asRecord(event.toolCall) ?? asRecord(event.tool) ?? asRecord(event.call);
  const details = asRecord(event.details) ?? asRecord(asRecord(event.result)?.details);
  return (
    event.args ??
    event.arguments ??
    event.input ??
    event.parameters ??
    nested?.args ??
    nested?.arguments ??
    nested?.input ??
    nested?.parameters ??
    details?.args ??
    details?.arguments
  );
}

function resolveResponseMessageId(
  event: Record<string, unknown>,
  activeMessageId: string | null | undefined,
  lastAssistantMessageId: string | null | undefined,
): string | undefined {
  return (
    readString(event.responseMessageId) ??
    readString(event.messageId) ??
    readString(event.assistantMessageId) ??
    readNestedId(event, 'assistantMessage') ??
    activeMessageId ??
    lastAssistantMessageId ??
    undefined
  );
}
