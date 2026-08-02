/**
 * Resolve `${SECRET_NAME}` placeholders in MCP env values against collected
 * secrets. Throws if a required placeholder has no value.
 */
export function resolveSecretEnv(
  env: Record<string, string>,
  secrets: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(env)) {
    resolved[key] = replacePlaceholders(rawValue, secrets, key);
  }
  return resolved;
}

const PLACEHOLDER_PATTERN = /\$\{([A-Z0-9_]+)\}/g;

function replacePlaceholders(
  value: string,
  secrets: Record<string, string>,
  envKey: string,
): string {
  return value.replace(PLACEHOLDER_PATTERN, (match, name: string) => {
    const replacement = secrets[name];
    if (replacement === undefined || replacement.length === 0) {
      throw new Error(
        `Missing secret value for placeholder ${match} in env.${envKey}`,
      );
    }
    return replacement;
  });
}

/** Collect placeholder names referenced in env values. */
export function extractSecretPlaceholders(env: Record<string, string>): string[] {
  const names = new Set<string>();
  for (const value of Object.values(env)) {
    const matches = value.matchAll(PLACEHOLDER_PATTERN);
    for (const match of matches) {
      if (match[1] !== undefined) {
        names.add(match[1]);
      }
    }
  }
  return [...names].sort();
}
