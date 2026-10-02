import type { ReactElement } from 'react';
import type { BackendWorkflowsData, HostCommand, HostResponse } from '@piwin/contracts';
import { BackendWorkflowCard } from './backend-workflow-card.js';
import './styles/backend-workflows.css';

export type BackendWorkflowRequest = (command: Extract<HostCommand, { type: 'agents/workflows' | 'agents/workflow-report' }>) => Promise<HostResponse>;

import { useBackendWorkflows } from './use-backend-workflows.js';

type Props = { sessionId: string; request: BackendWorkflowRequest; locale: 'zh-CN' | 'en' };

export function BackendWorkflows(props: Props): ReactElement | null {
  const observation = useBackendWorkflows(props.sessionId, props.request);
  return <BackendWorkflowSequence {...props} workflows={observation.data?.workflows ?? []} error={observation.error} />;
}

/** Rendered inside the initiating assistant article, never as a transcript-tail tray. */
export function BackendWorkflowSequence(props: Props & {
  workflows: BackendWorkflowsData['workflows']; error?: string | null;
}): ReactElement | null {
  const data = { workflows: props.workflows };
  const error = props.error;
  if (!data?.workflows.length && !error) return null;
  return (
    <div
      className="thread turn-tool-sequence backend-workflows-sequence"
      data-testid="backend-workflows-sequence"
      aria-label={props.locale === 'zh-CN' ? '工作流调用链' : 'Workflow call chain'}
    >
      {error ? (
        <p role="alert" className="backend-workflows-error">
          {props.locale === 'zh-CN' ? '后台任务暂时读不到' : 'Background tasks are temporarily unavailable'}
        </p>
      ) : null}
      {data?.workflows.map((workflow) => (
        <BackendWorkflowCard
          key={`${props.sessionId}:${workflow.workflowId}`}
          workflow={workflow}
          request={props.request}
          locale={props.locale}
        />
      ))}
    </div>
  );
}
