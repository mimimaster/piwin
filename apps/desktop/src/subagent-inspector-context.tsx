/**
 * Inline subagent inspector wiring.
 *
 * Split into two contexts on purpose: the toggle context only changes when an
 * anchor expands/collapses (cheap for every transcript anchor to watch), while
 * the panel context carries live transcript state that only the single mounted
 * inline panel consumes. Both are provided once by the App composition root so
 * deep transcript nodes never thread inspector plumbing through props.
 */
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import type {
  PermissionDecision,
  PermissionRememberScope,
  SessionSummary,
  SubagentInvocation,
} from '@piwin/contracts';
import type { ChatMessageUi, PermissionPromptUi, SubagentStreamState } from './chat-reducer';
import type {
  ActiveSubagentStatus,
  SubagentInspectorSelection,
} from './subagent-activity-model';
import type { ModelOption } from './model-options';

export type SubagentInspectorToggle = {
  /** Currently expanded anchor identity; null when everything is collapsed. */
  selection: SubagentInspectorSelection | null;
  /** Expand the anchor, or collapse it when it is already the selection. */
  toggle: (selection: SubagentInspectorSelection) => void;
};

/**
 * What the dense preview reads. Observation only: there is no navigation to
 * the child session and no delivery action — the only control is the
 * child's pending permission gate.
 */
export type SubagentInspectorPanelData = {
  status: ActiveSubagentStatus;
  messages: ChatMessageUi[];
  liveTail: SubagentStreamState | null;
  loading: boolean;
  error: string | null;
  child?: SessionSummary;
  invocation?: SubagentInvocation;
  modelOptions?: readonly ModelOption[];
  /** Whether child-session thinking lines are listed in the preview. */
  showThinking?: boolean;
  onRetry: () => void;
  /** Collapse the panel. Never aborts the child. */
  onClose: () => void;
  onPermission?: (
    prompt: PermissionPromptUi,
    decision: PermissionDecision,
    rememberScope?: PermissionRememberScope,
  ) => void;
};

const SubagentInspectorToggleContext = createContext<SubagentInspectorToggle | null>(null);
const SubagentInspectorPanelContext = createContext<SubagentInspectorPanelData | null>(null);

export type SubagentInspectorProviderProps = {
  toggle: SubagentInspectorToggle;
  panel: SubagentInspectorPanelData;
  children: ReactNode;
};

export function SubagentInspectorProvider(
  props: SubagentInspectorProviderProps,
): ReactElement {
  return (
    <SubagentInspectorToggleContext.Provider value={props.toggle}>
      <SubagentInspectorPanelContext.Provider value={props.panel}>
        {props.children}
      </SubagentInspectorPanelContext.Provider>
    </SubagentInspectorToggleContext.Provider>
  );
}

/** Null outside the provider (tests, nested child transcripts). */
export function useSubagentInspectorToggle(): SubagentInspectorToggle | null {
  return useContext(SubagentInspectorToggleContext);
}

/** Null outside the provider (tests, nested child transcripts). */
export function useSubagentInspectorPanel(): SubagentInspectorPanelData | null {
  return useContext(SubagentInspectorPanelContext);
}
