const DEFAULT_MIN_RUN_MS = 10_000;
/** Terminals known to turn OSC 9 into a desktop notification; others get the bell. */
const OSC9_TERMINALS = new Set(['iTerm.app', 'ghostty', 'WezTerm']);

export type TurnNotifierOptions = {
  /** Writes raw bytes to the terminal. */
  write: (data: string) => void;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  /** A run shorter than this finishes while the person is still watching. */
  minRunMs?: number;
};

/**
 * Tells a person who looked away that the agent needs them: a long turn
 * finished, or a question is waiting. `PIWIN_TUI_NOTIFY=off` silences it;
 * `bell` or `osc9` forces one signal; otherwise the bell, plus a desktop
 * notification where the terminal is known to show one.
 */
export class TurnNotifier {
  private readonly env: NodeJS.ProcessEnv;
  private readonly now: () => number;
  private readonly minRunMs: number;
  private runStartedAt: number | undefined;

  public constructor(private readonly options: TurnNotifierOptions) {
    this.env = options.env ?? process.env;
    this.now = options.now ?? Date.now;
    this.minRunMs = options.minRunMs ?? DEFAULT_MIN_RUN_MS;
  }

  /** Feed the run state on every redraw; only a change does anything. */
  public observeRunning(running: boolean): void {
    if (running) {
      this.runStartedAt ??= this.now();
      return;
    }
    const startedAt = this.runStartedAt;
    this.runStartedAt = undefined;
    if (startedAt !== undefined && this.now() - startedAt >= this.minRunMs) this.signal('piwin：这一轮完成了');
  }

  /** A question is waiting on the person. */
  public attention(message: string): void {
    this.signal(`piwin：${message}`);
  }

  private signal(message: string): void {
    const mode = this.env.PIWIN_TUI_NOTIFY?.toLowerCase();
    if (mode === 'off' || mode === '0' || mode === 'false') return;
    const osc9 = mode === 'osc9' || (mode !== 'bell' && OSC9_TERMINALS.has(this.env.TERM_PROGRAM ?? ''));
    const bell = mode !== 'osc9';
    // The text rides inside an escape sequence, so strip anything that could end it early.
    const safe = message.replace(/[\x00-\x1f\x7f]/g, ' ');
    this.options.write(`${bell ? '\x07' : ''}${osc9 ? `\x1b]9;${safe}\x07` : ''}`);
  }
}
