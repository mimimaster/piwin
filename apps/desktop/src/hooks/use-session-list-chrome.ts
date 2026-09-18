/**
 * Session-list chrome state (extracted from App.tsx).
 *
 * Owns search / archive / order toggles and the menu / rename / delete /
 * continue-in-project dialog drafts. Host mutations stay in useSessionActions;
 * this hook only holds the UI surface those actions open.
 */
import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { SessionListOrder, SessionScope } from '@piwin/contracts';
import type { SessionRowMenuAction } from '../session-row-menu';

export type SessionMenuState = {
  sessionId: string;
  x: number;
  y: number;
};

export type SessionRenameDraft = {
  sessionId: string;
  name: string;
};

export type SessionNamedDraft = {
  sessionId: string;
  sessionName: string;
};

export type SessionNameLookup = {
  id: string;
  name?: string | undefined;
};

export function resolveSessionDisplayName(
  sessionId: string,
  sessions: readonly SessionNameLookup[],
): string {
  const session = sessions.find((item) => item.id === sessionId);
  const name = session?.name?.trim();
  return name && name.length > 0 ? name : sessionId.slice(0, 8);
}

export function routeSessionChromeMenuAction(input: {
  sessionId: string;
  action: SessionRowMenuAction;
  sessions: readonly SessionNameLookup[];
  requestDelete: (sessionId: string, sessionName: string) => void;
  requestContinueInProject: (sessionId: string, sessionName: string) => void;
  handleHostMenuAction: (sessionId: string, action: SessionRowMenuAction) => void;
}): void {
  if (input.action === 'delete') {
    input.requestDelete(
      input.sessionId,
      resolveSessionDisplayName(input.sessionId, input.sessions),
    );
    return;
  }
  if (input.action === 'continue-in-project') {
    input.requestContinueInProject(
      input.sessionId,
      resolveSessionDisplayName(input.sessionId, input.sessions),
    );
    return;
  }
  input.handleHostMenuAction(input.sessionId, input.action);
}

export type UseSessionListChromeResult = {
  sessionSearch: string;
  setSessionSearch: Dispatch<SetStateAction<string>>;
  sessionSearchOpen: boolean;
  setSessionSearchOpen: (open: boolean) => void;
  openSessionSearch: () => void;
  showArchivedSessions: boolean;
  setShowArchivedSessions: Dispatch<SetStateAction<boolean>>;
  sessionListOrder: SessionListOrder;
  setSessionListOrder: Dispatch<SetStateAction<SessionListOrder>>;
  sessionMenu: SessionMenuState | null;
  renameDraft: SessionRenameDraft | null;
  setRenameDraft: Dispatch<SetStateAction<SessionRenameDraft | null>>;
  projectPickerOpen: boolean;
  setProjectPickerOpen: Dispatch<SetStateAction<boolean>>;
  deleteConfirm: SessionNamedDraft | null;
  deleteBusy: boolean;
  continueInProject: SessionNamedDraft | null;
  continueInProjectBusy: boolean;
  openSessionMenu: (sessionId: string, x: number, y: number) => void;
  closeSessionMenu: () => void;
  requestDeleteSession: (sessionId: string, sessionName: string) => void;
  requestContinueInProject: (sessionId: string, sessionName: string) => void;
  closeDeleteConfirm: () => void;
  closeContinueInProject: () => void;
  runDeleteConfirm: (deleteSession: (sessionId: string) => Promise<unknown>) => void;
  runContinueInProject: (
    targetScope: SessionScope,
    continueSession: (sessionId: string, targetScope: SessionScope) => Promise<boolean>,
  ) => void;
};

export function useSessionListChrome(): UseSessionListChromeResult {
  const [sessionSearch, setSessionSearch] = useState('');
  const [sessionSearchOpen, setSessionSearchOpenState] = useState(false);
  const [showArchivedSessions, setShowArchivedSessions] = useState(false);
  const [sessionListOrder, setSessionListOrder] = useState<SessionListOrder>('updated');
  const [sessionMenu, setSessionMenu] = useState<SessionMenuState | null>(null);
  const [renameDraft, setRenameDraft] = useState<SessionRenameDraft | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<SessionNamedDraft | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [continueInProject, setContinueInProject] = useState<SessionNamedDraft | null>(null);
  const [continueInProjectBusy, setContinueInProjectBusy] = useState(false);

  const setSessionSearchOpen = useCallback((open: boolean): void => {
    setSessionSearchOpenState(open);
    if (!open) {
      setSessionSearch('');
    }
  }, []);

  const openSessionSearch = useCallback((): void => {
    setSessionSearchOpenState(true);
  }, []);

  const openSessionMenu = useCallback((sessionId: string, x: number, y: number): void => {
    setSessionMenu({ sessionId, x, y });
  }, []);

  const closeSessionMenu = useCallback((): void => {
    setSessionMenu(null);
  }, []);

  const requestDeleteSession = useCallback((sessionId: string, sessionName: string): void => {
    setDeleteConfirm({ sessionId, sessionName });
    setSessionMenu(null);
  }, []);

  const requestContinueInProject = useCallback((sessionId: string, sessionName: string): void => {
    setContinueInProject({ sessionId, sessionName });
    setSessionMenu(null);
  }, []);

  const closeDeleteConfirm = useCallback((): void => {
    if (!deleteBusy) {
      setDeleteConfirm(null);
    }
  }, [deleteBusy]);

  const closeContinueInProject = useCallback((): void => {
    if (!continueInProjectBusy) {
      setContinueInProject(null);
    }
  }, [continueInProjectBusy]);

  const runDeleteConfirm = useCallback(
    (deleteSession: (sessionId: string) => Promise<unknown>): void => {
      if (!deleteConfirm) {
        return;
      }
      const sessionId = deleteConfirm.sessionId;
      setDeleteBusy(true);
      void deleteSession(sessionId).finally(() => {
        setDeleteBusy(false);
        setDeleteConfirm(null);
      });
    },
    [deleteConfirm],
  );

  const runContinueInProject = useCallback(
    (
      targetScope: SessionScope,
      continueSession: (sessionId: string, targetScope: SessionScope) => Promise<boolean>,
    ): void => {
      if (!continueInProject) {
        return;
      }
      const sessionId = continueInProject.sessionId;
      setContinueInProjectBusy(true);
      void continueSession(sessionId, targetScope)
        .then((continued) => {
          if (continued) {
            setContinueInProject(null);
          }
        })
        .finally(() => {
          setContinueInProjectBusy(false);
        });
    },
    [continueInProject],
  );

  return {
    sessionSearch,
    setSessionSearch,
    sessionSearchOpen,
    setSessionSearchOpen,
    openSessionSearch,
    showArchivedSessions,
    setShowArchivedSessions,
    sessionListOrder,
    setSessionListOrder,
    sessionMenu,
    renameDraft,
    setRenameDraft,
    projectPickerOpen,
    setProjectPickerOpen,
    deleteConfirm,
    deleteBusy,
    continueInProject,
    continueInProjectBusy,
    openSessionMenu,
    closeSessionMenu,
    requestDeleteSession,
    requestContinueInProject,
    closeDeleteConfirm,
    closeContinueInProject,
    runDeleteConfirm,
    runContinueInProject,
  };
}
