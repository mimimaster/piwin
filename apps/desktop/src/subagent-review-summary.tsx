/**
 * Connected review/repair tree for transcript and Tasks.
 * Indentation follows F1 row order. Invocation cards stay the inspect surface.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Button, StatusBadge } from '@piwin/ui-kit';
import type {
  SubagentResultSummary,
  SubagentReviewRecord,
  SubagentTaskResult,
} from '@piwin/contracts';
import type { SubagentInspectorSelection } from './subagent-activity-model';
import type { SubagentReviewLoop, SubagentReviewLoopRow } from './subagent-review-loop-view';
import {
  boundReviewFindings,
  collectReviewsFromTaskResults,
  isSafeRelativeFindingPath,
  resolveSubagentReviewActionGate,
  reviewForRow,
  reviewLoopRowCopy,
  reviewLoopRowDepth,
  reviewLoopVerificationCopy,
  shouldPresentReviewLoop,
  shouldShowVerificationRow,
  type DesktopLocaleTag,
} from './subagent-review-summary-model';

export type SubagentReviewSummaryProps = {
  loop: SubagentReviewLoop;
  locale?: DesktopLocaleTag;
  enabled?: boolean;
  reviews?: Record<string, SubagentReviewRecord>;
  taskResults?: Record<string, SubagentTaskResult>;
  results?: Record<string, SubagentResultSummary>;
  onInspect?: (selection: SubagentInspectorSelection) => void;
  onApply?: (resultId: string) => void;
  onRequestResolution?: (resultId: string) => void;
};

function findingLocation(finding: {
  relativePath?: string;
  line?: number;
}): string | undefined {
  if (finding.relativePath === undefined || !isSafeRelativeFindingPath(finding.relativePath)) {
    return undefined;
  }
  return finding.line !== undefined
    ? `${finding.relativePath}:${String(finding.line)}`
    : finding.relativePath;
}

function ReviewFindings(props: {
  review: SubagentReviewRecord;
  locale: DesktopLocaleTag;
  expanded: boolean;
}): ReactElement | null {
  const findings = boundReviewFindings(props.review.findings);
  const zh = props.locale === 'zh-CN';
  if (!props.expanded) {
    return null;
  }
  return (
    <div data-testid="subagent-review-findings">
      {findings.length === 0 ? (
        <p className="subagent-review-findings-empty">{zh ? '无审查项' : 'No findings'}</p>
      ) : (
        <ol className="subagent-review-findings">
          {findings.map((finding) => {
            const location = findingLocation(finding);
            return (
              <li
                key={finding.id}
                className="subagent-review-finding"
                data-testid="subagent-review-finding"
                data-finding-id={finding.id}
                data-severity={finding.severity}
              >
                <span className="subagent-review-finding-severity">{finding.severity}</span>
                <span className="subagent-review-finding-title">{finding.title}</span>
                {location !== undefined ? (
                  <span className="subagent-review-finding-path">{location}</span>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function LoopRowActions(props: {
  resultId: string;
  locale: DesktopLocaleTag;
  applyEnabled: boolean;
  resolveEnabled: boolean;
  reason?: string;
  onApply?: (resultId: string) => void;
  onRequestResolution?: (resultId: string) => void;
}): ReactElement | null {
  if (props.onApply === undefined && props.onRequestResolution === undefined) {
    return null;
  }
  const zh = props.locale === 'zh-CN';
  return (
    <span className="subagent-review-row-actions">
      {props.onApply !== undefined ? (
        <Button
          size="compact"
          variant="secondary"
          disabled={!props.applyEnabled}
          data-testid="subagent-review-apply"
          onClick={() => {
            if (props.applyEnabled) {
              props.onApply?.(props.resultId);
            }
          }}
        >
          {zh ? '合入' : 'Apply'}
        </Button>
      ) : null}
      {props.onRequestResolution !== undefined ? (
        <Button
          size="compact"
          variant="ghost"
          disabled={!props.resolveEnabled}
          data-testid="subagent-review-resolve"
          onClick={() => {
            if (props.resolveEnabled) {
              props.onRequestResolution?.(props.resultId);
            }
          }}
        >
          {zh ? '让主代理处理' : 'Request resolution'}
        </Button>
      ) : null}
      {props.reason !== undefined ? (
        <span
          className="subagent-review-stale-reason"
          data-testid="subagent-review-stale-reason"
        >
          {props.reason}
        </span>
      ) : null}
    </span>
  );
}

function LoopRow(props: {
  loop: SubagentReviewLoop;
  row: SubagentReviewLoopRow;
  index: number;
  locale: DesktopLocaleTag;
  reviews?: Record<string, SubagentReviewRecord>;
  result?: SubagentResultSummary;
  onInspect?: (selection: SubagentInspectorSelection) => void;
  onApply?: (resultId: string) => void;
  onRequestResolution?: (resultId: string) => void;
}): ReactElement {
  const copy = reviewLoopRowCopy({ row: props.row, locale: props.locale });
  const review = props.row.kind === 'review' ? reviewForRow(props.row, props.reviews) : undefined;
  const [expanded, setExpanded] = useState(false);
  const depth = reviewLoopRowDepth(props.index);
  const gate =
    props.row.kind === 'review' || props.row.resultId === undefined
      ? undefined
      : resolveSubagentReviewActionGate({
          loop: props.loop,
          row: props.row,
          locale: props.locale,
          ...(props.result !== undefined ? { result: props.result } : {}),
        });
  const canInspect = props.row.childSessionId !== undefined && props.onInspect !== undefined;
  const label = `${copy.prefix}${copy.title}: ${copy.status}`;

  const inspect = (): void => {
    if (props.row.childSessionId === undefined || props.onInspect === undefined) {
      return;
    }
    props.onInspect({
      childSessionId: props.row.childSessionId,
      displayName: copy.title,
      taskSummary: props.row.title,
      anchorId: props.row.invocationId ?? props.row.resultId ?? props.row.id,
    });
  };

  return (
    <li
      className="subagent-review-loop-row"
      data-testid="subagent-review-loop-row"
      data-row-kind={props.row.kind}
      data-row-id={props.row.id}
      data-depth={String(depth)}
      {...(props.row.invocationId !== undefined
        ? { 'data-invocation-id': props.row.invocationId }
        : {})}
      {...(props.row.runId !== undefined ? { 'data-run-id': props.row.runId } : {})}
      {...(props.row.resultId !== undefined ? { 'data-result-id': props.row.resultId } : {})}
      {...(props.row.childSessionId !== undefined
        ? { 'data-child-session-id': props.row.childSessionId }
        : {})}
      {...(props.row.candidateGeneration !== null
        ? { 'data-candidate-generation': String(props.row.candidateGeneration) }
        : {})}
      style={{ ['--subagent-review-depth' as string]: String(depth) }}
    >
      <div className="subagent-review-loop-row-main" aria-label={label}>
        <span className="subagent-review-loop-indent" aria-hidden="true">
          {depth > 0 ? '└─' : ''}
        </span>
        <span className="subagent-review-loop-copy">
          <span className="subagent-review-loop-title">
            <span className="subagent-review-loop-prefix">{copy.prefix}</span>
            {copy.title}
          </span>
          <span className="subagent-review-loop-status" data-testid="subagent-review-row-status">
            {copy.status}
          </span>
          {review !== undefined && review.findings.length > 0 ? (
            <Button
              size="compact"
              variant="ghost"
              aria-expanded={expanded}
              data-testid="subagent-review-expand"
              onClick={() => {
                setExpanded((current) => !current);
              }}
            >
              {props.locale === 'zh-CN' ? (expanded ? '收起' : '展开') : expanded ? 'Hide' : 'Show'}
            </Button>
          ) : null}
          {canInspect ? (
            <Button
              size="compact"
              variant="ghost"
              data-testid="subagent-review-inspect"
              onClick={inspect}
            >
              {props.locale === 'zh-CN' ? '查看' : 'Inspect'}
            </Button>
          ) : null}
        </span>
        {gate !== undefined && props.row.resultId !== undefined ? (
          <LoopRowActions
            resultId={props.row.resultId}
            locale={props.locale}
            applyEnabled={gate.applyEnabled}
            resolveEnabled={gate.resolveEnabled}
            {...(gate.reason !== undefined ? { reason: gate.reason } : {})}
            {...(props.onApply !== undefined ? { onApply: props.onApply } : {})}
            {...(props.onRequestResolution !== undefined
              ? { onRequestResolution: props.onRequestResolution }
              : {})}
          />
        ) : null}
      </div>
      {review !== undefined ? (
        <ReviewFindings review={review} locale={props.locale} expanded={expanded} />
      ) : null}
    </li>
  );
}

export function SubagentReviewSummary(props: SubagentReviewSummaryProps): ReactElement | null {
  if (props.enabled === false || !shouldPresentReviewLoop(props.loop)) {
    return null;
  }
  const locale = props.locale ?? 'zh-CN';
  const reviews = useMemo(
    () => collectReviewsFromTaskResults(props.taskResults, props.reviews),
    [props.reviews, props.taskResults],
  );
  const verification = shouldShowVerificationRow(props.loop)
    ? reviewLoopVerificationCopy({ loop: props.loop, locale })
    : undefined;
  const incomplete = props.loop.applied && !props.loop.delivered;
  const phaseLabel =
    props.loop.phase === null
      ? locale === 'zh-CN'
        ? '已完成'
        : 'Complete'
      : props.loop.phase;

  return (
    <section
      className="subagent-review-summary"
      data-testid="subagent-review-summary"
      data-loop-id={props.loop.loopId}
      data-phase={props.loop.phase ?? 'complete'}
      data-applied={props.loop.applied ? 'true' : 'false'}
      data-delivered={props.loop.delivered ? 'true' : 'false'}
      data-incomplete={incomplete ? 'true' : 'false'}
      aria-label={
        locale === 'zh-CN'
          ? `审查与返工：${phaseLabel}`
          : `Review and repair: ${phaseLabel}`
      }
    >
      <ol className="subagent-review-loop">
        {props.loop.rows.map((row, index) => (
          <LoopRow
            key={row.id}
            loop={props.loop}
            row={row}
            index={index}
            locale={locale}
            {...(Object.keys(reviews).length > 0 ? { reviews } : {})}
            {...(row.resultId !== undefined && props.results?.[row.resultId] !== undefined
              ? { result: props.results[row.resultId] }
              : {})}
            {...(props.onInspect !== undefined ? { onInspect: props.onInspect } : {})}
            {...(props.onApply !== undefined ? { onApply: props.onApply } : {})}
            {...(props.onRequestResolution !== undefined
              ? { onRequestResolution: props.onRequestResolution }
              : {})}
          />
        ))}
        {verification !== undefined ? (
          <li
            className="subagent-review-loop-row is-verification"
            data-testid="subagent-review-verification"
            data-row-kind="verification"
            data-depth={String(props.loop.rows.length)}
            data-incomplete={verification.incomplete ? 'true' : 'false'}
            style={{ ['--subagent-review-depth' as string]: String(props.loop.rows.length) }}
          >
            <div className="subagent-review-loop-row-main">
              <span className="subagent-review-loop-indent" aria-hidden="true">
                {props.loop.rows.length > 0 ? '└─' : ''}
              </span>
              <span className="subagent-review-loop-copy">
                <span className="subagent-review-loop-title">{verification.title}</span>
                <span
                  className="subagent-review-loop-status"
                  data-testid="subagent-review-verification-status"
                >
                  {verification.status}
                </span>
                {props.loop.delivered ? (
                  <StatusBadge
                    tone="success"
                    label={locale === 'zh-CN' ? '已交付' : 'Delivered'}
                    testId="subagent-review-delivered-badge"
                  />
                ) : null}
              </span>
            </div>
          </li>
        ) : null}
      </ol>
    </section>
  );
}
