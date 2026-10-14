/** Bounded raw terminal replay so a detached view can reconnect to the same process. */
export class NativeCliOutputBuffer {
  private readonly chunks: string[] = [];
  private size = 0;
  private sequence = 0;
  constructor(private readonly maxChars = 256 * 1024) {}

  append(data: string): void {
    this.sequence += 1;
    this.chunks.push(data);
    this.size += data.length;
    while (this.size > this.maxChars && this.chunks.length > 1) {
      const removed = this.chunks.shift();
      if (removed !== undefined) this.size -= removed.length;
    }
    const first = this.chunks[0];
    if (first !== undefined && first.length > this.maxChars) {
      let start = first.length - this.maxChars;
      const code = first.charCodeAt(start);
      if (code >= 0xdc00 && code <= 0xdfff) start += 1;
      this.chunks[0] = first.slice(start);
      this.size = this.chunks[0].length;
    }
  }

  getSequence(): number { return this.sequence; }

  read(): readonly string[] {
    return this.chunks;
  }
}
