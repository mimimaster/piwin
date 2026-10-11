const STATUS_HINT_MS = 4_000;

/**
 * A transient line in the status bar: kept for a few seconds, not one frame.
 * Pushes redraw the bar many times a second, so a hint cleared inside the
 * redraw that displays it would never reach the screen; the redraw keeps the
 * current hint and only this timer retires it.
 */
export class StatusHint {
  private current: { text: string; timer: ReturnType<typeof setTimeout> } | undefined;

  /** `onChange` redraws the bar after the hint appears or expires. */
  public constructor(private readonly onChange: () => void) {}

  public get text(): string | undefined {
    return this.current?.text;
  }

  public show(text: string): void {
    this.clearTimer();
    const timer = setTimeout(() => {
      this.current = undefined;
      this.onChange();
    }, STATUS_HINT_MS);
    timer.unref();
    this.current = { text, timer };
    this.onChange();
  }

  public dispose(): void {
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.current !== undefined) clearTimeout(this.current.timer);
  }
}
