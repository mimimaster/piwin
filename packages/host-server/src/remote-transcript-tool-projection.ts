/**
 * Remote session/resume tool cards. Live HostPush already carries presentation
 * heads; hydrate used to drop them and leave a bare localized verb.
 */
import type { RemoteTranscriptTool, ToolPresentation } from '@piwin/contracts';
import {
  isToolKind,
  parsePlanDisplayPayload,
  projectBoundedHealthToolCardSummary,
} from '@piwin/contracts';
import { redactRemoteHostPaths } from './remote-redact.js';

const MAX_REMOTE_TRANSCRIPT_TOOLS = 24;
const MAX_REMOTE_TOOL_OUTPUT_BYTES = 16_384;

export function projectRemoteTranscriptTools(value: unknown): RemoteTranscriptTool[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const projected: RemoteTranscriptTool[] = [];
  for (const item of value) {
    if (projected.length >= MAX_REMOTE_TRANSCRIPT_TOOLS) {
      break;
    }
    const record = asRecord(item);
    if (
      record === undefined ||
      typeof record.toolCallId !== 'string' ||
      typeof record.toolName !== 'string' ||
      (record.status !== 'running' && record.status !== 'done' && record.status !== 'error')
    ) {
      continue;
    }
    const tool: RemoteTranscriptTool = {
      toolCallId: boundedString(record.toolCallId, 256),
      toolName: boundedString(record.toolName, 256),
      status: record.status,
      output: redactRemoteHostPaths(boundedString(record.output, MAX_REMOTE_TOOL_OUTPUT_BYTES)),
    };
    if (typeof record.runId === 'string' && record.runId.length > 0) {
      tool.runId = boundedString(record.runId, 256);
    }
    const presentation = projectRemoteToolPresentation(record.presentation);
    if (presentation !== undefined) {
      tool.presentation = presentation;
    }
    projected.push(tool);
  }
  return projected;
}

function projectRemoteToolPresentation(value: unknown): ToolPresentation | undefined {
  const record = asRecord(value);
  if (record === undefined || typeof record.title !== 'string' || record.title.length === 0) {
    return undefined;
  }
  const presentation: ToolPresentation = {
    kind: isToolKind(record.kind) ? record.kind : 'other',
    title: boundedString(redactRemoteHostPaths(record.title), 256),
  };
  copyBoundedRedactedString(record, 'routedToolName', presentation, 'routedToolName', 256);
  copyBoundedRedactedString(record, 'summary', presentation, 'summary', 512);
  copyBoundedRedactedString(record, 'inputPreview', presentation, 'inputPreview', 2_048);
  copyBoundedRedactedString(record, 'command', presentation, 'command', 4_096);
  copyBoundedRedactedString(record, 'actionVerb', presentation, 'actionVerb', 64);
  copyBoundedRedactedString(record, 'lineRange', presentation, 'lineRange', 64);
  copyBoundedRedactedString(record, 'countTag', presentation, 'countTag', 64);
  copyBoundedRedactedString(record, 'startedAt', presentation, 'startedAt', 128);
  copyBoundedRedactedString(record, 'endedAt', presentation, 'endedAt', 128);
  const targetPaths = projectRemotePaths(record.targetPaths);
  if (targetPaths !== undefined) {
    presentation.targetPaths = targetPaths;
  }
  const changedPaths = projectRemotePaths(record.changedPaths);
  if (changedPaths !== undefined) {
    presentation.changedPaths = changedPaths;
  }
  if (typeof record.durationMs === 'number' && Number.isFinite(record.durationMs)) {
    presentation.durationMs = Math.max(0, Math.round(record.durationMs));
  }
  if (typeof record.exitCode === 'number' && Number.isSafeInteger(record.exitCode)) {
    presentation.exitCode = record.exitCode;
  } else if (record.exitCode === null) {
    presentation.exitCode = null;
  }
  const error = asRecord(record.error);
  if (error !== undefined && typeof error.message === 'string') {
    const category =
      error.category === 'execution' ||
      error.category === 'permission' ||
      error.category === 'timeout' ||
      error.category === 'cancelled' ||
      error.category === 'unknown'
        ? error.category
        : 'unknown';
    presentation.error = {
      category,
      message: boundedString(redactRemoteHostPaths(error.message), 240),
    };
  }
  if (record.sensitivity === 'health') {
    presentation.sensitivity = 'health';
  }
  const health = projectBoundedHealthToolCardSummary(record.health);
  if (health !== undefined) {
    presentation.health = health;
  }
  const plan = parsePlanDisplayPayload(record.plan);
  if (plan !== null) {
    presentation.plan = plan;
  }
  return presentation;
}

function copyBoundedRedactedString<T>(
  source: Record<string, unknown>,
  sourceKey: string,
  target: T,
  targetKey: keyof T,
  maxBytes: number,
): void {
  const value = source[sourceKey];
  if (typeof value === 'string' && value.length > 0) {
    target[targetKey] = boundedString(redactRemoteHostPaths(value), maxBytes) as T[keyof T];
  }
}

function projectRemotePaths(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const paths: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) {
      continue;
    }
    paths.push(boundedString(item, 16_384));
    if (paths.length >= 24) {
      break;
    }
  }
  return paths.length > 0 ? paths : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function boundedString(value: unknown, maxBytes: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) {
    return value;
  }
  return `${value.slice(0, Math.max(0, Math.floor(maxBytes / 2)))}…`;
}
