import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseRegistryIndex } from './parse-registry-index.js';

/**
 * Copy of piwin-extensions `schema/fixtures`. The registry CI must never admit
 * an entry this parser drops: `valid/` and `invalid-strict/` (CI-only form
 * rules this parser normalizes) are kept, `invalid/` is dropped.
 */
const root = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'entries');

function entriesUnder(group: string): Array<Record<string, unknown>> {
  const base = join(root, group);
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else if (name.endsWith('.json')) files.push(path);
    }
  };
  visit(base);
  return files.sort().map((file) => {
    const [, owner, name] = relative(base, file).replace(/\.json$/, '').split('/');
    const entry = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    return { id: `${owner}/${name}`, ...entry };
  });
}

function parsedIds(group: string): string[] {
  const { index } = parseRegistryIndex({
    schemaVersion: 1,
    generatedAt: '',
    extensions: entriesUnder(group),
  });
  return index.extensions.map((entry) => entry.id);
}

describe('registry entry fixtures shared with piwin-extensions', () => {
  it('keeps every valid entry', () => {
    expect(parsedIds('valid')).toEqual(['acme/minimal', 'alice/git-autopilot', 'yorick/git-autopilot']);
  });

  it('drops every entry that breaks a shared rule', () => {
    expect(entriesUnder('invalid')).toHaveLength(9);
    expect(parsedIds('invalid')).toEqual([]);
  });

  it('normalizes the CI-only strict cases instead of dropping them', () => {
    expect(parsedIds('invalid-strict')).toHaveLength(3);
  });
});
