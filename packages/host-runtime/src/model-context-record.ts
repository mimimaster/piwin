import type { ContextSummaryPush, HostPush } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { openModelContextStore } from '@piwin/session';
import { getPiwinRoot, getPiwinSessionModelContextDatabasePath } from './paths.js';

export async function persistAndPushAssembly(input: {
  piwinRoot?: string;
  summary: ContextSummaryPush;
  push: (message: HostPush) => void;
}): Promise<void> {
  try {
    const store = await openModelContextStore({
      dbPath: getPiwinSessionModelContextDatabasePath(
        getPiwinRoot(input.piwinRoot),
        input.summary.sessionId,
      ),
      sessionId: input.summary.sessionId,
    });
    try {
      await store.recordAssembly(input.summary);
    } finally {
      store.close();
    }
    input.push(input.summary);
  } catch (error) {
    const missed: ContextSummaryPush = {
      ...input.summary,
      coverage: 'capture-missed',
    };
    input.push({
      type: 'host/log',
      level: 'warn',
      message: `model context persist failed: ${formatError(error)}`,
    });
    input.push(missed);
  }
}
