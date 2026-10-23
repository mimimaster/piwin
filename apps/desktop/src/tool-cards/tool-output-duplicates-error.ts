import type { ToolErrorView } from '@piwin/contracts';

/**
 * Host packs the same failure string into both `presentation.error` and
 * `output` (error.message is often a short slice / wrapper of the output).
 * The card already shows a structured error row — suppress the body pre when
 * it would only repeat that row.
 *
 * Long stderr that merely *starts with* the error message stays visible.
 */
export function toolOutputDuplicatesError(
  output: string | undefined,
  error: ToolErrorView | undefined,
): boolean {
  if (!output || !error) return false;
  const out = output.replace(/\s+/g, ' ').trim();
  const msg = error.message.replace(/\s+/g, ' ').trim();
  if (!out || !msg) return false;
  if (out === msg) return true;

  const labeled = `${error.category}: ${msg}`;
  if (out === labeled) return true;

  // Adapters often wrap as "Tool error (execution-failed): <message>".
  const stripped = out.replace(/^Tool error \([^)]+\):\s*/i, '').trim();
  if (stripped === msg || stripped === labeled) return true;

  // Host stores error.message as a short slice of the same output — only treat
  // as duplicate when the body adds almost nothing beyond that slice / wrapper
  // (e.g. trailing "exit 1"). Longer stderr stays visible under the error row.
  const prefixSlack = 24;
  if (out.startsWith(msg) && out.length <= msg.length + prefixSlack) {
    return true;
  }
  if (stripped.startsWith(msg) && stripped.length <= msg.length + prefixSlack) {
    return true;
  }
  return false;
}
