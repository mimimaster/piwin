import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { AgentModeId } from '../agent-mode';
import type { ComposerDockProps } from '../composer-dock-types';
import {
  detectActiveSlashToken,
  filterSlashItems,
  isReservedSlashExecuteName,
  replaceActiveSlashToken,
  type ActiveSlashToken,
  type SlashItem,
} from '../slash';
import { useComposerSlashCatalog } from '../slash/use-composer-slash-catalog';

export interface UseComposerSlashMenuOptions {
  props: ComposerDockProps;
  composer: string;
  caretIndex: number;
  canComposeText: boolean;
  isStreamingRun: boolean;
  focusCaret: (nextCaret: number) => void;
  proceedSend: (overrideText?: string) => void;
}

export interface UseComposerSlashMenuReturn {
  items: SlashItem[];
  isOpen: boolean;
  selectedIndex: number;
  setSelectedIndex: Dispatch<SetStateAction<number>>;
  activeToken: ActiveSlashToken | null;
  applyItem: (item: SlashItem) => void;
  completeItem: (item: SlashItem) => void;
  executeItem: (item: SlashItem) => void;
  closeMenu: () => void;
  resetForcedClosed: () => void;
}

export function useComposerSlashMenu(
  options: UseComposerSlashMenuOptions,
): UseComposerSlashMenuReturn {
  const {
    props,
    composer,
    caretIndex,
    canComposeText,
    isStreamingRun,
    focusCaret,
    proceedSend,
  } = options;

  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [slashMenuForcedClosed, setSlashMenuForcedClosed] = useState(false);

  const slashCatalog = useComposerSlashCatalog(props, isStreamingRun);

  const activeSlashToken = useMemo(
    () => detectActiveSlashToken(composer, caretIndex),
    [composer, caretIndex],
  );

  const slashItems = useMemo(() => {
    if (!activeSlashToken || !canComposeText) {
      return [];
    }
    return filterSlashItems(slashCatalog, activeSlashToken.query);
  }, [activeSlashToken, canComposeText, slashCatalog]);

  const slashMenuOpen =
    slashItems.length > 0 && activeSlashToken !== null && canComposeText && !slashMenuForcedClosed;

  useEffect(() => {
    setSlashSelectedIndex(0);
  }, [activeSlashToken?.query, slashMenuOpen]);

  useEffect(() => {
    if (slashSelectedIndex >= slashItems.length && slashItems.length > 0) {
      setSlashSelectedIndex(slashItems.length - 1);
    }
  }, [slashItems.length, slashSelectedIndex]);

  // Reset forced-close only after the token is gone. Resetting on every
  // composer change reopened the menu after applying `/ultra-code` (the
  // token is still active), which is the two-Enter layout-break path.
  const hasActiveSlashToken = activeSlashToken !== null;
  useEffect(() => {
    if (!hasActiveSlashToken) {
      setSlashMenuForcedClosed(false);
    }
  }, [hasActiveSlashToken]);

  /** Tab / click-into-box semantics: fill the token, never send. */
  const completeItem = useCallback(
    (item: SlashItem): void => {
      if (!activeSlashToken) {
        return;
      }
      if (!item.available) {
        return;
      }
      const insert =
        item.kind === 'command' && !item.acceptsArgs ? `/${item.name}` : `/${item.name} `;
      const next = replaceActiveSlashToken(composer, activeSlashToken, insert);
      props.onComposerChange(next);
      focusCaret(activeSlashToken.startIndex + insert.length);
      setSlashMenuForcedClosed(true);
    },
    [activeSlashToken, composer, focusCaret, props],
  );

  const executeSlashItemSend = useCallback(
    (item: SlashItem, suffix: string): void => {
      const next = `/${item.name}${suffix}`.replace(/[ \t]+$/u, '').trimStart();
      props.onComposerChange(next);
      setSlashMenuForcedClosed(true);
      proceedSend(next);
    },
    [proceedSend, props],
  );

  /**
   * Enter semantics: perform the selected item now.
   * - Modes switch in place (or send when args follow the token).
   * - Skills with no args complete like click/Tab so the user can type a
   *   real prompt; skills with typed args after the token still send.
   * - Reserved commands / other execute items send immediately.
   */
  const executeItem = useCallback(
    (item: SlashItem): void => {
      if (!activeSlashToken) {
        return;
      }
      if (item.kind === 'mode') {
        const suffix = composer.slice(activeSlashToken.endIndex);
        if (suffix.trim().length > 0) {
          // `/goal fix the bug` — the send layer parses mode + args.
          executeSlashItemSend(item, suffix);
          return;
        }
        props.onAgentModeChange(item.name as AgentModeId);
        const next = replaceActiveSlashToken(composer, activeSlashToken, '');
        props.onComposerChange(next);
        focusCaret(activeSlashToken.startIndex);
        setSlashMenuForcedClosed(true);
        return;
      }
      if (item.kind === 'skill') {
        const suffix = composer.slice(activeSlashToken.endIndex);
        if (suffix.trim().length === 0) {
          completeItem(item);
          return;
        }
        executeSlashItemSend(item, suffix);
        return;
      }
      executeSlashItemSend(item, composer.slice(activeSlashToken.endIndex));
    },
    [activeSlashToken, completeItem, composer, executeSlashItemSend, focusCaret, props],
  );

  const applyItem = useCallback(
    (item: SlashItem): void => {
      if (!activeSlashToken) {
        return;
      }
      if (isReservedSlashExecuteName(item.name) || item.kind === 'mode') {
        // Menu click on a reserved command or a mode performs it immediately.
        executeItem(item);
        return;
      }
      completeItem(item);
    },
    [activeSlashToken, completeItem, executeItem],
  );

  const closeMenu = useCallback((): void => {
    setSlashMenuForcedClosed(true);
  }, []);

  const resetForcedClosed = useCallback((): void => {
    setSlashMenuForcedClosed(false);
  }, []);

  return {
    items: slashItems,
    isOpen: slashMenuOpen,
    selectedIndex: slashSelectedIndex,
    setSelectedIndex: setSlashSelectedIndex,
    activeToken: activeSlashToken,
    applyItem,
    completeItem,
    executeItem,
    closeMenu,
    resetForcedClosed,
  };
}
