/**
 * Workspace-data providers the workbench tree shares: subagent stop and
 * review loop, knowledge mounts and citation actions, and turn changes (so
 * the transcript's turn cards and the right panel's 本轮变更 view read one
 * index and one focused turn).
 */
import type { ReactElement, ReactNode } from 'react';
import type { HostClient } from './host-client';
import { KnowledgeCitationActionsProvider } from './knowledge/knowledge-citation-actions';
import { KnowledgeMountsProvider } from './knowledge/knowledge-mounts-context';
import {
  SubagentReviewLoopProvider,
  type SubagentReviewLoopBinding,
} from './subagent-review-loop-context';
import { SubagentStopProvider } from './subagent-stop-controller';
import { TurnChangesHostProvider } from './turn-changes/turn-changes-host-provider.js';

type MountsValue = Parameters<typeof KnowledgeMountsProvider>[0]['value'];
type CitationActionsValue = Parameters<typeof KnowledgeCitationActionsProvider>[0]['value'];
type StopValue = Parameters<typeof SubagentStopProvider>[0]['value'];

export function WorkbenchWorkspaceProviders(props: {
  hostClient: HostClient;
  subagentStop: StopValue;
  reviewLoop: SubagentReviewLoopBinding;
  knowledgeMounts: MountsValue;
  knowledgeCitationActions: CitationActionsValue;
  onOpenReview: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <SubagentStopProvider value={props.subagentStop}>
      {props.subagentStop?.dialog}
      <SubagentReviewLoopProvider value={props.reviewLoop}>
        <TurnChangesHostProvider hostClient={props.hostClient} onOpenReview={props.onOpenReview}>
          <KnowledgeMountsProvider value={props.knowledgeMounts}>
            <KnowledgeCitationActionsProvider value={props.knowledgeCitationActions}>
              {props.children}
            </KnowledgeCitationActionsProvider>
          </KnowledgeMountsProvider>
        </TurnChangesHostProvider>
      </SubagentReviewLoopProvider>
    </SubagentStopProvider>
  );
}
