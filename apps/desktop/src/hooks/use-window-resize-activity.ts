import { useEffect } from 'react';
import { isMobileTauriRuntime, usesOnScreenKeyboard } from '../tool-cards/shell-runtime.js';
import { installWindowResizeActivity } from '../platform/window-resize-activity.js';

/** Keyboard viewport changes on phones must retain their normal scroll behavior. */
export function useWindowResizeActivity(): void {
  useEffect(() => {
    if (isMobileTauriRuntime() || usesOnScreenKeyboard()) return;
    return installWindowResizeActivity(window);
  }, []);
}
