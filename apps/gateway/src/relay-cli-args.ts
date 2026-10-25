export type ParsedRelayArgs = {
  positionals: string[];
  /** `--name value` and `--name=value`; bare `--flag` is `"true"`. */
  flags: Map<string, string>;
};

const BOOLEAN_FLAGS = new Set(['trust-proxy', 'log-ips', 'help']);

export function parseRelayArgs(argv: readonly string[]): ParsedRelayArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const equals = body.indexOf('=');
    if (equals !== -1) {
      flags.set(body.slice(0, equals), body.slice(equals + 1));
      continue;
    }
    if (BOOLEAN_FLAGS.has(body)) {
      flags.set(body, 'true');
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`--${body} needs a value`);
    }
    flags.set(body, value);
    index += 1;
  }
  return { positionals, flags };
}

export function readIntegerFlag(
  flags: Map<string, string>,
  name: string,
  range: { min: number; max: number },
): number | undefined {
  const raw = flags.get(name);
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    throw new Error(`--${name} must be an integer between ${range.min} and ${range.max}`);
  }
  return value;
}
