/**
 * Validate theme packages: tokens only, no executable payloads.
 */
import type { ThemeColorTokens, ThemeManifest } from '@piwin/contracts';

const REQUIRED_TOKEN_KEYS: Array<keyof ThemeColorTokens> = [
  'bg',
  'panel',
  'panel2',
  'border',
  'text',
  'muted',
  'accent',
  'accent2',
  'danger',
  'ok',
  'radius',
  'font',
];

const COLOR_OR_CSS =
  /^(#([0-9a-fA-F]{3,8})|rgba?\([^)]+\)|hsla?\([^)]+\)|transparent|currentColor|[a-zA-Z][a-zA-Z0-9-]*|var\(--[a-zA-Z0-9-]+\))$/;

const SAFE_FONT = /^[a-zA-Z0-9\s,"'_\-]+$/;
const SAFE_RADIUS = /^[0-9.]+(px|rem|em|%)$/;

export type ThemeValidationIssue = {
  path: string;
  message: string;
};

export type ThemeValidationResult =
  | { ok: true; manifest: ThemeManifest }
  | { ok: false; issues: ThemeValidationIssue[] };

export function validateThemeManifest(value: unknown): ThemeValidationResult {
  const issues: ThemeValidationIssue[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: [{ path: '', message: 'manifest must be an object' }] };
  }
  const record = value as Record<string, unknown>;

  const id = asNonEmptyString(record.id);
  if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    issues.push({ path: 'id', message: 'id must match [a-z0-9][a-z0-9-]*' });
  }
  const name = asNonEmptyString(record.name);
  if (!name) {
    issues.push({ path: 'name', message: 'name is required' });
  }
  const version = asNonEmptyString(record.version);
  if (!version) {
    issues.push({ path: 'version', message: 'version is required' });
  }
  const mode = record.mode === 'light' || record.mode === 'dark' ? record.mode : null;
  if (!mode) {
    issues.push({ path: 'mode', message: 'mode must be dark|light' });
  }

  const tokensRaw = record.tokens;
  if (!tokensRaw || typeof tokensRaw !== 'object' || Array.isArray(tokensRaw)) {
    issues.push({ path: 'tokens', message: 'tokens object is required' });
  }

  // Reject executable payloads if present
  for (const banned of ['css', 'js', 'script', 'stylesheets', 'javascript']) {
    if (banned in record) {
      issues.push({ path: banned, message: 'executable theme payloads are not allowed' });
    }
  }

  if (issues.length > 0 || !tokensRaw || typeof tokensRaw !== 'object') {
    return { ok: false, issues };
  }

  const tokensRecord = tokensRaw as Record<string, unknown>;
  const tokens = {} as ThemeColorTokens;
  for (const key of REQUIRED_TOKEN_KEYS) {
    const tokenValue = asNonEmptyString(tokensRecord[key]);
    if (!tokenValue) {
      issues.push({ path: `tokens.${key}`, message: 'required token missing' });
      continue;
    }
    if (key === 'font') {
      if (!SAFE_FONT.test(tokenValue) || tokenValue.includes('url(') || tokenValue.includes('@import')) {
        issues.push({ path: `tokens.${key}`, message: 'unsafe font token' });
        continue;
      }
    } else if (key === 'radius') {
      if (!SAFE_RADIUS.test(tokenValue)) {
        issues.push({ path: `tokens.${key}`, message: 'invalid radius token' });
        continue;
      }
    } else if (!COLOR_OR_CSS.test(tokenValue) || tokenValue.includes('url(') || tokenValue.includes('expression')) {
      issues.push({ path: `tokens.${key}`, message: 'invalid color token' });
      continue;
    }
    tokens[key] = tokenValue;
  }

  if (issues.length > 0 || !id || !name || !version || !mode) {
    return { ok: false, issues };
  }

  const manifest: ThemeManifest = {
    id,
    name,
    version,
    mode,
    tokens,
  };
  const description = asNonEmptyString(record.description);
  if (description) {
    manifest.description = description;
  }
  if (record.artifact && typeof record.artifact === 'object' && !Array.isArray(record.artifact)) {
    const artifact: NonNullable<ThemeManifest['artifact']> = {};
    for (const [key, raw] of Object.entries(record.artifact as Record<string, unknown>)) {
      if (typeof raw === 'string' && raw.trim()) {
        (artifact as Record<string, string>)[key] = raw.trim();
      }
    }
    if (Object.keys(artifact).length > 0) {
      manifest.artifact = artifact;
    }
  }
  return { ok: true, manifest };
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
