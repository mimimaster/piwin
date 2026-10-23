import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import type { RightPanelTab } from './right-panel-sections.js';

export const RIGHT_PANEL_SIDE_CHAT_TABS_SLOT_ID = 'right-panel-side-chat-tabs-slot';

export type RightPanelChrome = {
  closeTab: (tab: RightPanelTab) => void;
};

const RightPanelChromeContext = createContext<RightPanelChrome | null>(null);

export function RightPanelChromeProvider(props: {
  closeTab: (tab: RightPanelTab) => void;
  children: ReactNode;
}): ReactElement {
  return (
    <RightPanelChromeContext.Provider value={{ closeTab: props.closeTab }}>
      {props.children}
    </RightPanelChromeContext.Provider>
  );
}

export function useRightPanelChrome(): RightPanelChrome | null {
  return useContext(RightPanelChromeContext);
}
