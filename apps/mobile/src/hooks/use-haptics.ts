export type HapticType = 'tap' | 'success' | 'warning' | 'error' | 'selection';

export function useHaptics() {
  const trigger = (type: HapticType = 'tap') => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return;
    }

    try {
      if (typeof navigator.vibrate === 'function') {
        switch (type) {
          case 'tap':
          case 'selection':
            navigator.vibrate(10);
            break;
          case 'success':
            navigator.vibrate([15, 30, 15]);
            break;
          case 'warning':
            navigator.vibrate([35, 50, 35]);
            break;
          case 'error':
            navigator.vibrate([50, 70, 50]);
            break;
        }
      }
    } catch {
      // Haptics not supported or blocked by user gesture policy
    }
  };

  return {
    trigger,
    tap: () => trigger('tap'),
    success: () => trigger('success'),
    warning: () => trigger('warning'),
    error: () => trigger('error'),
    selection: () => trigger('selection'),
  };
}
