/**
 * Reviewer-scoped structured review submit. One successful decision per Run.
 */
import type {
  HostToolRegistration,
  SubagentReviewDecision,
  SubagentReviewFinding,
  SubagentReviewRecord,
  SubagentResultRef,
  ToolResult,
} from '@piwin/contracts';
import { passThroughPrepareArgs } from './tools/pass-through-prepare-args.js';
import { parseSubagentResultRef } from './subagent-tool-input.js';
import type { SubagentReviewCapabilityScope } from './subagent-review-context.js';
import type { SubagentReviewService } from './subagent-review-service.js';

export const SUBAGENT_REVIEW_SUBMIT_TOOL_NAME = 'piwin_subagent_review_submit';

const SUBAGENT_REVIEW_DECISIONS = new Set<SubagentReviewDecision>(['approved', 'changes-requested', 'blocked']);
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const VERIFICATION_STATUSES = new Set(['passed', 'failed', 'not-run']);

export type SubagentReviewSubmitToolOptions = {
  scope: SubagentReviewCapabilityScope;
  reviewerSessionId: string;
  invocationId?: string;
  service: SubagentReviewService;
};

export const subagentReviewSubmitInputParameters = {
  type: 'object' as const,
  properties: {
    target: {
      type: 'object',
      description: 'Must be the exact Host-bound review target.',
      properties: {
        resultId: { type: 'string' },
        revision: { type: 'number' },
      },
      required: ['resultId', 'revision'],
    },
    decision: {
      type: 'string',
      enum: ['approved', 'changes-requested', 'blocked'],
      description: 'Structured reviewer decision for the bound result.',
    },
    findings: {
      type: 'array',
      description: 'Bounded findings. approved rejects critical/high; other decisions need a reason.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          title: { type: 'string' },
          detail: { type: 'string' },
          relativePath: { type: 'string' },
          line: { type: 'number' },
          evidence: { type: 'string' },
        },
        required: ['id', 'severity', 'title', 'detail'],
      },
    },
    verification: {
      type: 'array',
      description: 'Reviewer-local checks. These do not mark delivery as verified.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          status: { type: 'string', enum: ['passed', 'failed', 'not-run'] },
          evidence: { type: 'string' },
        },
        required: ['label', 'status'],
      },
    },
  },
  required: ['target', 'decision', 'findings', 'verification'] as const,
};

function reviewError(
  code: Extract<ToolResult, { ok: false }>['code'],
  message: string,
): Extract<ToolResult, { ok: false }> {
  return { ok: false, code, message };
}

function parseReviewFindings(value: unknown): { ok: true; value: SubagentReviewFinding[] } | Extract<ToolResult, { ok: false }> {
  if (!Array.isArray(value)) {
    return reviewError('invalid-input', 'findings must be an array');
  }
  const findings: SubagentReviewFinding[] = [];
  for (const [index, entry] of value.entries()) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return reviewError('invalid-input', `findings[${String(index)}] must be an object`);
    }
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const title = typeof record.title === 'string' ? record.title : '';
    const detail = typeof record.detail === 'string' ? record.detail : '';
    const severity = typeof record.severity === 'string' ? record.severity : '';
    if (!id) return reviewError('invalid-input', `findings[${String(index)}].id is required`);
    if (!SEVERITIES.has(severity)) {
      return reviewError('invalid-input', `findings[${String(index)}].severity is invalid`);
    }
    if (!title) return reviewError('invalid-input', `findings[${String(index)}].title is required`);
    if (!detail) return reviewError('invalid-input', `findings[${String(index)}].detail is required`);
    const finding: SubagentReviewFinding = {
      id,
      severity: severity as SubagentReviewFinding['severity'],
      title,
      detail,
    };
    if (typeof record.relativePath === 'string') finding.relativePath = record.relativePath;
    if (record.line !== undefined) {
      if (typeof record.line !== 'number') {
        return reviewError('invalid-input', `findings[${String(index)}].line must be a number`);
      }
      finding.line = record.line;
    }
    if (typeof record.evidence === 'string') finding.evidence = record.evidence;
    findings.push(finding);
  }
  return { ok: true, value: findings };
}

function parseReviewVerification(
  value: unknown,
): { ok: true; value: SubagentReviewRecord['verification'] } | Extract<ToolResult, { ok: false }> {
  if (!Array.isArray(value)) {
    return reviewError('invalid-input', 'verification must be an array');
  }
  const entries: SubagentReviewRecord['verification'] = [];
  for (const [index, entry] of value.entries()) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return reviewError('invalid-input', `verification[${String(index)}] must be an object`);
    }
    const record = entry as Record<string, unknown>;
    const label = typeof record.label === 'string' ? record.label.trim() : '';
    const status = typeof record.status === 'string' ? record.status : '';
    if (!label) return reviewError('invalid-input', `verification[${String(index)}].label is required`);
    if (!VERIFICATION_STATUSES.has(status)) {
      return reviewError('invalid-input', `verification[${String(index)}].status is invalid`);
    }
    entries.push({
      label,
      status: status as SubagentReviewRecord['verification'][number]['status'],
      ...(typeof record.evidence === 'string' ? { evidence: record.evidence } : {}),
    });
  }
  return { ok: true, value: entries };
}

export type ParsedReviewSubmitArgs = {
  target: SubagentResultRef;
  decision: SubagentReviewDecision;
  findings: SubagentReviewFinding[];
  verification: SubagentReviewRecord['verification'];
};

/** Shared by the reviewer-child and Lead variants of the submit tool. */
export function parseReviewSubmitArgs(
  args: Record<string, unknown>,
): { ok: true; value: ParsedReviewSubmitArgs } | Extract<ToolResult, { ok: false }> {
  const parsedTarget = parseSubagentResultRef(args.target, 'target');
  if (!parsedTarget.ok) return parsedTarget;
  const decisionRaw = String(args.decision ?? '').trim();
  if (!SUBAGENT_REVIEW_DECISIONS.has(decisionRaw as SubagentReviewDecision)) {
    return reviewError('invalid-input', 'decision must be approved, changes-requested, or blocked');
  }
  const findings = parseReviewFindings(args.findings);
  if (!findings.ok) return findings;
  const verification = parseReviewVerification(args.verification);
  if (!verification.ok) return verification;
  return {
    ok: true,
    value: {
      target: parsedTarget.value,
      decision: decisionRaw as SubagentReviewDecision,
      findings: findings.value,
      verification: verification.value,
    },
  };
}

export function createSubagentReviewSubmitTool(
  options: SubagentReviewSubmitToolOptions,
): HostToolRegistration {
  return {
    descriptor: {
      name: SUBAGENT_REVIEW_SUBMIT_TOOL_NAME,
      description:
        'Submit one structured review for the Host-bound candidate. ' +
        'Identical retries return the same review. A different decision is rejected.',
      parameters: subagentReviewSubmitInputParameters,
    },
    family: 'delegate',
    permissionSpec: {
      action: 'subagent:run',
      risk: 'unknown',
      rememberable: false,
      subjectBuilder: () => ({ kind: 'tool', action: 'subagent:run' }),
    },
    prepareArgs: passThroughPrepareArgs,
    async execute(args) {
      const parsed = parseReviewSubmitArgs(args);
      if (!parsed.ok) return parsed;

      const submitted = await options.service.submit({
        reviewerSessionId: options.reviewerSessionId,
        ...(options.invocationId ? { invocationId: options.invocationId } : {}),
        scope: options.scope,
        ...parsed.value,
      });
      if (!submitted.ok) return submitted;
      const { record } = submitted;
      return {
        ok: true,
        output: `review ${record.reviewId} ${record.decision}`,
        details: {
          reviewRef: { reviewId: record.reviewId, revision: record.revision },
          decision: record.decision,
          target: record.targetResult,
        },
      };
    },
  };
}
