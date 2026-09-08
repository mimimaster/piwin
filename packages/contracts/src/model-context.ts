/**
 * Model Visibility Ledger (M1): assembly transparency contracts.
 * Does not claim the model observed the provider payload.
 */

export type ModelContextCoverage =
  | 'assembly-only'
  | 'payload-observed'
  | 'canonical-verified'
  | 'capture-missed'
  | 'unsupported'
  | 'redacted'
  | 'unknown';

export type ModelRequestClass =
  | 'prompt'
  | 'tool-loop'
  | 'steer'
  | 'run-intervention'
  | 'follow-up'
  | 'pause-resume'
  | 'compaction'
  | 'vision-delegate'
  | 'search-delegate'
  | 'subagent'
  | 'side-chat-sync'
  | 'other';

export type ModelContextTrustOrigin =
  | 'piwin'
  | 'user'
  | 'local-file'
  | 'project'
  | 'external-web'
  | 'mcp'
  | 'tool'
  | 'subagent'
  | 'unknown';

export type ModelContextContributionKind =
  | 'user'
  | 'context-ref'
  | 'side-chat'
  | 'attachment-text'
  | 'web-element'
  | 'vision-description'
  | 'image-path'
  | 'native-image'
  | 'agent-mode'
  | 'orchestration'
  | 'active-plan'
  | 'files-touched'
  | 'product-history'
  | 'runtime-observed'
  /** Explicit slash/mention Skill activation (SKILL.md body). */
  | 'skill'
  | 'other';

export type ModelContextRedactionState = 'none' | 'path' | 'body' | 'full';

export type ContentRef = {
  digest: `sha256:${string}`;
  mediaType: string;
  encoding: 'identity' | 'zstd';
  byteLength: number;
};

export type ModelContextContribution = {
  id: string;
  kind: ModelContextContributionKind;
  contentRef?: ContentRef;
  estimatedTokens?: number;
  placement: 'base' | 'prepend' | 'append' | 'attachment';
  trustOrigin: ModelContextTrustOrigin;
  label: string;
  resourceRef?: string;
  displayPath?: string;
  canOpenOnClient: boolean;
  redactionState: ModelContextRedactionState;
  preview?: string;
  reason?: string;
  rawKind?: string;
};

export type ContextSummaryContribution = {
  id: string;
  kind: ModelContextContributionKind;
  label: string;
  trustOrigin: ModelContextTrustOrigin;
  /** Internal-safe content identity used by the ledger's explicit Blob refs. */
  contentRef?: ContentRef;
  estimatedTokens?: number;
  resourceRef?: string;
  displayPath?: string;
  canOpenOnClient: boolean;
  redactionState: ModelContextRedactionState;
  preview?: string;
  reason?: string;
  rawKind?: string;
};

/** Real-time assembly summary. Never includes Host absolute paths or raw payloads. */
export type ContextSummaryPush = {
  type: 'agent/context-summary';
  sessionId: string;
  runId: string;
  requestClass: ModelRequestClass;
  requestOrdinal: number;
  coverage: Extract<ModelContextCoverage, 'assembly-only' | 'capture-missed' | 'redacted'>;
  estimateSource: 'host-estimate';
  /** Product user row this capsule belongs under. Absent for Host-authored resumes. */
  userMessageId?: string;
  totalEstimatedTokens?: number;
  reportedPromptTokens?: number;
  usageSource?: 'pi-contextUsage' | 'assistant-usage' | 'host-estimate';
  contributions: ContextSummaryContribution[];
};

export type ModelContextSummaryData = {
  sessionId: string;
  coverage: ModelContextCoverage;
  summaries: ContextSummaryPush[];
};

export type ModelContextEventType =
  | 'generation/open'
  | 'turn/input'
  | 'surface/checkpoint'
  | 'surface/append'
  | 'surface/replace'
  | 'request/header'
  | 'request/dispatch'
  | 'capture/missed'
  | 'replay/checkpoint';

export const MODEL_CONTEXT_COVERAGES: readonly ModelContextCoverage[] = [
  'assembly-only',
  'payload-observed',
  'canonical-verified',
  'capture-missed',
  'unsupported',
  'redacted',
  'unknown',
];

export function isModelContextCoverage(value: unknown): value is ModelContextCoverage {
  return (
    typeof value === 'string' &&
    (MODEL_CONTEXT_COVERAGES as readonly string[]).includes(value)
  );
}

/** Host-estimate: Unicode code points / 4, minimum 1 for non-empty text. */
export function estimateHostTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return Math.max(1, Math.ceil([...text].length / 4));
}

export function displayPathFromHostPath(hostPath: string): string {
  const trimmed = hostPath.trim();
  if (trimmed.length === 0) {
    return '';
  }
  const parts = trimmed.split(/[/\\]/).filter((part) => part.length > 0);
  const last = parts[parts.length - 1];
  return last ?? trimmed;
}
