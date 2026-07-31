# Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the security, error-visibility, and build-graph issues found in the 2026-07-29 project review: media symlink protection, silent error logging, secret-file permission coverage, artifact XSS tests, tsconfig graph repair, and RPC honesty in docs.

**Architecture:** All fixes are minimal diffs to existing files. Security fixes (media symlink, permission policy) get new unit tests following the existing TDD pattern. Error-visibility fixes add `console.warn`/`this.push({type:'host/log'})` calls at catch sites — no behavior change, only observability. Build-graph fixes add missing entries to root `tsconfig.json` references and make `apps/desktop/tsconfig.json` extend the base. Doc fixes update `architecture.md` to honestly describe the RPC fallback reality.

**Tech Stack:** TypeScript (strict, NodeNext, ESM), vitest, pnpm workspace, Tauri 2 (desktop).

## Global Constraints

- TypeScript strict mode (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) — never weaken without ADR.
- ESM only; relative imports use `.js` extensions (NodeNext).
- No `any`; prefer `unknown` + narrowing. No non-null assertion `!` except after runtime check in same block.
- No silent `catch {}` — AGENTS.md §3.3: log at boundary with context, or rethrow.
- Colocated tests: `foo.ts` + `foo.test.ts` in same `src/` dir.
- `pnpm typecheck` and `pnpm test` must stay green after every task.
- Node `>= 20`, pnpm `9.15.0`.
- Keep diffs minimal — do not refactor unrelated code.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `packages/media/src/media-service.ts` | Add symlink-aware path validation | Modify |
| `packages/media/src/media-service.test.ts` | Symlink escape + traversal tests | Modify |
| `packages/agent-host/src/host-runtime.ts` | Log at 3 silent catch sites | Modify |
| `packages/agent-host/src/host-runtime.test.ts` | Test for index-write warn | Modify |
| `packages/agent-host/src/sdk-adapter.ts` | Log at trusted-roots catch site | Modify |
| `packages/agent-host/src/commands/catalog-commands.ts` | Log secret-resolution failures | Modify |
| `packages/agent-host/src/permission-policy.ts` | Expand secret-file write patterns | Modify |
| `packages/agent-host/src/permission-policy.test.ts` | Golden tests for secret-file writes | Modify |
| `packages/artifact/src/security.test.ts` | XSS golden test cases | Modify |
| `tsconfig.json` | Add 4 missing package references | Modify |
| `apps/desktop/tsconfig.json` | Extend base instead of standalone | Modify |
| `docs/architecture.md` | RPC fallback honesty note | Modify |

---

### Task 1: Media symlink protection (B1)

**Files:**
- Modify: `packages/media/src/media-service.ts:1-96`
- Test: `packages/media/src/media-service.test.ts:1-54`

**Interfaces:**
- Consumes: `node:fs/promises` (`realpath`, `symlink`, `mkdir`, `writeFile`), `node:path` (`resolve`, `join`)
- Produces: `assertInsideMediaRoot` (existing, unchanged) + new `assertRealPathInsideMediaRoot` helper

**Why:** `path.resolve()` does not follow symlinks. A symlink inside the media tree pointing outside (e.g. a symlinked session dir → `~/.ssh/`) passes the current prefix check because the *path string* is under root, but the *resolved file* is outside. We add a `realpath`-based check after write.

- [ ] **Step 1: Write the failing test for symlink escape**

In `packages/media/src/media-service.test.ts`, replace line 1:

```typescript
import { mkdtemp, readFile } from 'node:fs/promises';
```

with:

```typescript
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
```

Then add this test inside the `describe('media-service')` block, after the `rejects path traversal` test (after line 34, before the `rejects disallowed mime` test):

```typescript
  it('rejects symlinked session dir that escapes media root', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-media-'));
    // Attacker pre-creates a symlinked session dir pointing outside.
    const targetOutside = await mkdtemp(join(tmpdir(), 'piwin-escape-'));
    const symlinkedSession = join(mediaRoot, 'sess-evil');
    await symlink(targetOutside, symlinkedSession);
    await expect(
      saveMediaAsset(
        {
          mediaRoot,
          maxPasteBytes: 1024,
          allowedMimeTypes: ['image/png'],
        },
        {
          sessionId: 'sess-evil',
          bytes: new Uint8Array([137, 80, 78, 71, 0, 1, 2, 3]),
          mimeType: 'image/png',
          source: 'paste',
        },
      ),
    ).rejects.toThrow(/escapes media root/);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @piwin/media test`
Expected: FAIL — the current `saveMediaAsset` writes into the symlinked dir successfully because `resolve()` of the path string stays under root; `escapes media root` is never thrown.

- [ ] **Step 3: Implement the realpath check**

In `packages/media/src/media-service.ts`, replace line 2:

```typescript
import { mkdir, writeFile } from 'node:fs/promises';
```

with:

```typescript
import { mkdir, realpath, writeFile } from 'node:fs/promises';
```

Replace the `assertInsideMediaRoot` function (lines 68-75) with two functions:

```typescript
export function assertInsideMediaRoot(mediaRoot: string, absolutePath: string): string {
  const root = resolve(mediaRoot);
  const target = resolve(absolutePath);
  if (target !== root && !target.startsWith(root + '/') && !target.startsWith(root + '\\')) {
    throw new Error(`path escapes media root: ${absolutePath}`);
  }
  return target;
}

/**
 * Resolve symlinks then re-validate the real path stays under media root.
 * `assertInsideMediaRoot` alone is insufficient because `path.resolve()`
 * does not follow symlinks — a symlinked session dir pointing outside the
 * root would pass the string prefix check but write outside the root.
 */
export async function assertRealPathInsideMediaRoot(
  mediaRoot: string,
  absolutePath: string,
): Promise<string> {
  const realPath = await realpath(absolutePath);
  return assertInsideMediaRoot(mediaRoot, realPath);
}
```

In `saveMediaAsset`, replace lines 53-55:

```typescript
  const absolutePath = resolve(directory, `${id}${extension}`);
  assertInsideMediaRoot(options.mediaRoot, absolutePath);
  await writeFile(absolutePath, input.bytes);
```

with:

```typescript
  const absolutePath = resolve(directory, `${id}${extension}`);
  assertInsideMediaRoot(options.mediaRoot, absolutePath);
  await writeFile(absolutePath, input.bytes);
  await assertRealPathInsideMediaRoot(options.mediaRoot, absolutePath);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @piwin/media test`
Expected: PASS — all 4 tests green (3 existing + 1 new symlink test).

- [ ] **Step 5: Commit**

```bash
git add packages/media/src/media-service.ts packages/media/src/media-service.test.ts
git commit -m "fix(media): reject symlinked session dirs that escape media root

path.resolve() does not follow symlinks, so a symlinked session
directory pointing outside ~/.piwin/media/ would pass the prefix
check. Add realpath-based re-validation after write."
```

---

### Task 2: Log silent errors in host-runtime (C1, C2)

**Files:**
- Modify: `packages/agent-host/src/host-runtime.ts:249-258, 900-912, 1418-1422`
- Test: `packages/agent-host/src/host-runtime.test.ts`

**Interfaces:**
- Consumes: `HostPush` type (already imported at line 11), `this.push` method (private, line 1886)
- Produces: `host/log` warn events at 3 catch sites

**Why:** Three catch blocks swallow errors with only a comment, violating AGENTS.md §3.3. Users cannot distinguish "feature unconfigured" from "database corrupt". Add `host/log` warn events so the HostLogPanel surfaces them.

- [ ] **Step 1: Write the failing test for session-index-write logging**

First, find the top-level describe block name and the host/log assertion pattern:

Run: `grep -n "^describe\|host/log" packages/agent-host/src/host-runtime.test.ts | head -5`

Add this test inside the top-level `describe` block, before its final closing `});`. If the existing tests use a different constructor pattern, match it — check with `grep -n "new HostRuntime" packages/agent-host/src/host-runtime.test.ts | head -3` first.

```typescript
  it('emits host/log warn when session index write fails', async () => {
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: '/nonexistent-root-xyz/piwin',
    });
    const logs: Array<{ level: string; message: string }> = [];
    runtime.subscribe((push) => {
      if (push.type === 'host/log') {
        logs.push({ level: push.level, message: push.message });
      }
    });
    await runtime.createSession({
      projectPath: '/tmp/piwin-test-project',
      executionMode: 'agent',
    });
    const indexWarn = logs.find(
      (log) => log.level === 'warn' && log.message.includes('session index'),
    );
    expect(indexWarn).toBeDefined();
    await runtime.dispose();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @piwin/agent-host test -- src/host-runtime.test.ts`
Expected: FAIL — `indexWarn` is undefined because the catch at line 1420 swallows silently.

- [ ] **Step 3: Add host/log warn at the session-index catch (C1)**

In `packages/agent-host/src/host-runtime.ts`, replace lines 1420-1422:

```typescript
      } catch {
        // best-effort index write
      }
```

with:

```typescript
      } catch (error) {
        // best-effort index write — surface failure so users see why a
        // session may be missing from the list (corrupt index, permissions).
        const detail = error instanceof Error ? error.message : String(error);
        this.push({
          type: 'host/log',
          level: 'warn',
          message: `session index write failed: ${detail}`,
        });
      }
```

- [ ] **Step 4: Add host/log warn at the trusted-roots catch in constructor (C2)**

In `packages/agent-host/src/host-runtime.ts`, replace lines 255-257:

```typescript
        } catch {
          return [];
        }
```

with:

```typescript
        } catch (error) {
          // Trust DB read failure must not crash the host, but silently
          // returning [] would make all process spawns look "untrusted"
          // with no explanation. Warn so the user can diagnose.
          const detail = error instanceof Error ? error.message : String(error);
          this.push({
            type: 'host/log',
            level: 'warn',
            message: `trusted project roots read failed: ${detail}`,
          });
          return [];
        }
```

- [ ] **Step 5: Add host/log warn at the PTY trust check catch (C2)**

In `packages/agent-host/src/host-runtime.ts`, replace lines 909-911:

```typescript
          } catch {
            return false;
          }
```

with:

```typescript
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            this.push({
              type: 'host/log',
              level: 'warn',
              message: `pty trust check failed for ${projectPath}: ${detail}`,
            });
            return false;
          }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @piwin/agent-host test -- src/host-runtime.test.ts`
Expected: PASS — the `session index write failed` warn is now emitted.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-host/src/host-runtime.ts packages/agent-host/src/host-runtime.test.ts
git commit -m "fix(host): log silent catch failures via host/log warn

Three catch sites in host-runtime swallowed errors with only a
comment: session index write, trusted-roots read, PTY trust check.
Users could not distinguish 'unconfigured' from 'corrupt DB'.
Emit host/log warn so HostLogPanel surfaces the cause."
```

---

### Task 3: Log silent errors in sdk-adapter and catalog-commands (C2, C3)

**Files:**
- Modify: `packages/agent-host/src/sdk-adapter.ts:414-416`
- Modify: `packages/agent-host/src/commands/catalog-commands.ts:326-328, 351-353`

**Interfaces:**
- Consumes: `console.warn` (existing pattern in sdk-adapter, see line 392)
- Produces: `console.warn` diagnostic lines at 3 catch sites

**Why:** The sdk-adapter trusted-roots catch (same pattern as host-runtime but in a standalone function, no `this.push`) and the catalog-commands secret-resolution catches swallow errors. Use `console.warn` to match the existing sdk-adapter convention. No new test needed — these are diagnostic-only additions with no behavior change.

- [ ] **Step 1: Fix the sdk-adapter trusted-roots catch**

In `packages/agent-host/src/sdk-adapter.ts`, replace lines 414-416:

```typescript
        } catch {
          return [];
        }
```

with:

```typescript
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          console.warn(`[piwin] trusted project roots read failed: ${detail}`);
          return [];
        }
```

- [ ] **Step 2: Fix the catalog-commands models/discover catch**

In `packages/agent-host/src/commands/catalog-commands.ts`, replace lines 322-328:

```typescript
                try {
                  if (provider.apiKeyRef?.trim() || provider.apiKeyEnv?.trim()) {
                    return await secretResolver.resolveProviderSecret(provider);
                  }
                } catch {
                  return null;
                }
```

with:

```typescript
                try {
                  if (provider.apiKeyRef?.trim() || provider.apiKeyEnv?.trim()) {
                    return await secretResolver.resolveProviderSecret(provider);
                  }
                } catch (error) {
                  // Surface the real cause (env unset, keychain locked) so the
                  // downstream "no auth" error is diagnosable. Soft-resolve
                  // still returns null to not block local no-auth endpoints.
                  const detail = error instanceof Error ? error.message : String(error);
                  console.warn(`[piwin] models/discover secret resolve failed: ${detail}`);
                  return null;
                }
```

- [ ] **Step 3: Fix the catalog-commands models/test catch**

In `packages/agent-host/src/commands/catalog-commands.ts`, replace lines 347-353:

```typescript
                try {
                  if (provider.apiKeyRef?.trim() || provider.apiKeyEnv?.trim()) {
                    return await secretResolver.resolveProviderSecret(provider);
                  }
                } catch {
                  return null;
                }
```

with:

```typescript
                try {
                  if (provider.apiKeyRef?.trim() || provider.apiKeyEnv?.trim()) {
                    return await secretResolver.resolveProviderSecret(provider);
                  }
                } catch (error) {
                  const detail = error instanceof Error ? error.message : String(error);
                  console.warn(`[piwin] models/test secret resolve failed: ${detail}`);
                  return null;
                }
```

- [ ] **Step 4: Run typecheck and tests to verify no regressions**

Run: `pnpm --filter @piwin/agent-host typecheck && pnpm --filter @piwin/agent-host test`
Expected: PASS — typecheck green, all 205 tests still pass (no behavior change, only added logging).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-host/src/sdk-adapter.ts packages/agent-host/src/commands/catalog-commands.ts
git commit -m "fix(host): log secret-resolve and trusted-roots failures

sdk-adapter trusted-roots catch and catalog-commands secret-resolve
catches swallowed errors. Users got 'no auth' or 'untrusted' with no
real cause. Add console.warn diagnostics matching the existing
sdk-adapter convention."
```

---

### Task 4: Expand secret-file write permission patterns (B2)

**Files:**
- Modify: `packages/agent-host/src/permission-policy.ts:23-30`
- Test: `packages/agent-host/src/permission-policy.test.ts:1-37`

**Interfaces:**
- Consumes: `PermissionDecision` type from `@piwin/contracts`
- Produces: `evaluateBashPermission` (existing, enhanced ASK_PATTERNS)

**Why:** The `write-env` ASK pattern only matches `.env` files. Writes to `~/.ssh/authorized_keys`, `~/.ssh/id_rsa`, `~/.aws/credentials`, `~/.piwin/config.json`, `~/.gitconfig`, `~/.npmrc` are not gated. Add a `write-secret-file` pattern covering known secret-bearing dotfile paths.

- [ ] **Step 1: Write the failing tests**

In `packages/agent-host/src/permission-policy.test.ts`, add these two tests inside the `describe('evaluateBashPermission')` block, after the `asks for force push` test (after line 26):

```typescript
  it('asks for writes to secret-bearing dotfiles', () => {
    expect(evaluateBashPermission('echo key >> ~/.ssh/authorized_keys').decision).toBe('ask');
    expect(evaluateBashPermission('cp secret ~/.ssh/id_rsa').decision).toBe('ask');
    expect(evaluateBashPermission('tee ~/.aws/credentials').decision).toBe('ask');
    expect(evaluateBashPermission('echo "token=x" > ~/.npmrc').decision).toBe('ask');
    expect(evaluateBashPermission('cat secret > ~/.gitconfig').decision).toBe('ask');
    expect(evaluateBashPermission('mv bad ~/.piwin/config.json').decision).toBe('ask');
  });

  it('still allows writes to non-secret files', () => {
    expect(evaluateBashPermission('echo hi > ~/notes.txt').decision).toBe('allow');
    expect(evaluateBashPermission('tee ~/output.log').decision).toBe('allow');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @piwin/agent-host test -- src/permission-policy.test.ts`
Expected: FAIL — the 6 secret-file writes return `allow` (no matching pattern).

- [ ] **Step 3: Add the write-secret-file pattern**

In `packages/agent-host/src/permission-policy.ts`, add a new entry to the `ASK_PATTERNS` array. Insert after the `write-env` entry (line 28) and before `chmod-777` (line 29):

```typescript
  {
    name: 'write-secret-file',
    pattern:
      /(?:^|[;&|])\s*(?:tee|cp|mv|echo|cat)\b[^\n]*~\/\.(?:ssh\/(?:authorized_keys|id_rsa|id_ed25519|id_ecdsa)|aws\/credentials|aws\/config|piwin\/config\.json|gitconfig|npmrc|pypirc|netrc)\b/i,
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @piwin/agent-host test -- src/permission-policy.test.ts`
Expected: PASS — all tests green including the 6 new secret-file writes (now `ask`) and 2 non-secret writes (still `allow`).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-host/src/permission-policy.ts packages/agent-host/src/permission-policy.test.ts
git commit -m "fix(host): ask before writes to secret-bearing dotfiles

write-env only gated .env. Add write-secret-file ASK pattern covering
~/.ssh/authorized_keys, id_rsa/id_ed25519/id_ecdsa, ~/.aws/credentials,
~/.aws/config, ~/.piwin/config.json, ~/.gitconfig, ~/.npmrc, ~/.pypirc,
~/.netrc."
```

---

### Task 5: Add artifact XSS golden test cases (B3)

**Files:**
- Modify: `packages/artifact/src/security.test.ts:1-87`

**Interfaces:**
- Consumes: `classifyArtifactSecurity` (existing, from `./security.js`)
- Produces: New test cases documenting expected behavior for XSS vectors

**Why:** The security test suite covers external-resource blocking and size limits but has no tests for inline XSS vectors (`<img onerror>`, `javascript:` URLs, `<svg onload>`). These are mitigated by the sandbox iframe (no `allow-same-origin`) + CSP (`connect-src 'none'`), but the *classifier* behavior for these inputs should be documented as golden cases so any future change to the classifier is caught.

**Important context:** The classifier (`classifyArtifactSecurity`) only blocks *external resources* and *oversized/empty* content. Inline event handlers (`onerror`, `onload`) and `javascript:` URLs are **not** blocked by the classifier — they are allowed to render because the sandbox iframe is the mitigation. These tests document that contract: the classifier allows them (`canRender=true`) because the sandbox contains them. If someone later weakens the sandbox, these tests flag that the classifier was not catching inline scripts.

- [ ] **Step 1: Add the XSS golden tests**

In `packages/artifact/src/security.test.ts`, add a new describe block after the existing `describe('classifyArtifactSecurity')` block (after line 86, before the final EOF):

```typescript
describe('classifyArtifactSecurity — inline XSS vectors (sandbox-mitigated)', () => {
  // These inputs contain inline XSS vectors but NO external resources.
  // The classifier allows them (canRender=true) because the sandbox iframe
  // (no allow-same-origin) + CSP (connect-src 'none') is the mitigation.
  // These golden cases document that contract so a future classifier
  // change or sandbox weakening is caught.

  it('allows inline onerror handler (sandbox-mitigated)', () => {
    const result = classifyArtifactSecurity(
      '<img src="x" onerror="alert(1)">',
    );
    expect(result.canRender).toBe(true);
    expect(result.blockReason).toBe(null);
    expect(result.externalResources).toEqual([]);
  });

  it('allows svg onload handler (sandbox-mitigated)', () => {
    const result = classifyArtifactSecurity(
      '<svg onload="alert(1)"><circle r="10"/></svg>',
    );
    expect(result.canRender).toBe(true);
    expect(result.blockReason).toBe(null);
  });

  it('allows javascript: URL in href (sandbox-mitigated)', () => {
    const result = classifyArtifactSecurity(
      '<a href="javascript:alert(1)">click</a>',
    );
    expect(result.canRender).toBe(true);
    expect(result.blockReason).toBe(null);
  });

  it('allows nested iframe srcdoc (sandbox-mitigated, no external src)', () => {
    const result = classifyArtifactSecurity(
      '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    );
    expect(result.canRender).toBe(true);
    expect(result.blockReason).toBe(null);
  });

  it('allows javascript: URL in img src (not detected as external, sandbox-mitigated)', () => {
    // javascript: is not https?:// so not detected as external resource,
    // but this documents that the classifier does NOT catch it — sandbox does.
    const result = classifyArtifactSecurity(
      '<img src="javascript:alert(1)">',
    );
    expect(result.canRender).toBe(true);
    expect(result.blockReason).toBe(null);
  });
});
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `pnpm --filter @piwin/artifact test`
Expected: PASS — all existing + 5 new tests green. The classifier allows inline XSS vectors (sandbox is the mitigation); these tests document that contract.

- [ ] **Step 3: Commit**

```bash
git add packages/artifact/src/security.test.ts
git commit -m "test(artifact): add XSS golden cases for inline vectors

Document that the classifier allows inline onerror/onload/javascript:
URLs because the sandbox iframe (no allow-same-origin) + CSP
(connect-src 'none') is the mitigation. These golden cases catch any
future classifier change or sandbox weakening."
```

---

### Task 6: Repair root tsconfig references (A2)

**Files:**
- Modify: `tsconfig.json:1-20`

**Interfaces:**
- Consumes: existing package tsconfigs (each has its own `tsconfig.json`)
- Produces: complete `tsc -b` dependency graph

**Why:** `packages/automation`, `doc-rag`, `flashcards`, `notes` exist on disk and are consumed by `agent-host`/`cli`/`desktop` but are missing from root `tsconfig.json` references. `pnpm typecheck` still works (it runs `pnpm -r run typecheck`), but the `tsc -b` graph is incomplete. Add them in dependency order: `notes` before `doc-rag` (doc-rag imports from notes).

- [ ] **Step 1: Add the missing references**

In `tsconfig.json`, replace the entire `references` array with:

```json
{
  "files": [],
  "references": [
    { "path": "packages/contracts" },
    { "path": "packages/notes" },
    { "path": "packages/doc-rag" },
    { "path": "packages/flashcards" },
    { "path": "packages/automation" },
    { "path": "packages/agent-host" },
    { "path": "packages/session" },
    { "path": "packages/project" },
    { "path": "packages/skills" },
    { "path": "packages/mcp" },
    { "path": "packages/tools-web" },
    { "path": "packages/process" },
    { "path": "packages/git" },
    { "path": "packages/theme" },
    { "path": "packages/pet" },
    { "path": "packages/artifact" },
    { "path": "packages/media" },
    { "path": "packages/marketplace" },
    { "path": "packages/ui-kit" },
    { "path": "apps/cli" }
  ]
}
```

- [ ] **Step 2: Verify typecheck still passes**

Run: `pnpm typecheck`
Expected: PASS — all 19 packages + 2 apps typecheck green (no change to per-package typecheck, only the reference graph is now complete).

- [ ] **Step 3: Commit**

```bash
git add tsconfig.json
git commit -m "fix(build): add missing packages to root tsconfig references

automation, doc-rag, flashcards, notes were on disk and consumed by
agent-host/cli/desktop but missing from root tsconfig.json references.
pnpm typecheck covered them via -r, but the tsc -b graph was incomplete.
Added in dependency order (notes before doc-rag)."
```

---

### Task 7: Make apps/desktop tsconfig extend base (A1)

**Files:**
- Modify: `apps/desktop/tsconfig.json:1-20`

**Interfaces:**
- Consumes: `../../tsconfig.base.json`
- Produces: desktop tsconfig that inherits strict flags from base, only overriding what differs (bundler resolution, jsx, noEmit, DOM libs)

**Why:** `apps/desktop/tsconfig.json` is fully standalone — it manually re-declares `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. If `tsconfig.base.json` adds a rule (e.g. `noImplicitOverride`), desktop won't inherit it. Make it `extends` the base and only override the desktop-specific options.

- [ ] **Step 1: Rewrite desktop tsconfig to extend base**

Replace the entire contents of `apps/desktop/tsconfig.json` with:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": false,
    "noEmit": true,
    "jsx": "react-jsx",
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

**What this preserves from the old standalone config:**
- `target: ES2022` — now inherited from base
- `strict: true` — now inherited from base
- `noUncheckedIndexedAccess: true` — now inherited from base
- `exactOptionalPropertyTypes: true` — now inherited from base
- `skipLibCheck: true` — now inherited from base
- `resolveJsonModule: true` — now inherited from base
- `isolatedModules: true` — now inherited from base
- `forceConsistentCasingInFileNames: true` — now inherited from base
- `declaration`/`declarationMap`/`sourceMap` — base has these but `noEmit: true` overrides, so no emit happens (matches old behavior)

**What's overridden (desktop-specific):**
- `lib` adds DOM (base only has ES2022)
- `module: ESNext` + `moduleResolution: bundler` (Vite, not NodeNext)
- `jsx: react-jsx`
- `noEmit: true` (Vite handles builds)
- `noUnusedLocals`/`noUnusedParameters`/`noFallthroughCasesInSwitch` (desktop-only strictness)

- [ ] **Step 2: Verify desktop typecheck still passes**

Run: `pnpm --filter @piwin/desktop typecheck`
Expected: PASS — `tsc -b --pretty false` exits 0. If it fails on `declaration` conflicting with `noEmit`, add `"declaration": false` to the `compilerOptions` override block.

- [ ] **Step 3: Run desktop tests to verify no breakage**

Run: `pnpm --filter @piwin/desktop test`
Expected: PASS — all 269 desktop tests green.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/tsconfig.json
git commit -m "fix(desktop): extend tsconfig.base instead of standalone

Desktop tsconfig manually re-declared all strict flags. If base adds a
rule, desktop would silently drift. Now extends base, overriding only
desktop-specific options (bundler resolution, jsx, DOM libs, noEmit)."
```

---

### Task 8: RPC honesty in architecture.md (A3)

**Files:**
- Modify: `docs/architecture.md:58-60`

**Interfaces:**
- Consumes: ADR 0008, 0011, 0012 (referenced)
- Produces: accurate §3.1 reflecting the SDK-fallback reality

**Why:** PRD §1.4 and architecture §3.1 say "dual-mode from day one" and describe RPC as "process isolation". The reality (per `rpc-adapter.ts` and `todo-deferred` D-HOST-01b) is that RPC mode defaults to SDK fallback because stock `pi --mode rpc` cannot register custom tools. New contributors will be misled by the current wording.

- [ ] **Step 1: Update architecture.md §3.1**

In `docs/architecture.md`, replace line 60:

```text
v1: **both adapters exist** behind `AgentHost` / `SessionHandle`. Default runtime = SDK. RPC used by `piwin rpc` and optional "isolated session" setting.
```

with:

```text
v1: **both adapters exist** behind `AgentHost` / `SessionHandle`. Default runtime = SDK. RPC mode (`PiRpcAdapter`) defaults to **SDK session fallback** because stock `pi --mode rpc` cannot register piwin custom tools (web/MCP/bash gate) or extensions/prompts (ADR 0008 / D-EXT-07). True RPC process isolation is residual (D-HOST-01b, ADR 0012); the product path uses SDK fallback under `hostMode=rpc` (ADR 0011). Set `PIWIN_RPC_STOCK=1` to attempt the stock binary path (will fail the product tool path with an actionable error).
```

- [ ] **Step 2: Commit**

```bash
git add docs/architecture.md
git commit -m "docs(arch): clarify RPC mode uses SDK fallback in v1

§3.1 said 'dual-mode from day one' and described RPC as process
isolation. Reality: RPC defaults to SDK fallback because stock pi
--mode rpc cannot register custom tools. True isolation is residual
D-HOST-01b. Update wording to match ADR 0008/0011/0012."
```

---

### Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS — all 19 packages + 2 apps green.

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: PASS — all packages green. New tests: media symlink (1), host-runtime index-warn (1), permission-policy secret-files (2), artifact XSS (5). Total new: 9 tests.

- [ ] **Step 3: Run desktop e2e (browser shell)**

Run: `pnpm e2e:desktop`
Expected: PASS — browser shell e2e green (no behavior change to UI).

- [ ] **Step 4: Verify no silent catches remain in the 5 fixed sites**

Run: `grep -n "catch {" packages/agent-host/src/host-runtime.ts packages/agent-host/src/sdk-adapter.ts packages/agent-host/src/commands/catalog-commands.ts`
Expected: The 5 specific catch sites (host-runtime lines ~255, ~909, ~1420; sdk-adapter ~414; catalog-commands ~326, ~351) now show `catch (error)` instead of `catch {`. Other `catch {` sites with legitimate best-effort comments (shutdown races, abort errors) are acceptable and unchanged.

- [ ] **Step 5: Final commit if any formatting drift**

If prettier or lint changed anything during verification:

```bash
git add -A
git commit -m "chore: format after review fixes"
```

Otherwise no commit needed.
