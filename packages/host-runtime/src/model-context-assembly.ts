import { randomUUID } from 'node:crypto';
import type {
  ContentRef,
  ContextSummaryContribution,
  ContextSummaryPush,
  ModelContextContributionKind,
  ModelContextTrustOrigin,
  ModelRequestClass,
} from '@piwin/contracts';
import {
  displayPathFromHostPath,
  estimateHostTokens,
} from '@piwin/contracts';

export type AssemblyContributionInput = {
  kind: ModelContextContributionKind;
  label: string;
  trustOrigin: ModelContextTrustOrigin;
  text?: string;
  hostPath?: string;
  reason?: string;
  rawKind?: string;
  contentRef?: ContentRef;
};

export type ModelPromptAssembly = {
  add(input: AssemblyContributionInput): void;
  toSummary(input: {
    sessionId: string;
    runId: string;
    requestClass: ModelRequestClass;
    requestOrdinal: number;
    coverage?: ContextSummaryPush['coverage'];
    userMessageId?: string;
  }): ContextSummaryPush;
};

const PREVIEW_CHARS = 200;

export function createModelPromptAssembly(): ModelPromptAssembly {
  const contributions: ContextSummaryContribution[] = [];

  return {
    add(input) {
      const preview =
        input.text !== undefined && input.text.length > 0
          ? input.text.length > PREVIEW_CHARS
            ? `${input.text.slice(0, PREVIEW_CHARS)}…`
            : input.text
          : undefined;
      const estimatedTokens =
        input.text !== undefined ? estimateHostTokens(input.text) : undefined;
      const displayPath =
        input.hostPath !== undefined ? displayPathFromHostPath(input.hostPath) : undefined;
      const contribution: ContextSummaryContribution = {
        id: randomUUID(),
        kind: input.kind,
        label: input.label,
        trustOrigin: input.trustOrigin,
        canOpenOnClient: false,
        redactionState: input.hostPath !== undefined ? 'path' : 'none',
      };
      if (input.contentRef !== undefined) {
        contribution.contentRef = { ...input.contentRef };
      }
      if (estimatedTokens !== undefined) {
        contribution.estimatedTokens = estimatedTokens;
      }
      if (displayPath !== undefined && displayPath.length > 0) {
        contribution.displayPath = displayPath;
      }
      if (preview !== undefined) {
        contribution.preview = preview;
      }
      if (input.reason !== undefined) {
        contribution.reason = input.reason;
      }
      if (input.rawKind !== undefined) {
        contribution.rawKind = input.rawKind;
      }
      contribution.resourceRef = contribution.id;
      contributions.push(contribution);
    },
    toSummary(input) {
      const totalEstimatedTokens = contributions.reduce(
        (sum, item) => sum + (item.estimatedTokens ?? 0),
        0,
      );
      const summary: ContextSummaryPush = {
        type: 'agent/context-summary',
        sessionId: input.sessionId,
        runId: input.runId,
        requestClass: input.requestClass,
        requestOrdinal: input.requestOrdinal,
        coverage: input.coverage ?? 'assembly-only',
        estimateSource: 'host-estimate',
        contributions: contributions.map((item) => ({ ...item })),
      };
      if (totalEstimatedTokens > 0) {
        summary.totalEstimatedTokens = totalEstimatedTokens;
      }
      if (input.userMessageId !== undefined && input.userMessageId.length > 0) {
        summary.userMessageId = input.userMessageId;
      }
      return summary;
    },
  };
}
