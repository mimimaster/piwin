import type {
  HostCommand,
  HostResponse,
  SessionLifecycleApplyResult,
  SessionLifecyclePlan,
} from '@piwin/contracts';

export type SessionLifecycleHostClient = {
  handleCommand: (command: HostCommand) => Promise<HostResponse>;
};

export async function runSessionLifecyclePlan(
  client: SessionLifecycleHostClient,
  print: (line: string) => void,
): Promise<SessionLifecyclePlan> {
  const response = await client.handleCommand({ type: 'session/lifecycle-plan' });
  if (!response.success) {
    throw new Error(response.error);
  }
  const plan = response.data as SessionLifecyclePlan;
  print(formatSessionLifecyclePlan(plan));
  return plan;
}

export async function runSessionLifecycleApply(
  client: SessionLifecycleHostClient,
  planId: string,
  print: (line: string) => void,
): Promise<SessionLifecycleApplyResult> {
  const response = await client.handleCommand({
    type: 'session/lifecycle-apply',
    planId,
  });
  if (!response.success) {
    throw new Error(response.error);
  }
  const result = response.data as SessionLifecycleApplyResult;
  print(formatSessionLifecycleApplyResult(result));
  return result;
}

export function formatSessionLifecyclePlan(plan: SessionLifecyclePlan): string {
  const lines = [
    `plan ${plan.planId}`,
    `candidates=${plan.candidates.length} skipped-pinned=${plan.skippedPinned} skipped-non-main=${plan.skippedNonMain}`,
  ];
  if (plan.candidates.length === 0) {
    lines.push('(no sessions would be archived)');
  } else {
    for (const candidate of plan.candidates) {
      lines.push(
        `${candidate.sessionId}\t${candidate.reason}\t${candidate.updatedAt}\t${candidate.name ?? ''}`,
      );
    }
    lines.push(`apply with: piwin session lifecycle apply --plan ${plan.planId}`);
  }
  return lines.join('\n');
}

export function formatSessionLifecycleApplyResult(result: SessionLifecycleApplyResult): string {
  const lines = [
    `plan ${result.planId}`,
    `archived=${result.archived.length} skipped=${result.skipped.length} failed=${result.failed.length}`,
  ];
  for (const sessionId of result.archived) {
    lines.push(`archived\t${sessionId}`);
  }
  for (const skipped of result.skipped) {
    lines.push(`skipped\t${skipped.sessionId}\t${skipped.reason}`);
  }
  for (const failure of result.failed) {
    lines.push(`failed\t${failure.sessionId}\t${failure.error}`);
  }
  return lines.join('\n');
}
