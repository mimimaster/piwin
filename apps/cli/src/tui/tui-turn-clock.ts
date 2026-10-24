/**
 * Redraw clocks for the activity line (turn elapsed counter) and for running
 * subagent rows. Both timers are unref'd: a visual counter must never keep the
 * CLI process alive on its own.
 */
export class TuiTurnClock {
  private startedAt: number | undefined;
  private elapsedTimer: ReturnType<typeof setInterval> | undefined;
  private subagentTimer: ReturnType<typeof setInterval> | undefined;

  /** Absent when no turn is being counted. */
  public get turnStartedAt(): number | undefined {
    return this.startedAt;
  }

  public elapsedMs(): number {
    return this.startedAt === undefined ? 0 : Date.now() - this.startedAt;
  }

  /** Starts counting a turn and ticking `onTick` once a second; restarts any earlier count. */
  public startTurn(onTick: () => void): void {
    this.stopTurn();
    this.startedAt = Date.now();
    this.elapsedTimer = setInterval(onTick, 1000);
    this.elapsedTimer.unref?.();
  }

  public stopTurn(): void {
    if (this.elapsedTimer !== undefined) clearInterval(this.elapsedTimer);
    this.elapsedTimer = undefined;
    this.startedAt = undefined;
  }

  /** Ticks `onTick` while any subagent runs; stops once none does. */
  public syncSubagents(running: boolean, onTick: () => void): void {
    if (running && this.subagentTimer === undefined) {
      this.subagentTimer = setInterval(onTick, 1000);
      this.subagentTimer.unref?.();
    } else if (!running && this.subagentTimer !== undefined) {
      clearInterval(this.subagentTimer);
      this.subagentTimer = undefined;
    }
  }

  public dispose(): void {
    this.stopTurn();
    this.syncSubagents(false, () => undefined);
  }
}
