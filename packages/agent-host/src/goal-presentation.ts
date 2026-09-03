import {
  isGoalToolName,
  parseGoalDisplayPayload,
  type ToolPresentation,
} from '@piwin/contracts';

/**
 * Attach the structured goal signal from a `goal_*` tool's result details.
 *
 * Gated on the tool name as well as the payload shape: an unrelated tool whose
 * details happen to carry `status: 'completed'` must not grow a goal card.
 */
export function attachGoalPresentation(
  presentation: ToolPresentation,
  input: { toolName: string; routedToolName?: string; details?: unknown },
): ToolPresentation {
  if (!isGoalToolName(input.toolName) && !isGoalToolName(input.routedToolName)) {
    return presentation;
  }
  const goal = parseGoalDisplayPayload(input.details);
  if (!goal) return presentation;
  return { ...presentation, goal };
}