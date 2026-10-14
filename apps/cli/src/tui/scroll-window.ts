import { Key, matchesKey } from '@earendil-works/pi-tui';

/**
 * Vertical scroll state for a read-only overlay body: which line is on top,
 * and the keys that move it. Shared by the diff/report viewer and the
 * subagent preview so both scroll the same way.
 */
export class ScrollWindow {
  public top = 0;
  /** Pinned to the end: new lines keep the newest one visible. */
  public following = false;

  public constructor(public readonly visible: number) {}

  public lastTop(total: number): number {
    return Math.max(0, total - this.visible);
  }

  /** Re-apply after the content changed: keep following, or clamp. */
  public settle(total: number): void {
    this.top = this.following ? this.lastTop(total) : Math.min(this.top, this.lastTop(total));
  }

  /** True when `data` was a scroll key (and was applied). */
  public handleKey(data: string, total: number): boolean {
    const last = this.lastTop(total);
    const moveTo = (top: number): void => {
      this.top = Math.min(last, Math.max(0, top));
      this.following = this.top === last;
    };
    if (matchesKey(data, Key.up) || data === 'k') moveTo(this.top - 1);
    else if (matchesKey(data, Key.down) || data === 'j') moveTo(this.top + 1);
    else if (matchesKey(data, Key.pageUp)) moveTo(this.top - this.visible);
    else if (matchesKey(data, Key.pageDown) || data === ' ') moveTo(this.top + this.visible);
    else if (matchesKey(data, Key.home) || data === 'g') moveTo(0);
    else if (matchesKey(data, Key.end) || data === 'G') moveTo(last);
    else return false;
    return true;
  }

  public slice<T>(lines: readonly T[]): T[] {
    return lines.slice(this.top, this.top + this.visible);
  }

  /** `12–31 / 80`, or `空` when there is nothing. */
  public position(total: number): string {
    if (total === 0) return '空';
    return `${this.top + 1}–${Math.min(total, this.top + this.visible)} / ${total}`;
  }
}
