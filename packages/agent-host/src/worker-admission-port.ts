/** Parent-owned admission for a task-scoped worker (residency ledger lives in host-runtime). */
export type WorkerAdmissionPort = {
  begin(input: {
    sessionId: string;
    runtimeGenerationId: string;
    /** Run whose phase should show waiting-resource while queued. */
    runId?: string;
    signal: AbortSignal;
  }): Promise<WorkerAdmission>;
};
export type WorkerAdmission = { commit(): void; release(): void };
