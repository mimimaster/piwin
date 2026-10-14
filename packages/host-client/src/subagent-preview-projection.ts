/**
 * Pure projection for the dense subagent preview, shared by every shell
 * (Desktop proto-14 ③, TUI `/subagents` preview). Shells only paint it.
 *
 * The preview is deliberately not the main transcript: no Markdown, no tool
 * cards, no diffs or artifacts. Every step of the child becomes one plain
 * line (`time · verb · target · result`), the task and the final report are
 * plain text. Every value comes from Host-normalized data; a field the Host
 * did not send is omitted rather than invented.
 */
import type {
  AgentMessageRole,
  SessionSummary,
  SubagentInvocation,
  ToolPresentation,
} from '@piwin/contracts';
import {
  firstTextLine,
  formatSubagentTokens,
  formatSubagentToolCalls,
  withoutSuccessVerdict,
  type SubagentTextLocale,
} from './subagent-report-text.js';

/** The child's coarse status as the preview reports it. */
export type SubagentPreviewStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** One child tool call, in the shape every shell already holds. */
export type SubagentStepTool = {
  toolCallId: string;
  toolName: string;
  status: 'running' | 'done' | 'error';
  presentation?: ToolPresentation | undefined;
};

/** One child message (persisted history or a retained live segment). */
export type SubagentStepMessage = {
  id: string;
  role: AgentMessageRole;
  text: string;
  thinking: string;
  tools: readonly SubagentStepTool[];
};

/** The child's current, not yet persisted assistant message. */
export type SubagentStepTail = {
  id: string;
  text: string;
  thinking: string;
  tools: readonly SubagentStepTool[];
};

/** Most recent lines kept; older ones fold into one "N earlier steps" line. */
export const SUBAGENT_PREVIEW_MAX_LINES = 200;

/** Upper bound for one line's text; CSS ellipsizes long before this. */
const LINE_TEXT_MAX = 240;

export type SubagentPreviewLine =
  | {
      kind: 'tool';
      key: string;
      offset: string;
      verb: string;
      target: string;
      result: string;
      status: SubagentStepTool['status'];
    }
  | { kind: 'say' | 'think'; key: string; offset: string; text: string };

export type SubagentPreviewOutcome = {
  tone: 'done' | 'failed';
  label: string;
  text: string;
};

export type SubagentPreviewView = {
  /** role · model · N 次工具调用 · Xk tok — each only when the Host sent it. */
  meta: string[];
  statusLabel: string;
  live: boolean;
  task: string;
  lines: SubagentPreviewLine[];
  /** Lines folded away before `lines`. */
  elidedCount: number;
  outcome?: SubagentPreviewOutcome;
  startedAt?: string;
  endedAt?: string;
};

export type SubagentPreviewInput = {
  status: SubagentPreviewStatus;
  messages: readonly SubagentStepMessage[];
  liveTail: SubagentStepTail | null;
  invocation?: SubagentInvocation | undefined;
  child?: SessionSummary | undefined;
  /** Fallback task text when neither invocation nor child carries one. */
  taskSummary?: string | undefined;
  /** Shell-resolved display name of the child's model (shells own model catalogs). */
  modelLabel?: string | undefined;
  showThinking: boolean;
  locale: SubagentTextLocale;
  maxLines?: number;
};

const STATUS_LABEL: Record<SubagentTextLocale, Record<SubagentPreviewStatus, string>> = {
  'zh-CN': {
    queued: '排队中',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  },
  en: {
    queued: 'Queued',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
  },
};

function clip(text: string): string {
  return text.length > LINE_TEXT_MAX ? `${text.slice(0, LINE_TEXT_MAX - 1)}…` : text;
}

/** `m:ss` from the child's start; empty when either end is unknown. */
export function formatPreviewOffset(baseMs: number, at: string | undefined): string {
  if (at === undefined || !Number.isFinite(baseMs)) return '';
  const atMs = Date.parse(at);
  if (!Number.isFinite(atMs)) return '';
  const seconds = Math.max(0, Math.floor((atMs - baseMs) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function relativePath(path: string, root: string | undefined): string {
  if (!root) return path;
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function toolTarget(tool: SubagentStepTool, root: string | undefined): string {
  const presentation = tool.presentation;
  const path = presentation?.targetPaths?.[0];
  const pathTarget =
    path !== undefined
      ? `${relativePath(path, root)}${presentation?.lineRange ? `:${presentation.lineRange}` : ''}`
      : undefined;
  const candidates = [
    presentation?.command,
    pathTarget,
    presentation?.inputPreview,
    presentation?.summary,
    presentation?.title,
  ];
  for (const candidate of candidates) {
    const line = firstTextLine(candidate);
    if (line) return clip(line);
  }
  return '';
}

function toolResult(tool: SubagentStepTool): string {
  if (tool.status === 'running') return '';
  const presentation = tool.presentation;
  const exitCode = presentation?.exitCode;
  const failedExit = exitCode !== undefined && exitCode !== null && exitCode !== 0;
  if (tool.status === 'error') {
    if (failedExit) return `exit ${exitCode}`;
    return clip(firstTextLine(presentation?.error?.message));
  }
  if (presentation?.countTag) return presentation.countTag;
  return failedExit ? `exit ${exitCode}` : '';
}

/**
 * One tool call as a step line. Exported so a shell can show "the step it is
 * on now" with exactly the preview's wording.
 */
export function projectSubagentToolLine(
  tool: SubagentStepTool,
  baseMs: number = Number.NaN,
  root?: string,
): Extract<SubagentPreviewLine, { kind: 'tool' }> {
  return {
    kind: 'tool',
    key: tool.toolCallId,
    offset: formatPreviewOffset(baseMs, tool.presentation?.startedAt),
    verb: tool.presentation?.routedToolName ?? tool.toolName,
    target: toolTarget(tool, root),
    result: toolResult(tool),
    status: tool.status,
  };
}

function linesFromParts(
  parts: SubagentStepTail,
  input: SubagentPreviewInput,
  baseMs: number,
  root: string | undefined,
): SubagentPreviewLine[] {
  const lines: SubagentPreviewLine[] = [];
  const thinking = input.showThinking ? firstTextLine(parts.thinking) : '';
  if (thinking) {
    lines.push({ kind: 'think', key: `${parts.id}:think`, offset: '', text: clip(thinking) });
  }
  // A bare success verdict (`complete`) says nothing a status label does not.
  const text = firstTextLine(withoutSuccessVerdict(parts.text));
  if (text) lines.push({ kind: 'say', key: `${parts.id}:say`, offset: '', text: clip(text) });
  for (const tool of parts.tools) lines.push(projectSubagentToolLine(tool, baseMs, root));
  return lines;
}

function lastAssistantText(messages: readonly SubagentStepMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'assistant' && message.text.trim()) return message.text.trim();
  }
  return '';
}

function resolveOutcome(input: SubagentPreviewInput): SubagentPreviewOutcome | undefined {
  const zh = input.locale === 'zh-CN';
  const activity = input.invocation?.activity;
  if (input.status === 'failed') {
    const reason =
      (activity?.kind === 'failed' ? activity.message?.trim() : undefined) ||
      (zh ? '子任务失败' : 'Subtask failed');
    return { tone: 'failed', label: zh ? '失败' : 'Failed', text: reason };
  }
  if (input.status !== 'completed') return undefined;
  // The child's final message is the full report; the Host activity and the
  // session summary are bounded previews used until history has loaded.
  const report =
    lastAssistantText(input.messages) ||
    (activity?.kind === 'completed' ? activity.summary?.trim() : undefined) ||
    (activity?.kind === 'needs-integration' ? activity.message?.trim() : undefined) ||
    input.child?.summaryPreview?.trim() ||
    '';
  const text = withoutSuccessVerdict(report).trim();
  if (!text) return undefined;
  return { tone: 'done', label: zh ? '结论' : 'Result', text };
}

function resolveMeta(input: SubagentPreviewInput): string[] {
  const meta: string[] = [];
  const role =
    input.invocation?.role?.trim() ||
    input.child?.subagentRole?.trim() ||
    input.invocation?.profileId?.trim() ||
    input.child?.subagentProfileId?.trim();
  if (role) meta.push(role);
  const model = input.invocation?.model ?? input.child?.subagentModel;
  const modelLabel = input.modelLabel?.trim() || model?.modelId;
  if (modelLabel) meta.push(modelLabel);
  const usage = input.invocation?.usage;
  if (usage !== undefined && Number.isFinite(usage.toolCalls)) {
    meta.push(formatSubagentToolCalls(usage.toolCalls, input.locale));
    if (Number.isFinite(usage.totalTokens) && usage.totalTokens > 0) {
      meta.push(formatSubagentTokens(usage.totalTokens));
    }
  }
  return meta;
}

export function deriveSubagentPreview(input: SubagentPreviewInput): SubagentPreviewView {
  const startedAt = input.invocation?.createdAt;
  const baseMs = startedAt !== undefined ? Date.parse(startedAt) : Number.NaN;
  const root = input.child?.workingDirectory;
  const all: SubagentPreviewLine[] = [];
  for (const message of input.messages) {
    if (message.role !== 'assistant') continue;
    all.push(...linesFromParts(message, input, baseMs, root));
  }
  if (input.liveTail !== null) all.push(...linesFromParts(input.liveTail, input, baseMs, root));
  const maxLines = input.maxLines ?? SUBAGENT_PREVIEW_MAX_LINES;
  const elidedCount = Math.max(0, all.length - maxLines);
  const live = input.status === 'running' || input.status === 'queued';
  const outcome = resolveOutcome(input);
  const endedAt = input.invocation?.updatedAt;
  return {
    meta: resolveMeta(input),
    statusLabel: STATUS_LABEL[input.locale][input.status],
    live,
    task: (input.invocation?.task ?? input.child?.task ?? input.taskSummary ?? '').trim(),
    lines: elidedCount > 0 ? all.slice(elidedCount) : all,
    elidedCount,
    ...(outcome !== undefined ? { outcome } : {}),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(!live && endedAt !== undefined ? { endedAt } : {}),
  };
}
