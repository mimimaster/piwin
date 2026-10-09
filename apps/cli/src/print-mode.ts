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
