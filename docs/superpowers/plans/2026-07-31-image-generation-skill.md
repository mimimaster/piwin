# Image Generation Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class, feature-gated, hidden-from-UI piwin **image generation skill** (`imagegen`) that replaces the deprecated imagegen-MCP approach. The skill guides the agent to a new host tool `image_gen`, which routes by **model name** to the correct configured provider/endpoint, saves the generated image through `@piwin/media` (path-based, no base64 in context), and returns an absolute path.

**Architecture:** Contracts-first. Add `hidden?: boolean` to `SkillSummary` so system skills (like `imagegen`) stay out of the Skills panel and CLI lists. New host tool `image-gen-tool.ts` in `@piwin/agent-host` (existing `HostToolDefinition` pattern from `tools-web`/`gated-file-tools`) is registered into Pi customTools **only when the `imagegen` skill is enabled** (i.e. not in `config.skills.disabledIds`). The tool resolves the target provider by model name against `config.providers`, routes by provider protocol (`openai-compatible` → `POST {baseUrl}/images/generations`; `google-gemini` → `POST {baseUrl}...:predict` for `imagen-*`; `anthropic-compatible` → clear unsupported error), decodes the returned base64, saves via `@piwin/media` `saveMediaAsset` to `~/.piwin/media/<session>/`, and returns the absolute path. The outbound call is permission-gated as a network action (rule engine `kind: network`). The bundled skill `skills/imagegen/SKILL.md` (frontmatter `hidden: true`, modeled on Codex's `imagegen` skill) teaches when/how to use `image_gen`.

**Tech Stack:** TypeScript (strict, NodeNext, ESM), vitest, pnpm workspace, `typebox` (already in `@piwin/agent-host`), Pi 0.80.10 `@earendil-works/pi-coding-agent`.

**ADR:** `docs/adr/0021-image-generation-skill.md`

## Global Constraints

- TypeScript strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) — never weaken without ADR.
- ESM only; relative imports use `.js` extensions (NodeNext).
- No `any`; prefer `unknown` + narrowing. No non-null assertion `!` except after runtime check in same block.
- No silent `catch {}` — AGENTS.md §3.3: log at boundary with context, or rethrow.
- Colocated tests: `foo.ts` + `foo.test.ts` in same `src/` dir.
- `pnpm typecheck` and `pnpm test` must stay green after every task.
- Keep diffs minimal — do not refactor unrelated code.
- **No base64 in model context** (AGENTS.md §3.6): generated images are saved to `~/.piwin/media/<session>/` and injected as **absolute paths** only. Never return base64/data-URLs from `image_gen`.
- **Secrets never logged** (AGENTS.md §3.6): resolve API keys via the existing `secret-resolver`; never include keys in tool output, error messages, or logs.
- Media writes go through `@piwin/media` `saveMediaAsset` (media-root + realpath validation, ADR 0019) — the tool must not hand-roll path writes.
- `exactOptionalPropertyTypes` is on: never assign `undefined` to optional fields — use conditional spread in builders.
- **No new MCP**: imagegen must not be exposed as or depend on an MCP server. The deprecated imagegen-MCP path is removed; no `mcp.json` entry is added.
- **Routing by model name only** — no new `imageGeneration` config section. The tool reuses `config.providers` + `config.defaultProviderId`/`defaultModelId`.
- The `image_gen` tool is registered **only when `imagegen` is not in `config.skills.disabledIds`**. Disabling the skill removes both the skill guidance and the tool.
- Hidden skills (frontmatter `hidden: true`) are excluded from the Desktop Skills panel and CLI skill lists, but **still loadable by Pi** when enabled.
- Image generation is a paid/network capability: the outbound HTTP call requires permission (`network:image-gen` → rule engine `kind: network`, default `ask`). The tool returns a clear "requires permission / configure model" error when gated or unconfigured.
- `@piwin/agent-host` already depends on `@earendil-works/pi-coding-agent` and `typebox`; the tool uses global `fetch` (Node ≥20) — **no new dependencies**.
- Intentional: image **editing** (`openai /images/edits`) is a documented follow-up and is **not** wired in this plan — the openai branch throws a clear not-yet-supported error if `editPath` is passed. Only prompt-based **generation** is shipped.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `packages/contracts/src/skills.ts` | add `hidden?: boolean` to `SkillSummary` | Modify (Task 1) |
| `packages/skills/src/skill-scanner.ts` | parse `hidden` from SKILL.md frontmatter into `SkillSummary.hidden` | Modify (Task 1) |
| `packages/skills/src/skill-scanner.test.ts` | golden cases: hidden true/false/absent | Modify (Task 1) |
| `apps/desktop/src/SkillsPanel.tsx` | filter `!skill.hidden` from the visible list | Modify (Task 2) |
| `apps/desktop/src/SkillsPanel.test.tsx` | hidden skill not rendered | Modify (Task 2) |
| `apps/cli/src` (skills list command) | filter hidden skills from `piwin skill list` output | Modify (Task 2) |
| `packages/agent-host/src/image-gen-tool.ts` | `image_gen` `HostToolDefinition`: provider-by-model router + HTTP call + media save | Create (Task 3) |
| `packages/agent-host/src/image-gen-tool.test.ts` | router + HTTP + media save unit tests (mock fetch) | Create (Task 3) |
| `packages/agent-host/src/pi-tool-adapter.ts` | add `image_gen` TypeBox parameter schema case | Modify (Task 4) |
| `packages/agent-host/src/sdk-adapter.ts` | build `image_gen` tool when skill enabled; include in `codingTools` | Modify (Task 4) |
| `skills/imagegen/SKILL.md` | bundled imagegen skill (frontmatter `hidden: true`) | Create (Task 5) |
| `docs/architecture.md` | add `image_gen` tool + `imagegen` skill to package map / capability notes | Modify (Task 6) |
| `docs/adr/0021-image-generation-skill.md` | ADR: deprecate imagegen-MCP; skill + host tool + disabledIds switch + hidden UI | Create (Task 6) |
| `docs/superpowers/plans/2026-07-31-image-generation-skill.md` | this plan | Create (Task 6) |

---

## Task 1: `hidden` flag on skills (contracts + scanner)

**Why:** The `imagegen` skill must not appear in the UI skills panel or CLI lists while remaining loadable by Pi. A `hidden` flag on `SkillSummary`, read from SKILL.md frontmatter, is the cleanest mechanism and does not couple the panel to a hardcoded id set.

**Files:**
- Modify: `packages/contracts/src/skills.ts:5-12`
- Modify: `packages/skills/src/skill-scanner.ts:59-68`
- Modify: `packages/skills/src/skill-scanner.test.ts`

**Interfaces:**
- Consumes: `SkillSummary` (existing), frontmatter parser `parseFrontmatter` (existing, returns `Record<string, string>`).
- Produces: `SkillSummary.hidden?: boolean`. `scanSkills()` now returns summaries where `hidden` is `true` for skills whose SKILL.md frontmatter contains `hidden: true` (case-insensitive), and `undefined` otherwise. Later tasks read `skill.hidden` to filter UI/CLI lists.

- [ ] **Step 1: Write the failing compile-time gate**

The `hidden` field is optional, so a vitest runtime test cannot observe its absence (esbuild transpiles without typechecking). Instead, gate on the **type**: add a small compile-time assertion in `packages/contracts/src/skills.test.ts` (new file) that reads `.hidden` through the public `SkillSummary` type. Before the field exists, `pnpm typecheck` fails; after adding the field, it passes.

Create `packages/contracts/src/skills.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SkillSummary } from './skills.js';

describe('SkillSummary', () => {
  it('exposes an optional hidden flag', () => {
    const visible: SkillSummary = {
      id: 'hatch-theme',
      name: 'hatch-theme',
      description: 'x',
      source: 'bundled',
      path: '/x/SKILL.md',
      enabled: true,
    };
    const hidden: SkillSummary = {
      ...visible,
      hidden: true,
    };
    // Runtime is trivial; the real signal is that `.hidden` typechecks on the
    // public type. The scanner test (Step 4) covers actual parse behavior.
    expect(visible.hidden).toBeUndefined();
    expect(hidden.hidden).toBe(true);
  });
});
```

Run to verify it fails: `pnpm typecheck`
Expected: FAIL — `Property 'hidden' does not exist on type 'SkillSummary'` in `packages/contracts/src/skills.test.ts` (the `.hidden` accesses at lines 92-93).

> Note: `pnpm --filter @piwin/contracts test skills` alone will PASS here (vitest does not typecheck); the failing gate is `pnpm typecheck`. Treat Step 1's "failing test" as the typecheck failure, per AGENTS.md §3.7 (contracts type change → typecheck green).

- [ ] **Step 2: Add the field**

Edit `packages/contracts/src/skills.ts:5-12`:

```ts
export type SkillSummary = {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  path: string;
  enabled: boolean;
  /** System skills (e.g. imagegen) are excluded from UI/CLI skill lists. */
  hidden?: boolean;
};
```

- [ ] **Step 3: Run the gate + tests**

Run: `pnpm typecheck`
Expected: PASS (the `.hidden` accesses in `skills.test.ts` now typecheck).

Run: `pnpm --filter @piwin/contracts test skills`
Expected: PASS.

- [ ] **Step 4: Write the failing scanner test**

Add to `packages/skills/src/skill-scanner.test.ts` (create the file if it does not exist). It writes temp skill dirs with and without `hidden` frontmatter and asserts the scanned summaries:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanSkills } from './skill-scanner.js';

let root = '';
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'piwin-skills-test-'));
});
afterEach(async () => {
  await import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true }));
});

describe('scanSkills hidden flag', () => {
  it('marks a skill hidden when frontmatter has hidden: true', async () => {
    const dir = join(root, 'skills', 'imagegen');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'SKILL.md'),
      '---\nname: imagegen\ndescription: Generate images\nhidden: true\n---\n# Imagegen\n',
      'utf8',
    );
    const skills = await scanSkills({ piwinRoot: root });
    const imagegen = skills.find((s) => s.id === 'imagegen');
    expect(imagegen?.hidden).toBe(true);
  });

  it('leaves hidden undefined when frontmatter omits hidden', async () => {
    const dir = join(root, 'skills', 'hatch-theme');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'SKILL.md'),
      '---\nname: hatch-theme\ndescription: Hatch a theme\n---\n# Hatch Theme\n',
      'utf8',
    );
    const skills = await scanSkills({ piwinRoot: root });
    const theme = skills.find((s) => s.id === 'hatch-theme');
    expect(theme?.hidden).toBeUndefined();
  });
});
```

Run to verify it fails: `pnpm --filter @piwin/skills test skill-scanner`
Expected: FAIL — `hidden` is not parsed (assertions fail).

- [ ] **Step 5: Implement frontmatter `hidden` parsing**

Edit `packages/skills/src/skill-scanner.ts:59-68` — inside `parseSkillMarkdown`, read `hidden` after parsing frontmatter and include it in the returned summary. The frontmatter values are already trimmed strings; treat any case-insensitive `true`/`1` as hidden:

```ts
async function parseSkillMarkdown(filePath: string, source: SkillSource, directoryPath?: string): Promise<SkillSummary | null> {
  let raw: string;
  try { raw = await readFile(filePath, 'utf8'); } catch { return null; }
  const fm = parseFrontmatter(raw);
  const name = (fm.name ?? basename(directoryPath ?? filePath).replace(/\.md$/i, '')).trim();
  if (!name) return null;
  const description = (fm.description ?? '').trim() || '(no description)';
  const id = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const hiddenRaw = (fm.hidden ?? '').trim().toLowerCase();
  const hidden = hiddenRaw === 'true' || hiddenRaw === '1';
  return {
    id,
    name,
    description,
    source,
    path: directoryPath ?? filePath,
    enabled: true,
    ...(hidden ? { hidden: true } : {}),
  };
}
```

Note: `parseFrontmatter` returns `Record<string, string>`; `fm.hidden` is `string | undefined` under `noUncheckedIndexedAccess`, so `(fm.hidden ?? '')` is required.

- [ ] **Step 6: Run the scanner test**

Run: `pnpm --filter @piwin/skills test skill-scanner`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS (no new errors from the optional field).

```bash
git add packages/contracts/src/skills.ts packages/contracts/src/skills.test.ts packages/skills/src/skill-scanner.ts packages/skills/src/skill-scanner.test.ts
git commit -m "feat(contracts,skills): add hidden flag to SkillSummary for system skills"
```

---

## Task 2: Hide `hidden` skills from Desktop Skills panel and CLI

**Why:** The `imagegen` skill must not be listed/toggled in the Skills UI (user requirement: "不在界面配置显示"). The switch is `config.skills.disabledIds`, not the panel toggle, so the panel must not show it at all.

**Files:**
- Modify: `apps/desktop/src/SkillsPanel.tsx:107-116` (`visible` memo)
- Modify: `apps/desktop/src/SkillsPanel.test.tsx`
- Modify: `apps/cli/src` skills list command

**Interfaces:**
- Consumes: `SkillSummary.hidden` (Task 1).
- Produces: Desktop Skills panel and CLI `piwin skill list` exclude any skill with `hidden: true`. No contract/IPC change needed — filtering happens at the presentation layer.

- [ ] **Step 1: Write the failing desktop test**

Create `apps/desktop/src/SkillsPanel.test.tsx` (new file — none exists). Follow the repo's established happy-dom + `react-dom/client` + `createRoot` pattern (see `apps/desktop/src/right-panel.test.tsx`); `@testing-library/react` is **not** a dependency — do not use it. `SkillsPanel` needs `DesktopLocaleProvider` (locale + onLocaleChange) and the `request` prop. The render surfaces skills under `<ul data-testid="skills-list">` with a toggle per skill at `data-testid="skill-toggle-<id>"` (SkillsPanel.tsx:289-306):

```tsx
// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SkillsPanel } from './SkillsPanel.js';
import { DesktopLocaleProvider } from './desktop-locale-context.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function skillsRequestStub() {
  const fn = async (command: { type: string; projectPath?: string }) => {
    if (command.type === 'skills/list') {
      return {
        success: true,
        data: {
          skills: [
            {
              id: 'hatch-theme',
              name: 'hatch-theme',
              description: 'Hatch a theme',
              source: 'bundled',
              path: '/x/hatch-theme',
              enabled: true,
            },
            {
              id: 'imagegen',
              name: 'imagegen',
              description: 'Generate images',
              source: 'bundled',
              path: '/x/imagegen',
              enabled: true,
              hidden: true,
            },
          ],
        },
      };
    }
    if (command.type === 'config/get') {
      return { success: true, data: { config: { skills: { extraPaths: [], disabledIds: [] } } } };
    }
    return { success: true, data: {} };
  };
  return fn as (command: never) => Promise<{ success: boolean; data: unknown }>;
}

function renderPanel(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
        <SkillsPanel projectPath={null} request={skillsRequestStub()} variant="inline" />
      </DesktopLocaleProvider> as ReactElement,
    );
  });
  return { container, root };
}

describe('SkillsPanel hidden skills', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
      container.remove();
    }
    root = undefined;
    container = undefined;
  });

  it('does not render skills with hidden: true', async () => {
    ({ root, container } = renderPanel());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const list = container!.querySelector('[data-testid="skills-list"]');
    expect(list).not.toBeNull();
    expect(container!.querySelector('[data-testid="skill-toggle-hatch-theme"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="skill-toggle-imagegen"]')).toBeNull();
  });
});
```

Run to verify it fails: `pnpm --filter @piwin/desktop test SkillsPanel`
Expected: FAIL — `skill-toggle-imagegen` is present because `hidden` is not filtered yet.

> Note: `SkillsPanel`'s `request` prop type expects a specific command union; the stub's `as (command: never) => ...` cast keeps the test focused without widening the component's prop types. If `act` flushing needs the skills `useEffect` to resolve, keep the `setTimeout(0)` await inside `act` as shown (matches the async load pattern in `SkillsPanel.loadSkills`).

- [ ] **Step 2: Filter hidden skills in the panel**

Edit `apps/desktop/src/SkillsPanel.tsx:107-116` — the `visible` memo filters both the text filter and `hidden`:

```tsx
const visible = useMemo(() => {
  const unhidden = skills.filter((s) => s.hidden !== true);
  if (!filter) return unhidden;
  const lower = filter.toLowerCase();
  return unhidden.filter(
    (s) =>
      s.name.toLowerCase().includes(lower) ||
      s.id.toLowerCase().includes(lower) ||
      s.description?.toLowerCase().includes(lower),
  );
}, [skills, filter]);
```

- [ ] **Step 3: Run the desktop test**

Run: `pnpm --filter @piwin/desktop test SkillsPanel`
Expected: PASS.

- [ ] **Step 4: Filter hidden skills in the CLI**

Edit `apps/cli/src/index.ts:696-704` (the `skill list` subcommand). Filter out `hidden` summaries before printing:

```ts
const skills = await scanSkills(scanOptions);
const visible = skills.filter((s) => s.hidden !== true);
if (visible.length === 0) {
  console.log('(no skills found)');
  return;
}
for (const skill of visible) {
  const flag = skill.enabled ? 'on ' : 'off';
  console.log(`${flag}\t${skill.id}\t${skill.source}\t${skill.name}\t${skill.path}`);
}
```

The CLI has no dedicated unit test for `skill list` output (it shells to stdout); verify via the smoke step below (`piwin skill list` should omit a temp `hidden: true` skill).

- [ ] **Step 5: Typecheck + smoke + commit**

Run: `pnpm typecheck`
Expected: PASS.

Smoke: `pnpm --filter @piwin/desktop test SkillsPanel` → PASS; and confirm a temporary skill dir with `hidden: true` does not appear in `piwin skill list`.

```bash
git add apps/desktop/src/SkillsPanel.tsx apps/desktop/src/SkillsPanel.test.tsx apps/cli/src
git commit -m "feat(desktop,cli): hide hidden system skills from skill lists"
```

---

## Task 3: `image_gen` host tool (router + HTTP + media save)

**Why:** This is the core capability. The tool is a `HostToolDefinition` in `@piwin/agent-host` that: (a) resolves the target provider by **model name** against `config.providers`; (b) routes by provider protocol to the right endpoint; (c) permission-gates the outbound call; (d) saves the decoded image through `@piwin/media`; (e) returns an absolute path. No MCP, no new deps.

**Files:**
- Create: `packages/agent-host/src/image-gen-tool.ts`
- Create: `packages/agent-host/src/image-gen-tool.test.ts`

**Interfaces:**
- Consumes:
  - `config.providers: ModelProviderConfig[]`, `config.defaultProviderId`, `config.defaultModelId`
  - `SecretResolver.resolveProviderSecret(provider)` (`packages/agent-host/src/secret-resolver.ts`)
  - `@piwin/media` `saveMediaAsset` + `createMediaService`
  - `@piwin/tools-web` `HostToolDefinition`
  - `PermissionRuleSet` + `requestPermission?: ToolPermissionGate` (same shape as `gated-file-tools.ts`)
- Produces:
  - `buildImageGenTool(options: ImageGenToolOptions): HostToolDefinition | null`
    - returns `null` when the provider registry has no resolvable image model at build time (callers skip registration)
  - `resolveImageProvider(config, modelId?): { provider, model }` — throws `ImageGenConfigError` if no matching provider/model
  - `callImageEndpoint(provider, model, args, apiKey, signal): Promise<Uint8Array>` — routes per protocol
  - `formatImageGenError(error): string` — user-facing string, never includes API key
  - Returned tool `execute` returns `JSON.stringify({ paths: string[], size?: number, ...meta })` — paths only, never base64.

**Options type:**

```ts
export type ImageGenToolOptions = {
  piwinRoot: string;
  sessionId: string;
  config: PiwinConfig;
  mediaConfig: { mediaRoot: string; maxPasteBytes: number; allowedMimeTypes: string[] };
  secretResolver: SecretResolver;
  rules?: PermissionRuleSet;
  requestPermission?: (request: {
    action: string;
    detail: string;
    defaultDecision: 'allow' | 'deny' | 'ask';
    signal?: AbortSignal;
  }) => Promise<'allow' | 'deny' | 'ask'>;
};
```

- [ ] **Step 1: Write the failing router + HTTP tests**

Create `packages/agent-host/src/image-gen-tool.test.ts` with a stubbed `fetch`. Golden cases:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { PiwinConfig } from '@piwin/contracts';
import {
  resolveImageProvider,
  callImageEndpoint,
  buildImageGenTool,
} from './image-gen-tool.js';

const openAiProvider = {
  id: 'openai',
  protocol: 'openai-compatible' as const,
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyEnv: 'OPENAI_API_KEY',
  models: [{ id: 'gpt-image-1', label: 'gpt-image-1' }],
};

const geminiProvider = {
  id: 'gemini',
  protocol: 'google-gemini' as const,
  name: 'Gemini',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  apiKeyEnv: 'GEMINI_API_KEY',
  models: [{ id: 'imagen-4.0-generate-001', label: 'imagen-4.0' }],
};

const baseConfig = {
  hostMode: 'sdk' as const,
  providers: [openAiProvider, geminiProvider],
  defaultProviderId: 'openai',
  defaultModelId: 'gpt-image-1',
  media: { maxPasteBytes: 10 * 1024 * 1024, allowedMimeTypes: ['image/png', 'image/jpeg'] },
  artifact: { maxBytes: 100_000, htmlUiModeDefault: false },
};

function configWith(overrides: Partial<PiwinConfig>): PiwinConfig {
  return { ...baseConfig, ...overrides } as PiwinConfig;
}

describe('resolveImageProvider', () => {
  it('resolves by explicit model name across providers', () => {
    const { provider, model } = resolveImageProvider(configWith({}), 'imagen-4.0-generate-001');
    expect(provider.id).toBe('gemini');
    expect(model.id).toBe('imagen-4.0-generate-001');
  });

  it('falls back to default provider/model', () => {
    const { provider, model } = resolveImageProvider(configWith({}), undefined);
    expect(provider.id).toBe('openai');
    expect(model.id).toBe('gpt-image-1');
  });

  it('throws a config error for an unknown model name', () => {
    expect(() => resolveImageProvider(configWith({}), 'nope-9')).toThrow(/model/i);
  });
});

describe('callImageEndpoint', () => {
  it('routes openai-compatible to /images/generations and returns bytes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }),
    });
    const bytes = await callImageEndpoint(openAiProvider, openAiProvider.models[0]!, { prompt: 'a cat' }, 'sk-test', undefined, fetchMock as unknown as typeof fetch);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/images/generations',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(new TextDecoder().decode(bytes)).toBe('hello');
  });

  it('routes gemini imagen to :predict and reads bytesBase64Encoded', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ predictions: [{ bytesBase64Encoded: 'd29ybGQ=' }] }),
    });
    const bytes = await callImageEndpoint(geminiProvider, geminiProvider.models[0]!, { prompt: 'a dog' }, 'sk-gem', undefined, fetchMock as unknown as typeof fetch);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('models/imagen-4.0-generate-001:predict');
    expect(new TextDecoder().decode(bytes)).toBe('world');
  });

  it('rejects anthropic-compatible with a clear unsupported error', async () => {
    const anthropic = {
      id: 'anthropic',
      protocol: 'anthropic-compatible' as const,
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com',
      models: [{ id: 'claude-image-1' }],
    };
    await expect(
      callImageEndpoint(anthropic, anthropic.models[0]!, { prompt: 'x' }, 'key'),
    ).rejects.toThrow(/not support|unsupported/i);
  });
});

describe('buildImageGenTool', () => {
  it('returns null when no image model can be resolved at build time', () => {
    const tool = buildImageGenTool({
      piwinRoot: '/tmp/piwin',
      sessionId: 's1',
      config: configWith({ providers: [], defaultProviderId: undefined, defaultModelId: undefined }),
      mediaConfig: { mediaRoot: '/tmp/piwin/media', maxPasteBytes: 10_000_000, allowedMimeTypes: ['image/png'] },
      secretResolver: { resolveProviderSecret: async () => 'k' } as never,
    });
    expect(tool).toBeNull();
  });
});
```

Run to verify it fails: `pnpm --filter @piwin/agent-host test image-gen-tool`
Expected: FAIL — module does not exist / functions undefined.

- [ ] **Step 2: Implement the router**

Create `packages/agent-host/src/image-gen-tool.ts` with the provider-resolution logic. Pure, unit-testable:

```ts
import type { ModelProviderConfig, PiwinConfig } from '@piwin/contracts';
import type { HostToolDefinition } from '@piwin/tools-web';

export class ImageGenConfigError extends Error {
  readonly name = 'ImageGenConfigError';
}

export type ResolvedImageProvider = {
  provider: ModelProviderConfig;
  /** The selected model entry (subtype of ModelConfigEntry, always has `.id`). */
  model: ModelProviderConfig['models'][number];
};

/** Resolve the provider + model for image generation by model name (or default). */
export function resolveImageProvider(
  config: Pick<PiwinConfig, 'providers' | 'defaultProviderId' | 'defaultModelId'>,
  modelId?: string,
): ResolvedImageProvider {
  const requested = modelId?.trim();
  const providers = config.providers ?? [];
  if (requested) {
    for (const provider of providers) {
      const match = (provider.models ?? []).find((m) => m.id === requested);
      if (match) return { provider, model: match };
    }
    throw new ImageGenConfigError(
      `image_gen: no configured provider exposes image model "${requested}". Add it under Settings → Providers.`,
    );
  }
  const defaultProvider = providers.find((p) => p.id === config.defaultProviderId);
  const defaultModel = defaultProvider?.models?.find((m) => m.id === config.defaultModelId);
  if (!defaultProvider || !defaultModel) {
    throw new ImageGenConfigError(
      'image_gen: no default image model configured. Enable image generation and add an image-capable model under Settings → Providers.',
    );
  }
  return { provider: defaultProvider, model: defaultModel };
}
```

Note: `ModelConfigEntry` (from `@piwin/contracts`) has optional fields; the tests only read `.id`, and `callImageEndpoint` accepts `model: { id: string }`, so the resolved model type is structurally compatible. Under `noUncheckedIndexedAccess`, `defaultProvider?.models?.find(...)` may be `undefined` — the guard `if (!defaultProvider || !defaultModel)` handles it before the return.

- [ ] **Step 3: Implement the HTTP router**

Append to `packages/agent-host/src/image-gen-tool.ts`:

```ts
const OPENAI_IMAGE_PROTOCOLS = new Set(['openai-compatible']);
const GEMINI_PROTOCOLS = new Set(['google-gemini']);

/** Call the provider's image endpoint and return raw image bytes. */
export async function callImageEndpoint(
  provider: ModelProviderConfig,
  model: { id: string },
  args: { prompt: string; editPath?: string; size?: string; quality?: string; n?: number },
  apiKey: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const prompt = args.prompt.trim();
  if (!prompt) throw new ImageGenConfigError('image_gen: prompt is required');

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (OPENAI_IMAGE_PROTOCOLS.has(provider.protocol)) {
    // Image editing (/images/edits) requires multipart image upload and is not
    // wired in this plan — fail loudly rather than send a malformed JSON body.
    if (args.editPath) {
      throw new ImageGenConfigError(
        'image_gen: image editing is not yet supported. Use generation (prompt-only) instead.',
      );
    }
    headers.authorization = `Bearer ${apiKey}`;
    const endpoint = `${provider.baseUrl.replace(/\/+$/, '')}/images/generations`;
    const body: Record<string, unknown> = { model: model.id, prompt, n: args.n ?? 1 };
    if (args.size) body.size = args.size;
    if (args.quality) body.quality = args.quality;
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      throw new ImageGenConfigError(
        `image_gen: provider returned HTTP ${response.status} (${model.id})`,
      );
    }
    const json = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
    const item = json.data?.[0];
    const b64 = item?.b64_json;
    if (b64) return base64ToBytes(b64);
    const url = item?.url;
    if (url) {
      const imageResp = await fetchImpl(url, { signal });
      if (!imageResp.ok) throw new ImageGenConfigError(`image_gen: failed to download image from ${url}`);
      return new Uint8Array(await imageResp.arrayBuffer());
    }
    throw new ImageGenConfigError('image_gen: provider returned no image data');
  }

  if (GEMINI_PROTOCOLS.has(provider.protocol)) {
    const base = provider.baseUrl.replace(/\/+$/, '');
    const endpoint = `${base}/models/${model.id}:predict`;
    const body = {
      instances: [{ prompt }],
      parameters: {
        sampleCount: args.n ?? 1,
        ...(args.size ? { aspectRatio: args.size } : {}),
      },
    };
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { ...headers, 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      throw new ImageGenConfigError(
        `image_gen: provider returned HTTP ${response.status} (${model.id})`,
      );
    }
    const json = (await response.json()) as {
      predictions?: Array<{ bytesBase64Encoded?: string }>;
    };
    const b64 = json.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) throw new ImageGenConfigError('image_gen: provider returned no image data');
    return base64ToBytes(b64);
  }

  throw new ImageGenConfigError(
    `image_gen: protocol "${provider.protocol}" does not support image generation in piwin (supported: openai-compatible, google-gemini).`,
  );
}

export function base64ToBytes(base64Data: string): Uint8Array {
  const normalized = base64Data.replace(/\s/g, '');
  if (normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new ImageGenConfigError('image_gen: provider returned invalid base64');
  }
  return new Uint8Array(Buffer.from(normalized, 'base64'));
}
```

Note: `editPath` is accepted in the args type but image editing (openai `/images/edits`) is **not wired in this plan** — the openai branch throws a clear not-yet-supported `ImageGenConfigError` before any HTTP call, so there is no silent stub and no malformed multipart request. This matches the "Image editing is a documented follow-up" known limitation in the ADR and Global Constraints. `buildImageGenTool` (Step 4) does not expose `editPath` to the model at all — the tool's `parameters` schema only lists `prompt`/`model`/`size`/`quality`/`n`.

- [ ] **Step 4: Implement `buildImageGenTool` (permission + media save + path return)**

Append to `packages/agent-host/src/image-gen-tool.ts`:

```ts
import { createMediaService } from '@piwin/media';
import type { PermissionDecision, PermissionRuleSet } from '@piwin/contracts';
import type { SecretResolver } from './secret-resolver.js';
import { evaluateWebPermission, resolveNonInteractiveDecision } from './permission-policy.js';
import type { ToolPermissionGate } from './session-tools.js';

export type ImageGenToolOptions = {
  piwinRoot: string;
  sessionId: string;
  config: PiwinConfig;
  mediaConfig: { mediaRoot: string; maxPasteBytes: number; allowedMimeTypes: string[] };
  secretResolver: SecretResolver;
  rules?: PermissionRuleSet;
  requestPermission?: ToolPermissionGate;
};

/** Build the image_gen host tool, or null when no image model is configured. */
export function buildImageGenTool(options: ImageGenToolOptions): HostToolDefinition | null {
  const { config, sessionId, mediaConfig, secretResolver } = options;
  try {
    resolveImageProvider(config);
  } catch {
    return null;
  }

  return {
    name: 'image_gen',
    description:
      'Generate a raster image from a text prompt using a configured image model. ' +
      'Returns the absolute path(s) to saved images under the media store. ' +
      'Use for photos, illustrations, icons, textures, mockups, or transparent cutouts. ' +
      'Do not use for SVG/vector/code-native assets or HTML/CSS/canvas visuals.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed prompt describing the image to generate' },
        model: { type: 'string', description: 'Optional image model id (routed by name). Defaults to the configured default model.' },
        size: { type: 'string', description: 'Optional size (openai: e.g. 1024x1024; gemini: aspect ratio e.g. 1:1)' },
        quality: { type: 'string', description: 'Optional quality (openai only)' },
        n: { type: 'number', description: 'Optional number of images (default 1)' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    async execute(args, signal) {
      const prompt = String(args.prompt ?? '').trim();
      if (!prompt) return JSON.stringify({ error: 'prompt is required' }, null, 2);

      // Permission gate — mirrors wrapWebToolWithPermission (session-tools.ts)
      // for the network image call, but with a hard 'ask' default (image gen costs money).
      const target = prompt.slice(0, 160);
      const evaluation = evaluateWebPermission('image-gen' as never, target, options.rules);
      let decision: PermissionDecision = evaluation.decision;
      if (decision === 'ask') {
        if (options.requestPermission) {
          decision = await options.requestPermission({
            action: 'network:image-gen',
            detail: target,
            defaultDecision: 'ask',
            ...(signal ? { signal } : {}),
          });
        } else {
          decision = resolveNonInteractiveDecision(evaluation);
        }
      }
      if (decision !== 'allow') {
        return JSON.stringify({ error: `image_gen permission ${decision}: ${evaluation.reason}` }, null, 2);
      }

      const { provider, model } = resolveImageProvider(config, typeof args.model === 'string' ? args.model : undefined);
      const apiKey = await secretResolver.resolveProviderSecret(provider);
      const bytes = await callImageEndpoint(
        provider,
        model,
        {
          prompt,
          ...(typeof args.size === 'string' ? { size: args.size } : {}),
          ...(typeof args.quality === 'string' ? { quality: args.quality } : {}),
          ...(typeof args.n === 'number' && Number.isFinite(args.n) ? { n: Math.max(1, Math.floor(args.n)) } : {}),
        },
        apiKey,
        signal,
      );

      const media = createMediaService({
        mediaRoot: mediaConfig.mediaRoot,
        maxPasteBytes: mediaConfig.maxPasteBytes,
        allowedMimeTypes: mediaConfig.allowedMimeTypes,
      });
      const asset = await media.saveMediaAsset({
        sessionId,
        bytes,
        mimeType: 'image/png',
        source: 'image_gen',
      });
      return JSON.stringify({ paths: [asset.absolutePath], mimeType: asset.mimeType, byteSize: asset.byteSize }, null, 2);
    },
  };
}
```

**Important implementation note:** `evaluateWebPermission` is typed for `WebPermissionAction = 'web_search' | 'web_fetch'`. The `as never` cast on `'image-gen'` above is only a compile-time shim for the plan. When implementing, extend `WebPermissionAction` in `permission-policy.ts` (or add a dedicated `evaluateImageGenPermission` that mirrors it) with an `image_gen` branch whose rule subject is `{ kind: 'web-fetch', host }` semantics — i.e. treat the provider base URL as the network host. The gate **must**:
- consult `options.rules` via `findMatchingRule({ kind: 'web-fetch', host: providerBaseUrlHost })` (import from `./permission-rule-engine.js` — exported at line ~318; reuse `evaluateWebPermission`'s host-extraction approach),
- default to `ask` (paid API call), degrade to `deny` in non-interactive sessions via `resolveNonInteractiveDecision` (exported from `./permission-policy.js`),
- never leak the API key in the deny/error string (use `evaluation.reason` / a fixed message).

Add a golden unit test to `image-gen-tool.test.ts`: with `requestPermission` returning `'deny'`, `execute` returns a string containing `permission denied` and does **not** call the provider endpoint; with `'allow'`, it proceeds to media save.

- [ ] **Step 5: Run the unit tests**

Run: `pnpm --filter @piwin/agent-host test image-gen-tool`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. If `ResolvedImageProvider` / `evaluateImageNetworkPermission` types fight strictness, tighten them per the real `ModelProviderConfig['models'][number]` shape and the existing `web_fetch` gate signatures in `session-tools.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-host/src/image-gen-tool.ts packages/agent-host/src/image-gen-tool.test.ts
git commit -m "feat(agent-host): add image_gen host tool with model-name routing and media save"
```

---

## Task 4: Wire `image_gen` into Pi sessions (TypeBox schema + registration gated on skill enablement)

**Why:** The tool must reach the Pi agent as a custom tool, and only when the `imagegen` skill is enabled (switch = `config.skills.disabledIds`).

**Files:**
- Modify: `packages/agent-host/src/pi-tool-adapter.ts` (`parametersForHostTool`)
- Modify: `packages/agent-host/src/sdk-adapter.ts` (build + register in `codingTools`)

**Interfaces:**
- Consumes: `buildImageGenTool` (Task 3), `config.skills.disabledIds`, `config.providers`, existing `secretResolver` instance in `createPiSdkSession`, existing media config, `rootDir`, `sessionId`.
- Produces: Pi customTool `image_gen` registered only when `imagegen` is enabled. No behavior change when disabled.

- [ ] **Step 1: Add the TypeBox schema**

Edit `packages/agent-host/src/pi-tool-adapter.ts:171-176` (before the generic fallback). Add an `image_gen` case:

```ts
if (tool.name === 'image_gen') {
  return Type.Object({
    prompt: Type.String({ description: 'Detailed prompt describing the image to generate' }),
    model: Type.Optional(Type.String({ description: 'Optional image model id (routed by name)' })),
    size: Type.Optional(Type.String({ description: 'Optional size / aspect ratio' })),
    quality: Type.Optional(Type.String({ description: 'Optional quality (openai only)' })),
    n: Type.Optional(Type.Number({ description: 'Optional number of images (default 1)' })),
  });
}
```

- [ ] **Step 2: Build + register the tool in `createPiSdkSession`**

Edit `packages/agent-host/src/sdk-adapter.ts`. Inside `createPiSdkSession`, **before** the `codingTools`/`customTools` build section (lines ~661-677), build the image_gen tool gated on skill enablement. `secretResolver` is not in scope at that point (it is created locally inside `createPiModelRuntime` at line ~871, called later at line ~780) — so create a local one with the already-imported `createSecretResolver()` (it is a cheap stateless closure):

```ts
// image_gen tool: only when the imagegen skill is enabled (switch = disabledIds).
const imagegenDisabled = config.skills?.disabledIds?.includes('imagegen') ?? false;
const imageGenTool = imagegenDisabled
  ? null
  : buildImageGenTool({
      piwinRoot: rootDir,
      sessionId,
      config,
      mediaConfig: {
        mediaRoot: getPiwinMediaDir(rootDir),
        maxPasteBytes: config.media.maxPasteBytes,
        allowedMimeTypes: config.media.allowedMimeTypes,
      },
      secretResolver: createSecretResolver(),
      ...(mergedRules ? { rules: mergedRules } : {}),
      ...(permissionHandler
        ? {
            requestPermission: wrapPermissionHandler(permissionHandler, sessionId, permissionProjectPath),
          }
        : {}),
    });
```

Add `...(imageGenTool ? [imageGenTool] : [])` into the `codingTools` array (line ~661):

```ts
const codingTools: import('@piwin/tools-web').HostToolDefinition[] = [
  ...webTools,
  ...mcpBridge.tools,
  planTool,
  planCreateTool,
  ...processTools,
  ...notesTools,
  ...(flashcardsInCoding ? flashcardTools : []),
  ...(subagentRunTool ? [subagentRunTool] : []),
  ...(imageGenTool ? [imageGenTool] : []),
];
```

Verified locals in `createPiSdkSession`: `rootDir` (line ~439), `sessionId` (~438), `mergedRules` (~487), `permissionHandler`/`requestPermission` (~442), `permissionProjectPath` (~428), `config` (~424) are all in scope. Import `getPiwinMediaDir` from `./paths.js` and confirm `createSecretResolver` is already imported (it is, at line ~49). Do **not** try to reuse the `secretResolver` from `createPiModelRuntime` — it is out of scope here.

- [ ] **Step 3: Add a registration test**

Extend `packages/agent-host/src/sdk-adapter.test.ts` (or a focused test) to assert:
- With `disabledIds: ['imagegen']`, the built custom tool list does **not** include `image_gen`.
- Without it, `image_gen` **is** included (when a provider/model is configured).

Use the existing mock-session + fake Pi module harness in `sdk-adapter.test.ts`. If the harness makes this heavy, add the assertion at the `createPiSdkSession` level with a stubbed `@earendil-works/pi-coding-agent` `createAgentSession` that records `customTools` names.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @piwin/agent-host test`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-host/src/pi-tool-adapter.ts packages/agent-host/src/sdk-adapter.ts packages/agent-host/src/sdk-adapter.test.ts
git commit -m "feat(agent-host): register image_gen tool gated on imagegen skill enablement"
```

---

## Task 5: Bundled `imagegen` skill

**Why:** The first-class surface the agent sees. Modeled on Codex's `imagegen` skill: frontmatter `hidden: true` (Task 1), guidance on when/how to use `image_gen`, routing notes, and clear "configure a model" fallback messaging. Bundled via the existing `ensureBundledSkillsInstalled` copy (`skills/` → `~/.piwin/skills/`).

**Files:**
- Create: `skills/imagegen/SKILL.md`

**Interfaces:**
- Consumes: `image_gen` host tool (Task 3), `hidden` frontmatter (Task 1).
- Produces: a Pi-loadable skill with `name: imagegen`. `scanSkills` returns it with `hidden: true`; the UI/CLI hide it (Task 2); Pi loads it when not in `disabledIds` (existing `disabledSkillIds` mechanism).

- [ ] **Step 1: Write the skill**

Create `skills/imagegen/SKILL.md`:

```markdown
---
name: imagegen
description: Generate or edit raster images when the task benefits from AI-created bitmap visuals such as photos, illustrations, textures, sprites, mockups, or transparent-background cutouts. Use when the agent should create a brand-new image or derive visual variants from references, and the output should be a bitmap asset rather than repo-native code or vector. Do not use when the task is better handled by editing existing SVG/vector/code-native assets, extending an established icon or logo system, or building the visual directly in HTML/CSS/canvas.
hidden: true
---

# Image Generation Skill

Generate raster images for the current project (website assets, game assets, UI
mockups, product shots, wireframes, logo drafts, photorealistic images,
infographics, or transparent-background cutouts).

## When to use

Use the `image_gen` tool when a deliverable benefits from AI-created bitmap
visuals. Examples:

- A hero image or cover for a web page
- Game sprites or textures
- UI mockups and product mockups
- Icon drafts (then refine to a final SVG/icon system if the project needs it)
- Concept art for a feature

Do **not** use it for:

- Editing existing SVG / vector / code-native assets
- Extending an established icon or logo system
- Visuals that are better expressed in HTML/CSS/canvas or inline SVG

## How to use `image_gen`

Call the host tool `image_gen` with a detailed `prompt`. The tool:

1. Routes by `model` name (optional) to the configured provider; without it,
   uses the configured default model. Only models added under Settings →
   Providers are usable.
2. Saves the generated image under the piwin media store and returns an
   **absolute path** — never a base64 blob.
3. Returns `{ "paths": [ ... ], "mimeType", "byteSize" }`.

### Prompting guidance

- Be specific about subject, style, composition, and palette.
- State dimensions or aspect ratio when it matters (e.g. `1024x1024`, `1:1`).
- For transparent-background cutouts, ask the model to render the subject on a
  flat solid chroma-key background and note that true native transparency is
  not guaranteed — validate the alpha channel after generation.

## When the tool is unavailable

If `image_gen` is missing or errors with "no default image model configured":

- Tell the user: image generation is enabled but no image-capable model is
  configured. They should add an image model under Settings → Providers
  (e.g. an OpenAI-compatible provider with a `gpt-image-*` model, or Google
  Gemini with an `imagen-*` model).
- Do not fall back to ad-hoc curl scripts or base64-in-context workarounds.

## Known limitations

- Image editing (reference-image workflows) is a documented follow-up and is
  not yet available; `image_gen` currently supports prompt-based generation
  only.
- Anthropic-compatible providers do not expose an image-generation endpoint.
```

- [ ] **Step 2: Verify scan + load**

Run: `pnpm typecheck` (contracts/skills tests already cover `hidden`).
Then add a scanner test in `packages/skills/src/skill-scanner.test.ts` pointing `scanSkills` at a `piwinRoot` whose `skills/imagegen/SKILL.md` is the file above, asserting `hidden === true` and `id === 'imagegen'`.

Run: `pnpm --filter @piwin/skills test skill-scanner`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add skills/imagegen/SKILL.md packages/skills/src/skill-scanner.test.ts
git commit -m "feat(skills): bundle hidden imagegen skill guiding image_gen usage"
```

---

## Task 6: Docs — ADR, architecture, plan

**Why:** AGENTS.md requires ADR updates for new cross-cutting capabilities (host tool + config semantics) and architecture.md package-map updates.

**Files:**
- Create: `docs/adr/0021-image-generation-skill.md`
- Modify: `docs/architecture.md`
- Create: `docs/superpowers/plans/2026-07-31-image-generation-skill.md` (this plan)

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: ADR recording the decision (deprecate imagegen-MCP; skill + host tool; disabledIds switch; hidden-from-UI), architecture.md updated capability/package notes, and the saved plan.

- [ ] **Step 1: Write the ADR**

Create `docs/adr/0021-image-generation-skill.md`:

```markdown
# ADR 0021: Image generation as a skill (deprecates imagegen-MCP)

## Status

Accepted (2026-07-31)

## Context

The earlier imagegen-MCP approach (an MCP server exposing image generation) had
a poor design fit: it split configuration between an MCP server and piwin's
provider model, could not reuse piwin's permission/media/path-injection
discipline, and duplicated the `imagegen` skill already shipped by Codex/Claude
as a skill. We want image generation as a first-class piwin skill: feature-gated,
reusing `config.providers` (routed by model name), hidden from the UI skill list,
and saving outputs through `@piwin/media`.

## Decision

1. **Deprecate imagegen-MCP.** No `mcp.json` entry, no MCP server dependency.
   The capability is delivered as a bundled skill + host tool.
2. **Bundled skill** `skills/imagegen/SKILL.md` with frontmatter `hidden: true`.
   It guides when/how to use the `image_gen` host tool.
3. **Host tool** `image_gen` in `@piwin/agent-host`:
   - Routes by **model name** against `config.providers` (no new config section);
     falls back to `defaultProviderId`/`defaultModelId`.
   - Protocol routing: `openai-compatible` → `POST {baseUrl}/images/generations`;
     `google-gemini` (imagen) → `{baseUrl}/models/{model}:predict`;
     `anthropic-compatible` → unsupported error.
   - Permission-gated as a network action (`network:image-gen`), default `ask`.
   - Saves decoded bytes via `@piwin/media` to `~/.piwin/media/<session>/` and
     returns absolute path(s) only (AGENTS.md §3.6: no base64 in context).
4. **Switch = `config.skills.disabledIds`.** Adding `imagegen` disables both the
   skill and the `image_gen` tool. No new `imageGeneration` config field.
5. **Hidden from UI/CLI.** `SkillSummary.hidden` (frontmatter `hidden: true`) is
   filtered from the Desktop Skills panel and CLI skill lists, but the skill is
   still loadable by Pi when enabled.

## Consequences

- System skills can opt out of the Skills panel via `hidden` frontmatter.
- Image generation requires a configured image-capable model (openai-compatible
  or google-gemini) in Settings → Providers.
- Anthropic-compatible providers cannot generate images (clear error).
- Image editing via `/images/edits` is a documented follow-up, not shipped here.
- CLI and Desktop share the same host tool and switch; no CLI degradation.
```

- [ ] **Step 2: Update `docs/architecture.md`**

Add `image_gen` to the host tools/capabilities list and the `imagegen` skill to
the skills/capability notes. Keep it a short addition (match existing section
style): mention the tool routes by model name, is gated on the `imagegen` skill
being enabled, and that the skill is hidden from the skills UI.

- [ ] **Step 3: Save this plan document (already in place)**

Ensure `docs/superpowers/plans/2026-07-31-image-generation-skill.md` is saved.

- [ ] **Step 4: Final verification**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test`
Expected: PASS.

Smoke (mock mode): `pnpm dev:cli --mock` and trigger a prompt that requests an
image; confirm the agent sees `image_gen` only when the skill is enabled, and
that a disabled `imagegen` (in `disabledIds`) hides the tool.

- [ ] **Step 5: Commit**

```bash
git add docs/adr/0021-image-generation-skill.md docs/architecture.md docs/superpowers/plans/2026-07-31-image-generation-skill.md
git commit -m "docs: ADR 0021 image generation skill, architecture notes, plan"
```

---

## Self-Review

**1. Spec coverage:**
- Deprecate imagegen-MCP: ADR 0021 (Task 6) records it; no MCP wiring added anywhere (Global Constraints).
- Skill-first surface: Task 5 bundles `skills/imagegen/SKILL.md`; frontmatter `hidden: true` (Task 1).
- Switch via `disabledIds`: Task 4 gates `image_gen` registration on `!disabledIds.includes('imagegen')`; existing Pi loader already filters the skill via `disabledSkillIds`.
- Hidden from UI: Task 2 filters `hidden` from Desktop panel + CLI.
- Route by model name, no new config: Task 3 `resolveImageProvider` uses `config.providers` + defaults; no `imageGeneration` section introduced.
- Model config requirement: `buildImageGenTool` returns `null` when no image model resolves; skill text + tool error tell the user to add a model under Providers (Task 3/5).

**2. Placeholder scan:**
- No "TBD" / "TODO" / "implement later" in shipped code. The only deferred item is openai `/images/edits` (explicitly documented as a known limitation with a clear throw in the plan's Step 3 note — not a silent stub).
- Every step has exact file paths, code, commands, and expected results.

**3. Type consistency:**
- `SkillSummary.hidden?: boolean` (Task 1) consumed as `s.hidden !== true` in panel/CLI (Task 2) and `hidden: true` in scanner (Task 1).
- `buildImageGenTool(options) → HostToolDefinition | null` (Task 3) consumed in `sdk-adapter.ts` as `imageGenTool ? [imageGenTool] : []` (Task 4).
- `resolveImageProvider(config, modelId?) → { provider, model }` (Task 3) consumed by `buildImageGenTool.execute` (Task 3) — model `.id` used consistently.
- `HostToolDefinition.execute` returns `Promise<string>` (tools-web) — `image_gen` returns `JSON.stringify(...)` strings, matching `toPiCustomTool` (Task 4).

**4. Acceptance criteria:**
- Contracts `hidden` test green; scanner parses `hidden`; panel/CLI hide hidden skills.
- `image_gen` routes by model name (openai + gemini golden cases), permission-gated, saves via `@piwin/media`, returns paths only.
- `image_gen` registered iff `imagegen` enabled; disabled → no tool.
- Bundled `imagegen` skill loads into Pi when enabled; `typecheck` + `pnpm test` green.
