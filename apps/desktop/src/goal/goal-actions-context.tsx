/**
 * Goal card actions.
 *
 * The goal cards render deep inside the transcript (ChatThread →
 * ChatMessageRow → TurnWorkDetails / ConversationResponseContent →
 * TurnToolGroup), and their actions are shell concerns: focus the composer,
 * leave Goal mode, open the review surface. Threading three callbacks through
 * four component signatures would tax every intermediate node for props none
 * of them use, so this follows the `subagent-inspector-context` precedent and
 * provides them once from the conversation column.
 */
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';

export type GoalActions = {
  /** Put the caret back in the composer so the user can answer a blocker. */
  focusComposer: () => void;
  /** Leave Goal mode and return to Agent. */
  leaveGoalMode: () => void;
  /** Open the review surface for the run's changes. */
  reviewChanges?: () => void;
};

const GoalActionsContext = createContext<GoalActions | null>(null);

export function GoalActionsProvider(props: {
  actions: GoalActions;
  children: ReactNode;
}): ReactElement {
  return (
    <GoalActionsContext.Provider value={props.actions}>
      {props.children}
    </GoalActionsContext.Provider>
  );
}

/** Null outside the provider (tests, subagent transcripts) — cards degrade to read-only. */
export function useGoalActions(): GoalActions | null {
  return useContext(GoalActionsContext);
}