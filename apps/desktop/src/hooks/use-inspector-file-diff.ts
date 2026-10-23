import { useCallback, useState } from 'react';

export type InspectorFileDiff = {
  absolutePath: string;
  relativePath: string;
};

export function useInspectorFileDiff(): {
  diff: InspectorFileDiff | null;
  open: (absolutePath: string, relativePath?: string) => void;
  clear: () => void;
} {
  const [diff, setDiff] = useState<InspectorFileDiff | null>(null);
  const open = useCallback((absolutePath: string, relativePath?: string) => {
    setDiff({
      absolutePath,
      relativePath: relativePath && relativePath.length > 0 ? relativePath : absolutePath,
    });
  }, []);
  const clear = useCallback(() => {
    setDiff(null);
  }, []);
  return { diff, open, clear };
}
