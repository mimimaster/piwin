/**
 * One admitted health_read_context call per Run. Released only when the Run
 * becomes terminal — cancelling the tool does not reset the budget.
 */
export class HealthToolRunBudget {
  private readonly admitted = new Set<string>();

  public tryAdmit(runId: string): boolean {
    if (this.admitted.has(runId)) {
      return false;
    }
    this.admitted.add(runId);
    return true;
  }

  public release(runId: string): void {
    this.admitted.delete(runId);
  }
}

export function isAppleHealthExperimentalEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.PIWIN_EXPERIMENTAL_APPLE_HEALTH === '1';
}
