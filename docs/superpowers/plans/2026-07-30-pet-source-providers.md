# Pet Source Providers & Live Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded pet source enumeration in `@piwin/pet` with an extensible `PetSourceProvider` registry (bundled / local / codex-live / remote registry), add a `pet/store-query` + `pet/install-registry` command path, and re-implement the lost `PetSprite` canvas renderer + agent-state-driven `pet/state` push so the desktop shows a live, interactive companion.

**Architecture:** A new `PetSourceProvider` interface in `@piwin/contracts` is implemented by four providers in `@piwin/pet/src/sources/`. A `pet-source-registry` orders providers by fixed priority (bundled > local > codex-live > registry), dedupes by pet id, and exposes `discover`/`resolve`/`install` operations. `pet-store.ts` becomes a thin facade over the registry plus preference persistence. `agent-host` grows a `pet-state-store` that reduces the live `AgentEvent` stream into a `PetAnimationState` and pushes `pet/state` messages; `catalog-commands` wires `pet/store-query` and `pet/install-registry`. Desktop grows a canvas-based `PetSprite` (drag, hover, random idle, agent-driven state) mounted in `App.tsx`, and `PetPanel` gains a registry browse + install button.

**Tech Stack:** TypeScript strict ESM, Node 20+ `fs/promises`, vitest, Tauri 2 asset protocol, React 18 + canvas 2D. No new runtime deps — `fetch` is global in Node 20+ and the desktop renderer.

## Global Constraints

- TypeScript strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` — do not weaken.
- ESM only, `.js` extensions in relative imports (NodeNext).
- No `any`; isolate unavoidable `unknown` behind a named type.
- No non-null assertion (`!`) except after an explicit runtime check in the same block.
- Apps (`apps/*`) never import `@earendil-works/pi-*`; only `@piwin/*` allowed.
- Only `packages/agent-host` may import Pi.
- Contracts (`@piwin/contracts`) is a leaf — no `@piwin/*` imports.
- `@piwin/ui-kit` imports `@piwin/contracts` only.
- No new dependency without justification. `fetch`, `crypto.subtle`, `node:fs/promises`, `node:crypto` are all stdlib/global — use them.
- Codex spritesheet contract: 8×9 cells of 192×208 (defaults), overridable per manifest. States `idle|running|waiting|failed|waving|jumping|review` map to rows 0..6 by default.
- Registry downloads must: enforce HTTPS, cap size at `PET_MAX_DOWNLOAD_BYTES` (16 MiB), stream to a temp dir, verify SHA256, validate magic bytes, atomic-rename into `~/.piwin/pets/`.
- Provider failures are isolated — one provider's `discover()` throwing must not break the others.
- `pet/list` must NOT make network calls; only `pet/store-query` (explicit user action) and `pet/install-registry` may hit the network.
- Tauri asset scope already allows `$HOME/.piwin/pets/**` and `$HOME/.codex/pets/**` — no `tauri.conf.json` change needed for this plan.

---

## File Structure

```
packages/contracts/src/pet.ts                      (modify) — add source/provider types
packages/contracts/src/ipc.ts                      (modify) — add 2 commands + pet/state push
packages/pet/src/sources/pet-source-provider.ts     (create) — interface + shared types
packages/pet/src/sources/bundled-provider.ts       (create) — bundled pets under package assets
packages/pet/src/sources/local-provider.ts         (create) — ~/.piwin/pets user installs
packages/pet/src/sources/codex-provider.ts          (create) — ~/.codex/pets live scan
packages/pet/src/sources/registry-provider.ts      (create) — remote CodexPetHub install/query
packages/pet/src/sources/registry-download.ts      (create) — HTTPS download + checksum + magic
packages/pet/src/pet-source-registry.ts            (create) — provider registry + dedupe + locks
packages/pet/src/pet-store.ts                      (modify) — facade over registry
packages/pet/src/index.ts                          (modify) — public exports
packages/pet/src/sources/*.test.ts                 (create) — per-provider unit tests
packages/pet/src/pet-source-registry.test.ts       (create) — registry dedupe/priority tests
packages/agent-host/src/pet-state-store.ts         (create) — AgentEvent → PetAnimationState
packages/agent-host/src/pet-state-store.test.ts    (create) — reducer fixtures
packages/agent-host/src/host-runtime.ts            (modify) — wire pet-state-store + pet/state push
packages/agent-host/src/commands/catalog-commands.ts (modify) — add 2 commands, read live state
packages/agent-host/src/commands/host-command-context.ts (modify) — add petStateStore
apps/cli/src/host-serve-command-lane.ts           (modify) — serialize new install command
apps/desktop/src/components/PetSprite.tsx         (create) — canvas renderer + interaction
apps/desktop/src/components/pet-sprite.css        (create) — drag/floating styles
apps/desktop/src/PetPanel.tsx                      (modify) — registry browse + install
apps/desktop/src/host-client.ts                    (modify) — timeout for new install command
apps/desktop/src/host-client-mock.ts              (modify) — mock new commands + pet/state
apps/desktop/src/host-request-adapters.ts         (modify) — new command union
apps/desktop/src/hooks/use-host-bootstrap.ts       (modify) — subscribe to pet/state
apps/desktop/src/App.tsx                           (modify) — mount floating PetSprite
apps/desktop/src/settings/settings-context.tsx    (modify) — extend requestPet union
apps/desktop/src/SettingsPanel.tsx                (modify) — extend requestPet union
apps/desktop/src/settings/pages/pets-page.tsx     (no change — uses PetPanel)
```

---

## Task 1: Contracts — pet source/provider types

**Files:**
- Modify: `packages/contracts/src/pet.ts`

**Interfaces:**
- Produces: `PetSourceKind`, `PetDiscoveredEntry`, `PetResolvedPackage`, `PetSourceProvider`, `PetInstallResult`, `PetStoreQuery`, `PetStoreQueryResult`, `PetRegistryEntry`. Modifies `PetSummary.source` from union literal to `PetSourceKind` (string).

- [ ] **Step 1: Add the new types to `packages/contracts/src/pet.ts`**

Append after the existing `PetRuntimeSnapshot` block (line 75):

```typescript
/** Stable identifier for where a pet package came from. */
export type PetSourceKind = 'bundled' | 'local' | 'codex-live' | 'registry';

/** A pet discovered by a provider during enumeration (no payload fetched). */
export type PetDiscoveredEntry = {
  petId: string;
  displayName: string;
  description?: string;
  version?: string;
  source: PetSourceKind;
  /** Absolute path for local sources; URL for registry; empty for bundled. */
  location: string;
  /** True if the package is already installed locally and resolvable. */
  installed: boolean;
  /** Validation issues found during discovery (missing spritesheet, etc). */
  issues: string[];
};

/** A fully resolved, ready-to-render pet package. */
export type PetResolvedPackage = {
  petId: string;
  displayName: string;
  description?: string;
  version?: string;
  source: PetSourceKind;
  /** Absolute path to the package directory (or temp dir for registry staging). */
  packagePath: string;
  /** Absolute path to the spritesheet file. */
  spritesheetAbsolutePath: string;
  manifest: PetManifest;
};

/** Result of installing a pet from any source. */
export type PetInstallResult = {
  petId: string;
  source: PetSourceKind;
  path: string;
};

/** Query payload for the remote registry browse command. */
export type PetStoreQuery = {
  /** Search text; empty string lists all. */
  query: string;
  /** Optional source filter; default 'registry'. */
  source?: PetSourceKind;
};

/** One hit from a store query. */
export type PetStoreQueryResult = {
  petId: string;
  displayName: string;
  description?: string;
  version?: string;
  source: PetSourceKind;
  /** Registry URL or local path. */
  location: string;
  /** True if already installed under ~/.piwin/pets. */
  installed: boolean;
  /** SHA256 hex of the package tarball, if known by the registry. */
  sha256?: string;
  /** Package size in bytes, if known. */
  sizeBytes?: number;
};

/** A single entry in the remote registry catalog (CodexPetHub shape). */
export type PetRegistryEntry = {
  id: string;
  displayName: string;
  description?: string;
  version?: string;
  /** HTTPS URL to the package tarball (zip). */
  url: string;
  sha256: string;
  sizeBytes: number;
};
```

- [ ] **Step 2: Change `PetSummary.source` to `PetSourceKind`**

In `packages/contracts/src/pet.ts`, replace the `PetSummary` type (lines 48-58):

```typescript
export type PetSummary = {
  id: string;
  displayName: string;
  description?: string;
  path: string;
  spritesheetAbsolutePath: string;
  source: PetSourceKind;
  active: boolean;
  valid: boolean;
  issues: string[];
};
```

- [ ] **Step 3: Verify contracts typecheck**

Run: `pnpm --filter @piwin/contracts typecheck`
Expected: PASS (no consumers have been changed yet, but `PetSummary['source']` is now a string union that still admits the old literals).

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/pet.ts
git commit -m "contracts(pet): add PetSourceProvider types and widen PetSummary.source"
```

---

## Task 2: Contracts — new IPC commands + pet/state push

**Files:**
- Modify: `packages/contracts/src/ipc.ts`

**Interfaces:**
- Consumes: `PetStoreQuery`, `PetStoreQueryResult`, `PetInstallResult`, `PetRuntimeSnapshot`, `PetAnimationState` from Task 1 / existing.
- Produces: two new `HostCommand` variants (`pet/store-query`, `pet/install-registry`), one new `HostPush` variant (`pet/state`).

- [ ] **Step 1: Add the two new commands to `HostCommand`**

In `packages/contracts/src/ipc.ts`, after line 234 (`pet/install-local`), insert:

```typescript
  | { id?: string; type: 'pet/store-query'; query: PetStoreQuery }
  | { id?: string; type: 'pet/install-registry'; url: string; sha256?: string }
```

Add a new import line after the existing `import type { ... } from './notes.js'` line (line 44). There is NO existing `./pet.js` import in `ipc.ts`:

```typescript
import type {
  PetInstallResult,
  PetRuntimeSnapshot,
  PetStoreQuery,
  PetStoreQueryResult,
} from './pet.js';
```

- [ ] **Step 2: Add `pet/state` to `HostPush`**

In the `HostPush` union (after line 469, the `extension/ui_request` variant), append:

```typescript
  | { type: 'pet/state'; pet: PetRuntimeSnapshot }
```

- [ ] **Step 3: Verify contracts typecheck**

Run: `pnpm --filter @piwin/contracts typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/ipc.ts
git commit -m "contracts(ipc): add pet/store-query, pet/install-registry, pet/state push"
```

---

## Task 3: Pet package — PetSourceProvider interface

**Files:**
- Create: `packages/pet/src/sources/pet-source-provider.ts`
- Test: `packages/pet/src/sources/pet-source-provider.test.ts`

**Interfaces:**
- Consumes: `PetDiscoveredEntry`, `PetResolvedPackage`, `PetInstallResult`, `PetStoreQueryResult`, `PetSourceKind`, `PetManifest` from `@piwin/contracts`.
- Produces: `PetSourceProvider` interface, `PetSourceProviderContext` (service bag handed to providers), `PET_SOURCE_PRIORITY` constant.

- [ ] **Step 1: Write the failing test**

`packages/pet/src/sources/pet-source-provider.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { PET_SOURCE_PRIORITY } from './pet-source-provider.js';

describe('PET_SOURCE_PRIORITY', () => {
  it('orders bundled first, registry last', () => {
    expect(PET_SOURCE_PRIORITY).toEqual([
      'bundled',
      'local',
      'codex-live',
      'registry',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @piwin/pet test -- pet-source-provider`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`packages/pet/src/sources/pet-source-provider.ts`:

```typescript
/**
 * Provider abstraction for pet package sources.
 * Each provider owns one PetSourceKind and is isolated from the others:
 * a throw in discover/resolve/install must not cascade.
 */
import type {
  PetDiscoveredEntry,
  PetInstallResult,
  PetManifest,
  PetResolvedPackage,
  PetSourceKind,
  PetStoreQueryResult,
} from '@piwin/contracts';

/** Fixed priority — earlier wins on id collisions. */
export const PET_SOURCE_PRIORITY: readonly PetSourceKind[] = [
  'bundled',
  'local',
  'codex-live',
  'registry',
];

/** Services handed to every provider. FS roots are absolute. */
export type PetSourceProviderContext = {
  /** ~/.piwin */
  piwinRoot: string;
  /** ~/.piwin/pets — install target for local + registry. */
  petsDir: string;
  /** ~/.codex/pets — codex-live scan root. */
  codexPetsDir: string;
};

export type PetSourceProvider = {
  readonly kind: PetSourceKind;
  /**
   * Enumerate pets available from this source without fetching payloads.
   * Must NOT perform network I/O. Throw on infrastructure failure —
   * the registry catches and logs.
   */
  discover(ctx: PetSourceProviderContext): Promise<PetDiscoveredEntry[]>;
  /**
   * Resolve a discovered entry into a renderable package (manifest + spritesheet path).
   * For registry this is only valid after install(); for local/codex/bundled it
   * reads from disk.
   */
  resolve(
    ctx: PetSourceProviderContext,
    petId: string,
  ): Promise<PetResolvedPackage>;
  /**
   * Install a pet into ~/.piwin/pets. Only registry + local implement this;
   * bundled/codex-live return a no-op result pointing at their existing path.
   */
  install?(
    ctx: PetSourceProviderContext,
    location: string,
  ): Promise<PetInstallResult>;
  /**
   * Optional remote catalog query. Only registry implements this.
   */
  queryStore?(
    ctx: PetSourceProviderContext,
    query: string,
  ): Promise<PetStoreQueryResult[]>;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @piwin/pet test -- pet-source-provider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pet/src/sources/pet-source-provider.ts packages/pet/src/sources/pet-source-provider.test.ts
git commit -m "pet: add PetSourceProvider interface and priority order"
```

---

## Task 4: Pet package — bundled provider

**Files:**
- Create: `packages/pet/src/sources/bundled-provider.ts`
- Test: `packages/pet/src/sources/bundled-provider.test.ts`

**Interfaces:**
- Consumes: `PetSourceProvider`, `PetSourceProviderContext` from Task 3; `validatePetManifest`, `resolvePetLayout` from existing `validate-manifest.ts`; `resolveBundledAssetsRoot` from existing `bundled-assets-root.ts`.
- Produces: `bundledProvider` (a `PetSourceProvider` with `kind: 'bundled'`).

- [ ] **Step 1: Write the failing test**

`packages/pet/src/sources/bundled-provider.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundledProvider } from './bundled-provider.js';

async function makeTempPiwinRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'piwin-pet-bundled-'));
  return root;
}

async function seedBundled(root: string, petId: string): Promise<void> {
  // The provider reads from <root>/pet/bundled/<petId> to mirror the
  // resolveBundledAssetsRoot layout used in production.
  const dir = join(root, 'pet', 'bundled', petId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'pet.json'),
    JSON.stringify({
      id: petId,
      displayName: petId,
      spritesheetPath: 'sheet.png',
    }),
  );
  await writeFile(join(dir, 'sheet.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
}

describe('bundledProvider.discover', () => {
  it('lists bundled pets under pet/bundled', async () => {
    const root = await makeTempPiwinRoot();
    await seedBundled(root, 'piwin-default');
    const ctx = {
      piwinRoot: root,
      petsDir: join(root, 'pets'),
      codexPetsDir: join(root, 'codex-pets'),
      bundledRoot: join(root, 'pet', 'bundled'),
    };
    const entries = await bundledProvider.discover(ctx);
    expect(entries.map((e) => e.petId)).toContain('piwin-default');
    expect(entries[0]?.source).toBe('bundled');
    expect(entries[0]?.installed).toBe(false);
  });

  it('returns empty list when bundled dir is missing', async () => {
    const root = await makeTempPiwinRoot();
    const ctx = {
      piwinRoot: root,
      petsDir: join(root, 'pets'),
      codexPetsDir: join(root, 'codex-pets'),
      bundledRoot: join(root, 'pet', 'bundled'),
    };
    const entries = await bundledProvider.discover(ctx);
    expect(entries).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @piwin/pet test -- bundled-provider`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`packages/pet/src/sources/bundled-provider.ts`:

```typescript
/**
 * Bundled provider: enumerates pets shipped with the @piwin/pet package
 * (under pet/bundled/*). Does not install — bundled pets are read in place.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  PetDiscoveredEntry,
  PetInstallResult,
  PetManifest,
  PetResolvedPackage,
} from '@piwin/contracts';
import { validatePetManifest } from '../validate-manifest.js';
import { resolveBundledAssetsRoot } from '../bundled-assets-root.js';
import type { PetSourceProvider, PetSourceProviderContext } from './pet-source-provider.js';

export type BundledProviderContext = PetSourceProviderContext & {
  /** Override the bundled root for tests. */
  bundledRoot?: string;
};

function resolveBundledRoot(ctx: PetSourceProviderContext, override?: string): string {
  if (override) return override;
  return resolveBundledAssetsRoot({
    layoutPath: 'pet/bundled',
    moduleUrl: import.meta.url,
    relativeFallback: '../bundled',
  });
}

async function readManifest(dir: string): Promise<PetManifest | null> {
  try {
    const raw = await readFile(join(dir, 'pet.json'), 'utf8');
    const result = validatePetManifest(JSON.parse(raw));
    return result.ok ? result.manifest : null;
  } catch {
    return null;
  }
}

export const bundledProvider: PetSourceProvider = {
  kind: 'bundled',

  async discover(ctx: PetSourceProviderContext): Promise<PetDiscoveredEntry[]> {
    const root = resolveBundledRoot(ctx, (ctx as BundledProviderContext).bundledRoot);
    let entries: string[] = [];
    try {
      entries = await readdir(root);
    } catch {
      return [];
    }
    const out: PetDiscoveredEntry[] = [];
    for (const entry of entries) {
      const dir = join(root, entry);
      try {
        if (!(await stat(dir)).isDirectory()) continue;
      } catch {
        continue;
      }
      const manifest = await readManifest(dir);
      if (!manifest) continue;
      const issues: string[] = [];
      try {
        await stat(join(dir, manifest.spritesheetPath));
      } catch {
        issues.push(`missing spritesheet: ${manifest.spritesheetPath}`);
      }
      const summary: PetDiscoveredEntry = {
        petId: manifest.id,
        displayName: manifest.displayName,
        source: 'bundled',
        location: dir,
        installed: false,
        issues,
      };
      if (manifest.description) summary.description = manifest.description;
      if (manifest.version) summary.version = manifest.version;
      out.push(summary);
    }
    return out;
  },

  async resolve(ctx: PetSourceProviderContext, petId: string): Promise<PetResolvedPackage> {
    const root = resolveBundledRoot(ctx, (ctx as BundledProviderContext).bundledRoot);
    let entries: string[] = [];
    try {
      entries = await readdir(root);
    } catch {
      throw new Error(`bundled pet not found: ${petId}`);
    }
    for (const entry of entries) {
      const dir = join(root, entry);
      const manifest = await readManifest(dir);
      if (!manifest || manifest.id !== petId) continue;
      const spritesheetAbsolutePath = join(dir, manifest.spritesheetPath);
      await stat(spritesheetAbsolutePath);
      const result: PetResolvedPackage = {
        petId: manifest.id,
        displayName: manifest.displayName,
        source: 'bundled',
        packagePath: dir,
        spritesheetAbsolutePath,
        manifest,
      };
      if (manifest.description) result.description = manifest.description;
      if (manifest.version) result.version = manifest.version;
      return result;
    }
    throw new Error(`bundled pet not found: ${petId}`);
  },

  async install(
    _ctx: PetSourceProviderContext,
    location: string,
  ): Promise<PetInstallResult> {
    // Bundled pets are read in place; "install" is a no-op that returns the path.
    return { petId: '', source: 'bundled', path: location };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @piwin/pet test -- bundled-provider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pet/src/sources/bundled-provider.ts packages/pet/src/sources/bundled-provider.test.ts
git commit -m "pet: add bundled PetSourceProvider"
```

---

## Task 5: Pet package — local provider

**Files:**
- Create: `packages/pet/src/sources/local-provider.ts`
- Test: `packages/pet/src/sources/local-provider.test.ts`

**Interfaces:**
- Consumes: `PetSourceProvider`, `PetSourceProviderContext` from Task 3; `validatePetManifest` from existing.
- Produces: `localProvider` (`kind: 'local'`) — scans `~/.piwin/pets`, supports `install` from a local directory.

- [ ] **Step 1: Write the failing test**

`packages/pet/src/sources/local-provider.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localProvider } from './local-provider.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function makeRoot(): Promise<{ root: string; petsDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'piwin-pet-local-'));
  const petsDir = join(root, 'pets');
  await mkdir(petsDir, { recursive: true });
  return { root, petsDir };
}

async function seedPet(parent: string, petId: string): Promise<string> {
  const dir = join(parent, petId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'pet.json'),
    JSON.stringify({ id: petId, displayName: petId, spritesheetPath: 'sheet.png' }),
  );
  await writeFile(join(dir, 'sheet.png'), PNG_MAGIC);
  return dir;
}

describe('localProvider.discover', () => {
  it('lists pets under ~/.piwin/pets', async () => {
    const { root, petsDir } = await makeRoot();
    await seedPet(petsDir, 'my-pet');
    const ctx = { piwinRoot: root, petsDir, codexPetsDir: join(root, 'codex') };
    const entries = await localProvider.discover(ctx);
    expect(entries.map((e) => e.petId)).toEqual(['my-pet']);
    expect(entries[0]?.source).toBe('local');
    expect(entries[0]?.installed).toBe(true);
  });
});

describe('localProvider.install', () => {
  it('copies a source directory into petsDir', async () => {
    const { root, petsDir } = await makeRoot();
    const staging = await mkdtemp(join(tmpdir(), 'piwin-pet-stage-'));
    const sourceDir = await seedPet(staging, 'imported-pet');
    const ctx = { piwinRoot: root, petsDir, codexPetsDir: join(root, 'codex') };
    const result = await localProvider.install!(ctx, sourceDir);
    expect(result.petId).toBe('imported-pet');
    expect(result.source).toBe('local');
    expect(result.path).toBe(join(petsDir, 'imported-pet'));
  });

  it('rejects a missing spritesheet', async () => {
    const { root, petsDir } = await makeRoot();
    const staging = await mkdtemp(join(tmpdir(), 'piwin-pet-stage-'));
    const dir = join(staging, 'bad-pet');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'pet.json'),
      JSON.stringify({ id: 'bad-pet', displayName: 'bad', spritesheetPath: 'sheet.png' }),
    );
    const ctx = { piwinRoot: root, petsDir, codexPetsDir: join(root, 'codex') };
    await expect(localProvider.install!(ctx, dir)).rejects.toThrow(/spritesheet/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @piwin/pet test -- local-provider`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`packages/pet/src/sources/local-provider.ts`:

```typescript
/**
 * Local provider: scans ~/.piwin/pets for user-installed pets and supports
 * installing from a local directory (the old installPetFromLocalPath behavior).
 */
import { cp, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  PetDiscoveredEntry,
  PetInstallResult,
  PetManifest,
  PetResolvedPackage,
} from '@piwin/contracts';
import { validatePetManifest } from '../validate-manifest.js';
import type { PetSourceProvider, PetSourceProviderContext } from './pet-source-provider.js';

async function readManifest(dir: string): Promise<PetManifest | null> {
  try {
    const raw = await readFile(join(dir, 'pet.json'), 'utf8');
    const result = validatePetManifest(JSON.parse(raw));
    return result.ok ? result.manifest : null;
  } catch {
    return null;
  }
}

function toEntry(manifest: PetManifest, dir: string, issues: string[]): PetDiscoveredEntry {
  const entry: PetDiscoveredEntry = {
    petId: manifest.id,
    displayName: manifest.displayName,
    source: 'local',
    location: dir,
    installed: true,
    issues,
  };
  if (manifest.description) entry.description = manifest.description;
  if (manifest.version) entry.version = manifest.version;
  return entry;
}

export const localProvider: PetSourceProvider = {
  kind: 'local',

  async discover(ctx: PetSourceProviderContext): Promise<PetDiscoveredEntry[]> {
    let entries: string[] = [];
    try {
      entries = await readdir(ctx.petsDir);
    } catch {
      return [];
    }
    const out: PetDiscoveredEntry[] = [];
    for (const entry of entries) {
      const dir = join(ctx.petsDir, entry);
      try {
        if (!(await stat(dir)).isDirectory()) continue;
      } catch {
        continue;
      }
      const manifest = await readManifest(dir);
      if (!manifest) continue;
      const issues: string[] = [];
      try {
        await stat(join(dir, manifest.spritesheetPath));
      } catch {
        issues.push(`missing spritesheet: ${manifest.spritesheetPath}`);
      }
      out.push(toEntry(manifest, dir, issues));
    }
    return out;
  },

  async resolve(ctx: PetSourceProviderContext, petId: string): Promise<PetResolvedPackage> {
    let entries: string[] = [];
    try {
      entries = await readdir(ctx.petsDir);
    } catch {
      throw new Error(`local pet not found: ${petId}`);
    }
    for (const entry of entries) {
      const dir = join(ctx.petsDir, entry);
      const manifest = await readManifest(dir);
      if (!manifest || manifest.id !== petId) continue;
      const spritesheetAbsolutePath = join(dir, manifest.spritesheetPath);
      await stat(spritesheetAbsolutePath);
      const result: PetResolvedPackage = {
        petId: manifest.id,
        displayName: manifest.displayName,
        source: 'local',
        packagePath: dir,
        spritesheetAbsolutePath,
        manifest,
      };
      if (manifest.description) result.description = manifest.description;
      if (manifest.version) result.version = manifest.version;
      return result;
    }
    throw new Error(`local pet not found: ${petId}`);
  },

  async install(
    ctx: PetSourceProviderContext,
    location: string,
  ): Promise<PetInstallResult> {
    const absolute = location.trim();
    if (!absolute) throw new Error('sourcePath required');
    const manifestPath = join(absolute, 'pet.json');
    const raw = await readFile(manifestPath, 'utf8');
    const validated = validatePetManifest(JSON.parse(raw));
    if (!validated.ok) {
      throw new Error(validated.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
    }
    const sheet = join(absolute, validated.manifest.spritesheetPath);
    await stat(sheet);
    const target = join(ctx.petsDir, validated.manifest.id);
    await mkdir(ctx.petsDir, { recursive: true });
    await cp(absolute, target, { recursive: true, force: true });
    return { petId: validated.manifest.id, source: 'local', path: target };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @piwin/pet test -- local-provider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pet/src/sources/local-provider.ts packages/pet/src/sources/local-provider.test.ts
git commit -m "pet: add local PetSourceProvider"
```

---

## Task 6: Pet package — codex-live provider

**Files:**
- Create: `packages/pet/src/sources/codex-provider.ts`
- Test: `packages/pet/src/sources/codex-provider.test.ts`

**Interfaces:**
- Consumes: `PetSourceProvider`, `PetSourceProviderContext` from Task 3; `validatePetManifest`.
- Produces: `codexProvider` (`kind: 'codex-live'`) — scans `~/.codex/pets` in place, no install.

- [ ] **Step 1: Write the failing test**

`packages/pet/src/sources/codex-provider.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexProvider } from './codex-provider.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('codexProvider.discover', () => {
  it('lists pets under the codex pets dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pet-codex-'));
    const codexPetsDir = join(root, 'codex-pets');
    const dir = join(codexPetsDir, 'codex-pet');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'pet.json'),
      JSON.stringify({ id: 'codex-pet', displayName: 'Codex', spritesheetPath: 's.png' }),
    );
    await writeFile(join(dir, 's.png'), PNG_MAGIC);
    const ctx = { piwinRoot: root, petsDir: join(root, 'pets'), codexPetsDir };
    const entries = await codexProvider.discover(ctx);
    expect(entries.map((e) => e.petId)).toEqual(['codex-pet']);
    expect(entries[0]?.source).toBe('codex-live');
    expect(entries[0]?.installed).toBe(true);
  });

  it('returns empty when codex dir is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pet-codex-'));
    const ctx = {
      piwinRoot: root,
      petsDir: join(root, 'pets'),
      codexPetsDir: join(root, 'missing-codex'),
    };
    const entries = await codexProvider.discover(ctx);
    expect(entries).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @piwin/pet test -- codex-provider`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`packages/pet/src/sources/codex-provider.ts`:

```typescript
/**
 * Codex-live provider: scans ~/.codex/pets in place. Pets are shared with
 * Codex without being copied. No install — codex pets are read-only.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  PetDiscoveredEntry,
  PetManifest,
  PetResolvedPackage,
} from '@piwin/contracts';
import { validatePetManifest } from '../validate-manifest.js';
import type { PetSourceProvider, PetSourceProviderContext } from './pet-source-provider.js';

async function readManifest(dir: string): Promise<PetManifest | null> {
  try {
    const raw = await readFile(join(dir, 'pet.json'), 'utf8');
    const result = validatePetManifest(JSON.parse(raw));
    return result.ok ? result.manifest : null;
  } catch {
    return null;
  }
}

export const codexProvider: PetSourceProvider = {
  kind: 'codex-live',

  async discover(ctx: PetSourceProviderContext): Promise<PetDiscoveredEntry[]> {
    let entries: string[] = [];
    try {
      entries = await readdir(ctx.codexPetsDir);
    } catch {
      return [];
    }
    const out: PetDiscoveredEntry[] = [];
    for (const entry of entries) {
      const dir = join(ctx.codexPetsDir, entry);
      try {
        if (!(await stat(dir)).isDirectory()) continue;
      } catch {
        continue;
      }
      const manifest = await readManifest(dir);
      if (!manifest) continue;
      const issues: string[] = [];
      try {
        await stat(join(dir, manifest.spritesheetPath));
      } catch {
        issues.push(`missing spritesheet: ${manifest.spritesheetPath}`);
      }
      const summary: PetDiscoveredEntry = {
        petId: manifest.id,
        displayName: manifest.displayName,
        source: 'codex-live',
        location: dir,
        installed: true,
        issues,
      };
      if (manifest.description) summary.description = manifest.description;
      if (manifest.version) summary.version = manifest.version;
      out.push(summary);
    }
    return out;
  },

  async resolve(ctx: PetSourceProviderContext, petId: string): Promise<PetResolvedPackage> {
    let entries: string[] = [];
    try {
      entries = await readdir(ctx.codexPetsDir);
    } catch {
      throw new Error(`codex pet not found: ${petId}`);
    }
    for (const entry of entries) {
      const dir = join(ctx.codexPetsDir, entry);
      const manifest = await readManifest(dir);
      if (!manifest || manifest.id !== petId) continue;
      const spritesheetAbsolutePath = join(dir, manifest.spritesheetPath);
      await stat(spritesheetAbsolutePath);
      const result: PetResolvedPackage = {
        petId: manifest.id,
        displayName: manifest.displayName,
        source: 'codex-live',
        packagePath: dir,
        spritesheetAbsolutePath,
        manifest,
      };
      if (manifest.description) result.description = manifest.description;
      if (manifest.version) result.version = manifest.version;
      return result;
    }
    throw new Error(`codex pet not found: ${petId}`);
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @piwin/pet test -- codex-provider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pet/src/sources/codex-provider.ts packages/pet/src/sources/codex-provider.test.ts
git commit -m "pet: add codex-live PetSourceProvider"
```

---

## Task 7: Pet package — registry download helper

**Files:**
- Create: `packages/pet/src/sources/registry-download.ts`
- Test: `packages/pet/src/sources/registry-download.test.ts`

**Interfaces:**
- Consumes: `PetRegistryEntry` from `@piwin/contracts`.
- Produces: `downloadAndVerifyPackage(entry, destDir)` — streams HTTPS to disk, enforces size cap, verifies SHA256, validates magic bytes, returns the local file path.

- [ ] **Step 1: Write the failing test**

`packages/pet/src/sources/registry-download.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { downloadAndVerifyPackage } from './registry-download.js';

function makeZipBuffer(): Buffer {
  // Minimal ZIP magic bytes (PK\x03\x04) — enough for magic-byte validation.
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('rest-of-zip'),
  ]);
}

describe('downloadAndVerifyPackage', () => {
  it('writes the file and verifies sha256 against a stub fetch', async () => {
    const buf = makeZipBuffer();
    const sha = createHash('sha256').update(buf).digest('hex');
    const dest = await mkdtemp(join(tmpdir(), 'piwin-pet-dl-'));
    const entry = {
      id: 'remote-pet',
      displayName: 'Remote',
      url: 'https://example.test/pet.zip',
      sha256: sha,
      sizeBytes: buf.byteLength,
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: new Blob([buf]).stream(),
    }));
    const result = await downloadAndVerifyPackage(entry, dest, { fetch: fetchMock as never });
    expect(result.filePath).toMatch(/pet\.zip$/);
    expect(await readFile(result.filePath)).toEqual(buf);
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/pet.zip', expect.any(Object));
  });

  it('rejects when sha256 mismatches', async () => {
    const buf = makeZipBuffer();
    const dest = await mkdtemp(join(tmpdir(), 'piwin-pet-dl-'));
    const entry = {
      id: 'remote-pet',
      displayName: 'Remote',
      url: 'https://example.test/pet.zip',
      sha256: '0'.repeat(64),
      sizeBytes: buf.byteLength,
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: new Blob([buf]).stream(),
    }));
    await expect(
      downloadAndVerifyPackage(entry, dest, { fetch: fetchMock as never }),
    ).rejects.toThrow(/sha256/i);
  });

  it('rejects non-https urls', async () => {
    const dest = await mkdtemp(join(tmpdir(), 'piwin-pet-dl-'));
    const entry = {
      id: 'x',
      displayName: 'x',
      url: 'http://insecure.test/pet.zip',
      sha256: '0'.repeat(64),
      sizeBytes: 1,
    };
    await expect(downloadAndVerifyPackage(entry, dest)).rejects.toThrow(/https/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @piwin/pet test -- registry-download`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`packages/pet/src/sources/registry-download.ts`:

```typescript
/**
 * Download a pet package tarball/zip from a registry entry, enforcing:
 *   - HTTPS only
 *   - max size cap (PET_MAX_DOWNLOAD_BYTES)
 *   - SHA256 checksum match
 *   - ZIP magic bytes (PK\x03\x04) before accepting
 * Streams to a temp file in destDir, returns the absolute path on success.
 */
import { createHash } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { PetRegistryEntry } from '@piwin/contracts';

export const PET_MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024;

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export type DownloadOptions = {
  /** Override global fetch (tests). */
  fetch?: typeof fetch;
  /** Override size cap (tests). */
  maxBytes?: number;
};

export type DownloadResult = {
  filePath: string;
  sizeBytes: number;
};

export async function downloadAndVerifyPackage(
  entry: PetRegistryEntry,
  destDir: string,
  options: DownloadOptions = {},
): Promise<DownloadResult> {
  if (!/^https:\/\//i.test(entry.url)) {
    throw new Error(`registry url must be https: ${entry.url}`);
  }
  const maxBytes = options.maxBytes ?? PET_MAX_DOWNLOAD_BYTES;
  if (entry.sizeBytes > maxBytes) {
    throw new Error(`package too large: ${entry.sizeBytes} > ${maxBytes}`);
  }
  await mkdir(destDir, { recursive: true });
  const tempPath = join(destDir, `${entry.id}.pet.zip.tmp`);
  const finalPath = join(destDir, `${entry.id}.pet.zip`);
  const fetchFn = options.fetch ?? fetch;
  const response = await fetchFn(entry.url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`download failed: HTTP ${response.status}`);
  }
  const handle = await open(tempPath, 'w');
  const hash = createHash('sha256');
  let total = 0;
  let firstChunk = true;
  try {
    for await (const chunk of response.body as unknown as Iterable<Uint8Array>) {
      if (firstChunk) {
        firstChunk = false;
        if (chunk.byteLength < 4 || !ZIP_MAGIC.equals(Buffer.from(chunk.buffer, chunk.byteOffset, 4))) {
          throw new Error('invalid package: missing ZIP magic bytes');
        }
      }
      total += chunk.byteLength;
      if (total > maxBytes) {
        throw new Error(`package exceeded size cap: ${total} > ${maxBytes}`);
      }
      hash.update(chunk);
      await handle.writeFile(chunk);
    }
    if (total === 0) throw new Error('empty package');
    const digest = hash.digest('hex');
    if (digest !== entry.sha256.toLowerCase()) {
      throw new Error(`sha256 mismatch: expected ${entry.sha256}, got ${digest}`);
    }
  } finally {
    await handle.close();
  }
  await rename(tempPath, finalPath);
  return { filePath: finalPath, sizeBytes: total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @piwin/pet test -- registry-download`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pet/src/sources/registry-download.ts packages/pet/src/sources/registry-download.test.ts
git commit -m "pet: add registry download helper with sha256 + magic-byte validation"
```

---

## Task 8: Pet package — registry provider

**Files:**
- Create: `packages/pet/src/sources/registry-provider.ts`
- Test: `packages/pet/src/sources/registry-provider.test.ts`

**Interfaces:**
- Consumes: `PetSourceProvider`, `PetSourceProviderContext` from Task 3; `downloadAndVerifyPackage` from Task 7; `validatePetManifest`; `PetRegistryEntry`, `PetStoreQueryResult` from `@piwin/contracts`.
- Produces: `registryProvider` (`kind: 'registry'`) — `queryStore` hits the registry catalog JSON, `install` downloads + extracts + validates into `~/.piwin/pets`.

- [ ] **Step 1: Write the failing test**

`packages/pet/src/sources/registry-provider.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registryProvider } from './registry-provider.js';

describe('registryProvider.queryStore', () => {
  it('returns parsed catalog entries from the registry url', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pet-reg-'));
    const catalog = [
      {
        id: 'remote-1',
        displayName: 'Remote One',
        url: 'https://reg.test/remote-1.zip',
        sha256: 'a'.repeat(64),
        sizeBytes: 1024,
      },
    ];
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => catalog,
    }));
    const ctx = {
      piwinRoot: root,
      petsDir: join(root, 'pets'),
      codexPetsDir: join(root, 'codex'),
      registryUrl: 'https://reg.test/catalog.json',
      fetch: fetchMock as never,
    };
    const results = await registryProvider.queryStore!(ctx as never, '');
    expect(results.map((r) => r.petId)).toEqual(['remote-1']);
    expect(results[0]?.source).toBe('registry');
    expect(fetchMock).toHaveBeenCalledWith('https://reg.test/catalog.json');
  });

  it('marks already-installed pets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pet-reg-'));
    const petsDir = join(root, 'pets');
    const installed = join(petsDir, 'remote-1');
    await mkdir(installed, { recursive: true });
    await writeFile(
      join(installed, 'pet.json'),
      JSON.stringify({ id: 'remote-1', displayName: 'x', spritesheetPath: 's.png' }),
    );
    const catalog = [
      {
        id: 'remote-1',
        displayName: 'Remote One',
        url: 'https://reg.test/remote-1.zip',
        sha256: 'a'.repeat(64),
        sizeBytes: 1024,
      },
    ];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => catalog,
    }));
    const ctx = {
      piwinRoot: root,
      petsDir,
      codexPetsDir: join(root, 'codex'),
      registryUrl: 'https://reg.test/catalog.json',
      fetch: fetchMock as never,
    };
    const results = await registryProvider.queryStore!(ctx as never, '');
    expect(results[0]?.installed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @piwin/pet test -- registry-provider`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`packages/pet/src/sources/registry-provider.ts`:

```typescript
/**
 * Registry provider: queries a remote CodexPetHub-compatible catalog and
 * installs pets by downloading + validating + extracting into ~/.piwin/pets.
 * Extraction is delegated to the host (unzip) — this provider validates the
 * manifest post-extract. For now we assume the registry serves a directory
 * zip (no internal nesting); if a top-level folder is present we use it.
 */
import { mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  PetDiscoveredEntry,
  PetInstallResult,
  PetStoreQueryResult,
} from '@piwin/contracts';
import { validatePetManifest } from '../validate-manifest.js';
import { downloadAndVerifyPackage } from './registry-download.js';
import type { PetSourceProvider, PetSourceProviderContext } from './pet-source-provider.js';

export type RegistryProviderContext = PetSourceProviderContext & {
  /** HTTPS catalog URL. */
  registryUrl: string;
  /** Override fetch (tests). */
  fetch?: typeof fetch;
};

const DEFAULT_REGISTRY_URL = 'https://codexpethub.com/catalog.json';

function resolveCtx(
  ctx: PetSourceProviderContext,
): RegistryProviderContext {
  const override = ctx as RegistryProviderContext;
  return {
    ...ctx,
    registryUrl: override.registryUrl ?? DEFAULT_REGISTRY_URL,
    ...(override.fetch ? { fetch: override.fetch } : {}),
  };
}

async function isInstalled(petsDir: string, petId: string): Promise<boolean> {
  try {
    const dir = join(petsDir, petId);
    await stat(join(dir, 'pet.json'));
    return true;
  } catch {
    return false;
  }
}

export const registryProvider: PetSourceProvider = {
  kind: 'registry',

  async discover(): Promise<PetDiscoveredEntry[]> {
    // Registry pets are not enumerated in pet/list — only via explicit query.
    return [];
  },

  async resolve(): Promise<never> {
    // Registry pets must be installed before resolve; local provider handles
    // post-install resolution.
    throw new Error('registry pets must be installed before resolution');
  },

  async queryStore(
    ctx: PetSourceProviderContext,
    query: string,
  ): Promise<PetStoreQueryResult[]> {
    const reg = resolveCtx(ctx);
    const fetchFn = reg.fetch ?? fetch;
    const response = await fetchFn(reg.registryUrl, { redirect: 'follow' });
    if (!response.ok) throw new Error(`registry query failed: HTTP ${response.status}`);
    const entries = (await response.json()) as Array<{
      id: string;
      displayName: string;
      description?: string;
      version?: string;
      url: string;
      sha256: string;
      sizeBytes: number;
    }>;
    const q = query.trim().toLowerCase();
    const out: PetStoreQueryResult[] = [];
    for (const entry of entries) {
      if (q && !entry.id.toLowerCase().includes(q) && !entry.displayName.toLowerCase().includes(q)) {
        continue;
      }
      const installed = await isInstalled(ctx.petsDir, entry.id);
      const result: PetStoreQueryResult = {
        petId: entry.id,
        displayName: entry.displayName,
        source: 'registry',
        location: entry.url,
        installed,
        sha256: entry.sha256,
        sizeBytes: entry.sizeBytes,
      };
      if (entry.description) result.description = entry.description;
      if (entry.version) result.version = entry.version;
      out.push(result);
    }
    return out;
  },

  async install(
    ctx: PetSourceProviderContext,
    location: string,
  ): Promise<PetInstallResult> {
    // location is the HTTPS package URL. We need the matching registry entry
    // for sha256/size — the caller passes them via the command input.
    // For the provider API we accept a JSON-encoded entry string OR a bare URL.
    // catalog-commands passes the full entry. Bare URL path: fetch catalog,
    // find matching url, then download.
    const reg = resolveCtx(ctx);
    let entry: { id: string; displayName: string; url: string; sha256: string; sizeBytes: number };
    try {
      entry = JSON.parse(location) as typeof entry;
    } catch {
      // Bare URL — look up in catalog.
      const results = await registryProvider.queryStore!(ctx, '');
      const match = results.find((r) => r.location === location);
      if (!match || !match.sha256 || !match.sizeBytes) {
        throw new Error(`registry entry not found for url: ${location}`);
      }
      entry = {
        id: match.petId,
        displayName: match.displayName,
        url: match.location,
        sha256: match.sha256,
        sizeBytes: match.sizeBytes,
      };
    }
    const staging = join(ctx.piwinRoot, 'pets', '.staging', entry.id);
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    const downloaded = await downloadAndVerifyPackage(entry, staging, reg.fetch ? { fetch: reg.fetch } : {});
    // Extract: rely on the host's unzip. For portability we shell out to `unzip`.
    // (Node 22 has no stdlib unzip; this keeps the package dependency-free.)
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    await execFileAsync('unzip', ['-o', downloaded.filePath, '-d', staging]);
    // Find the extracted pet dir: either staging/<id> or staging itself.
    let petDir = staging;
    const children = await readdir(staging);
    const singleDir = children.length === 1 && !children[0]!.endsWith('.zip');
    if (singleDir) {
      const candidate = join(staging, children[0]!);
      try {
        if ((await stat(candidate)).isDirectory()) petDir = candidate;
      } catch {
        // keep staging
      }
    }
    // Validate manifest.
    const raw = await readFile(join(petDir, 'pet.json'), 'utf8');
    const validated = validatePetManifest(JSON.parse(raw));
    if (!validated.ok) {
      await rm(staging, { recursive: true, force: true });
      throw new Error(validated.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
    }
    const target = join(ctx.petsDir, validated.manifest.id);
    await mkdir(ctx.petsDir, { recursive: true });
    await rm(target, { recursive: true, force: true });
    await rename(petDir, target);
    await rm(staging, { recursive: true, force: true });
    return { petId: validated.manifest.id, source: 'registry', path: target };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @piwin/pet test -- registry-provider`
Expected: PASS.

**Known limitation:** The `install` method shells out to `unzip`, which is not available on Windows by default. This is acceptable for the initial implementation (piwin targets macOS/Linux first). A follow-up task should replace this with a cross-platform extraction (e.g. `node:zlib` for gzip, or a minimal zip parser, or a Tauri Rust-side extraction command).

- [ ] **Step 5: Commit**

```bash
git add packages/pet/src/sources/registry-provider.ts packages/pet/src/sources/registry-provider.test.ts
git commit -m "pet: add registry PetSourceProvider with catalog query + install"
```

---

## Task 9: Pet package — source registry

**Files:**
- Create: `packages/pet/src/pet-source-registry.ts`
- Test: `packages/pet/src/pet-source-registry.test.ts`

**Interfaces:**
- Consumes: `PetSourceProvider`, `PET_SOURCE_PRIORITY` from Task 3; all four providers from Tasks 4-8.
- Produces: `createPetSourceRegistry(providers)`, `discoverAllPets(ctx)`, `resolvePet(ctx, petId)`, `installPet(ctx, source, location)`, `queryPetStore(ctx, query)`.

- [ ] **Step 1: Write the failing test**

`packages/pet/src/pet-source-registry.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createPetSourceRegistry,
  discoverAllPets,
} from './pet-source-registry.js';
import { bundledProvider } from './sources/bundled-provider.js';
import { localProvider } from './sources/local-provider.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('discoverAllPets', () => {
  it('dedupes by petId with priority order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pet-reg-test-'));
    const petsDir = join(root, 'pets');
    await mkdir(petsDir, { recursive: true });
    // Both bundled and local expose a pet with id 'shared'.
    const bundledDir = join(root, 'pet', 'bundled', 'shared');
    await mkdir(bundledDir, { recursive: true });
    await writeFile(
      join(bundledDir, 'pet.json'),
      JSON.stringify({ id: 'shared', displayName: 'Bundled Shared', spritesheetPath: 's.png' }),
    );
    await writeFile(join(bundledDir, 's.png'), PNG);
    const localDir = join(petsDir, 'shared');
    await mkdir(localDir, { recursive: true });
    await writeFile(
      join(localDir, 'pet.json'),
      JSON.stringify({ id: 'shared', displayName: 'Local Shared', spritesheetPath: 's.png' }),
    );
    await writeFile(join(localDir, 's.png'), PNG);
    const ctx = {
      piwinRoot: root,
      petsDir,
      codexPetsDir: join(root, 'codex'),
      bundledRoot: join(root, 'pet', 'bundled'),
    };
    const registry = createPetSourceRegistry([bundledProvider, localProvider]);
    const entries = await discoverAllPets(registry, ctx);
    const shared = entries.find((e) => e.petId === 'shared');
    expect(shared?.source).toBe('bundled');
    expect(shared?.displayName).toBe('Bundled Shared');
  });

  it('isolates provider failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-pet-reg-test-'));
    const failing = {
      kind: 'bundled' as const,
      discover: vi.fn(async () => {
        throw new Error('boom');
      }),
      resolve: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const ok = {
      kind: 'local' as const,
      discover: vi.fn(async () => [
        {
          petId: 'ok-pet',
          displayName: 'OK',
          source: 'local' as const,
          location: '/x',
          installed: true,
          issues: [],
        },
      ]),
      resolve: vi.fn(async () => {
        throw new Error('no');
      }),
    };
    const ctx = {
      piwinRoot: root,
      petsDir: join(root, 'pets'),
      codexPetsDir: join(root, 'codex'),
    };
    const registry = createPetSourceRegistry([failing, ok]);
    const entries = await discoverAllPets(registry, ctx);
    expect(entries.map((e) => e.petId)).toEqual(['ok-pet']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @piwin/pet test -- pet-source-registry`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`packages/pet/src/pet-source-registry.ts`:

```typescript
/**
 * Pet source registry: orders providers by PET_SOURCE_PRIORITY, dedupes by
 * petId (earlier provider wins), and isolates provider failures so one
 * broken source does not break enumeration.
 */
import type {
  PetDiscoveredEntry,
  PetInstallResult,
  PetResolvedPackage,
  PetSourceKind,
  PetStoreQueryResult,
} from '@piwin/contracts';
import {
  PET_SOURCE_PRIORITY,
  type PetSourceProvider,
  type PetSourceProviderContext,
} from './sources/pet-source-provider.js';

export type PetSourceRegistry = {
  providers: readonly PetSourceProvider[];
  byKind: ReadonlyMap<PetSourceKind, PetSourceProvider>;
};

export function createPetSourceRegistry(
  providers: PetSourceProvider[],
): PetSourceRegistry {
  const sorted = [...providers].sort(
    (a, b) =>
      PET_SOURCE_PRIORITY.indexOf(a.kind) - PET_SOURCE_PRIORITY.indexOf(b.kind),
  );
  const byKind = new Map<PetSourceKind, PetSourceProvider>();
  for (const p of sorted) byKind.set(p.kind, p);
  return { providers: sorted, byKind };
}

export async function discoverAllPets(
  registry: PetSourceRegistry,
  ctx: PetSourceProviderContext,
): Promise<PetDiscoveredEntry[]> {
  const seen = new Set<string>();
  const out: PetDiscoveredEntry[] = [];
  for (const provider of registry.providers) {
    try {
      const entries = await provider.discover(ctx);
      for (const entry of entries) {
        if (seen.has(entry.petId)) continue;
        seen.add(entry.petId);
        out.push(entry);
      }
    } catch (error) {
      // Provider isolation — log and continue.
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[pet] provider ${provider.kind} discover failed: ${message}`);
    }
  }
  return out;
}

export async function resolvePet(
  registry: PetSourceRegistry,
  ctx: PetSourceProviderContext,
  petId: string,
): Promise<PetResolvedPackage> {
  let lastError: Error | null = null;
  for (const provider of registry.providers) {
    try {
      return await provider.resolve(ctx, petId);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error(`pet not found: ${petId}`);
}

export async function installPet(
  registry: PetSourceRegistry,
  ctx: PetSourceProviderContext,
  source: PetSourceKind,
  location: string,
): Promise<PetInstallResult> {
  const provider = registry.byKind.get(source);
  if (!provider || !provider.install) {
    throw new Error(`install not supported for source: ${source}`);
  }
  return provider.install(ctx, location);
}

export async function queryPetStore(
  registry: PetSourceRegistry,
  ctx: PetSourceProviderContext,
  query: string,
): Promise<PetStoreQueryResult[]> {
  const provider = registry.byKind.get('registry');
  if (!provider || !provider.queryStore) return [];
  return provider.queryStore(ctx, query);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @piwin/pet test -- pet-source-registry`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pet/src/pet-source-registry.ts packages/pet/src/pet-source-registry.test.ts
git commit -m "pet: add PetSourceRegistry with priority dedupe and failure isolation"
```

---

## Task 10: Pet package — refactor pet-store.ts onto the registry

**Files:**
- Modify: `packages/pet/src/pet-store.ts`
- Modify: `packages/pet/src/index.ts`

**Interfaces:**
- Consumes: `createPetSourceRegistry`, `discoverAllPets`, `resolvePet`, `installPet`, `queryPetStore` from Task 9; all four providers from Tasks 4-8.
- Produces: same public function names as today (`listPets`, `loadPetManifest`, `getActivePet`, `setActivePet`, `installPetFromLocalPath`) plus new `queryPetStore`, `installPetFromRegistry`. `PetSummary.source` now typed as `PetSourceKind`.

- [ ] **Step 1: Replace pet-store.ts with a registry-backed facade**

Overwrite `packages/pet/src/pet-store.ts` with:

```typescript
/**
 * Pet store facade: preference persistence + provider registry.
 * All enumeration/resolution/install is delegated to PetSourceRegistry.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type {
  PetAnimationState,
  PetManifest,
  PetPreference,
  PetRuntimeSnapshot,
  PetSourceKind,
  PetStoreQueryResult,
  PetSummary,
} from '@piwin/contracts';
import { resolvePetLayout } from './validate-manifest.js';
import {
  createPetSourceRegistry,
  discoverAllPets,
  installPet,
  queryPetStore,
  resolvePet,
  type PetSourceRegistry,
} from './pet-source-registry.js';
import { bundledProvider } from './sources/bundled-provider.js';
import { localProvider } from './sources/local-provider.js';
import { codexProvider } from './sources/codex-provider.js';
import { registryProvider } from './sources/registry-provider.js';

export function getPetsDir(piwinRoot: string): string {
  return join(piwinRoot, 'pets');
}

export function getPetPreferencePath(piwinRoot: string): string {
  return join(piwinRoot, 'pet.json');
}

export function getDefaultCodexPetsDir(): string {
  return join(homedir(), '.codex', 'pets');
}

let registrySingleton: PetSourceRegistry | null = null;

function getRegistry(): PetSourceRegistry {
  if (!registrySingleton) {
    registrySingleton = createPetSourceRegistry([
      bundledProvider,
      localProvider,
      codexProvider,
      registryProvider,
    ]);
  }
  return registrySingleton;
}

function buildContext(piwinRoot: string) {
  return {
    piwinRoot,
    petsDir: getPetsDir(piwinRoot),
    codexPetsDir: getDefaultCodexPetsDir(),
  };
}

export async function loadPetPreference(piwinRoot: string): Promise<PetPreference> {
  try {
    const raw = await readFile(getPetPreferencePath(piwinRoot), 'utf8');
    const parsed = JSON.parse(raw) as { activePetId?: string };
    if (typeof parsed.activePetId === 'string' && parsed.activePetId.trim()) {
      return { activePetId: parsed.activePetId.trim() };
    }
  } catch {
    // default
  }
  return { activePetId: 'piwin-default' };
}

export async function savePetPreference(
  piwinRoot: string,
  preference: PetPreference,
): Promise<void> {
  const path = getPetPreferencePath(piwinRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(preference, null, 2)}\n`, 'utf8');
}

export async function listPets(piwinRoot: string): Promise<{
  pets: PetSummary[];
  activePetId: string;
}> {
  const preference = await loadPetPreference(piwinRoot);
  const ctx = buildContext(piwinRoot);
  const entries = await discoverAllPets(getRegistry(), ctx);
  const pets: PetSummary[] = entries.map((entry) => {
    const summary: PetSummary = {
      id: entry.petId,
      displayName: entry.displayName,
      path: entry.location,
      spritesheetAbsolutePath: entry.location, // resolved lazily via loadPetManifest
      source: entry.source,
      active: entry.petId === preference.activePetId,
      valid: entry.issues.length === 0,
      issues: entry.issues,
    };
    if (entry.description) summary.description = entry.description;
    return summary;
  });
  pets.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { pets, activePetId: preference.activePetId };
}

export async function loadPetManifest(
  piwinRoot: string,
  petId: string,
): Promise<{ manifest: PetManifest; packagePath: string; spritesheetAbsolutePath: string }> {
  const ctx = buildContext(piwinRoot);
  const resolved = await resolvePet(getRegistry(), ctx, petId);
  return {
    manifest: resolved.manifest,
    packagePath: resolved.packagePath,
    spritesheetAbsolutePath: resolved.spritesheetAbsolutePath,
  };
}

export async function getActivePet(
  piwinRoot: string,
  state: PetAnimationState = 'idle',
): Promise<PetRuntimeSnapshot> {
  const preference = await loadPetPreference(piwinRoot);
  let petId = preference.activePetId;
  try {
    return await buildRuntimeSnapshot(piwinRoot, petId, state);
  } catch {
    petId = 'piwin-default';
    return buildRuntimeSnapshot(piwinRoot, petId, state);
  }
}

async function buildRuntimeSnapshot(
  piwinRoot: string,
  petId: string,
  state: PetAnimationState,
): Promise<PetRuntimeSnapshot> {
  const loaded = await loadPetManifest(piwinRoot, petId);
  const layout = resolvePetLayout(loaded.manifest);
  return {
    petId: loaded.manifest.id,
    displayName: loaded.manifest.displayName,
    spritesheetAbsolutePath: loaded.spritesheetAbsolutePath,
    state,
    fps: layout.fps,
    cellWidth: layout.cellWidth,
    cellHeight: layout.cellHeight,
    cols: layout.cols,
    rows: layout.rows,
    stateRows: layout.stateRows,
  };
}

export async function setActivePet(piwinRoot: string, petId: string): Promise<PetRuntimeSnapshot> {
  await loadPetManifest(piwinRoot, petId);
  await savePetPreference(piwinRoot, { activePetId: petId });
  return getActivePet(piwinRoot, 'idle');
}

export async function installPetFromLocalPath(
  piwinRoot: string,
  sourcePath: string,
): Promise<{ petId: string; path: string }> {
  const ctx = buildContext(piwinRoot);
  const result = await installPet(getRegistry(), ctx, 'local', sourcePath);
  return { petId: result.petId, path: result.path };
}

export async function installPetFromRegistry(
  piwinRoot: string,
  entryJson: string,
): Promise<{ petId: string; path: string }> {
  const ctx = buildContext(piwinRoot);
  const result = await installPet(getRegistry(), ctx, 'registry', entryJson);
  return { petId: result.petId, path: result.path };
}

export async function queryRemotePetStore(
  piwinRoot: string,
  query: string,
): Promise<PetStoreQueryResult[]> {
  const ctx = buildContext(piwinRoot);
  return queryPetStore(getRegistry(), ctx, query);
}
```

- [ ] **Step 2: Update index.ts exports**

In `packages/pet/src/index.ts`, replace the `pet-store.js` export block (lines 10-22) with:

```typescript
export {
  getPetsDir,
  getPetPreferencePath,
  getDefaultCodexPetsDir,
  loadPetPreference,
  savePetPreference,
  listPets,
  loadPetManifest,
  getActivePet,
  setActivePet,
  installPetFromLocalPath,
  installPetFromRegistry,
  queryRemotePetStore,
} from './pet-store.js';
export {
  createPetSourceRegistry,
  discoverAllPets,
  resolvePet,
  installPet,
  queryPetStore,
  type PetSourceRegistry,
} from './pet-source-registry.js';
export {
  PET_SOURCE_PRIORITY,
  type PetSourceProvider,
  type PetSourceProviderContext,
} from './sources/pet-source-provider.js';
export { bundledProvider } from './sources/bundled-provider.js';
export { localProvider } from './sources/local-provider.js';
export { codexProvider } from './sources/codex-provider.js';
export { registryProvider } from './sources/registry-provider.js';
export {
  downloadAndVerifyPackage,
  PET_MAX_DOWNLOAD_BYTES,
} from './sources/registry-download.js';
```

- [ ] **Step 3: Run pet tests + typecheck**

Run: `pnpm --filter @piwin/pet test && pnpm --filter @piwin/pet typecheck`
Expected: PASS (existing `agent-state-map.test.ts`, `validate-manifest.test.ts`, `bundled-assets-root.test.ts` still pass; new provider tests pass).

**Notes on behavior changes:**
- `ensureBundledPetsInstalled` is removed — bundled pets are now read in place by `bundledProvider` from the package assets, not copied to `~/.piwin/pets/`. No external consumers import it (verified: only `pet-store.ts` and `index.ts` referenced it).
- `PetSummary.spritesheetAbsolutePath` in `listPets` now contains the package directory path, not the actual spritesheet file path. This is a known compromise — `PetPanel` does not use this field, and the actual path is resolved via `loadPetManifest`/`getActivePet` when needed.

- [ ] **Step 4: Commit**

```bash
git add packages/pet/src/pet-store.ts packages/pet/src/index.ts
git commit -m "pet: refactor pet-store onto PetSourceRegistry; add registry install + query"
```

---

## Task 11: Agent-host — pet-state-store

**Files:**
- Create: `packages/agent-host/src/pet-state-store.ts`
- Test: `packages/agent-host/src/pet-state-store.test.ts`

**Interfaces:**
- Consumes: `AgentEvent`, `PetAnimationState`, `PetRuntimeSnapshot` from `@piwin/contracts`; `reducePetAgentContext`, `createInitialPetAgentContext`, `derivePetAnimationState` from `@piwin/pet`.
- Produces: `createPetStateStore(options)` — `{ reduce(event), snapshot(), setBase(pet), subscribe(listener) }`.

- [ ] **Step 1: Write the failing test**

`packages/agent-host/src/pet-state-store.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { AgentEvent, PetRuntimeSnapshot } from '@piwin/contracts';
import { createPetStateStore } from './pet-state-store.js';

const basePet: PetRuntimeSnapshot = {
  petId: 'piwin-default',
  displayName: 'Piwin',
  spritesheetAbsolutePath: '/x/sheet.png',
  state: 'idle',
  fps: 6,
  cellWidth: 48,
  cellHeight: 52,
  cols: 8,
  rows: 9,
  stateRows: {
    idle: 0,
    running: 1,
    waiting: 2,
    failed: 3,
    waving: 4,
    jumping: 5,
    review: 6,
  },
};

describe('createPetStateStore', () => {
  it('starts idle and reflects base pet', () => {
    const store = createPetStateStore({ basePet });
    expect(store.snapshot().pet.state).toBe('idle');
    expect(store.snapshot().pet.petId).toBe('piwin-default');
  });

  it('transitions to running on assistant message/start', () => {
    const store = createPetStateStore({ basePet });
    store.reduce({ type: 'message/start', messageId: 'm1', role: 'assistant' } as AgentEvent);
    expect(store.snapshot().pet.state).toBe('running');
  });

  it('transitions to waiting on permission/request', () => {
    const store = createPetStateStore({ basePet });
    store.reduce({
      type: 'permission/request',
      requestId: 'p1',
      action: 'bash',
      detail: 'rm',
      defaultDecision: 'ask',
    } as AgentEvent);
    expect(store.snapshot().pet.state).toBe('waiting');
  });

  it('notifies subscribers on state change', () => {
    const store = createPetStateStore({ basePet });
    const seen: string[] = [];
    store.subscribe((snap) => seen.push(snap.pet.state));
    store.reduce({ type: 'message/start', messageId: 'm1', role: 'assistant' } as AgentEvent);
    store.reduce({ type: 'message/end', messageId: 'm1' } as AgentEvent);
    expect(seen).toEqual(['running', 'idle']);
  });

  it('does not notify when state is unchanged', () => {
    const store = createPetStateStore({ basePet });
    const seen: string[] = [];
    store.subscribe((snap) => seen.push(snap.pet.state));
    store.reduce({ type: 'session/started', sessionId: 's1' } as AgentEvent);
    expect(seen).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @piwin/agent-host test -- pet-state-store`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`packages/agent-host/src/pet-state-store.ts`:

```typescript
/**
 * Reduces the live AgentEvent stream into a PetRuntimeSnapshot and notifies
 * subscribers only when the animation state actually changes. HostRuntime
 * feeds every session event through reduce(); the desktop subscribes via
 * the pet/state push.
 */
import type { AgentEvent, PetAnimationState, PetRuntimeSnapshot } from '@piwin/contracts';
import {
  createInitialPetAgentContext,
  reducePetAgentContext,
  type PetAgentContext,
} from '@piwin/pet';

export type PetStateSnapshot = {
  pet: PetRuntimeSnapshot;
  context: PetAgentContext;
};

export type PetStateStoreOptions = {
  basePet: PetRuntimeSnapshot;
};

export type PetStateStore = {
  reduce(event: AgentEvent): void;
  snapshot(): PetStateSnapshot;
  setBase(pet: PetRuntimeSnapshot): void;
  subscribe(listener: (snapshot: PetStateSnapshot) => void): () => void;
};

export function createPetStateStore(options: PetStateStoreOptions): PetStateStore {
  let context = createInitialPetAgentContext();
  let basePet = options.basePet;
  const listeners = new Set<(snapshot: PetStateSnapshot) => void>();

  function snapshot(): PetStateSnapshot {
    return {
      pet: { ...basePet, state: context.state },
      context,
    };
  }

  function notifyIfChanged(prevState: PetAnimationState): void {
    if (context.state === prevState) return;
    const snap = snapshot();
    for (const listener of listeners) listener(snap);
  }

  return {
    reduce(event: AgentEvent): void {
      const prevState = context.state;
      context = reducePetAgentContext(context, event);
      notifyIfChanged(prevState);
    },
    snapshot,
    setBase(pet: PetRuntimeSnapshot): void {
      basePet = pet;
    },
    subscribe(listener: (snapshot: PetStateSnapshot) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
```
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @piwin/agent-host test -- pet-state-store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-host/src/pet-state-store.ts packages/agent-host/src/pet-state-store.test.ts
git commit -m "agent-host: add PetStateStore reducer with change-only notifications"
```

---

## Task 12: Agent-host — wire pet-state-store into HostRuntime

**Files:**
- Modify: `packages/agent-host/src/host-runtime.ts`
- Modify: `packages/agent-host/src/commands/host-command-context.ts`

**Interfaces:**
- Consumes: `createPetStateStore`, `PetStateStore` from Task 11; `getActivePet`, `setActivePet` from `@piwin/pet`; `PetRuntimeSnapshot` from `@piwin/contracts`.
- Produces: `HostRuntime` constructs a `petStateStore`, feeds every `AgentEvent` through `petStateStore.reduce`, pushes `pet/state` on change, and exposes the store via `HostCommandContext.petStateStore`.

- [ ] **Step 1: Add petStateStore to HostCommandContext**

In `packages/agent-host/src/commands/host-command-context.ts`, add to the `HostCommandContext` type (after `todoStore`):

```typescript
  petStateStore: import('../pet-state-store.js').PetStateStore;
```

- [ ] **Step 2: Import and construct the store in HostRuntime**

In `packages/agent-host/src/host-runtime.ts`:

Replace the existing pet import (line 67):
```typescript
import { getActivePet, installPetFromLocalPath, listPets, setActivePet } from '@piwin/pet';
```
with:
```typescript
import {
  getActivePet,
  installPetFromLocalPath,
  installPetFromRegistry,
  listPets,
  queryRemotePetStore,
  setActivePet,
} from '@piwin/pet';
import { createPetStateStore, type PetStateStore } from './pet-state-store.js';
import type { PetRuntimeSnapshot } from '@piwin/contracts';
```

Add a private field near the other private state (e.g. after `terminalRunIdsBySession`):
```typescript
  private petStateStore: PetStateStore | null = null;
```

Add an initializer method (place near `buildDomainContext`):
```typescript
  private async ensurePetStateStore(): Promise<PetStateStore> {
    if (this.petStateStore) return this.petStateStore;
    const root = this.options.piwinRoot;
    let base: PetRuntimeSnapshot;
    if (root) {
      try {
        base = await getActivePet(root, 'idle');
      } catch {
        base = fallbackPetSnapshot();
      }
    } else {
      base = fallbackPetSnapshot();
    }
    const store = createPetStateStore({ basePet: base });
    store.subscribe((snapshot) => {
      this.push({ type: 'pet/state', pet: snapshot.pet });
    });
    this.petStateStore = store;
    return store;
  }
```

Add the fallback snapshot helper near the bottom of the class (before the final closing brace):
```typescript
function fallbackPetSnapshot(): PetRuntimeSnapshot {
  return {
    petId: 'piwin-default',
    displayName: 'Piwin Default',
    spritesheetAbsolutePath: '',
    state: 'idle',
    fps: 6,
    cellWidth: 48,
    cellHeight: 52,
    cols: 8,
    rows: 9,
    stateRows: {
      idle: 0,
      running: 1,
      waiting: 2,
      failed: 3,
      waving: 4,
      jumping: 5,
      review: 6,
    },
  };
}
```

- [ ] **Step 3: Feed AgentEvents into the store**

In the event dispatch path (around line 1499, after `this.push({ type: 'event', sessionId: session.id, event: correlatedEvent });`), add:

```typescript
      void this.ensurePetStateStore().then((store) => store.reduce(correlatedEvent));
```

- [ ] **Step 4: Expose the store in buildDomainContext**

In `buildDomainContext` (around line 1302), change the signature to async and add `petStateStore`:

```typescript
  private async buildDomainContext(): Promise<import('./commands/domain-command-dispatch.js').DomainDispatchContext> {
    const hostContext: HostCommandContext = {
      ...(this.options.piwinRoot !== undefined ? { piwinRoot: this.options.piwinRoot } : {}),
      push: (message) => this.push(message),
      requireSession: (sessionId) => this.requireSession(sessionId),
      getMcpManager: () => this.getMcpManager(),
      getProcessRegistry: () => this.getProcessRegistry(),
      getPtyHost: () => this.getPtyHost(),
      todoStore: this.todoStore,
      petStateStore: await this.ensurePetStateStore(),
      runCronJob: (job) => this.runCronJob(job),
      pendingPermissions: this.pendingPermissions,
      pendingExtensionUi: this.pendingExtensionUi,
      rememberProjectPermission: (sessionId, action, detail, scope, projectPath) =>
        this.rememberProjectPermission(sessionId, action, detail, scope, projectPath),
    };
```

**Critical:** The caller at line 384 currently passes `this.buildDomainContext()` inline inside `dispatchDomainCommands(...)`. Since `buildDomainContext` is now async, this would pass a Promise. Fix the caller:

```typescript
    const ctx = await this.buildDomainContext();
    const domain = await dispatchDomainCommands(command, requestId, ctx);
```

- [ ] **Step 5: Update catalog-commands to read live state**

In `packages/agent-host/src/commands/catalog-commands.ts`:

**Remove `getActivePet` from the import** (line 14) — it is no longer called here. Replace:
```typescript
import { getActivePet, installPetFromLocalPath, listPets, setActivePet } from '@piwin/pet';
```
with:
```typescript
import {
  installPetFromLocalPath,
  installPetFromRegistry,
  listPets,
  queryRemotePetStore,
  setActivePet,
} from '@piwin/pet';
```

Replace the `pet/get-active` case (lines 271-274):
```typescript
    case 'pet/get-active': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const pet = await getActivePet(rootDir);
      return ok(requestId, 'pet/get-active', { pet });
    }
```
with:
```typescript
    case 'pet/get-active': {
      const pet = context.petStateStore.snapshot().pet;
      return ok(requestId, 'pet/get-active', { pet });
    }
```

Replace the `pet/set-active` case (lines 276-279):
```typescript
    case 'pet/set-active': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const pet = await setActivePet(rootDir, command.petId);
      context.petStateStore.setBase(pet);
      return ok(requestId, 'pet/set-active', { pet });
    }
```

Add the two new command cases after `pet/install-local` (line 284):
```typescript
    case 'pet/store-query': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const results = await queryRemotePetStore(rootDir, command.query.query);
      return ok(requestId, 'pet/store-query', { results });
    }
    case 'pet/install-registry': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const installed = await installPetFromRegistry(rootDir, command.url);
      return ok(requestId, 'pet/install-registry', installed);
    }
```

Add `'pet/store-query'` and `'pet/install-registry'` to the `CATALOG_COMMAND_TYPES` array (lines 44-47) alongside the existing pet entries.

- [ ] **Step 6: Run agent-host typecheck + tests**

Run: `pnpm --filter @piwin/agent-host typecheck && pnpm --filter @piwin/agent-host test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-host/src/host-runtime.ts packages/agent-host/src/commands/host-command-context.ts packages/agent-host/src/commands/catalog-commands.ts
git commit -m "agent-host: wire PetStateStore into HostRuntime; add pet/store-query + pet/install-registry"
```

---

## Task 13: CLI — serialize the new install command

**Files:**
- Modify: `apps/cli/src/host-serve-command-lane.ts`

- [ ] **Step 1: Add the new install command to the serialized lane**

In `apps/cli/src/host-serve-command-lane.ts`, in the `SERIALIZED_COMMAND_TYPES` set (after line 34 `pet/install-local`), add:

```typescript
  'pet/install-registry',
```

- [ ] **Step 2: Run CLI typecheck**

Run: `pnpm --filter @piwin/cli typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/host-serve-command-lane.ts
git commit -m "cli: serialize pet/install-registry command"
```

---

## Task 14: Desktop — PetSprite canvas component

**Files:**
- Create: `apps/desktop/src/components/PetSprite.tsx`
- Create: `apps/desktop/src/components/pet-sprite.css`

**Interfaces:**
- Consumes: `PetRuntimeSnapshot`, `PetAnimationState` from `@piwin/contracts`.
- Produces: `<PetSprite pet={...} onOpenSettings={() => void} />` — floating, draggable, hover-reactive, random-idle canvas renderer.

- [ ] **Step 1: Create the CSS**

`apps/desktop/src/components/pet-sprite.css`:

```css
.pet-sprite-root {
  position: fixed;
  bottom: 16px;
  right: 16px;
  width: 96px;
  height: 104px;
  z-index: 9999;
  user-select: none;
  cursor: grab;
  touch-action: none;
}
.pet-sprite-root.dragging {
  cursor: grabbing;
}
.pet-sprite-root canvas {
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
}
.pet-sprite-root.hidden {
  display: none;
}
```

- [ ] **Step 2: Create the component**

`apps/desktop/src/components/PetSprite.tsx`:

```typescript
import { useEffect, useRef, useState } from 'react';
import type { PetAnimationState, PetRuntimeSnapshot } from '@piwin/contracts';
import { DEFAULT_PET_STATE_ROWS } from '@piwin/contracts';
import './pet-sprite.css';

export type PetSpriteProps = {
  pet: PetRuntimeSnapshot;
  /** Called when the user clicks the pet (not drags). */
  onOpenSettings?: () => void;
  /** Hide the sprite entirely. */
  hidden?: boolean;
};

const IDLE_INTERVAL_MS = 4000;
const ACTION_DURATION_MS = 1200;

type TempAction = PetAnimationState | null;

export function PetSprite(props: PetSpriteProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const rafRef = useRef<number>(0);
  const frameRef = useRef<number>(0);
  const [dragging, setDragging] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [tempAction, setTempAction] = useState<TempAction>(null);
  const tempActionUntil = useRef<number>(0);
  const hoverRef = useRef<boolean>(false);

  // Load spritesheet.
  useEffect(() => {
    if (!props.pet.spritesheetAbsolutePath) return;
    const img = new Image();
    img.src = convertFileSrc(props.pet.spritesheetAbsolutePath);
    img.onload = () => {
      imageRef.current = img;
    };
  }, [props.pet.spritesheetAbsolutePath]);

  // Animation loop.
  useEffect(() => {
    let lastFrame = 0;
    let lastIdle = performance.now();
    const fps = props.pet.fps || 6;
    const frameMs = 1000 / fps;

    function tick(now: number): void {
      const canvas = canvasRef.current;
      const img = imageRef.current;
      if (canvas && img) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          if (now - lastFrame >= frameMs) {
            frameRef.current = (frameRef.current + 1) % props.pet.cols;
            lastFrame = now;
          }
          const state = effectiveState();
          const row = props.pet.stateRows[state] ?? DEFAULT_PET_STATE_ROWS[state] ?? 0;
          const col = frameRef.current;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(
            img,
            col * props.pet.cellWidth,
            row * props.pet.cellHeight,
            props.pet.cellWidth,
            props.pet.cellHeight,
            0,
            0,
            canvas.width,
            canvas.height,
          );
        }
      }
      // Random idle action.
      if (
        !tempAction &&
        props.pet.state === 'idle' &&
        !hoverRef.current &&
        now - lastIdle > IDLE_INTERVAL_MS &&
        Math.random() < 0.02
      ) {
        const actions: PetAnimationState[] = ['waving', 'jumping'];
        const action = actions[Math.floor(Math.random() * actions.length)] ?? 'waving';
        setTempAction(action);
        tempActionUntil.current = now + ACTION_DURATION_MS;
        lastIdle = now;
      }
      if (tempAction && now > tempActionUntil.current) {
        setTempAction(null);
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [props.pet, tempAction]);

  function effectiveState(): PetAnimationState {
    if (tempAction) return tempAction;
    return props.pet.state;
  }

  // Drag handling.
  function onPointerDown(e: React.PointerEvent): void {
    setDragging(true);
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      px: pos?.x ?? window.innerWidth - 112,
      py: pos?.y ?? window.innerHeight - 120,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent): void {
    if (!dragging || !dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPos({ x: dragStart.current.px + dx, y: dragStart.current.py + dy });
  }
  function onPointerUp(e: React.PointerEvent): void {
    setDragging(false);
    dragStart.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    // Jump on release if dragged.
    if (tempAction === null) {
      setTempAction('jumping');
      tempActionUntil.current = performance.now() + ACTION_DURATION_MS;
    }
  }
  function onClick(): void {
    if (dragging) return;
    props.onOpenSettings?.();
  }
  function onMouseEnter(): void {
    hoverRef.current = true;
    if (props.pet.state === 'idle' && !tempAction) {
      setTempAction('waving');
      tempActionUntil.current = performance.now() + ACTION_DURATION_MS;
    }
  }
  function onMouseLeave(): void {
    hoverRef.current = false;
  }

  const style: React.CSSProperties = pos
    ? { left: `${pos.x}px`, top: `${pos.y}px`, bottom: 'auto', right: 'auto' }
    : {};

  return (
    <div
      className={`pet-sprite-root${dragging ? ' dragging' : ''}${props.hidden ? ' hidden' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <canvas
        ref={canvasRef}
        width={props.pet.cellWidth}
        height={props.pet.cellHeight}
      />
    </div>
  );
}

/**
 * Convert an absolute filesystem path to a Tauri asset URL.
 * In non-Tauri (mock) mode, fall back to a file:// URL.
 */
function convertFileSrc(path: string): string {
  const w = window as unknown as { __TAURI_INTERNALS__?: { convertFileSrc?: (p: string) => string } };
  if (w.__TAURI_INTERNALS__?.convertFileSrc) {
    return w.__TAURI_INTERNALS__.convertFileSrc(path);
  }
  return `file://${path}`;
}
```

- [ ] **Step 3: Run desktop typecheck**

Run: `pnpm --filter @piwin/desktop typecheck`
Expected: PASS (component is not yet mounted, but should compile).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/components/PetSprite.tsx apps/desktop/src/components/pet-sprite.css
git commit -m "desktop: add PetSprite canvas component with drag/hover/idle interactions"
```

---

## Task 15: Desktop — wire PetSprite + pet/state into App

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/hooks/use-host-bootstrap.ts`

**Interfaces:**
- Consumes: `PetSprite` from Task 14; `PetRuntimeSnapshot`, `HostPush` from `@piwin/contracts`.
- Produces: `App` holds `activePet` state, subscribes to `pet/state` pushes, renders `<PetSprite>` in the corner.

- [ ] **Step 1: Subscribe to pet/state in use-host-bootstrap**

In `apps/desktop/src/hooks/use-host-bootstrap.ts`, the hook already has internal `activePet`/`setActivePet` state (line 86) and returns them (lines 255-256). Add a `pet/state` handler in the subscribe block. After the `plan/updated` handler (around line 173), add:

```typescript
      if (message.type === 'pet/state') {
        setActivePet(message.pet);
        return;
      }
```

This calls the **internal** `setActivePet` (line 86), NOT `args.setActivePet` — `setActivePet` is not part of `UseHostBootstrapArgs`.

- [ ] **Step 2: Destructure activePet and mount PetSprite in App.tsx**

In `apps/desktop/src/App.tsx`, the hook already returns `activePet` (line 255 of the hook) but `App.tsx` only destructures `setActivePet` (line 312). Add `activePet` to the destructuring:

```typescript
  const {
    hostStatus,
    config,
    setConfig,
    activePet,
    setActivePet,
    sessionPlan,
    // ... rest unchanged
  } = useHostBootstrap({
```

Add the import near the other component imports:

```typescript
import { PetSprite } from './components/PetSprite';
```

In the JSX return (near the end, before the closing root element), add:

```tsx
      {activePet ? (
        <PetSprite pet={activePet} onOpenSettings={() => setSettingsOpen(true)} />
      ) : null}
```

(Use the existing `settingsOpen`/`setSettingsOpen` state variable already present in `App.tsx` — search for `settingsOpen` to find the setter name.)

- [ ] **Step 3: Run desktop typecheck + build**

Run: `pnpm --filter @piwin/desktop typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/hooks/use-host-bootstrap.ts
git commit -m "desktop: mount PetSprite and subscribe to pet/state pushes"
```

---

## Task 16: Desktop — PetPanel registry browse + install

**Files:**
- Modify: `apps/desktop/src/PetPanel.tsx`
- Modify: `apps/desktop/src/host-request-adapters.ts`
- Modify: `apps/desktop/src/host-client.ts`
- Modify: `apps/desktop/src/host-client-mock.ts`
- Modify: `apps/desktop/src/settings/settings-context.tsx`
- Modify: `apps/desktop/src/SettingsPanel.tsx`

**Interfaces:**
- Consumes: `PetStoreQueryResult`, `PetInstallResult` from `@piwin/contracts`.
- Produces: `PetPanel` gains a "Browse Registry" section that calls `pet/store-query` and an "Install from Registry" button that calls `pet/install-registry`.

- [ ] **Step 1: Extend the request union in host-request-adapters**

In `apps/desktop/src/host-request-adapters.ts`, replace the `requestPet` type (lines 91-95):

```typescript
  requestPet: (command: {
    type:
      | 'pet/list'
      | 'pet/get-active'
      | 'pet/set-active'
      | 'pet/install-local'
      | 'pet/store-query'
      | 'pet/install-registry';
    petId?: string;
    sourcePath?: string;
    query?: { query: string; source?: 'registry' };
    url?: string;
    sha256?: string;
  }) => Promise<HostResponse>;
```

Add the forwarding branches in the `requestPet` implementation (after the existing `pet/install-local` branch around line 328):

```typescript
      if (command.type === 'pet/store-query') {
        return hostClient.request({
          type: 'pet/store-query',
          query: command.query ?? { query: '' },
        });
      }
      if (command.type === 'pet/install-registry') {
        return hostClient.request({
          type: 'pet/install-registry',
          url: command.url ?? '',
          ...(command.sha256 ? { sha256: command.sha256 } : {}),
        });
      }
```

- [ ] **Step 2: Extend the timeout in host-client**

In `apps/desktop/src/host-client.ts`, add `pet/install-registry` to the operation-timeout case (after line 51 `pet/install-local`):

```typescript
    case 'pet/install-registry':
```

- [ ] **Step 3: Extend the mock**

In `apps/desktop/src/host-client-mock.ts`, after the `pet/install-local` case (line 1166), add:

```typescript
      case 'pet/store-query':
        return {
          id,
          type: 'response',
          command: 'pet/store-query',
          success: true,
          data: {
            results: [
              {
                petId: 'mock-registry-pet',
                displayName: 'Mock Registry Pet',
                source: 'registry',
                location: 'https://mock.test/pet.zip',
                installed: false,
                sha256: 'a'.repeat(64),
                sizeBytes: 1024,
              },
            ],
          },
        };
      case 'pet/install-registry':
        return {
          id,
          type: 'response',
          command: 'pet/install-registry',
          success: true,
          data: { petId: 'mock-registry-pet', path: '/mock/pets/mock-registry-pet' },
        };
```

Also add a `pet/state` push simulation — in the mock's subscribe loop (or wherever it emits pushes), no change is needed for the basic mock; the real host will push `pet/state`. Skip mock push for now.

- [ ] **Step 4: Extend settings-context and SettingsPanel**

In `apps/desktop/src/settings/settings-context.tsx`, the `requestPet` type is imported from `PetPanel` — update the `PetPanelProps['request']` union in `PetPanel.tsx` first (next step), and these files will pick it up automatically. No direct edit needed if they use `PetPanelProps['request']`.

- [ ] **Step 5: Add registry UI to PetPanel**

In `apps/desktop/src/PetPanel.tsx`, replace the `PetPanelProps` type (lines 7-16):

```typescript
export type PetPanelProps = {
  request: (command: {
    type:
      | 'pet/list'
      | 'pet/get-active'
      | 'pet/set-active'
      | 'pet/install-local'
      | 'pet/store-query'
      | 'pet/install-registry';
    petId?: string;
    sourcePath?: string;
    query?: { query: string; source?: 'registry' };
    url?: string;
    sha256?: string;
  }) => Promise<HostResponse>;
  onActiveChanged: (pet: PetRuntimeSnapshot) => void;
  onClose?: () => void;
  variant?: 'inline' | 'modal';
};
```

Add the import for `PetStoreQueryResult`:

```typescript
import type { HostResponse, PetRuntimeSnapshot, PetStoreQueryResult, PetSummary } from '@piwin/contracts';
```

Add state + handlers inside `PetPanel`:

```typescript
  const [registryResults, setRegistryResults] = useState<PetStoreQueryResult[]>([]);
  const [registryQuery, setRegistryQuery] = useState('');
  const [registryBusy, setRegistryBusy] = useState(false);

  async function handleQueryRegistry(): Promise<void> {
    setRegistryBusy(true);
    setError(null);
    const response = await props.request({ type: 'pet/store-query', query: { query: registryQuery } });
    setRegistryBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { results: PetStoreQueryResult[] };
    setRegistryResults(data.results);
  }

  async function handleInstallRegistry(result: PetStoreQueryResult): Promise<void> {
    setRegistryBusy(true);
    setError(null);
    setInfo(null);
    const entry = JSON.stringify({
      id: result.petId,
      displayName: result.displayName,
      ...(result.description ? { description: result.description } : {}),
      ...(result.version ? { version: result.version } : {}),
      url: result.location,
      sha256: result.sha256 ?? '',
      sizeBytes: result.sizeBytes ?? 0,
    });
    const response = await props.request({ type: 'pet/install-registry', url: entry });
    setRegistryBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { petId: string; path: string };
    setInfo(isChinese ? `已安装 ${data.petId}` : `Installed ${data.petId}`);
    await reload();
    await handleQueryRegistry();
  }
```

Add the registry section JSX before the closing `</div>` of the panel (after the local install section):

```tsx
        <div className="settings-section">
          <PageTitle
            title={isChinese ? '远程仓库' : 'Registry'}
            description={
              isChinese
                ? '从 CodexPetHub 浏览并安装伙伴。'
                : 'Browse and install companions from CodexPetHub.'
            }
          />
          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <input
                value={registryQuery}
                onChange={(e) => setRegistryQuery(e.target.value)}
                placeholder={isChinese ? '搜索...' : 'Search...'}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--line-soft)',
                  background: 'var(--surface-raised)',
                  color: 'var(--text)',
                }}
              />
            </div>
            <Button disabled={registryBusy} onClick={() => void handleQueryRegistry()}>
              {isChinese ? '搜索' : 'Search'}
            </Button>
          </div>
          <ul className="ext-list" style={{ marginTop: '12px' }}>
            {registryResults.map((result) => (
              <li key={result.petId} className="ext-list-item">
                <div className="ext-list-main" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      background: 'var(--surface-inset)',
                      border: '1px solid var(--line-soft)',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: '20px',
                    }}
                  >
                    🐾
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <strong>{result.displayName}</strong>
                    <div className="muted ext-desc" style={{ fontSize: '12px' }}>
                      {result.petId}
                      {result.sizeBytes ? ` · ${Math.round(result.sizeBytes / 1024)} KB` : ''}
                    </div>
                  </div>
                </div>
                <Button
                  variant={result.installed ? 'ghost' : 'primary'}
                  size="compact"
                  disabled={registryBusy || result.installed}
                  onClick={() => void handleInstallRegistry(result)}
                >
                  {result.installed
                    ? isChinese
                      ? '已安装'
                      : 'Installed'
                    : isChinese
                      ? '安装'
                      : 'Install'}
                </Button>
              </li>
            ))}
          </ul>
        </div>
```

- [ ] **Step 6: Run desktop typecheck**

Run: `pnpm --filter @piwin/desktop typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/PetPanel.tsx apps/desktop/src/host-request-adapters.ts apps/desktop/src/host-client.ts apps/desktop/src/host-client-mock.ts
git commit -m "desktop: add registry browse + install to PetPanel"
```

---

## Task 17: Full workspace verification

**Files:** (no file changes — verification only)

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS across all packages.

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 3: Manual smoke (document in PR)**

- Start desktop dev: `pnpm dev:desktop`
- Confirm the Piwin Default pet renders in the bottom-right corner, idle animation playing.
- Start a prompt → pet transitions to `running`.
- Trigger a permission request → pet transitions to `waiting`.
- Hover the pet → waving action.
- Drag the pet → it follows the cursor; on release it jumps.
- Open Settings → Pets → browse registry → install a mock pet → activate it → sprite swaps.

- [ ] **Step 4: Final commit (if any fixups)**

If verification surfaced fixups, commit them. Otherwise no commit.

```bash
git add -A
git commit -m "chore: pet source providers + live rendering verification"
```

---

## Self-Review

**1. Spec coverage:**
- PetSourceProvider abstraction (bundled/local/codex-live/registry): Tasks 3-9. ✓
- Re-implement PetSprite rendering: Task 14. ✓
- Re-wire pet-state-store + push: Tasks 11-12. ✓
- pet/store-query + pet/install-registry commands: Tasks 2, 12-13, 16. ✓
- Robustness (HTTPS, size cap, SHA256, magic bytes, atomic rename, provider isolation, dedupe): Tasks 7-9. ✓
- Desktop integration (App mount, PetPanel browse): Tasks 15-16. ✓
- Codex interop preserved (codex-live scan in place): Task 6. ✓
- No pet/import-codex dependency: confirmed — no task reintroduces it. ✓

**2. Placeholder scan:** No "TBD", "TODO", "implement later", "add error handling" without code. All steps contain concrete code. ✓

**3. Type consistency:**
- `PetSourceKind` used consistently across contracts, providers, registry, pet-store. ✓
- `PetSourceProviderContext` fields (`piwinRoot`, `petsDir`, `codexPetsDir`) match across all providers. ✓
- `createPetStateStore({ basePet })` matches Task 11 test + Task 12 wiring. ✓
- `petStateStore` field name matches between `host-command-context.ts` (Task 12 Step 1) and `catalog-commands.ts` (Task 12 Step 5). ✓
- `PetPanelProps['request']` union extended consistently in PetPanel + host-request-adapters. ✓
- `installPetFromRegistry` / `queryRemotePetStore` names match between pet-store.ts (Task 10) and catalog-commands.ts (Task 12). ✓

**4. Review fixes applied (round 2):**
- Task 2: `ipc.ts` has NO existing `./pet.js` import — added fresh import line instead of modifying nonexistent one. ✓
- Task 11: Removed unnecessary `PetAnimationStateLike` type alias; import `PetAnimationState` directly from contracts. ✓
- Task 12 Step 4: `buildDomainContext` caller at line 384 passes result inline to `dispatchDomainCommands` — must extract to separate `await` call to avoid passing a Promise. ✓
- Task 12 Step 5: `getActivePet` import in `catalog-commands.ts` becomes unused after switching to `petStateStore.snapshot()` — removed from import. ✓
- Task 14: `frameRef` was used for BOTH sprite column counter AND RAF handle — split into `rafRef` + `frameRef`. ✓
- Task 15 Step 1: `setActivePet` is internal hook state, NOT part of `UseHostBootstrapArgs` — call internal `setActivePet` directly. ✓
- Task 15 Step 2: `useHostBootstrap` already returns `activePet` — add to destructuring, don't create new state. ✓
- Task 10: Documented `ensureBundledPetsInstalled` removal and `spritesheetAbsolutePath` compromise. ✓
- Task 8: Documented `unzip` cross-platform limitation. ✓

No remaining issues.
