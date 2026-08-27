import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = dirname(fileURLToPath(import.meta.url));

export function loadModelStreamFixture(name: string): unknown[] {
  const parsed: unknown = JSON.parse(readFileSync(join(fixtureDir, name), 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`fixture ${name} must be a JSON array`);
  }
  return parsed;
}
