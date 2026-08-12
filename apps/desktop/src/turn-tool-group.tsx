/** Tool calls emitted by one Assistant response, in provider order. */
import type { ReactElement } from 'react';
import type { SessionSummary, SubagentInvocation } from '@piwin/contracts';
import type { SubagentStreamState, ToolCardUi } from './chat-reducer';
import { ToolCallCard, type DocumentOpenInput } from './tool-call-card';
import { SubagentInvocationBlock } from './subagent-invocation-block';
import type { SubagentInspectorSelection } from './subagent-activity-model';
import type { DiffCardRequest } from './diff-card';
import type { ToolCallDensity } from './ui-preferences';

export type TurnToolGroupProps = {
  tools: ToolCardUi[];
  density?: ToolCallDensity;
  locale?: 'zh-CN' | 'en';
  projectPath?: string | null;
  request?: DiffCardRequest;
  onOpenFile?: (absolutePath: string, relativePath?: string) => void;
  onOpenDocument?: ((input: DocumentOpenInput) => void) | undefined;
  subagentChildren?: Record<string, SessionSummary>;
  subagentInvocations?: Record<string, SubagentInvocation>;
  subagentStreams?: Record<string, SubagentStreamState>;
  onInspectSubagent?: (selection: SubagentInspectorSelection) => void;
};

/**
 * This component deliberately has no Run-level summary or nested inspector.
 * Its input is one response's tool array, so parallel calls from that response
 * may sit together while calls from later responses remain later transcript
 * rows.
 */
export function TurnToolGroup(props: TurnToolGroupProps): ReactElement | null {
  if (props.tools.length === 0) {
    return null;
  }

  return (
    <div className="turn-tool-sequence" data-testid="turn-tool-group">
      {props.tools.map((tool) => {
        if (tool.presentation?.kind === 'subagent' || tool.toolName === 'piwin_subagent_run') {
          const invocation = Object.values(props.subagentInvocations ?? {}).find(
            (candidate) => candidate.parentToolCallId === tool.toolCallId,
          );
          const child = invocation?.childSessionId
            ? props.subagentChildren?.[invocation.childSessionId]
            : Object.values(props.subagentChildren ?? {}).find(
                (candidate) => candidate.subagentParentToolCallId === tool.toolCallId,
              );
          return (
            <SubagentInvocationBlock
              key={tool.toolCallId}
              tool={tool}
              locale={props.locale ?? 'zh-CN'}
              {...(invocation ? { invocation } : {})}
              {...(child ? { child } : {})}
              {...(child &&
              props.subagentStreams?.[child.id] &&
              (!invocation ||
                invocation.status === 'queued' ||
                invocation.status === 'starting' ||
                invocation.status === 'running')
                ? { stream: props.subagentStreams[child.id] }
                : {})}
              {...(props.onInspectSubagent
                ? { onInspect: props.onInspectSubagent }
                : {})}
            />
          );
        }
        return (
          <ToolCallCard
            key={tool.toolCallId}
            tool={tool}
            density={props.density ?? 'compact'}
            expandWhileRunning
            {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
            {...(props.request !== undefined ? { request: props.request } : {})}
            {...(props.onOpenFile !== undefined ? { onOpenFile: props.onOpenFile } : {})}
            {...(props.onOpenDocument !== undefined
              ? { onOpenDocument: props.onOpenDocument }
              : {})}
            {...(props.locale !== undefined ? { locale: props.locale } : {})}
          />
        );
      })}
    </div>
  );
}
