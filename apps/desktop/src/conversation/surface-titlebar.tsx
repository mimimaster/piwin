/**
 * Lets a hosted surface (the browser) take over its host panel's titlebar:
 * page tabs go where the host's own tool tab would sit, surface actions go
 * ahead of the host's own expand/collapse/close controls.
 */
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';

export type SurfaceTitlebar = {
  /** Null until the host's slot element has mounted. */
  tabsSlot: HTMLElement | null;
  actionsSlot: HTMLElement | null;
  /** Page-tab count so the host can keep 「浏览器」 closeable when empty. */
  setPageTabCount?: (count: number) => void;
  /** Close the host browser tool (last page tab, or explicit dismiss). */
  closeHost?: () => void;
};

const SurfaceTitlebarContext = createContext<SurfaceTitlebar | null>(null);

export function SurfaceTitlebarProvider(props: { value: SurfaceTitlebar | null; children: ReactNode }): ReactElement {
  return <SurfaceTitlebarContext.Provider value={props.value}>{props.children}</SurfaceTitlebarContext.Provider>;
}

export function useSurfaceTitlebar(): SurfaceTitlebar | null {
  return useContext(SurfaceTitlebarContext);
}
