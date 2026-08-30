/**
 * Review inspector surface: this-turn git changes, subagent result, workspace Git.
 */
import type { ReactElement } from 'react';
import type { SubagentResultSummary } from '@piwin/contracts';
import type { ReviewResultsHost } from './use-review-subagent-results';
import type { HostRequestAdapters } from './host-request-adapters';
import type { DesktopLocale } from './desktop-locale';
import {
  DeferredChangesPanel,
  DeferredGitPanel,
  DeferredReviewPanel,
} from './deferred-desktop-surfaces';
import { RemoteUnavailableSurface } from './remote-unavailable-surface';
import { SubagentUnresolvedEntry } from './subagent-unresolved-entry';
import { SubagentCandidateCard } from './subagent-candidate-card';
import { useReviewSubagentResults } from './use-review-subagent-results';

export type WorkbenchReviewSurfaceProps = {
  hostClient: ReviewResultsHost;
  projectPath: string | null;
  locale: DesktopLocale;
  activeSessionId: string | null;
  requestGit: HostRequestAdapters['requestGit'];
};

export function WorkbenchReviewSurface(props: WorkbenchReviewSurfaceProps): ReactElement {
  const { hostClient, projectPath, locale, activeSessionId, requestGit } = props;
  const reviewResults = useReviewSubagentResults(hostClient, activeSessionId);
  if (!hostClient.supportsCommand('git/status')) {
    return <RemoteUnavailableSurface feature="review" locale={locale} />;
  }
  return (
    <DeferredReviewPanel
      changesContent={
        <DeferredChangesPanel
          projectPath={projectPath}
          request={requestGit as never}
          locale={locale}
        />
      }
      gitContent={
        <DeferredGitPanel
          projectPath={projectPath}
          request={requestGit as never}
          variant="embedded"
        />
      }
      {...(reviewResults.results.length > 0
        ? {
            resultContent: (
              <ReviewResultList
                results={reviewResults.results}
                locale={locale === 'zh-CN' ? 'zh-CN' : 'en'}
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
      locale={locale === 'zh-CN' ? 'zh-CN' : 'en'}
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
  return (
    <div className="review-result-list" data-testid="review-result-list">
      {unresolved.map((result) => (
        <SubagentUnresolvedEntry
          key={result.resultId}
          resultId={result.resultId}
          title={result.taskId}
          locale={props.locale}
          onRequestResolution={props.onRequestResolution}
        />
      ))}
      {[...candidatesByGroup.entries()].map(([groupId, members]) => (
        <SubagentCandidateCard
          key={groupId}
          candidateGroupId={groupId}
          candidates={members.map((member) => ({
            resultId: member.resultId,
            title: member.taskId,
          }))}
          locale={props.locale}
          onAdopt={props.onAdopt}
        />
      ))}
    </div>
  );
}
