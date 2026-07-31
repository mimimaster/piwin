/**
 * CLI walkthrough commands (spec §13).
 *
 * The CLI has no hover UX but reuses the same Host commands as Desktop:
 *   - `piwin walkthrough list <session-id>`
 *   - `piwin walkthrough generate <session-id> <message-id>`
 *   - `piwin walkthrough export <session-id> <message-id> [--output <path>]`
 *
 * `generate` waits for the `walkthrough/updated` push with `ready` or `error`
 * status before printing Markdown. `export` writes Markdown only (no HTML),
 * with file-write safety (no path traversal, refuse to overwrite existing
 * files) when `--output` is provided, and writes to stdout otherwise.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve, normalize, relative, join } from 'node:path';
import type {
  HostCommand,
  HostPush,
  HostResponse,
  WalkthroughArtifact,
  WalkthroughGenerateData,
  WalkthroughListData,
} from '@piwin/contracts';

/* ------------------------------------------------------------------ */
/* Host client seam (testable)                                         */
/* ------------------------------------------------------------------ */

/**
 * Minimal host client surface the walkthrough commands need. The real CLI
 * wires this to `HostRuntime`; tests provide a mock. Kept intentionally narrow
 * so the command logic is unit-testable without spinning up a real host.
 */
export type WalkthroughHostClient = {
  handleCommand: (command: HostCommand) => Promise<HostResponse>;
  onPush: (handler: (message: HostPush) => void) => () => void;
  dispose: () => Promise<void>;
};

/* ------------------------------------------------------------------ */
/* Output formatting (pure, unit-tested)                               */
/* ------------------------------------------------------------------ */

/**
 * Format a single artifact row for the `list` table. Returns tab-separated
 * `messageId\tstatus\tmode\tgeneratedAt` (spec §13: message id, status, mode,
 * generated time). `generating` artifacts have no `generatedAt`; we emit `-`.
 */
export function formatWalkthroughListRow(artifact: WalkthroughArtifact): string {
  const generatedAt =
    artifact.status === 'ready' || artifact.status === 'error' ? artifact.generatedAt : '-';
  return `${artifact.messageId}\t${artifact.status}\t${artifact.mode}\t${generatedAt}`;
}

/**
 * Render the full `list` table with a header row. Empty input yields a single
 * placeholder line so the CLI never prints a bare header with no data.
 */
export function formatWalkthroughListTable(artifacts: WalkthroughArtifact[]): string {
  if (artifacts.length === 0) {
    return '(no walkthroughs)';
  }
  const header = 'messageId\tstatus\tmode\tgeneratedAt';
  const rows = artifacts.map(formatWalkthroughListRow);
  return [header, ...rows].join('\n');
}

/* ------------------------------------------------------------------ */
/* File-write safety (pure, unit-tested)                               */
/* ------------------------------------------------------------------ */

/**
 * Resolve a user-supplied `--output` path safely. The path must be absolute or
 * relative to `cwd`, must not escape `cwd` after normalization (no traversal),
 * and must not already exist (refuse to overwrite). Returns the resolved
 * absolute path or throws with a user-facing message.
 */
export function resolveExportOutputPath(
  outputPath: string,
  cwd: string,
  exists: (absPath: string) => boolean,
): string {
  const resolved = isAbsolute(outputPath)
    ? normalize(outputPath)
    : normalize(join(cwd, outputPath));
  // Path-traversal guard: a relative path must stay under cwd after normalize.
  const rel = relative(cwd, resolved);
  if (rel.startsWith('..') || rel === '') {
    // `rel === ''` means the path *is* cwd itself (a directory), which is not
    // a valid file target.
    if (rel === '') {
      throw new Error(`Output path resolves to the working directory: ${resolved}`);
    }
    throw new Error(`Output path escapes the working directory: ${outputPath}`);
  }
  if (exists(resolved)) {
    throw new Error(`Output file already exists (refusing to overwrite): ${resolved}`);
  }
  return resolved;
}

/* ------------------------------------------------------------------ */
/* Command implementations                                             */
/* ------------------------------------------------------------------ */

/**
 * `piwin walkthrough list <session-id>` — table of message id, status, mode,
 * generated time.
 */
export async function runWalkthroughList(
  client: WalkthroughHostClient,
  sessionId: string,
  log: (line: string) => void,
): Promise<void> {
  const response = await client.handleCommand({ type: 'walkthrough/list', sessionId });
  if (!response.success) {
    throw new Error(response.error);
  }
  const data = response.data as WalkthroughListData | undefined;
  const artifacts = data?.artifacts ?? [];
  log(formatWalkthroughListTable(artifacts));
}

/**
 * `piwin walkthrough generate <session-id> <message-id>` — waits for the
 * `walkthrough/updated` push with `ready` or `error` status, then prints the
 * Markdown (ready) or the error message (error).
 *
 * Returns the resolved artifact so callers (tests) can assert on it.
 */
export async function runWalkthroughGenerate(
  client: WalkthroughHostClient,
  sessionId: string,
  messageId: string,
  log: (line: string) => void,
  options?: { timeoutMs?: number },
): Promise<WalkthroughArtifact> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const wait = waitForWalkthroughUpdated(client, sessionId, messageId, timeoutMs);

  try {
    const response = await client.handleCommand({
      type: 'walkthrough/generate',
      sessionId,
      messageId,
    });
    if (!response.success) {
      throw new Error(response.error);
    }

    const data = response.data as WalkthroughGenerateData | undefined;

    // If the host returned a ready artifact directly (cached, no new generation),
    // print it without waiting for a push.
    if (data?.status === 'ready' && data.artifact) {
      printWalkthroughArtifact(data.artifact, log);
      return data.artifact;
    }

    // Otherwise wait for the walkthrough/updated push with ready|error.
    const artifact = await wait.promise;
    printWalkthroughArtifact(artifact, log);
    return artifact;
  } finally {
    // Always cancel the wait so the timeout timer and push subscription are
    // torn down on every exit path (success, host error, cached ready, throw).
    // Without this, an orphaned timer would reject with "Timed out waiting for
    // walkthrough generation" and become an unhandled promise rejection.
    wait.cancel();
  }
}

/**
 * `piwin walkthrough export <session-id> <message-id> [--output <path>]` —
 * writes Markdown only (no HTML). With `--output`, writes to the user-specified
 * path with file-write safety; without `--output`, writes Markdown to stdout.
 *
 * Export reads the existing artifact via `walkthrough/list` (the artifact is
 * persisted by the host after generation). If no ready artifact exists, the
 * command errors instead of silently triggering a generation.
 */
export async function runWalkthroughExport(
  client: WalkthroughHostClient,
  sessionId: string,
  messageId: string,
  log: (line: string) => void,
  options: { outputPath?: string; cwd?: string; exists?: (absPath: string) => boolean },
): Promise<void> {
  const response = await client.handleCommand({ type: 'walkthrough/list', sessionId });
  if (!response.success) {
    throw new Error(response.error);
  }
  const data = response.data as WalkthroughListData | undefined;
  const artifacts = data?.artifacts ?? [];
  const artifact = artifacts.find((item) => item.messageId === messageId);
  if (!artifact) {
    throw new Error(
      `No walkthrough artifact found for message ${messageId} in session ${sessionId}.`,
    );
  }
  if (artifact.status !== 'ready') {
    throw new Error(
      `Walkthrough artifact for message ${messageId} is ${artifact.status}, not ready. Run 'piwin walkthrough generate' first.`,
    );
  }

  const markdown = artifact.markdown;

  if (!options.outputPath) {
    // stdout: write Markdown directly. Use the provided `log` sink so tests can
    // capture output without touching real stdout.
    log(markdown);
    return;
  }

  const cwd = options.cwd ?? resolve(process.cwd());
  const exists = options.exists ?? ((absPath: string) => existsSync(absPath));
  const resolved = resolveExportOutputPath(options.outputPath, cwd, exists);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, markdown, 'utf8');
  log(`exported ${markdown.length} bytes to ${resolved}`);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Print a resolved artifact: Markdown for `ready`, error message for `error`.
 * Any other status is unexpected at this point and reported as an error.
 */
function printWalkthroughArtifact(
  artifact: WalkthroughArtifact,
  log: (line: string) => void,
): void {
  if (artifact.status === 'ready') {
    log(artifact.markdown);
    return;
  }
  if (artifact.status === 'error') {
    log(`[walkthrough error] ${artifact.error.code}: ${artifact.error.message}`);
    return;
  }
  log(`[walkthrough] unexpected status: ${artifact.status}`);
}

/**
 * Subscribe to host pushes and resolve when a `walkthrough/updated` push for
 * the matching `sessionId` + `messageId` arrives with `ready` or `error`
 * status. Rejects on timeout so the CLI does not hang forever.
 *
 * Returns `{ promise, cancel }`: callers MUST `cancel()` on every exit path
 * (try/finally) to tear down the timer and subscription. Otherwise an orphaned
 * timer would reject after `timeoutMs` and, since nobody awaits the promise,
 * surface as an unhandled promise rejection.
 */
function waitForWalkthroughUpdated(
  client: WalkthroughHostClient,
  sessionId: string,
  messageId: string,
  timeoutMs: number,
): { promise: Promise<WalkthroughArtifact>; cancel: () => void } {
  let resolvePromise!: (artifact: WalkthroughArtifact) => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<WalkthroughArtifact>((res, rej) => {
    resolvePromise = res;
    rejectPromise = rej;
  });

  let settled = false;
  let unsubscribe: () => void = () => undefined;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    unsubscribe();
    rejectPromise(new Error(`Timed out waiting for walkthrough generation (${timeoutMs}ms).`));
  }, timeoutMs);

  unsubscribe = client.onPush((message) => {
    if (message.type !== 'walkthrough/updated') return;
    if (message.sessionId !== sessionId) return;
    const artifact = message.artifact;
    if (artifact.messageId !== messageId) return;
    if (artifact.status !== 'ready' && artifact.status !== 'error') return;
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    unsubscribe();
    resolvePromise(artifact);
  });

  // Tear down the timer and subscription. Idempotent: safe to call after the
  // promise has already settled (success or timeout).
  const cancel = (): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    unsubscribe();
  };

  return { promise, cancel };
}
