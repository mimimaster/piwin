import { truncateToWidth, type Component } from '@earendil-works/pi-tui';

/** One-line footer under the editor; clipped, never wrapped. */
export class StatusLine implements Component {
  private text = '';

  public setText(text: string): void {
    this.text = text;
  }

  public invalidate(): void {
    // Stateless between frames: nothing cached.
  }

  public render(width: number): string[] {
    return [truncateToWidth(` ${this.text}`, width)];
  }
}
