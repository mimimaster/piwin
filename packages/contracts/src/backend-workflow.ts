/** Observation of a backend-owned background run; separate from Host Runs and SessionPlans. */
export type BackendWorkflowSnapshot = {
  workflowId: string;
  sessionId: string;
  agentId: string;
  name: string;
  objective: string;
  status: string;
  revision: number;
  currentPhase?: string;
  phases: { title: string; detail?: string; status: 'pending' | 'active' | 'done' }[];
  agents: { id: string; label: string; phase?: string; status: string; tokensUsed?: number }[];
  history: { event: string; detail?: string; at?: string }[];
  elapsedMs?: number;
  message?: string;
  reportAvailable: boolean;
};

export type BackendWorkflowsData = { sessionId: string; workflows: BackendWorkflowSnapshot[] };
export type BackendWorkflowReportData = { sessionId: string; workflowId: string; text: string };

export function isBackendWorkflowActive(status: string): boolean {
  return ['active', 'running', 'pending', 'starting', 'waiting', 'resuming'].includes(status);
}
