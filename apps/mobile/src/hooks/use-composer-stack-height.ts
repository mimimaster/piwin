import { useLayoutEffect, type RefObject } from 'react';

const COMPOSER_STACK_PROPERTY = '--composer-stack-height';

/** Transcript padding tracks the real composer stack, including quick actions. */
export function useComposerStackHeight(options: {
  dockRef: RefObject<HTMLElement | null>;
  streamRef: RefObject<HTMLElement | null>;
}): void {
  useLayoutEffect(() => {
    const dock = options.dockRef.current;
    const stream = options.streamRef.current;
    if (!dock || !stream) {
      return;
    }
    const apply = () => {
      stream.style.setProperty(COMPOSER_STACK_PROPERTY, `${Math.ceil(dock.getBoundingClientRect().height)}px`);
    };
    apply();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(apply);
    observer.observe(dock);
    return () => {
      observer.disconnect();
      stream.style.removeProperty(COMPOSER_STACK_PROPERTY);
    };
  }, [options.dockRef, options.streamRef]);
}
