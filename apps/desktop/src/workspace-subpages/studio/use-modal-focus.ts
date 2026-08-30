import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Keeps keyboard focus inside an active workspace dialog and restores the
 * opener after close. Correctness does not depend on an animation finishing. */
export function useModalFocus<ElementType extends HTMLElement>(
  onClose: () => void,
  active = true,
): RefObject<ElementType | null> {
  const containerRef = useRef<ElementType | null>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!active) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = containerRef.current;
    const firstControl = container?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstControl ?? container)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !container) return;
      const controls = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) {
        event.preventDefault();
        container.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [active]);

  return containerRef;
}
