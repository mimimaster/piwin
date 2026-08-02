/**
 * Collapse completed tool batches in the transcript while keeping failures visible.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { ToolCardUi } from './chat-reducer';
import { ToolCallCard } from './tool-call-card';
import type { DiffCardRequest } from './diff-card';
import type { ToolCallDensity } from './ui-preferences';

export type TurnToolGroupProps = {
  tools: ToolCardUi[];
  density?: ToolCallDensity;
  /** Project root forwarded to ToolCallCard → DiffCard. */
  projectPath?: string | null;
  /** Host request adapter forwarded to ToolCallCard → DiffCard. */
  request?: DiffCardRequest;
};

export function TurnToolGroup(props: TurnToolGroupProps): ReactElement | null {
  const tools = props.tools;
  const density = props.density ?? 'compact';
  const runningOrFailed = tools.filter(
    (tool) => tool.status === 'running' || tool.status === 'error',
  );
  const completed = tools.filter((tool) => tool.status === 'done');
  // Keep 1–2 tool cards visible (Command-style). Only batch-collapse longer runs.
  const shouldCollapse = tools.length >= 3 && completed.length === tools.length;

  const [expanded, setExpanded] = useState(!shouldCollapse);

  useEffect(() => {
    if (shouldCollapse) {
      setExpanded(false);
    }
  }, [shouldCollapse]);
  const [userToggled, setUserToggled] = useState(false);

  useEffect(() => {
    if (!userToggled) {
      setExpanded(!shouldCollapse);
    }
  }, [shouldCollapse, userToggled]);

  if (tools.length === 0) {
    return null;
  }

  const cardProps = {
    density,
    ...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {}),
    ...(props.request !== undefined ? { request: props.request } : {}),
  };

  if (!shouldCollapse) {
    return (
      <>
        {tools.map((tool) => (
          <ToolCallCard key={tool.toolCallId} tool={tool} {...cardProps} />
        ))}
      </>
    );
  }

  const failedCount = tools.filter((tool) => tool.status === 'error').length;
  const summary =
    failedCount > 0
      ? `${completed.length} completed, ${failedCount} failed`
      : `${completed.length} tools completed`;

  return (
    <div className="turn-tool-group" data-testid="turn-tool-group">
      <button
        type="button"
        className="turn-tool-group-summary"
        aria-expanded={expanded}
        onClick={() => {
          setUserToggled(true);
          setExpanded((value) => !value);
        }}
      >
        {summary}
      </button>
      {expanded
        ? tools.map((tool) => <ToolCallCard key={tool.toolCallId} tool={tool} {...cardProps} />)
        : runningOrFailed.map((tool) => (
            <ToolCallCard key={tool.toolCallId} tool={tool} {...cardProps} />
          ))}
    </div>
  );
}
