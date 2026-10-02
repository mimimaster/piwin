import { useEffect, useState } from 'react';
import type { BackendWorkflowsData } from '@piwin/contracts';
import type { BackendWorkflowRequest } from './backend-workflows.js';

type Observation = { sessionId: string; data: BackendWorkflowsData | null; error: string | null };

/** A backend workflow keeps updating after the foreground prompt has finished. */
export function useBackendWorkflows(sessionId: string | undefined, request: BackendWorkflowRequest | undefined): {
  data: BackendWorkflowsData | null; error: string | null;
} {
  const [observation, setObservation] = useState<Observation | null>(null);
  useEffect(() => {
    if (!sessionId || !request) return;
    const observedSessionId = sessionId;
    const send = request;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh(): Promise<void> {
      try {
        const result = await send({ type: 'agents/workflows', sessionId: observedSessionId });
        if (!result?.success) throw new Error(result?.error ?? 'Workflow request unavailable');
        const value = result.data as BackendWorkflowsData | undefined;
        if (value === undefined || value.sessionId !== observedSessionId || !Array.isArray(value.workflows)) throw new Error('Invalid workflow response');
        if (!disposed) setObservation({ sessionId: observedSessionId, data: value, error: null });
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : String(failure);
        // Old adapters without a workflow method have no workflow projection.
        if (!disposed) setObservation((previous) => ({
          sessionId: observedSessionId,
          data: previous !== null && previous.sessionId === observedSessionId ? previous.data : null,
          error: message.includes('is not a function') ? null : message,
        }));
      } finally { if (!disposed) timer = setTimeout(() => void refresh(), 3000); }
    }
    void refresh();
    return () => { disposed = true; if (timer !== undefined) clearTimeout(timer); };
  }, [sessionId, request]);
  // Never paint the previous session's workflows during navigation.
  return observation !== null && observation.sessionId === sessionId
    ? observation
    : { data: null, error: null };
}
