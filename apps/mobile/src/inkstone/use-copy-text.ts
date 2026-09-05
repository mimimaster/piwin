import { useCallback } from 'react';
import { useInkstone } from './inkstone-context.js';

/** Prototype clipboard helper: mirrors copy-response / copy-report demo actions. */
export function useCopyText(): (text: string) => Promise<void> {
  const { dispatch } = useInkstone();
  return useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        dispatch({ type: 'toast', message: '示例内容已复制' });
      } catch {
        dispatch({ type: 'toast', message: '浏览器未允许复制，可直接选择正文复制' });
      }
    },
    [dispatch],
  );
}
