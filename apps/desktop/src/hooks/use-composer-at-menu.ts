import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { PromptContextRef } from '@piwin/contracts';
import {
  buildAtCatalog,
  contextRefFromAtItem,
  detectActiveAtToken,
  filterAtItems,
  replaceActiveAtToken,
  type ActiveAtToken,
  type AtItem,
} from '../at';
import type { ComposerDockProps } from '../composer-dock-types';

export interface UseComposerAtMenuOptions {
  projectPath?: string | null | undefined;
  menuMcp: ComposerDockProps['menuMcp'];
  atWorkspaceFiles?: ComposerDockProps['atWorkspaceFiles'];
  composer: string;
  caretIndex: number;
  canComposeText: boolean;
  slashMenuOpen: boolean;
  onAddContextRef?: ((ref: PromptContextRef) => void) | undefined;
  onComposerChange: (text: string) => void;
  focusCaret: (nextCaret: number) => void;
}

export interface UseComposerAtMenuReturn {
  items: AtItem[];
  isOpen: boolean;
  selectedIndex: number;
  setSelectedIndex: Dispatch<SetStateAction<number>>;
  activeToken: ActiveAtToken | null;
  applyItem: (item: AtItem) => void;
  closeMenu: () => void;
  resetForcedClosed: () => void;
}

export function useComposerAtMenu(options: UseComposerAtMenuOptions): UseComposerAtMenuReturn {
  const {
    projectPath,
    menuMcp,
    atWorkspaceFiles,
    composer,
    caretIndex,
    canComposeText,
    slashMenuOpen,
    onAddContextRef,
    onComposerChange,
    focusCaret,
  } = options;

  const [atSelectedIndex, setAtSelectedIndex] = useState(0);
  const [atMenuForcedClosed, setAtMenuForcedClosed] = useState(false);

  const atCatalog = useMemo(
    () =>
      buildAtCatalog({
        projectPath: projectPath ?? null,
        mcpServers: menuMcp.map((m) => ({ id: m.id, name: m.name })),
        recentFiles: (atWorkspaceFiles ?? [])
          .filter((entry) => entry.kind === 'file')
          .map((entry) => entry.relativePath),
        recentFolders: (atWorkspaceFiles ?? [])
          .filter((entry) => entry.kind === 'directory')
          .map((entry) => entry.relativePath),
      }),
    [projectPath, menuMcp, atWorkspaceFiles],
  );

  const activeAtToken = useMemo(
    () => detectActiveAtToken(composer, caretIndex),
    [composer, caretIndex],
  );

  const atItems = useMemo(() => {
    if (!activeAtToken || !canComposeText) {
      return [];
    }
    return filterAtItems(atCatalog, activeAtToken.query);
  }, [activeAtToken, canComposeText, atCatalog]);

  const atMenuOpen =
    activeAtToken !== null && canComposeText && !atMenuForcedClosed && !slashMenuOpen;

  useEffect(() => {
    setAtSelectedIndex(0);
  }, [activeAtToken?.query, atMenuOpen]);

  useEffect(() => {
    if (atSelectedIndex >= atItems.length && atItems.length > 0) {
      setAtSelectedIndex(atItems.length - 1);
    }
  }, [atItems.length, atSelectedIndex]);

  const hasActiveAtToken = activeAtToken !== null;
  useEffect(() => {
    if (!hasActiveAtToken) {
      setAtMenuForcedClosed(false);
    }
  }, [hasActiveAtToken]);

  const applyItem = useCallback(
    (item: AtItem): void => {
      if (!activeAtToken) {
        return;
      }
      // CM-17: workspace file/folder mentions also land in the structured
      // pending refs so Host resolves them the same way as right-click refs.
      const mentionRef = contextRefFromAtItem(item, projectPath);
      if (onAddContextRef && mentionRef) {
        onAddContextRef(mentionRef);
      }
      // File/folder chips live on the shelf; keep the textarea as plain
      // prompt text instead of duplicating `@path` next to the capsule.
      const insertValue = onAddContextRef && mentionRef ? '' : item.insertValue;
      const next = replaceActiveAtToken(composer, activeAtToken, insertValue);
      onComposerChange(next);
      focusCaret(activeAtToken.startIndex + insertValue.length);
      setAtMenuForcedClosed(true);
    },
    [activeAtToken, composer, focusCaret, onAddContextRef, onComposerChange, projectPath],
  );

  const closeMenu = useCallback((): void => {
    setAtMenuForcedClosed(true);
  }, []);

  const resetForcedClosed = useCallback((): void => {
    setAtMenuForcedClosed(false);
  }, []);

  return {
    items: atItems,
    isOpen: atMenuOpen,
    selectedIndex: atSelectedIndex,
    setSelectedIndex: setAtSelectedIndex,
    activeToken: activeAtToken,
    applyItem,
    closeMenu,
    resetForcedClosed,
  };
}
