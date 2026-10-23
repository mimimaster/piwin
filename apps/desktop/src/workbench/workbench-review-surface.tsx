/**
 * Review inspector surface: the right-panel Changes tab. One scope picker
 * covers this turn's sealed record, the workspace Git tree (uncommitted /
 * staged / unstaged), commit history, and subagent results.
 *
 * 本轮变更 shows the sealed record of the turn a card opened; it never falls
 * back to the Git working tree, which also holds other turns' and the user's
 * edits. ⋯ → 代码撤销记录 stays the undo fallback.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { HostPush, SubagentResultSummary } from '@piwin/contracts';
import type { ReviewResultsHost } from '../hooks/use-review-subagent-results';
import type { HostRequestAdapters } from '../host/host-request-adapters';
import type { DesktopLocale } from '../i18n/desktop-locale';
import { DeferredChangesPanel, DeferredGitPanel } from '../conversation/deferred-desktop-surfaces';
import type { ChangesScope } from '../turn-changes/changes-scope';
import { RemoteUnavailableSurface } from '../host/remote-unavailable-surface';
import { SubagentUnresolvedEntry } from '../agents/subagent-unresolved-entry';
import { SubagentCandidateCard } from '../agents/subagent-candidate-card';
import { useReviewSubagentResults } from '../hooks/use-review-subagent-results';
import { deriveSubagentReviewLoopView } from '../agents/subagent-orchestration-view';
import { resolveSubagentReviewActionGate } from '../agents/subagent-review-summary-model';
import { TurnChangePanel } from '../turn-changes/turn-change-panel.js';
import { useTurnChangesApi } from '../turn-changes/turn-changes-context.js';
import { useTurnChangeRecordEntry } from '../turn-changes/use-turn-change-record-entry.js';

export type WorkbenchReviewSurfaceProps = {
  hostClient: ReviewResultsHost & {
    request: (command: import('@piwin/contracts').HostCommand, options?: { idempotencyKey?: string }) => Promise<import('@piwin/contracts').HostResponse>;
    /** Server messages; turn-change pushes refresh the undo record. */
    subscribe?: (listener: (message: { type: string }) => void) => () => void;
  };
  projectPath: string | null;
  locale: DesktopLocale;
  activeSessionId: string | null;
  requestGit: HostRequestAdapters['requestGit'];
};

export function WorkbenchReviewSurface(props: WorkbenchReviewSurfaceProps): ReactElement {
  const { hostClient, projectPath, locale, activeSessionId, requestGit } = props;
  const reviewResults = useReviewSubagentResults(hostClient, activeSessionId);
  const turnChanges = useTurnChangesApi();
  const focused = turnChanges?.focusedChangeSetId ?? null;
  const focusRequest = turnChanges?.focusRequest ?? 0;
  // 查看变更 on a turn card opens that turn's record; otherwise the panel
  // keeps whatever scope the person picked (default: uncommitted).
  const [scope, setScope] = useState<{ scope: ChangesScope; request: number } | undefined>(undefined);
  useEffect(() => {
    if (focused !== null) setScope({ scope: 'turn', request: focusRequest });
  }, [focused, focusRequest]);
  const subscribeHost = hostClient.subscribe;
  const subscribeTurnChangePush = useCallback(
    (listener: (push: HostPush) => void) =>
      subscribeHost?.((message) => {
        if (message.type === 'turn-changes/operation-updated' || message.type === 'turn-changes/updated') {
          listener(message as HostPush);
        }
      }) ?? (() => undefined),
    [subscribeHost],
  );
  const uiLocale = locale === 'zh-CN' ? 'zh-CN' : 'en';
  const record = useTurnChangeRecordEntry({
    hostClient,
    subscribePush: subscribeTurnChangePush,
    projectPath,
    locale: uiLocale,
    turnChangesSupported: turnChanges !== null,
  });
  if (!hostClient.supportsCommand('git/status')) {
    return <RemoteUnavailableSurface feature="review" locale={locale} />;
  }
  const focusedSummary = focused !== null ? turnChanges?.index.summaries.get(focused) : undefined;
  return (
    <>
      <DeferredChangesPanel
        projectPath={projectPath}
        request={requestGit as never}
        locale={uiLocale}
        {...(turnChanges !== null
          ? {
              turn: {
                content: <TurnChangePanel projectPath={projectPath} locale={uiLocale} />,
                tally:
                  focusedSummary !== undefined
                    ? {
                        files: focusedSummary.fileCount ?? 0,
                        additions: focusedSummary.additions,
                        deletions: focusedSummary.deletions,
                      }
                    : null,
              },
            }
          : {})}
        history={<DeferredGitPanel projectPath={projectPath} request={requestGit as never} variant="embedded" />}
        {...(reviewResults.results.length > 0
          ? {
              result: (
                <ReviewResultList
                  results={reviewResults.results}
                  locale={uiLocale}
                  onRequestResolution={reviewResults.requestResolution}
                  onAdopt={reviewResults.adoptCandidate}
                />
              ),
            }
          : {})}
        moreMenuItems={record.menuItem}
        {...(scope !== undefined ? { scope: scope.scope, scopeRequest: scope.request } : {})}
        {...(reviewResults.resultId !== undefined ? { resultId: reviewResults.resultId } : {})}
        {...(reviewResults.changeSetId !== undefined ? { changeSetId: reviewResults.changeSetId } : {})}
      />
      {record.dialog}
    </>
  );
}

function ReviewResultList(props: {
  results: SubagentResultSummary[];
  locale: 'zh-CN' | 'en';
  onRequestResolution: (resultId: string) => void;
  onAdopt: (input: { resultId: string; candidateGroupId: string }) => void;
}): ReactElement {
  const candidatesByGroup = new Map<string, SubagentResultSummary[]>();
  const unresolved: SubagentResultSummary[] = [];
  for (const result of props.results) {
    if (result.deliveryIntent === 'candidate' && result.candidateGroupId) {
      const group = candidatesByGroup.get(result.candidateGroupId) ?? [];
      group.push(result);
      candidatesByGroup.set(result.candidateGroupId, group);
      continue;
    }
    if (result.integrationStatus !== 'applied') {
      unresolved.push(result);
    }
  }
  const parentSessionId = props.results[0]?.parentSessionId ?? '';
  const reviewView = deriveSubagentReviewLoopView({
    parentSessionId,
    invocations: {},
    results: Object.fromEntries(props.results.map((result) => [result.resultId, result])),
  });
  const gateFor = (result: SubagentResultSummary) => {
    const loop = reviewView.loops.find(
      (candidate) =>
        candidate.headResultId === result.resultId ||
        candidate.rows.some((row) => row.resultId === result.resultId),
    );
    const row = loop?.rows.find(
      (candidate) => candidate.resultId === result.resultId && candidate.kind !== 'review',
    );
    if (loop === undefined || row === undefined) {
      return {
        applyEnabled: result.availability.apply.allowed,
        resolveEnabled: result.availability.resolve.allowed,
        reason: result.availability.apply.reason ?? result.availability.resolve.reason,
      };
    }
    return resolveSubagentReviewActionGate({
      loop,
      row,
      result,
      locale: props.locale,
    });
  };
  return (
    <div className="review-result-list" data-testid="review-result-list">
      {unresolved.map((result) => {
        const gate = gateFor(result);
        return (
          <SubagentUnresolvedEntry
            key={result.resultId}
            resultId={result.resultId}
            title={result.taskId}
            locale={props.locale}
            disabled={!gate.resolveEnabled}
            {...(gate.reason !== undefined ? { reason: gate.reason } : {})}
            onRequestResolution={props.onRequestResolution}
          />
        );
      })}
      {[...candidatesByGroup.entries()].map(([groupId, members]) => (
        <SubagentCandidateCard
          key={groupId}
          candidateGroupId={groupId}
          candidates={members.map((member) => {
            const gate = gateFor(member);
            return {
              resultId: member.resultId,
              title: member.taskId,
              applyEnabled: gate.applyEnabled,
              ...(gate.reason !== undefined ? { applyReason: gate.reason } : {}),
            };
          })}
          locale={props.locale}
          onAdopt={props.onAdopt}
        />
      ))}
    </div>
  );
}
