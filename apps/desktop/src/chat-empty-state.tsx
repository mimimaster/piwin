/** Empty chat column: Cursor-like prompt-first empty state. */
import type { ReactElement } from 'react';
import {
  IconFolderOpen,
  IconPlus,
  IconSpark,
  IconListTree,
  IconBook,
  IconTerminal,
} from './shell-icons';
import type { AgentModeId } from './agent-mode';

export type ChatEmptyStateProps = {
  projectPath: string | null;
  projectTrusted?: boolean;
  activeSessionId?: string | null;
  onOpenWorkspace: () => void;
  onCreateSession?: () => void;
  onSuggest: (mode: AgentModeId, text: string) => void;
};

export function ChatEmptyState(props: ChatEmptyStateProps): ReactElement {
  const hasWorkspace = Boolean(props.projectPath);

  return (
    <div className="empty-state" data-testid="chat-empty-state">
      <div className="empty-state-badge">
        <span className="empty-state-badge-dot" />
        piwin workspace
      </div>

      <h2 className="empty-state-title">What are you working on?</h2>

      <p className="empty-state-copy muted">
        Start with a question or task. piwin creates a session when you send it.
        {!hasWorkspace
          ? ' Open a project folder when you need repo tools, Git, or the file tree.'
          : ''}
      </p>

      {!hasWorkspace ? (
        <div className="empty-state-actions">
          <button
            type="button"
            className="empty-state-cta-button"
            data-testid="empty-open-workspace"
            onClick={props.onOpenWorkspace}
          >
            <IconFolderOpen className="empty-state-cta-icon" />
            <span>Open project (optional)</span>
          </button>

          {!props.activeSessionId && props.onCreateSession ? (
            <button
              type="button"
              className="empty-state-sub-cta"
              data-testid="empty-create-session"
              onClick={props.onCreateSession}
            >
              <IconPlus />
              <span>New session</span>
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="suggestion-list" aria-label="Suggested first tasks">
        <button
          type="button"
          className="suggestion-card"
          onClick={() => {
            props.onCreateSession?.();
            props.onSuggest(
              'agent',
              hasWorkspace
                ? 'Review this project for risks and the next best step.'
                : 'Help me plan my next coding task.',
            );
          }}
        >
          <div className="suggestion-card-header">
            <div className="suggestion-card-icon">
              <IconSpark />
            </div>
            <strong>{hasWorkspace ? 'Review this project' : 'Start a task'}</strong>
          </div>
          <span className="muted">
            {hasWorkspace ? 'Risks, gaps, and a practical next step.' : 'No project required.'}
          </span>
        </button>

        <button
          type="button"
          className="suggestion-card"
          onClick={() => {
            props.onCreateSession?.();
            props.onSuggest(
              'plan',
              hasWorkspace
                ? 'Plan a feature end-to-end for this codebase.'
                : 'Help me design a feature plan.',
            );
          }}
        >
          <div className="suggestion-card-header">
            <div className="suggestion-card-icon">
              <IconListTree />
            </div>
            <strong>Plan a feature</strong>
          </div>
          <span className="muted">Decision-complete plan.</span>
        </button>

        <button
          type="button"
          className="suggestion-card"
          onClick={() => {
            props.onCreateSession?.();
            props.onSuggest(
              'agent',
              hasWorkspace
                ? 'Inspect open changes and suggest a clean commit split.'
                : 'Explain a coding concept clearly with examples.',
            );
          }}
        >
          <div className="suggestion-card-header">
            <div className="suggestion-card-icon">
              <IconBook />
            </div>
            <strong>{hasWorkspace ? 'Review open changes' : 'Explain with examples'}</strong>
          </div>
          <span className="muted">
            {hasWorkspace ? 'Diff risks and commit-sized slices.' : 'Works in General chat.'}
          </span>
        </button>

        <button
          type="button"
          className="suggestion-card"
          onClick={() => {
            props.onCreateSession?.();
            props.onSuggest(
              'agent',
              hasWorkspace
                ? 'Find failing tests and propose the smallest fix.'
                : 'Write a small TypeScript utility with tests.',
            );
          }}
        >
          <div className="suggestion-card-header">
            <div className="suggestion-card-icon">
              <IconTerminal />
            </div>
            <strong>{hasWorkspace ? 'Fix failing tests' : 'Write a utility'}</strong>
          </div>
          <span className="muted">
            {hasWorkspace ? 'Minimal diff, clear verification.' : 'General workspace sandbox.'}
          </span>
        </button>
      </div>
    </div>
  );
}
