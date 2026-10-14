/** Row and input shapes of the sidebar tree. The builder is sidebar-tree-rows.ts. */
import type { ProjectWorktreeListing, SessionListOrder, SessionScope } from '@piwin/contracts';
import type { SessionListItemUi } from './chat-reducer';
import type { DraftSessionItemUi } from './draft-session';
import type { SessionListScopeState } from './session-list-scope';
import type { SessionRowRunPhase } from './session-row-working';
import type { SidebarProjectRef } from './sidebar-repo-groups';

export type SidebarTreeRow =
  | { kind: 'no-repo-folder'; key: string; collapsed: boolean; depth: number }
  | { kind: 'section-header'; sectionId: 'pinned' | 'projects' | 'conversations'; key: string }
  | { kind: 'unavailable-group'; key: string; collapsed: boolean; count: number; depth: number }
  | {
      kind: 'time-group';
      id: string;
      title: string;
      key: string;
    }
  | {
      kind: 'project-folder';
      projectPath: string;
      /**
       * Other remembered paths this folder stands for: symlink aliases of the
       * directory, and for a repository folder its other worktrees.
       */
      aliasPaths?: string[];
      /**
       * Set on a repository folder, which lists every worktree's sessions as
       * one project. `projectPath` is then the worktree new sessions start in.
       */
      repository?: { title: string; collapseKey: string };
      collapsed: boolean;
      depth: number;
      currentBranch: string | null;
      unavailable?: boolean;
      key: string;
    }
  | {
      kind: 'session';
      scope: SessionScope;
      session: SessionListItemUi | DraftSessionItemUi;
      projectSubtitle?: string;
      /** Tree indent level; absent on the flat pinned and conversation lists. */
      depth?: number;
      /**
       * The session runs in a linked worktree of its repository folder. The
       * tree no longer has a worktree level, so the row itself has to say so.
       */
      worktree?: SidebarSessionWorktree;
      folderChild?: true;
      isPinnedSection?: true;
      key: string;
    }
  | {
      kind: 'project-show-more';
      projectPath: string;
      batchSize: number;
      nextVisibleCount: number;
      /** Sessions of this folder still folded away, all batches included. */
      hiddenCount: number;
      depth: number;
      key: string;
    }
  | { kind: 'empty-hint'; scope: SessionScope; depth?: number; key: string }
  | { kind: 'query-error'; scope: SessionScope; depth?: number; key: string }
  | {
      kind: 'truncation-hint';
      scope: SessionScope;
      hiddenCount: number;
      depth?: number;
      key: string;
    };

export type SidebarSessionWorktree = { name: string; branch: string | null };

export const DEFAULT_PROJECT_SESSION_VISIBLE_COUNT = 5;
export const PROJECT_SESSION_VISIBLE_INCREMENT = 5;
/** Collapse / show-more key for the No Repo agent-chat folder. */
export const NO_REPO_SIDEBAR_KEY = 'no-repo';

export type SidebarTreeRowsInput = {
  recentProjects: readonly SidebarProjectRef[];
  worktrees?: readonly ProjectWorktreeListing[];
  /** Built-in No Repo key: Host workspace path, or the opaque remote locator. */
  noRepoProjectPath?: string;
  projectSessionsByPath: Record<string, SessionListItemUi[]>;
  generalSessions: SessionListItemUi[];
  draftSessions?: readonly DraftSessionItemUi[];
  sessionSearch: string;
  sessionListOrder: SessionListOrder;
  pinnedSectionExpanded?: boolean;
  projectsSectionExpanded: boolean;
  conversationsSectionExpanded: boolean;
  collapsedProjects: Record<string, boolean>;
  unavailableGroupCollapsed?: boolean;
  projectSessionVisibleCounts?: Readonly<Record<string, number>>;
  sessionListScopes: SessionListScopeState;
  activeProjectPath?: string | null;
  activeProjectSessions?: SessionListItemUi[];
  revealSessionId?: string | null;
  revealDraftId?: string | null;
  groupBy?: 'time' | 'none';
  workingSessionIds?: Record<string, true>;
  backendServiceSessionIds?: Record<string, true>;
  waitingPermissionSessionIds?: Record<string, true>;
  runPhase?: SessionRowRunPhase;
};
