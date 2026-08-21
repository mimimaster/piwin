/** Tool calls emitted by one Assistant response, in provider order. */
import { useMemo, type ReactElement } from 'react';
import type { SessionSummary, SubagentInvocation } from '@piwin/contracts';
import type { SubagentStreamState, ToolCardUi } from './chat-reducer';
import { ToolCallCard, type DocumentOpenInput } from './tool-call-card';
import { SubagentInvocationBlock } from './subagent-invocation-block';
import type { SubagentInspectorSelection } from './subagent-activity-model';
import type { DiffCardRequest } from './diff-card';
import type { ToolCallDensity } from './ui-preferences';
import type { ModelOption } from './model-options';
import { clusterToolCalls, resolveToolClusterKind } from './tool-group-clustering';
import { ToolBatchCapsule } from './tool-batch-capsule';
import { GoalDeliveryCard, GoalBlockedCard } from './goal';
import { useSubagentInspectorToggle } from './subagent-inspector-context';
import { SubagentInlineSession } from './subagent-inline-session';

export type TurnToolGroupProps = {
  tools: ToolCardUi[];
  density?: ToolCallDensity;
  locale?: 'zh-CN' | 'en';
  modelOptions?: readonly ModelOption[];
  projectPath?: string | null;
  request?: DiffCardRequest;
  onOpenFile?: (absolutePath: string, relativePath?: string) => void;
  onOpenDiff?: (absolutePath: string, relativePath?: string) => void;
  onOpenDocument?: ((input: DocumentOpenInput) => void) | undefined;
  subagentChildren?: Record<string, SessionSummary>;
  subagentInvocations?: Record<string, SubagentInvocation>;
  subagentStreams?: Record<string, SubagentStreamState>;
  onInspectSubagent?: (selection: SubagentInspectorSelection) => void;
};

/**
 * Renders tool calls from one response with automatic clustering for consecutive
 * read-only / exploratory actions into compact collapsible batch capsules.
 */
export function TurnToolGroup(props: TurnToolGroupProps): ReactElement | null {
  const clusters = useMemo(() => clusterToolCalls(props.tools), [props.tools]);
  const inspectorToggle = useSubagentInspectorToggle();

  if (props.tools.length === 0) {
    return null;
  }

  return (
    <div className="turn-tool-sequence" data-testid="turn-tool-group">
      {clusters.map((item, index) => {
        if (item.kind === 'batch') {
          return (
            <ToolBatchCapsule
              key={`batch-${item.clusterKind}-${index}-${item.tools[0]?.toolCallId}`}
              clusterKind={item.clusterKind}
              tools={item.tools}
              summary={item.summary}
              density={props.density ?? 'compact'}
              locale={props.locale ?? 'zh-CN'}
              {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
              {...(props.request !== undefined ? { request: props.request } : {})}
              {...(props.onOpenFile !== undefined ? { onOpenFile: props.onOpenFile } : {})}
              {...(props.onOpenDiff !== undefined ? { onOpenDiff: props.onOpenDiff } : {})}
              {...(props.onOpenDocument !== undefined
                ? { onOpenDocument: props.onOpenDocument }
                : {})}
            />
          );
        }

        const tool = item.tool;
        if (tool.presentation?.kind === 'subagent' || tool.toolName === 'piwin_subagent_run') {
          const invocation = Object.values(props.subagentInvocations ?? {}).find(
            (candidate) => candidate.parentToolCallId === tool.toolCallId,
          );
          const child = invocation?.childSessionId
            ? props.subagentChildren?.[invocation.childSessionId]
            : Object.values(props.subagentChildren ?? {}).find(
                (candidate) => candidate.subagentParentToolCallId === tool.toolCallId,
              );
          // Only the top-level transcript activates anchors (nested child
          // transcripts never receive onInspectSubagent), so a nested block
          // can never claim the single expanded panel.
          const expanded =
            props.onInspectSubagent !== undefined &&
            child !== undefined &&
            inspectorToggle?.selection?.anchorId === tool.toolCallId &&
            inspectorToggle.selection.childSessionId === child.id;
          return (
            <div
              key={tool.toolCallId}
              className="subagent-embed"
              data-testid="subagent-embed"
              data-expanded={expanded}
            >
              <SubagentInvocationBlock
                tool={tool}
                locale={props.locale ?? 'zh-CN'}
                expanded={expanded}
                {...(props.modelOptions ? { modelOptions: props.modelOptions } : {})}
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
              {expanded ? <SubagentInlineSession /> : null}
            </div>
          );
        }

        if (tool.toolName === 'goal_complete' && tool.status === 'done') {
          return (
            <GoalDeliveryCard
              key={tool.toolCallId}
              summary={tool.output || 'Goal accomplished'}
              {...(props.onOpenFile ? { onOpenFile: (path) => props.onOpenFile?.(path) } : {})}
            />
          );
        }

        if (tool.toolName === 'goal_blocked') {
          return (
            <GoalBlockedCard
              key={tool.toolCallId}
              reason={tool.output || 'Goal execution is blocked'}
            />
          );
        }

        // Running commands stay expanded so terminal output streams live
        // (Cursor-style "Ran …"); other tools keep the collapsed row.
        return (
          <ToolCallCard
            key={tool.toolCallId}
            tool={tool}
            density={props.density ?? 'compact'}
            expandWhileRunning={resolveToolClusterKind(tool) === 'command'}
            {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
            {...(props.request !== undefined ? { request: props.request } : {})}
            {...(props.onOpenFile !== undefined ? { onOpenFile: props.onOpenFile } : {})}
            {...(props.onOpenDiff !== undefined ? { onOpenDiff: props.onOpenDiff } : {})}
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
