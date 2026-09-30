/**
 * Review inspector surface: this turn's recorded changes, subagent result,
 * and workspace Git (uncommitted changes + history).
 *
 * 本轮变更 shows the sealed record of the turn a card opened; it never falls
 * back to the Git working tree, which also holds other turns' and the user's
 * edits. Git keeps its own tab, with 更多 → 代码撤销记录.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { HostPush, SubagentResultSummary } from '@piwin/contracts';
import type { ReviewResultsHost } from './use-review-subagent-results';
import type { HostRequestAdapters } from './host-request-adapters';
import type { DesktopLocale } from './desktop-locale';
import {
  DeferredChangesPanel,
  DeferredGitPanel,
  DeferredReviewPanel,
} from './deferred-desktop-surfaces';
import type { ReviewPanelContext } from './review-panel';
import { RemoteUnavailableSurface } from './remote-unavailable-surface';
import { SubagentUnresolvedEntry } from './subagent-unresolved-entry';
import { SubagentCandidateCard } from './subagent-candidate-card';
import { useReviewSubagentResults } from './use-review-subagent-results';
import { deriveSubagentReviewLoopView } from './subagent-orchestration-view';
import { resolveSubagentReviewActionGate } from './subagent-review-summary-model';
import { TurnChangePanel } from './turn-changes/turn-change-panel.js';
import { useTurnChangesApi } from './turn-changes/turn-changes-context.js';
import { WorkspaceChangesSection } from './turn-changes/workspace-changes-section.js';

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
  // Without a turn-change Host (or before any card opened a turn), the first
  // tab keeps showing the workspace Git list, as before.
  const [context, setContext] = useState<{ tab: ReviewPanelContext; request: number } | undefined>(
    undefined,
  );
  useEffect(() => {
    if (focused !== null) setContext({ tab: 'this-turn', request: focusRequest });
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
  if (!hostClient.supportsCommand('git/status')) {
    return <RemoteUnavailableSurface feature="review" locale={locale} />;
  }
  const uiLocale = locale === 'zh-CN' ? 'zh-CN' : 'en';
  const workspaceChanges = (
    <WorkspaceChangesSection
      hostClient={hostClient}
      subscribePush={subscribeTurnChangePush}
      projectPath={projectPath}
      locale={uiLocale}
      turnChangesSupported={turnChanges !== null}
    >
      <DeferredChangesPanel projectPath={projectPath} request={requestGit as never} locale={locale} />
    </WorkspaceChangesSection>
  );
  return (
    <DeferredReviewPanel
      changesContent={
        turnChanges !== null ? (
          <TurnChangePanel
            projectPath={projectPath}
            locale={uiLocale}
            onShowWorkspaceChanges={() =>
              setContext((current) => ({ tab: 'git', request: (current?.request ?? 0) + 1 }))
            }
          />
        ) : (
          workspaceChanges
        )
      }
      gitContent={
        <>
          {turnChanges !== null ? workspaceChanges : null}
          <DeferredGitPanel projectPath={projectPath} request={requestGit as never} variant="embedded" />
        </>
      }
      {...(context !== undefined ? { context: context.tab, contextRequest: context.request } : {})}
      {...(reviewResults.results.length > 0
        ? {
            resultContent: (
              <ReviewResultList
                results={reviewResults.results}
                locale={uiLocale}
                onRequestResolution={reviewResults.requestResolution}
                onAdopt={reviewResults.adoptCandidate}
              />
            ),
          }
        : {})}
      {...(reviewResults.resultId !== undefined ? { resultId: reviewResults.resultId } : {})}
      {...(reviewResults.changeSetId !== undefined
        ? { changeSetId: reviewResults.changeSetId }
        : {})}
      locale={uiLocale}
    />
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
