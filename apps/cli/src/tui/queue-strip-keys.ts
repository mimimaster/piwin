import { Key, matchesKey } from '@earendil-works/pi-tui';
import type { QueueStrip } from './queue-strip.js';
import type { TuiInterventionTracker } from './tui-intervention-tracker.js';
import type { TuiQueueController } from './tui-queue-controller.js';

export type QueueStripActions = {
  queue: Pick<TuiQueueController, 'steerNow' | 'editTurn' | 'cancel'>;
  interventions: Pick<TuiInterventionTracker, 'cancel' | 'requeue'>;
  refresh: () => void;
  onError: (error: unknown) => void;
};

/**
 * Keys for the strip above the composer. Alt+↑ focuses it; then ↑↓ choose,
 * Enter steers a queued turn now (or re-queues a failed steer), E pulls a
 * queued turn back into the composer, Del cancels, Esc / Alt+↓ return.
 * Returns true when the key was the strip's.
 */
export function handleQueueStripKey(
  strip: QueueStrip,
  data: string,
  focusRequested: boolean,
  actions: QueueStripActions,
): boolean {
  if (!strip.focused) {
    if (!focusRequested || strip.current() === undefined) return false;
    strip.focused = true;
    actions.refresh();
    return true;
  }
  const row = strip.current();
  const run = (work: Promise<void> | undefined): void => {
    work?.then(actions.refresh, actions.onError);
  };
  if (row === undefined || matchesKey(data, Key.escape) || matchesKey(data, Key.alt('down'))) {
    strip.focused = false;
  } else if (matchesKey(data, Key.up) || focusRequested) {
    strip.move(-1);
  } else if (matchesKey(data, Key.down)) {
    strip.move(1);
  } else if (matchesKey(data, Key.enter)) {
    if (row.kind === 'queued') run(actions.queue.steerNow(row.turn));
    else if (row.failed) run(actions.interventions.requeue(row.intervention));
  } else if (data === 'e' || data === 'E') {
    if (row.kind === 'queued') {
      strip.focused = false;
      run(actions.queue.editTurn(row.turn));
    }
  } else if (matchesKey(data, Key.delete) || matchesKey(data, Key.backspace)) {
    run(row.kind === 'queued' ? actions.queue.cancel(row.turn) : actions.interventions.cancel(row.intervention));
  } else {
    // Anything else goes back to typing; the strip lets go of the keyboard.
    strip.focused = false;
    actions.refresh();
    return false;
  }
  actions.refresh();
  return true;
}
