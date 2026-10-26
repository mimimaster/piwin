/**
 * Lets the composer "+" menu start a screenshot without threading a prop
 * through every composer layer. `null` outside the workbench (tests, panes
 * without a provider) hides the menu entry.
 */
import { createContext, useContext } from 'react';

export type ScreenCaptureEntry = {
  /** False until the platform reports native capture support. */
  supported: boolean;
  start: () => void;
};

export const ScreenCaptureContext = createContext<ScreenCaptureEntry | null>(null);

export function useScreenCaptureEntry(): ScreenCaptureEntry | null {
  return useContext(ScreenCaptureContext);
}
