/**
 * Dismiss authority for idle-loop cards. Rows read it from context instead
 * of threading a callback through workbench-app (same precedent as
 * ToolOutputReaderContext / subagent-stop-controller).
 *
 * Dismissal is optimistic: the card hides at once and Host persists it
 * (`run/idle-loop-dismiss`). The local set covers terminal Runs, whose
 * record will not be republished, until the next transcript load reads the
 * persisted flag.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { showErrorNotification } from '@piwin/ui-kit';

export type RunIdleLoopActions = {
  isDismissed: (runId: string) => boolean;
  dismiss: (runId: string) => void;
};

const RunIdleLoopContext = createContext<RunIdleLoopActions | null>(null);

export function useRunIdleLoopActions(): RunIdleLoopActions | null {
  return useContext(RunIdleLoopContext);
}

export function RunIdleLoopProvider(props: {
  sessionId: string | null;
  request: (command: HostCommand) => Promise<HostResponse>;
  locale?: string;
  children: ReactNode;
}): ReactElement {
  const { sessionId, request, locale } = props;
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());

  const dismiss = useCallback(
    (runId: string) => {
      if (sessionId === null) return;
      setDismissed((current) => new Set(current).add(runId));
      void request({ type: 'run/idle-loop-dismiss', sessionId, runId })
        .then((response) => {
          if (!response.success) throw new Error(response.error);
        })
        .catch(() => {
          setDismissed((current) => {
            const next = new Set(current);
            next.delete(runId);
            return next;
          });
          showErrorNotification(
            locale === undefined || locale.startsWith('zh')
              ? '无法关闭空转提示，请重试'
              : 'Could not dismiss the idle-loop notice',
          );
        });
    },
    [locale, request, sessionId],
  );

  const value = useMemo<RunIdleLoopActions>(
    () => ({ isDismissed: (runId) => dismissed.has(runId), dismiss }),
    [dismiss, dismissed],
  );
  return <RunIdleLoopContext.Provider value={value}>{props.children}</RunIdleLoopContext.Provider>;
}
