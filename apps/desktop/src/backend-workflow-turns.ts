import type { BackendWorkflowSnapshot } from '@piwin/contracts';
import type { TranscriptTurn } from './transcript-turns.js';

function workflowStartMs(workflow: BackendWorkflowSnapshot): number {
  const started = workflow.history.find((entry) => entry.event === 'workflow_started')?.at
    ?? workflow.history.find((entry) => entry.at)?.at;
  return started === undefined ? NaN : Date.parse(started);
}

/** Keep the workflow on its initiating turn even while the user asks new questions. */
export function groupBackendWorkflowsByTurn(
  turns: readonly TranscriptTurn[], workflows: readonly BackendWorkflowSnapshot[],
): { byTurn: ReadonlyMap<string, BackendWorkflowSnapshot[]>; unanchored: BackendWorkflowSnapshot[] } {
  const byTurn = new Map<string, BackendWorkflowSnapshot[]>();
  const unanchored: BackendWorkflowSnapshot[] = [];
  const claimedPrompts = new Set<string>();
  const ordered = [...workflows].sort((left, right) => {
    const difference = workflowStartMs(left) - workflowStartMs(right);
    return Number.isFinite(difference) ? difference : 0;
  });
  for (const workflow of ordered) {
    const startedMs = workflowStartMs(workflow);
    const matches = turns.filter((turn) => turn.items.some(({ message }) => {
      if (message.role !== 'user') return false;
      const prompt = message.text.trim();
      return prompt.startsWith(`/${workflow.name} `)
        && (workflow.objective.length === 0 || prompt.includes(workflow.objective));
    }));
    const precededStart = (turn: TranscriptTurn): boolean => turn.items.some(({ message }) =>
      message.role === 'user' && message.createdAt !== undefined
      && Date.parse(message.createdAt) <= startedMs);
    // Vendor replay can stamp every old message with the reconnect time. In
    // that case the explicit prompt and transcript order outrank those dates.
    const owner = [...matches].reverse().find((turn) => !claimedPrompts.has(turn.id) && precededStart(turn))
      ?? matches.find((turn) => !claimedPrompts.has(turn.id))
      ?? (Number.isFinite(startedMs) ? [...turns].reverse().find(precededStart) : undefined);
    if (!owner) { unanchored.push(workflow); continue; }
    if (matches.includes(owner)) claimedPrompts.add(owner.id);
    const grouped = byTurn.get(owner.id) ?? [];
    grouped.push(workflow);
    byTurn.set(owner.id, grouped);
  }
  return { byTurn, unanchored };
}
