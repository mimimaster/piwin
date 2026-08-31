/** Correlate delayed Host decisions with the exact tool call, not the last call. */
export class PendingLiveTools {
  private readonly pending = new Set<string>();
  private readonly seen = new Set<string>();

  constructor(private readonly onOverflow: () => void) {}

  add(id: string): boolean {
    if (!id || this.seen.has(id)) return false;
    if (this.pending.size >= 16 || this.seen.size >= 256) {
      this.onOverflow();
      return false;
    }
    this.pending.add(id);
    this.seen.add(id);
    return true;
  }

  take(id: string | undefined): string | undefined {
    return id && this.pending.delete(id) ? id : undefined;
  }

  clear(): void { this.pending.clear(); this.seen.clear(); }
}
