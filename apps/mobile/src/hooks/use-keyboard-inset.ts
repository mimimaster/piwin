import { useEffect } from 'react';

const KEYBOARD_INSET_PROPERTY = '--keyboard-inset';

function readKeyboardInsetPx(viewport: VisualViewport): number {
  return Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
}

/** Drive composer padding from the visual viewport instead of guessing keyboard height. */
export function useKeyboardInset(): void {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const sync = () => {
      const inset = viewport == null ? 0 : readKeyboardInsetPx(viewport);
      root.style.setProperty(KEYBOARD_INSET_PROPERTY, `${Math.round(inset)}px`);
    };
    sync();
    if (viewport == null) {
      window.addEventListener('resize', sync);
      return () => {
        window.removeEventListener('resize', sync);
        root.style.removeProperty(KEYBOARD_INSET_PROPERTY);
      };
    }
    viewport.addEventListener('resize', sync);
    viewport.addEventListener('scroll', sync);
    return () => {
      viewport.removeEventListener('resize', sync);
      viewport.removeEventListener('scroll', sync);
      root.style.removeProperty(KEYBOARD_INSET_PROPERTY);
    };
  }, []);
}
