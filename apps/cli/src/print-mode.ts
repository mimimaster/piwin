/**
 * `piwin -p <text>` is `piwin chat` for scripts, the way `claude -p` is: the
 * prompt comes from the arguments, and anything piped on stdin is appended to
 * it, so `git diff | piwin -p "review this"` works.
 */
export function printModeArgv(argv: readonly string[], piped: string | undefined): string[] {
  const rest = argv.slice(1);
  const attached = piped?.trim() ?? '';
  if (attached.length === 0) return ['chat', ...rest];
  const optionsWithValue = new Set(['--project', '--mode', '--image', '--permission-mode', '--scheme', '--ref', '--agent', '--output-format']);
  const words: string[] = [];
  const flags: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] ?? '';
    if (token.startsWith('--')) {
      flags.push(token);
      const value = rest[index + 1];
      if (optionsWithValue.has(token) && value !== undefined) {
        flags.push(value);
        index += 1;
      }
    } else {
      words.push(token);
    }
  }
  const prompt = words.join(' ').trim();
  return ['chat', ...flags, prompt.length === 0 ? attached : `${prompt}\n\n${attached}`];
}

export function isPrintFlag(token: string | undefined): boolean {
  return token === '-p' || token === '--print';
}

/**
 * How `-p` treats stdin:
 * - `--no-stdin`: never read it;
 * - `-` as an argument: read it to the end, however long the writer takes;
 * - otherwise: read it only if data shows up within a short window. A parent
 *   process that leaves stdin open without writing (CI steps, editors, some
 *   task runners) would otherwise hang `-p` forever waiting for EOF.
 */
export type StdinMode = 'skip' | 'wait' | 'probe';

export function takeStdinMode(argv: readonly string[]): { argv: string[]; mode: StdinMode } {
  const mode: StdinMode = argv.includes('--no-stdin') ? 'skip' : argv.slice(1).includes('-') ? 'wait' : 'probe';
  return { argv: argv.filter((token, index) => token !== '--no-stdin' && !(index > 0 && token === '-')), mode };
}

export const STDIN_PROBE_MS = 200;

export async function readPrintStdin(
  stream: NodeJS.ReadableStream & { isTTY?: boolean },
  mode: StdinMode,
  probeMs = STDIN_PROBE_MS,
): Promise<string | undefined> {
  if (mode === 'skip' || (stream.isTTY === true && mode !== 'wait')) return undefined;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: string | undefined): void => {
      if (timer !== undefined) clearTimeout(timer);
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
      stream.pause();
      resolve(value);
    };
    const onData = (chunk: Buffer | string): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };
    const onEnd = (): void => finish(chunks.length === 0 ? undefined : Buffer.concat(chunks).toString('utf8'));
    const onError = (error: unknown): void => {
      if (timer !== undefined) clearTimeout(timer);
      reject(error);
    };
    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('error', onError);
    if (mode === 'probe') {
      // Nothing arrived in time: treat stdin as not part of the prompt.
      timer = setTimeout(() => finish(undefined), probeMs);
    }
  });
}
