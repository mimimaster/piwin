/**
 * Golden table for Host-side path resolution (ADR 0052 §6).
 *
 * One row per path *spelling*, run against all four Host shapes we support:
 *
 * | scenario     | what it means                                                |
 * |--------------|--------------------------------------------------------------|
 * | local-host   | the sidecar on the user's machine: host paths are readable    |
 * | remote-shell | a client on another machine: host paths are refused           |
 * | test-root    | a Host rooted at `~/.piwin-test` (never the product store)     |
 * | windows-root | a Windows Host (`C:\Users\…`, backslash spellings)            |
 *
 * Every historical regression has a row, so a fix cannot silently un-fix it:
 * the `~/.piwin/pi-agent/auth.json` chip that went looking for
 * `<project>/~/.piwin/…`, the `/tmp` vs `/private/tmp` workspace alias, the
 * `file://` scheme, percent-escapes, the bare file name only
 * `project/find-file` can place, a vanished workspace root, and a Windows
 * spelling arriving at a POSIX Host.
 *
 * The filesystem is a fixture, not the developer's disk, so the table answers
 * the same way on every OS.
 */
import { describe, expect, it } from 'vitest';
import type { DocumentPathResolveData, DocumentTargetRef } from '@piwin/contracts';
import { resolveDocumentPath, type FindProjectFileOutcome } from './document-path-resolution.js';

type ScenarioId = 'local-host' | 'remote-shell' | 'test-root' | 'windows-root';

const SCENARIO_IDS: readonly ScenarioId[] = [
  'local-host',
  'remote-shell',
  'test-root',
  'windows-root',
];

type Scenario = {
  id: ScenarioId;
  /** Paths that exist. A trailing separator marks a directory. */
  existing: string[];
  /** `realpath` answers for the entries that are aliases; identity otherwise. */
  realpaths?: Record<string, string>;
  piwinRoot: string;
  homeDir: string;
  projectPath: string;
  localFilePolicy: 'allowed' | 'denied';
  findFile?: FindProjectFileOutcome;
  /** The registered workspace folder is gone (temp cleanup). */
  projectRootMissing?: boolean;
  sep: '/' | '\\';
};

type Expected =
  { status: 'resolved'; target: DocumentTargetRef } | { status: 'unresolved'; reason: string };

function projectFile(relativePath: string): Expected {
  return {
    status: 'resolved',
    target: { kind: 'project-file', relativePath, displayRef: relativePath },
  };
}

function localFile(absolutePath: string, displayRef: string): Expected {
  return { status: 'resolved', target: { kind: 'local-file', absolutePath, displayRef } };
}

function trustedConfig(storeName: string, relativePath: string): Expected {
  return {
    status: 'resolved',
    target: {
      kind: 'trusted-config',
      relativePath,
      displayRef: `~/${storeName}/${relativePath}`,
    },
  };
}

function mediaTarget(): Expected {
  return {
    status: 'resolved',
    target: {
      kind: 'media',
      sessionId: 'sess-1',
      assetId: '0b1c2d3e-4f5a-6789-abcd-ef0123456789',
      displayRef: '0b1c2d3e-4f5a-6789-abcd-ef0123456789.png',
    },
  };
}

function skillTarget(): Expected {
  return {
    status: 'resolved',
    target: { kind: 'skill', skillId: 'imagegen', displayRef: 'skill:imagegen' },
  };
}

function unresolved(reason: string): Expected {
  return { status: 'unresolved', reason };
}

const LOCAL_HOST: Scenario = {
  id: 'local-host',
  piwinRoot: '/Users/wren/.piwin',
  homeDir: '/Users/wren',
  projectPath: '/Users/wren/proj',
  localFilePolicy: 'allowed',
  sep: '/',
  existing: [
    '/Users/wren/',
    '/Users/wren/proj/',
    '/Users/wren/proj/docs/plan.md',
    '/Users/wren/proj/docs/my plan.md',
    '/Users/wren/proj/shots/01-endpoint-loop.png',
    '/Users/wren/.piwin/',
    '/Users/wren/.piwin/config.json',
    '/Users/wren/.piwin/pi-agent/',
    '/Users/wren/.piwin/pi-agent/auth.json',
    '/Users/wren/.piwin/skills/imagegen/SKILL.md',
    '/Users/wren/.piwin/media/sess-1/0b1c2d3e-4f5a-6789-abcd-ef0123456789.png',
    '/tmp/notes.md',
    // The workspace reached through its /tmp spelling (alias row).
    '/tmp/proj/docs/plan.md',
  ],
  realpaths: { '/tmp/proj/docs/plan.md': '/Users/wren/proj/docs/plan.md' },
  findFile: { kind: 'unique', relativePath: 'shots/01-endpoint-loop.png' },
};

const REMOTE_SHELL: Scenario = {
  ...LOCAL_HOST,
  id: 'remote-shell',
  localFilePolicy: 'denied',
};

const TEST_ROOT: Scenario = {
  id: 'test-root',
  piwinRoot: '/Users/wren/.piwin-test',
  homeDir: '/Users/wren',
  projectPath: '/Users/wren/proj',
  localFilePolicy: 'allowed',
  sep: '/',
  existing: [
    '/Users/wren/',
    '/Users/wren/proj/',
    '/Users/wren/proj/docs/plan.md',
    '/Users/wren/proj/docs/my plan.md',
    '/Users/wren/proj/shots/01-endpoint-loop.png',
    '/Users/wren/.piwin-test/',
    '/Users/wren/.piwin-test/config.json',
    '/Users/wren/.piwin-test/skills/imagegen/SKILL.md',
    // The product store exists on this machine but is *not* this Host's root.
    '/Users/wren/.piwin/',
    '/Users/wren/.piwin/config.json',
    '/Users/wren/.piwin/pi-agent/',
    '/Users/wren/.piwin/pi-agent/auth.json',
    '/tmp/notes.md',
    '/tmp/proj/docs/plan.md',
  ],
  realpaths: { '/tmp/proj/docs/plan.md': '/Users/wren/proj/docs/plan.md' },
  findFile: { kind: 'unique', relativePath: 'shots/01-endpoint-loop.png' },
};

const WINDOWS_ROOT: Scenario = {
  id: 'windows-root',
  piwinRoot: 'C:\\Users\\wren\\.piwin',
  homeDir: 'C:\\Users\\wren',
  projectPath: 'C:\\Users\\wren\\proj',
  localFilePolicy: 'allowed',
  sep: '\\',
  existing: [
    'C:\\Users\\wren\\',
    'C:\\Users\\wren\\proj\\',
    'C:\\Users\\wren\\proj\\docs\\plan.md',
    'C:\\Users\\wren\\proj\\docs\\my plan.md',
    'C:\\Users\\wren\\proj\\shots\\01-endpoint-loop.png',
    'C:\\Users\\wren\\.piwin\\',
    'C:\\Users\\wren\\.piwin\\config.json',
    'C:\\Users\\wren\\.piwin\\pi-agent\\',
    'C:\\Users\\wren\\.piwin\\pi-agent\\auth.json',
    'C:\\Users\\wren\\.piwin\\skills\\imagegen\\SKILL.md',
    'C:\\Users\\wren\\.piwin\\media\\sess-1\\0b1c2d3e-4f5a-6789-abcd-ef0123456789.png',
    'C:\\tmp\\notes.md',
    'C:\\tmp\\proj\\docs\\plan.md',
  ],
  realpaths: { 'C:\\tmp\\proj\\docs\\plan.md': 'C:\\Users\\wren\\proj\\docs\\plan.md' },
  findFile: { kind: 'unique', relativePath: 'shots/01-endpoint-loop.png' },
};

const ALL_SCENARIOS: Record<ScenarioId, Scenario> = {
  'local-host': LOCAL_HOST,
  'remote-shell': REMOTE_SHELL,
  'test-root': TEST_ROOT,
  'windows-root': WINDOWS_ROOT,
};

/** The store's directory name as this scenario spells it. */
function storeName(s: Scenario): string {
  return s.piwinRoot.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? '.piwin';
}

function joinPath(s: Scenario, ...parts: string[]): string {
  return parts.join(s.sep);
}

type Row = {
  id: string;
  /** The spelling under test, computed for the scenario. */
  path: (s: Scenario) => string;
  /** Skip the workspace argument (rows about a path with no workspace). */
  withoutProject?: boolean;
  /**
   * Per-cell fixture patches. A row about an ambiguous name, or about a
   * workspace that vanished, must not run on the default fixture.
   */
  overrides?: Partial<Record<ScenarioId, Partial<Scenario>>>;
  /** The full answer for each Host shape — the golden cells. */
  expect: Record<ScenarioId, Expected>;
};

const ROWS: Row[] = [
  {
    id: 'project-relative path',
    path: () => 'docs/plan.md',
    expect: {
      'local-host': projectFile('docs/plan.md'),
      'remote-shell': projectFile('docs/plan.md'),
      'test-root': projectFile('docs/plan.md'),
      'windows-root': projectFile('docs/plan.md'),
    },
  },
  {
    id: 'project-absolute path',
    path: (s) => joinPath(s, s.projectPath, 'docs', 'plan.md'),
    expect: {
      'local-host': projectFile('docs/plan.md'),
      'remote-shell': projectFile('docs/plan.md'),
      'test-root': projectFile('docs/plan.md'),
      'windows-root': projectFile('docs/plan.md'),
    },
  },
  {
    id: 'workspace reached through a realpath alias (/tmp vs /private/tmp)',
    path: (s) => joinPath(s, s.sep === '\\' ? 'C:\\tmp\\proj' : '/tmp/proj', 'docs', 'plan.md'),
    expect: {
      'local-host': projectFile('docs/plan.md'),
      'remote-shell': projectFile('docs/plan.md'),
      'test-root': projectFile('docs/plan.md'),
      'windows-root': projectFile('docs/plan.md'),
    },
  },
  {
    id: 'file:// scheme',
    path: (s) => `file://${joinPath(s, s.projectPath, 'docs', 'plan.md')}`,
    expect: {
      'local-host': projectFile('docs/plan.md'),
      'remote-shell': projectFile('docs/plan.md'),
      'test-root': projectFile('docs/plan.md'),
      'windows-root': projectFile('docs/plan.md'),
    },
  },
  {
    id: 'percent-encoded path',
    path: (s) => joinPath(s, s.projectPath, 'docs', 'my%20plan.md'),
    expect: {
      'local-host': projectFile('docs/my plan.md'),
      'remote-shell': projectFile('docs/my plan.md'),
      'test-root': projectFile('docs/my plan.md'),
      'windows-root': projectFile('docs/my plan.md'),
    },
  },
  {
    id: 'bare file name placed by project/find-file',
    path: () => '01-endpoint-loop.png',
    expect: {
      'local-host': projectFile('shots/01-endpoint-loop.png'),
      'remote-shell': projectFile('shots/01-endpoint-loop.png'),
      'test-root': projectFile('shots/01-endpoint-loop.png'),
      'windows-root': projectFile('shots/01-endpoint-loop.png'),
    },
  },
  {
    id: 'ambiguous bare file name never guesses',
    path: () => 'README.md',
    overrides: everyScenario({
      findFile: { kind: 'ambiguous', relativePaths: ['a/README.md', 'b/README.md'] },
    }),
    expect: {
      'local-host': unresolved('ambiguous-file'),
      'remote-shell': unresolved('ambiguous-file'),
      'test-root': unresolved('ambiguous-file'),
      'windows-root': unresolved('ambiguous-file'),
    },
  },
  {
    id: 'vanished workspace root is named as such',
    path: (s) => joinPath(s, s.projectPath, 'notes.md'),
    overrides: everyScenario({ projectRootMissing: true }),
    expect: {
      'local-host': unresolved('project-root-missing'),
      'remote-shell': unresolved('project-root-missing'),
      'test-root': unresolved('project-root-missing'),
      'windows-root': unresolved('project-root-missing'),
    },
  },
  {
    id: 'home path outside every store',
    path: (s) => joinPath(s, '~', 'notes', 'plan.md'),
    expect: {
      'local-host': unresolved('not-found'),
      'remote-shell': unresolved('remote-local-path-denied'),
      'test-root': unresolved('not-found'),
      'windows-root': unresolved('not-found'),
    },
  },
  {
    id: 'config store reached with ~',
    path: (s) => joinPath(s, '~', storeName(s), 'pi-agent', 'auth.json'),
    expect: {
      'local-host': trustedConfig('.piwin', 'pi-agent/auth.json'),
      'remote-shell': trustedConfig('.piwin', 'pi-agent/auth.json'),
      'test-root': trustedConfig('.piwin-test', 'pi-agent/auth.json'),
      'windows-root': trustedConfig('.piwin', 'pi-agent/auth.json'),
    },
  },
  {
    // The reported loop: this chip used to be read as `<project>/~/.piwin/…`.
    id: 'product store named literally on another store (regression)',
    path: (s) => joinPath(s, '~', '.piwin', 'pi-agent', 'auth.json'),
    expect: {
      'local-host': trustedConfig('.piwin', 'pi-agent/auth.json'),
      'remote-shell': trustedConfig('.piwin', 'pi-agent/auth.json'),
      // A different store's file on this machine: previewable as a host path,
      // never read from this root under the same relative name.
      'test-root': localFile(
        '/Users/wren/.piwin/pi-agent/auth.json',
        '~/.piwin/pi-agent/auth.json',
      ),
      'windows-root': trustedConfig('.piwin', 'pi-agent/auth.json'),
    },
  },
  {
    id: 'config store absolute path',
    path: (s) => joinPath(s, s.piwinRoot, 'config.json'),
    expect: {
      'local-host': trustedConfig('.piwin', 'config.json'),
      'remote-shell': trustedConfig('.piwin', 'config.json'),
      'test-root': trustedConfig('.piwin-test', 'config.json'),
      'windows-root': trustedConfig('.piwin', 'config.json'),
    },
  },
  {
    id: 'windows spelling on a POSIX Host is not that Host store',
    path: () => 'C:\\Users\\wren\\.piwin\\config.json',
    expect: {
      'local-host': unresolved('not-found'),
      'remote-shell': unresolved('remote-local-path-denied'),
      'test-root': unresolved('not-found'),
      'windows-root': trustedConfig('.piwin', 'config.json'),
    },
  },
  {
    id: 'media vault asset becomes a logical target',
    path: (s) =>
      joinPath(s, s.piwinRoot, 'media', 'sess-1', '0b1c2d3e-4f5a-6789-abcd-ef0123456789.png'),
    expect: {
      'local-host': mediaTarget(),
      'remote-shell': mediaTarget(),
      'test-root': mediaTarget(),
      'windows-root': mediaTarget(),
    },
  },
  {
    id: 'skill document becomes a logical target',
    path: (s) => joinPath(s, s.piwinRoot, 'skills', 'imagegen', 'SKILL.md'),
    expect: {
      'local-host': skillTarget(),
      'remote-shell': skillTarget(),
      'test-root': skillTarget(),
      'windows-root': skillTarget(),
    },
  },
  {
    id: 'host path outside every domain',
    path: (s) => (s.sep === '\\' ? 'C:\\tmp\\notes.md' : '/tmp/notes.md'),
    expect: {
      'local-host': localFile('/tmp/notes.md', '/tmp/notes.md'),
      'remote-shell': unresolved('remote-local-path-denied'),
      'test-root': localFile('/tmp/notes.md', '/tmp/notes.md'),
      'windows-root': localFile('C:/tmp/notes.md', 'C:\\tmp\\notes.md'),
    },
  },
  {
    id: 'unrelated absolute path that does not exist',
    path: () => '/tmp/gone.md',
    expect: {
      'local-host': unresolved('not-found'),
      'remote-shell': unresolved('remote-local-path-denied'),
      'test-root': unresolved('not-found'),
      'windows-root': unresolved('not-found'),
    },
  },
  {
    id: 'relative name that misses the workspace',
    path: () => 'notes.md',
    overrides: everyScenario({ findFile: { kind: 'none' } }),
    expect: {
      'local-host': unresolved('not-found'),
      'remote-shell': unresolved('not-found'),
      'test-root': unresolved('not-found'),
      'windows-root': unresolved('not-found'),
    },
  },
  {
    id: 'relative path that climbs out of the workspace',
    path: (s) => joinPath(s, '..', 'outside.md'),
    expect: {
      'local-host': unresolved('outside-domains'),
      'remote-shell': unresolved('outside-domains'),
      'test-root': unresolved('outside-domains'),
      'windows-root': unresolved('outside-domains'),
    },
  },
  {
    id: 'relative path with no workspace at all',
    path: () => 'notes.md',
    withoutProject: true,
    expect: {
      'local-host': unresolved('outside-domains'),
      'remote-shell': unresolved('outside-domains'),
      'test-root': unresolved('outside-domains'),
      'windows-root': unresolved('outside-domains'),
    },
  },
  {
    id: 'empty path is refused before any filesystem hop',
    path: () => '   ',
    withoutProject: true,
    expect: {
      'local-host': unresolved('empty-path'),
      'remote-shell': unresolved('empty-path'),
      'test-root': unresolved('empty-path'),
      'windows-root': unresolved('empty-path'),
    },
  },
  {
    id: 'broken percent escape is refused, not guessed',
    path: (s) => joinPath(s, s.projectPath, 'docs', '%E0%A4%A.md'),
    expect: {
      'local-host': unresolved('invalid-path'),
      'remote-shell': unresolved('invalid-path'),
      'test-root': unresolved('invalid-path'),
      'windows-root': unresolved('invalid-path'),
    },
  },
];

/** The same patch for all four Host shapes. */
function everyScenario(patch: Partial<Scenario>): Partial<Record<ScenarioId, Partial<Scenario>>> {
  return {
    'local-host': patch,
    'remote-shell': patch,
    'test-root': patch,
    'windows-root': patch,
  };
}

/** Reasons produced before any route runs — nothing was tried yet. */
const PRE_ROUTE_REASONS = new Set(['empty-path', 'invalid-path']);

function createDeps(s: Scenario) {
  const caseFold = s.id === 'windows-root';
  const normalize = (value: string): string => {
    const slashed = value.replace(/\\/g, '/').replace(/\/+$/, '');
    return caseFold ? slashed.toLowerCase() : slashed;
  };
  const directories = new Set(s.existing.filter((entry) => /[\\/]$/.test(entry)).map(normalize));
  const present = new Set(s.existing.map(normalize));
  const aliases = new Map(
    Object.entries(s.realpaths ?? {}).map(([from, to]) => [normalize(from), to]),
  );
  return {
    piwinRoot: s.piwinRoot,
    homeDir: s.homeDir,
    localFilePolicy: s.localFilePolicy,
    realpath: async (absolutePath: string): Promise<string | null> => {
      const normalized = normalize(absolutePath);
      if (s.projectRootMissing === true && normalized === normalize(s.projectPath)) {
        return null;
      }
      if (!present.has(normalized)) {
        return null;
      }
      return aliases.get(normalized) ?? absolutePath.replace(/\\/g, '/').replace(/\/+$/, '');
    },
    isFile: async (absolutePath: string): Promise<boolean> => {
      const normalized = normalize(absolutePath);
      return present.has(normalized) && !directories.has(normalized);
    },
    findProjectFile: async (): Promise<FindProjectFileOutcome> => s.findFile ?? { kind: 'none' },
  };
}

function summarize(data: DocumentPathResolveData): Expected {
  return data.status === 'resolved'
    ? { status: 'resolved', target: data.target }
    : { status: 'unresolved', reason: data.reason };
}

describe('resolveDocumentPath golden table', () => {
  for (const scenarioId of SCENARIO_IDS) {
    describe(scenarioId, () => {
      for (const row of ROWS) {
        it(`${row.id}`, async () => {
          const s: Scenario = {
            ...ALL_SCENARIOS[scenarioId],
            ...(row.overrides?.[scenarioId] ?? {}),
          };
          const data = await resolveDocumentPath(
            {
              rawPath: row.path(s),
              ...(row.withoutProject ? {} : { projectPath: s.projectPath }),
            },
            createDeps(s),
          );

          expect(summarize(data)).toEqual(row.expect[scenarioId]);
          if (data.status === 'unresolved' && !PRE_ROUTE_REASONS.has(data.reason)) {
            // The whole point of the attempts list: a failure names its routes.
            expect(data.attempts.length).toBeGreaterThan(0);
            for (const attempt of data.attempts) {
              expect(typeof attempt.route).toBe('string');
              expect(attempt.reason.length).toBeGreaterThan(0);
            }
          }
        });
      }
    });
  }
});
