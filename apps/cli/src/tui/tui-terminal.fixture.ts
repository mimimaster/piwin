import { stripTerminalSequences, type Terminal } from '@earendil-works/pi-tui';

const ANSI_PATTERN =
  /\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[_P^][^\x1b]*\x1b\\|\x1b[@-Z\\-_]/g;

/** Records real pi-tui viewport writes; no emulator or renderer internals. */
export class TuiTestTerminal implements Terminal {
  public readonly kittyProtocolActive = false;
  public output = '';
  public title = '';
  public readonly screen = new Map<number, string>();
  private input: ((data: string) => void) | undefined;
  private resized: (() => void) | undefined;
  public constructor(
    public columns = 80,
    public rows = 24,
  ) {}
  public start(input: (data: string) => void, resized: () => void): void {
    this.input = input;
    this.resized = resized;
  }
  public stop(): void {
    this.input = undefined;
  }
  public async drainInput(): Promise<void> {}
  public write(data: string): void {
    this.output += data;
    if (data.includes('\x1b[2J')) this.screen.clear();
    for (const match of data.matchAll(
      /\x1b\[(\d+);1H\x1b\[2K([\s\S]*?)(?=\x1b\[\d+;\d+H|\x1b\[\?25[hl]|\x1b\[\?2026l|$)/g,
    )) {
      this.screen.set(Number(match[1]), stripTerminalSequences(match[2] ?? '').trimEnd());
    }
  }
  public moveBy(): void {}
  public hideCursor(): void {}
  public showCursor(): void {}
  public clearLine(): void {}
  public clearFromCursor(): void {}
  public clearScreen(): void {}
  public setTitle(title: string): void {
    this.title = title;
  }
  public setProgress(): void {}
  public type(data: string): void {
    this.input?.(data);
  }
  public resize(columns: number, rows: number): void {
    this.columns = columns;
    this.rows = rows;
    this.resized?.();
  }
  public get length(): number {
    return this.output.length;
  }
  public rawSince(mark: number): string {
    return this.output.slice(mark);
  }
  public textSince(mark: number): string {
    return this.rawSince(mark).replace(ANSI_PATTERN, '');
  }
  public text(): string {
    return this.textSince(0);
  }
}
