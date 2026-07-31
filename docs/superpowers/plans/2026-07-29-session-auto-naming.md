# Session Auto-Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give piwin sessions a meaningful name automatically — a text-derived fallback name appears immediately on first user message, then an LLM-generated title (via the session's current model + provider API) replaces it after the first completed exchange, without ever overwriting a user-manual rename.

**Architecture:**
- `packages/contracts`: add `nameSource` field to `SessionIndexRecord` / `SessionSummary` (`'default' | 'auto' | 'user'`), add `session/name-updated` HostPush, add `session/auto-name` HostCommand.
- `packages/session`: add `deriveDefaultNameFromMessage` (pure text cleanup) + `setSessionAutoName` (writes name only when `nameSource !== 'user'`).
- `packages/agent-host`: add `lightweight-completion.ts` (direct provider chat-completion fetch, no Pi session), add `session-naming-service.ts` (orchestrates fallback + LLM, fires push), wire trigger on `run/terminal` outcome=completed when `messageCount` reaches first exchange and `nameSource !== 'user'`, record session ModelRef at prompt time.
- `apps/desktop`: subscribe to `session/name-updated` push → dispatch `session/update`; manual rename sets `nameSource: 'user'`.
- Config: `PiwinConfig.session.autoName: boolean` (default true) for opt-out.

**Tech Stack:** TypeScript strict ESM, pnpm workspaces, Vitest, fetch (Node 20+), existing `@piwin/contracts` / `@piwin/session` / `@piwin/agent-host`.

## Global Constraints

- TypeScript strict mode; no `any`; no non-null assertion without runtime check.
- ESM only; relative imports use `.js` extensions (NodeNext).
- Only `packages/agent-host` may import Pi / call provider APIs; `packages/session` stays pure (no fetch).
- `packages/contracts` is a leaf — no runtime deps on other `@piwin/*`.
- Colocated tests: `foo.ts` + `foo.test.ts`.
- Fire-and-forget auto-naming must never fail a turn; all errors → `host/log` warn.
- User manual rename (`nameSource: 'user'`) is never overwritten by auto-naming.
- Provider completion uses the session's current ModelRef; on failure, retry on next completed exchange (not same turn).

---

## File Structure

**Create:**
- `packages/session/src/derive-default-name.ts` — pure text → fallback name.
- `packages/agent-host/src/lightweight-completion.ts` — direct provider chat-completion fetch.
- `packages/agent-host/src/session-naming-service.ts` — orchestrator: fallback + LLM + push.
- `packages/agent-host/src/lightweight-completion.test.ts`
- `packages/session/src/derive-default-name.test.ts`
- `packages/agent-host/src/session-naming-service.test.ts`

**Modify:**
- `packages/contracts/src/session-index.ts` — add `nameSource` to `SessionIndexRecord`.
- `packages/contracts/src/host.ts` — add `nameSource` to `SessionSummary`.
- `packages/contracts/src/ipc.ts` — add `session/auto-name` command, `session/name-updated` push.
- `packages/contracts/src/config.ts` — add `SessionConfig.autoName`.
- `packages/session/src/session-index-store.ts` — `renameSessionRecord` sets `nameSource: 'user'`; add `setSessionAutoName`.
- `packages/session/src/index.ts` — export new functions.
- `packages/agent-host/src/commands/session-product-commands.ts` — handle `session/auto-name`, `session/rename` sets `nameSource: 'user'`.
- `packages/agent-host/src/host-runtime.ts` — record session ModelRef; trigger naming service on `run/terminal` completed.
- `packages/agent-host/src/commands/session-live-commands.ts` — store prompt ModelRef into runtime map.
- `apps/desktop/src/hooks/use-host-bootstrap.ts` — handle `session/name-updated` push.
- `apps/desktop/src/hooks/use-session-actions.ts` — manual rename leaves `nameSource` to host (host sets `'user'`).
- `apps/desktop/src/host-client-mock.ts` — mock `session/auto-name` + push.

---

### Task 1: Contracts — nameSource field + config + IPC

**Files:**
- Modify: `packages/contracts/src/session-index.ts:7-54`
- Modify: `packages/contracts/src/host.ts:146-179`
- Modify: `packages/contracts/src/config.ts` (add SessionConfig)
- Modify: `packages/contracts/src/ipc.ts:78-400` (HostCommand), `:413-452` (HostPush)
- Test: `packages/contracts/src/session-index.test.ts` (create if absent) or existing contracts test

**Interfaces:**
- Produces: `SessionIndexRecord.nameSource`, `SessionSummary.nameSource`, `SessionConfig`, `HostCommand` variant `session/auto-name`, `HostPush` variant `session/name-updated`.

- [ ] **Step 1: Add `nameSource` to `SessionIndexRecord`**

In `packages/contracts/src/session-index.ts`, add after the `name?: string;` field (line 19):

```ts
  /**
   * Origin of the session name. Controls auto-naming overwrite policy:
   * - `default`: placeholder `session-<id>`; eligible for auto-naming.
   * - `auto`: host-derived (text fallback or LLM); eligible for re-naming.
   * - `user`: set via manual rename; never overwritten by auto-naming.
   * Defaults to `default` when absent (legacy records).
   */
  nameSource?: 'default' | 'auto' | 'user';
```

- [ ] **Step 2: Add `nameSource` to `SessionSummary`**

In `packages/contracts/src/host.ts`, after `name?: string;` (line 158):

```ts
  /** @see SessionIndexRecord.nameSource */
  nameSource?: 'default' | 'auto' | 'user';
```

- [ ] **Step 3: Add `SessionConfig` to config**

In `packages/contracts/src/config.ts`, add a new type and include it in `PiwinConfig`:

```ts
/** Product session behavior config under `PiwinConfig.session`. */
export type SessionConfig = {
  /** When true (default), host auto-names sessions after first exchange. */
  autoName?: boolean;
};

export function createDefaultSessionConfig(): SessionConfig {
  return { autoName: true };
}
```

Then add `session?: SessionConfig;` to the `PiwinConfig` type (find the existing type and add the field alongside `compaction`, `notes`, etc.). Import `SessionConfig` if needed.

- [ ] **Step 4: Add `session/auto-name` HostCommand**

In `packages/contracts/src/ipc.ts`, in the `HostCommand` union, add after the `session/rename` variant (find it near line 350–360):

```ts
  | {
      id?: string;
      type: 'session/auto-name';
      sessionId: string;
      /** First user message text for title generation. */
      firstMessage: string;
      /** Optional assistant reply text for richer context. */
      assistantReply?: string;
    }
```

- [ ] **Step 5: Add `session/name-updated` HostPush**

In `packages/contracts/src/ipc.ts`, in the `HostPush` union (after line 414 area), add:

```ts
  | {
      type: 'session/name-updated';
      sessionId: string;
      name: string;
      nameSource: 'auto' | 'user';
    }
```

- [ ] **Step 6: Export new types from contracts index**

Check `packages/contracts/src/index.ts` re-exports. `SessionConfig` and `createDefaultSessionConfig` should be exported. Run `grep -n "config" packages/contracts/src/index.ts` to confirm the pattern, then add `SessionConfig` to the config re-export line.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @piwin/contracts typecheck`
Expected: PASS (no behavior changed yet, only additive types).

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src/session-index.ts packages/contracts/src/host.ts packages/contracts/src/config.ts packages/contracts/src/ipc.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add nameSource, SessionConfig, session/auto-name + name-updated IPC"
```

---

### Task 2: Session package — derive default name + auto-name writer

**Files:**
- Create: `packages/session/src/derive-default-name.ts`
- Create: `packages/session/src/derive-default-name.test.ts`
- Modify: `packages/session/src/session-index-store.ts:279-310` (rename sets user), add `setSessionAutoName`
- Modify: `packages/session/src/index.ts` (exports)
- Test: `packages/session/src/session-index-store.test.ts` (extend)

**Interfaces:**
- Consumes: `SessionIndexRecord.nameSource` from Task 1.
- Produces:
  - `deriveDefaultNameFromMessage(text: string): string` — pure, returns cleaned ≤60-char name or `''`.
  - `setSessionAutoName(filePath: string, sessionId: string, name: string): Promise<SessionIndexRecord | undefined>` — writes name + `nameSource: 'auto'` only when current `nameSource !== 'user'`.
  - `renameSessionRecord` now sets `nameSource: 'user'`.

- [ ] **Step 1: Write failing test for `deriveDefaultNameFromMessage`**

Create `packages/session/src/derive-default-name.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveDefaultNameFromMessage } from './derive-default-name.js';

describe('deriveDefaultNameFromMessage', () => {
  it('returns trimmed first line for a simple prompt', () => {
    expect(deriveDefaultNameFromMessage('Fix the login bug')).toBe('Fix the login bug');
  });

  it('strips markdown headers, bold, italic, code', () => {
    expect(deriveDefaultNameFromMessage('## **Fix** the _login_ `bug`')).toBe(
      'Fix the login bug',
    );
  });

  it('strips URLs and keeps surrounding text', () => {
    expect(
      deriveDefaultNameFromMessage('Check https://example.com/page for details'),
    ).toBe('Check for details');
  });

  it('collapses whitespace and trims', () => {
    expect(deriveDefaultNameFromMessage('  hello\n\n  world  ')).toBe('hello world');
  });

  it('truncates at 60 chars on word boundary with ellipsis', () => {
    const long = 'This is a very long prompt that exceeds the sixty character limit for sure';
    const result = deriveDefaultNameFromMessage(long);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result.endsWith('…')).toBe(true);
  });

  it('returns empty string for blank input', () => {
    expect(deriveDefaultNameFromMessage('   \n\n  ')).toBe('');
  });

  it('returns empty string for input that is only markdown/urls', () => {
    expect(deriveDefaultNameFromMessage('### `https://x.com`')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @piwin/session test derive-default-name`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `deriveDefaultNameFromMessage`**

Create `packages/session/src/derive-default-name.ts`:

```ts
/** Max length for a text-derived default session name. */
const MAX_DEFAULT_NAME_CHARS = 60;

/**
 * Derive a human-readable fallback session name from the first user message.
 * Pure: no FS, no network. Strips markdown, URLs, collapses whitespace,
 * truncates on a word boundary with an ellipsis. Returns '' when nothing
 * meaningful remains (caller keeps existing placeholder).
 */
export function deriveDefaultNameFromMessage(text: string): string {
  let cleaned = text;
  // Strip markdown headers, bold, italic, inline code, code fences.
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');
  cleaned = cleaned.replace(/\*\*(.+?)\*\*/g, '$1');
  cleaned = cleaned.replace(/__(.+?)__/g, '$1');
  cleaned = cleaned.replace(/\*(.+?)\*/g, '$1');
  cleaned = cleaned.replace(/_(.+?)_/g, '$1');
  cleaned = cleaned.replace(/`{1,3}[^`]*`{1,3}/g, '');
  // Strip URLs.
  cleaned = cleaned.replace(/https?:\/\/\S+/g, '');
  // Collapse whitespace.
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) {
    return '';
  }
  if (cleaned.length <= MAX_DEFAULT_NAME_CHARS) {
    return cleaned;
  }
  // Truncate at the last word boundary before the limit.
  const slice = cleaned.slice(0, MAX_DEFAULT_NAME_CHARS - 1);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > 20 ? lastSpace : slice.length;
  return `${cleaned.slice(0, cut).trimEnd()}…`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @piwin/session test derive-default-name`
Expected: PASS.

- [ ] **Step 5: Write failing test for `setSessionAutoName` overwrite policy**

Append to `packages/session/src/session-index-store.test.ts` (read the file first to match imports/style):

```ts
import { setSessionAutoName } from './session-index-store.js';

it('setSessionAutoName writes name + nameSource=auto when nameSource is default', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'piwin-auto-name-'));
  const indexPath = join(dir, 'sessions.json');
  await saveSessionIndex(indexPath, {
    version: 2,
    sessions: [
      {
        id: 's1',
        projectPath: '/p',
        scope: { kind: 'project', projectPath: '/p' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        messageCount: 0,
      },
    ],
  });
  const updated = await setSessionAutoName(indexPath, 's1', 'Fix login bug');
  expect(updated?.name).toBe('Fix login bug');
  expect(updated?.nameSource).toBe('auto');
});

it('setSessionAutoName overwrites an existing auto name', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'piwin-auto-name-overwrite-'));
  const indexPath = join(dir, 'sessions.json');
  await saveSessionIndex(indexPath, {
    version: 2,
    sessions: [
      {
        id: 's1',
        projectPath: '/p',
        scope: { kind: 'project', projectPath: '/p' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        messageCount: 2,
        name: 'old auto name',
        nameSource: 'auto',
      },
    ],
  });
  const updated = await setSessionAutoName(indexPath, 's1', 'New auto name');
  expect(updated?.name).toBe('New auto name');
  expect(updated?.nameSource).toBe('auto');
});

it('setSessionAutoName does NOT overwrite a user-set name', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'piwin-auto-name-user-'));
  const indexPath = join(dir, 'sessions.json');
  await saveSessionIndex(indexPath, {
    version: 2,
    sessions: [
      {
        id: 's1',
        projectPath: '/p',
        scope: { kind: 'project', projectPath: '/p' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        messageCount: 2,
        name: 'my custom name',
        nameSource: 'user',
      },
    ],
  });
  const updated = await setSessionAutoName(indexPath, 's1', 'auto attempt');
  expect(updated).toBeUndefined();
  // Verify the file was not changed.
  const doc = await loadSessionIndex(indexPath);
  expect(doc.sessions[0]?.name).toBe('my custom name');
  expect(doc.sessions[0]?.nameSource).toBe('user');
});
```

(Adjust the `mkdtemp`/`join`/`tmpdir` imports to match the existing test file's imports.)

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @piwin/session test session-index-store`
Expected: FAIL — `setSessionAutoName` not exported.

- [ ] **Step 7: Implement `setSessionAutoName` and update `renameSessionRecord`**

In `packages/session/src/session-index-store.ts`, modify `renameSessionRecord` (around line 292) to set `nameSource: 'user'`:

```ts
export async function renameSessionRecord(
  filePath: string,
  sessionId: string,
  name: string,
): Promise<SessionIndexRecord | undefined> {
  const normalized = normalizeSessionName(name);
  if (normalized.length === 0) {
    return undefined;
  }
  const document = await loadSessionIndex(filePath);
  const record = document.sessions.find((item) => item.id === sessionId);
  if (!record) {
    return undefined;
  }
  record.name = normalized;
  record.nameSource = 'user';
  // Rename is metadata-only; do not bump updatedAt so sort order stays stable.
  await saveSessionIndex(filePath, document);
  return record;
}
```

Then add `setSessionAutoName` after `renameSessionRecord`:

```ts
/**
 * Write an auto-derived name to a session record, but ONLY when the current
 * `nameSource` is not `'user'`. A user-manual rename is permanent and must
 * never be overwritten by auto-naming. Returns the updated record, or
 * `undefined` when the session is missing or the name was user-set.
 */
export async function setSessionAutoName(
  filePath: string,
  sessionId: string,
  name: string,
): Promise<SessionIndexRecord | undefined> {
  const normalized = normalizeSessionName(name);
  if (normalized.length === 0) {
    return undefined;
  }
  const document = await loadSessionIndex(filePath);
  const record = document.sessions.find((item) => item.id === sessionId);
  if (!record) {
    return undefined;
  }
  if (record.nameSource === 'user') {
    return undefined;
  }
  record.name = normalized;
  record.nameSource = 'auto';
  // Auto-name is metadata-only; do not bump updatedAt so sort order stays stable.
  await saveSessionIndex(filePath, document);
  return record;
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter @piwin/session test`
Expected: PASS (new + existing).

- [ ] **Step 9: Export from package index**

In `packages/session/src/index.ts`, add:

```ts
export { deriveDefaultNameFromMessage } from './derive-default-name.js';
export { setSessionAutoName } from './session-index-store.js';
```

- [ ] **Step 10: Typecheck + commit**

```bash
pnpm --filter @piwin/session typecheck
git add packages/session/src/derive-default-name.ts packages/session/src/derive-default-name.test.ts packages/session/src/session-index-store.ts packages/session/src/session-index-store.test.ts packages/session/src/index.ts
git commit -m "feat(session): add deriveDefaultNameFromMessage + setSessionAutoName with nameSource guard"
```

---

### Task 3: Agent-host — lightweight provider completion

**Files:**
- Create: `packages/agent-host/src/lightweight-completion.ts`
- Create: `packages/agent-host/src/lightweight-completion.test.ts`

**Interfaces:**
- Consumes: `ModelProviderConfig` + `ModelRef` from `@piwin/contracts`, `resolveProviderSecret` from `./secret-resolver.js`.
- Produces:
  - `generateTitleViaProvider(input: { provider: ModelProviderConfig; modelId: string; apiKey: string; systemPrompt: string; userPrompt: string; signal?: AbortSignal }): Promise<string | null>` — returns a cleaned title or `null` on any failure.

- [ ] **Step 1: Write failing test for `generateTitleViaProvider`**

Create `packages/agent-host/src/lightweight-completion.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateTitleViaProvider } from './lightweight-completion.js';
import type { OpenAiCompatibleProviderConfig } from '@piwin/contracts';

const openaiProvider: OpenAiCompatibleProviderConfig = {
  id: 'openai',
  protocol: 'openai-compatible',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyEnv: 'OPENAI_API_KEY',
  models: [{ id: 'gpt-4o-mini' }],
};

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(responseBody: unknown, ok = true): void {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => responseBody,
    text: async () => JSON.stringify(responseBody),
  } as unknown as Response);
  vi.stubGlobal('fetch', fetchMock);
}

describe('generateTitleViaProvider', () => {
  it('extracts title from openai-compatible response', async () => {
    mockFetch({
      choices: [{ message: { content: '{"title":"Fix login bug"}' } }],
    });
    const title = await generateTitleViaProvider({
      provider: openaiProvider,
      modelId: 'gpt-4o-mini',
      apiKey: 'sk-test',
      systemPrompt: 'Generate a title',
      userPrompt: 'Fix the login bug please',
    });
    expect(title).toBe('Fix login bug');
  });

  it('strips surrounding quotes from title', async () => {
    mockFetch({
      choices: [{ message: { content: '"Refactor auth module"' } }],
    });
    const title = await generateTitleViaProvider({
      provider: openaiProvider,
      modelId: 'gpt-4o-mini',
      apiKey: 'sk-test',
      systemPrompt: 'Generate a title',
      userPrompt: 'refactor auth',
    });
    expect(title).toBe('Refactor auth module');
  });

  it('returns null on HTTP error', async () => {
    mockFetch({ error: 'bad request' }, false);
    const title = await generateTitleViaProvider({
      provider: openaiProvider,
      modelId: 'gpt-4o-mini',
      apiKey: 'sk-test',
      systemPrompt: 'Generate a title',
      userPrompt: 'hello',
    });
    expect(title).toBeNull();
  });

  it('returns null on malformed response', async () => {
    mockFetch({ unexpected: true });
    const title = await generateTitleViaProvider({
      provider: openaiProvider,
      modelId: 'gpt-4o-mini',
      apiKey: 'sk-test',
      systemPrompt: 'Generate a title',
      userPrompt: 'hello',
    });
    expect(title).toBeNull();
  });

  it('returns null on network exception', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const title = await generateTitleViaProvider({
      provider: openaiProvider,
      modelId: 'gpt-4o-mini',
      apiKey: 'sk-test',
      systemPrompt: 'Generate a title',
      userPrompt: 'hello',
    });
    expect(title).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @piwin/agent-host test lightweight-completion`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `generateTitleViaProvider`**

Create `packages/agent-host/src/lightweight-completion.ts`:

```ts
import type { ModelProviderConfig } from '@piwin/contracts';

/** Max chars for an LLM-generated session title. */
const MAX_TITLE_CHARS = 80;

const TITLE_SYSTEM_PROMPT =
  'Generate a concise, descriptive title (3-7 words) for this coding session from the user message and optional assistant reply. Return ONLY the title text, no quotes, no markdown, no trailing punctuation.';

/**
 * One-shot provider completion for session title generation.
 * Calls the provider chat-completion endpoint directly (no Pi session).
 * Returns a cleaned title string, or null on any failure (caller falls back).
 *
 * Only openai-compatible + anthropic-compatible protocols are supported in v1;
 * google-gemini returns null (can be added later).
 */
export async function generateTitleViaProvider(input: {
  provider: ModelProviderConfig;
  modelId: string;
  apiKey: string;
  systemPrompt?: string;
  userPrompt: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const { provider, modelId, apiKey, userPrompt, signal } = input;
  const systemPrompt = input.systemPrompt ?? TITLE_SYSTEM_PROMPT;
  try {
    if (provider.protocol === 'openai-compatible') {
      return await fetchOpenAiCompatible(provider, modelId, apiKey, systemPrompt, userPrompt, signal);
    }
    if (provider.protocol === 'anthropic-compatible') {
      return await fetchAnthropicCompatible(provider, modelId, apiKey, systemPrompt, userPrompt, signal);
    }
    // google-gemini not yet supported for title generation.
    return null;
  } catch {
    return null;
  }
}

async function fetchOpenAiCompatible(
  provider: Extract<ModelProviderConfig, { protocol: 'openai-compatible' }>,
  modelId: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const url = `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...provider.headers,
  };
  const response = await fetch(url, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 50,
      temperature: 0.3,
    }),
  });
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content;
  return cleanTitle(raw);
}

async function fetchAnthropicCompatible(
  provider: Extract<ModelProviderConfig, { protocol: 'anthropic-compatible' }>,
  modelId: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const url = `${provider.baseUrl.replace(/\/$/, '')}/messages`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    ...provider.headers,
  };
  const response = await fetch(url, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model: modelId,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 50,
    }),
  });
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const raw = data.content?.find((block) => block.type === 'text')?.text;
  return cleanTitle(raw);
}

/** Strip quotes, markdown, trailing punctuation, collapse whitespace, truncate. */
function cleanTitle(raw: string | undefined): string | null {
  if (!raw || typeof raw !== 'string') {
    return null;
  }
  let title = raw.trim();
  // Strip JSON wrapper if the model returned {"title":"..."}.
  const jsonMatch = title.match(/\{[^}]*"title"\s*:\s*"([^"]+)"/);
  if (jsonMatch) {
    title = jsonMatch[1] ?? '';
  }
  title = title.replace(/^["'`]+|["'`]+$/g, '');
  title = title.replace(/^(#{1,6}\s+)?/, '');
  title = title.replace(/\*\*(.+?)\*\*/g, '$1');
  title = title.replace(/[.!?]+$/, '');
  title = title.replace(/\s+/g, ' ').trim();
  if (title.length === 0) {
    return null;
  }
  if (title.length > MAX_TITLE_CHARS) {
    title = `${title.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`;
  }
  return title;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @piwin/agent-host test lightweight-completion`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-host/src/lightweight-completion.ts packages/agent-host/src/lightweight-completion.test.ts
git commit -m "feat(agent-host): add lightweight provider completion for title generation"
```

---

### Task 4: Agent-host — session naming service orchestrator

**Files:**
- Create: `packages/agent-host/src/session-naming-service.ts`
- Create: `packages/agent-host/src/session-naming-service.test.ts`

**Interfaces:**
- Consumes: `deriveDefaultNameFromMessage` from `@piwin/session`, `generateTitleViaProvider` from `./lightweight-completion.js`, `setSessionAutoName` from `@piwin/session`, `resolveProviderSecret` from `./secret-resolver.js`, `loadPiwinConfig` + `getPiwinSessionIndexPath` + `getPiwinRoot` from existing host-runtime helpers.
- Produces:
  - `maybeAutoNameSession(input: { piwinRoot: string; sessionId: string; firstMessage: string; assistantReply?: string; modelRef?: ModelRef; providers: ModelProviderConfig[]; secretResolver: SecretResolver; push: (msg: HostPush) => void; signal?: AbortSignal }): Promise<void>` — resolves config, derives fallback, attempts LLM, writes via `setSessionAutoName`, pushes `session/name-updated`.

- [ ] **Step 1: Write failing test for `maybeAutoNameSession`**

Create `packages/agent-host/src/session-naming-service.test.ts`:

```ts
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { maybeAutoNameSession } from './session-naming-service.js';
import { saveSessionIndex } from '@piwin/session';
import type { OpenAiCompatibleProviderConfig, SessionIndexRecord } from '@piwin/contracts';

const provider: OpenAiCompatibleProviderConfig = {
  id: 'openai',
  protocol: 'openai-compatible',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyEnv: 'OPENAI_API_KEY',
  models: [{ id: 'gpt-4o-mini' }],
};

const secretResolver = {
  resolveProviderSecret: async () => 'sk-test',
  reportProviderSecret: async () => ({}),
  writeProviderSecret: async () => 'keychain:x',
  readProviderSecret: async () => '',
};

function mockFetchTitle(title: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: title } }] }),
    } as unknown as Response),
  );
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'piwin-naming-'));
  await mkdir(join(root, 'sessions-index'), { recursive: true });
  return root;
}

async function seedSession(root: string, record: Partial<SessionIndexRecord> & { id: string }): Promise<void> {
  // NOTE: getPiwinSessionIndexPath returns <root>/sessions-index/index.json
  const indexPath = join(root, 'sessions-index', 'index.json');
  const base: SessionIndexRecord = {
    id: record.id,
    projectPath: '/p',
    scope: { kind: 'project', projectPath: '/p' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messageCount: 2,
    ...record,
  };
  await saveSessionIndex(indexPath, { version: 2, sessions: [base] });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('maybeAutoNameSession', () => {
  it('writes LLM title and pushes name-updated when nameSource is default', async () => {
    const root = await makeRoot();
    await seedSession(root, { id: 's1', messageCount: 2 });
    mockFetchTitle('Fix login bug');
    const pushes: Array<{ type: string }> = [];
    await maybeAutoNameSession({
      piwinRoot: root,
      sessionId: 's1',
      firstMessage: 'Fix the login bug',
      assistantReply: 'I will fix it',
      modelRef: { protocol: 'openai-compatible', providerId: 'openai', modelId: 'gpt-4o-mini' },
      providers: [provider],
      secretResolver: secretResolver as never,
      push: (msg) => pushes.push(msg),
    });
    expect(pushes).toContainEqual({
      type: 'session/name-updated',
      sessionId: 's1',
      name: 'Fix login bug',
      nameSource: 'auto',
    });
  });

  it('does NOT push or write when nameSource is user', async () => {
    const root = await makeRoot();
    await seedSession(root, { id: 's1', name: 'my name', nameSource: 'user' });
    mockFetchTitle('auto attempt');
    const pushes: Array<{ type: string }> = [];
    await maybeAutoNameSession({
      piwinRoot: root,
      sessionId: 's1',
      firstMessage: 'hello',
      modelRef: { protocol: 'openai-compatible', providerId: 'openai', modelId: 'gpt-4o-mini' },
      providers: [provider],
      secretResolver: secretResolver as never,
      push: (msg) => pushes.push(msg),
    });
    expect(pushes).toEqual([]);
  });

  it('falls back to text-derived name when LLM fetch fails', async () => {
    const root = await makeRoot();
    await seedSession(root, { id: 's1', messageCount: 2 });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const pushes: Array<{ type: string }> = [];
    await maybeAutoNameSession({
      piwinRoot: root,
      sessionId: 's1',
      firstMessage: 'Refactor the auth module',
      modelRef: { protocol: 'openai-compatible', providerId: 'openai', modelId: 'gpt-4o-mini' },
      providers: [provider],
      secretResolver: secretResolver as never,
      push: (msg) => pushes.push(msg),
    });
    expect(pushes).toContainEqual({
      type: 'session/name-updated',
      sessionId: 's1',
      name: 'Refactor the auth module',
      nameSource: 'auto',
    });
  });

  it('skips when autoName config is false', async () => {
    const root = await makeRoot();
    await seedSession(root, { id: 's1', messageCount: 2 });
    // Write a config with autoName disabled.
    await mkdir(join(root), { recursive: true });
    await writeFile(join(root, 'config.json'), JSON.stringify({ session: { autoName: false } }));
    mockFetchTitle('should not be called');
    const pushes: Array<{ type: string }> = [];
    await maybeAutoNameSession({
      piwinRoot: root,
      sessionId: 's1',
      firstMessage: 'hello',
      modelRef: { protocol: 'openai-compatible', providerId: 'openai', modelId: 'gpt-4o-mini' },
      providers: [provider],
      secretResolver: secretResolver as never,
      push: (msg) => pushes.push(msg),
    });
    expect(pushes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @piwin/agent-host test session-naming-service`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `maybeAutoNameSession`**

Create `packages/agent-host/src/session-naming-service.ts`:

```ts
import type { HostPush, ModelProviderConfig, ModelRef } from '@piwin/contracts';
import { deriveDefaultNameFromMessage, setSessionAutoName } from '@piwin/session';
import { generateTitleViaProvider } from './lightweight-completion.js';
import { loadPiwinConfig } from './config-store.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';
import { createSecretResolver, type SecretResolver } from './secret-resolver.js';

/**
 * Orchestrate auto-naming for a session after a completed exchange.
 *
 * 1. Check `PiwinConfig.session.autoName` (default true); skip when false.
 * 2. Attempt LLM title generation via the session's current model + provider.
 * 3. On LLM failure, fall back to a text-derived name from the first message.
 * 4. Write via `setSessionAutoName` (respects `nameSource: 'user'` guard).
 * 5. Push `session/name-updated` so the desktop list refreshes.
 *
 * Never throws — all failures are swallowed (caller wraps in fire-and-forget).
 */
export async function maybeAutoNameSession(input: {
  piwinRoot: string;
  sessionId: string;
  firstMessage: string;
  assistantReply?: string;
  modelRef?: ModelRef;
  providers: ModelProviderConfig[];
  secretResolver: SecretResolver;
  push: (message: HostPush) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const { piwinRoot, sessionId, firstMessage, assistantReply, modelRef, providers, secretResolver, push, signal } = input;
  try {
    const rootDir = getPiwinRoot(piwinRoot);
    const config = await loadPiwinConfig(rootDir);
    if (config.session?.autoName === false) {
      return;
    }
    const indexPath = getPiwinSessionIndexPath(rootDir);

    // Attempt LLM title when a model ref + matching provider are available.
    let llmTitle: string | null = null;
    if (modelRef) {
      const provider = providers.find((item) => item.id === modelRef.providerId);
      if (provider) {
        try {
          const apiKey = await secretResolver.resolveProviderSecret(provider);
          if (apiKey) {
            const userPrompt = assistantReply
              ? `User: ${firstMessage}\nAssistant: ${assistantReply}`
              : firstMessage;
            llmTitle = await generateTitleViaProvider({
              provider,
              modelId: modelRef.modelId,
              apiKey,
              userPrompt,
              signal,
            });
          }
        } catch {
          // Fall through to text fallback below.
        }
      }
    }

    const finalName = llmTitle ?? deriveDefaultNameFromMessage(firstMessage);
    if (!finalName) {
      return;
    }
    const updated = await setSessionAutoName(indexPath, sessionId, finalName);
    if (updated) {
      push({
        type: 'session/name-updated',
        sessionId,
        name: updated.name ?? finalName,
        nameSource: 'auto',
      });
    }
  } catch {
    // Best-effort: never fail a turn due to naming.
  }
}
```

**Note:** Verify the exact import paths (`./config-store.js`, `./piwin-paths.js`, `./secret-resolver.js`) by grepping the existing host-runtime imports before finalizing. Adjust to match the real module names in the repo.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @piwin/agent-host test session-naming-service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-host/src/session-naming-service.ts packages/agent-host/src/session-naming-service.test.ts
git commit -m "feat(agent-host): add session naming service orchestrator with LLM + text fallback"
```

---

### Task 5: Agent-host — wire trigger on run/terminal + record session ModelRef

**Files:**
- Modify: `packages/agent-host/src/host-runtime.ts:178-193` (add sessionModels map), `:1180-1196` (expose in context), `:1490-1514` (trigger on message/end or run/terminal)
- Modify: `packages/agent-host/src/commands/session-live-commands.ts:254` (store ModelRef on prompt)
- Modify: `packages/agent-host/src/commands/session-product-commands.ts:120-134` (session/rename sets nameSource via renameSessionRecord — already handled in Task 2)

**Interfaces:**
- Consumes: `maybeAutoNameSession` from `./session-naming-service.js`, `ModelRef` from contracts, session config + providers from `loadPiwinConfig`.
- Produces: host pushes `session/name-updated` after first completed exchange.

- [ ] **Step 1: Add `sessionModels` map to HostRuntime**

In `packages/agent-host/src/host-runtime.ts`, near the other `private readonly session*` declarations (around line 185), add:

```ts
  /** CE-NAME: ModelRef used for the most recent prompt, for auto-naming. */
  private readonly sessionModels = new Map<string, ModelRef>();
```

Add the import for `ModelRef` at the top if not already present (check existing imports from `@piwin/contracts`).

- [ ] **Step 2: Expose `sessionModels` in the command context**

In the context object built around line 1180–1196, add:

```ts
      sessionModels: this.sessionModels,
```

- [ ] **Step 3: Store ModelRef on prompt**

In `packages/agent-host/src/commands/session-live-commands.ts`, find where `sessionLastPromptText.set` is called (line 254). Right after it, store the model:

```ts
      context.sessionLastPromptText.set(command.sessionId, command.input.text);
      if (command.input.model) {
        context.sessionModels.set(command.sessionId, command.input.model);
      }
```

Also add `sessionModels: Map<string, ModelRef>;` to the context type definition (find the `SessionLiveCommandContext` or equivalent type around line 78 where `sessionLastPromptText` is declared).

- [ ] **Step 4: Clean up sessionModels on session end**

In `host-runtime.ts`, find where `sessionProjects.delete(sessionId)` is called (line 1837), and add alongside it:

```ts
    this.sessionModels.delete(sessionId);
```

- [ ] **Step 5: Wire the naming trigger on `run/terminal` completed**

In `host-runtime.ts`, in the session subscribe callback (around line 1491 where `message/end` is handled), add the auto-name trigger. The cleanest hook is right after the `message/end` block, detecting the first assistant reply. However, since `run/terminal` is the authoritative "exchange complete" signal, add the trigger in the `emitRunTerminal` path. Find `emitRunTerminal` (around line 1227) and after the terminal push, add:

```ts
      // CE-NAME: auto-name after first completed exchange (messageCount >= 2).
      if (outcome === 'completed') {
        void this.maybeTriggerAutoName(sessionId).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          this.push({ type: 'host/log', level: 'warn', message: `auto-name failed: ${message}` });
        });
      }
```

Then add the private method near `touchSession` (around line 1715):

```ts
  private async maybeTriggerAutoName(sessionId: string): Promise<void> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const indexPath = getPiwinSessionIndexPath(rootDir);
    const record = await getSessionRecord(indexPath, sessionId);
    if (!record) {
      return;
    }
    // Only auto-name after the first exchange (user + assistant = messageCount >= 2)
    // and only when the name has not been user-set.
    if (record.messageCount < 2) {
      return;
    }
    if (record.nameSource === 'user') {
      return;
    }
    // Only trigger once: if we already have an auto name, do not re-run.
    if (record.nameSource === 'auto' && record.name) {
      return;
    }
    const firstMessage = this.sessionLastPromptText.get(sessionId) ?? '';
    if (!firstMessage) {
      return;
    }
    const config = await loadPiwinConfig(rootDir);
    const modelRef = this.sessionModels.get(sessionId);
    await maybeAutoNameSession({
      piwinRoot: this.options.piwinRoot,
      sessionId,
      firstMessage,
      modelRef,
      providers: config.providers ?? [],
      secretResolver: createSecretResolver(),
      push: (message) => this.push(message),
    });
  }
```

Add the necessary imports at the top of `host-runtime.ts`:

```ts
import { maybeAutoNameSession } from './session-naming-service.js';
import { createSecretResolver } from './secret-resolver.js';
```

Note: `createSecretResolver()` is a stateless factory (see `packages/agent-host/src/secret-resolver.ts:35`) and is called on-demand in other modules (e.g. `notes-rerank.ts:35`, `catalog-commands.ts:314`). `loadPiwinConfig`, `getSessionRecord`, `getPiwinRoot`, `getPiwinSessionIndexPath` are already imported in `host-runtime.ts` (lines 121, 125-126) — verify before editing.

- [ ] **Step 6: Handle `session/auto-name` command in product commands**

In `packages/agent-host/src/commands/session-product-commands.ts`, add a case for `session/auto-name` (mirror the `session/rename` case at line 120):

```ts
    case 'session/auto-name': {
      const existing = await getSessionRecord(indexPath, command.sessionId);
      if (!existing) {
        return fail(requestId, 'session/auto-name', `Unknown session: ${command.sessionId}`);
      }
      // Auto-name via the naming service is normally triggered by run/terminal,
      // but this command allows manual re-trigger (e.g. after config change).
      // For now, only the text fallback is applied here; LLM path is host-driven.
      const fallbackName = deriveDefaultNameFromMessage(command.firstMessage);
      if (!fallbackName) {
        return fail(requestId, 'session/auto-name', 'No derivable name from first message');
      }
      const record = await setSessionAutoName(indexPath, command.sessionId, fallbackName);
      if (!record) {
        return fail(requestId, 'session/auto-name', 'Session name is user-set or empty');
      }
      return ok(requestId, 'session/auto-name', {
        sessionId: record.id,
        name: record.name,
        nameSource: record.nameSource,
        session: indexRecordToSummary(record),
      });
    }
```

Add the imports `deriveDefaultNameFromMessage` and `setSessionAutoName` from `@piwin/session` at the top of the file (alongside the existing `renameSessionRecord` import).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @piwin/agent-host typecheck`
Expected: PASS.

- [ ] **Step 8: Run host-runtime tests**

Run: `pnpm --filter @piwin/agent-host test`
Expected: PASS (existing tests should not break; the new trigger is fire-and-forget and guarded by messageCount/nameSource checks).

- [ ] **Step 9: Commit**

```bash
git add packages/agent-host/src/host-runtime.ts packages/agent-host/src/commands/session-live-commands.ts packages/agent-host/src/commands/session-product-commands.ts
git commit -m "feat(agent-host): wire auto-name trigger on run/terminal + record session ModelRef"
```

---

### Task 6: Desktop — subscribe to session/name-updated push

**Files:**
- Modify: `apps/desktop/src/hooks/use-host-bootstrap.ts:96-145` (add name-updated handler)
- Modify: `apps/desktop/src/host-client-mock.ts` (mock the push + command)
- Test: `apps/desktop/src/hooks/use-host-bootstrap.test.ts` (if exists) or manual

**Interfaces:**
- Consumes: `session/name-updated` HostPush from Task 1.
- Produces: desktop dispatches `session/update` with new name when push arrives.

- [ ] **Step 1: Add push handler in use-host-bootstrap**

In `apps/desktop/src/hooks/use-host-bootstrap.ts`, find the `hostClient.subscribe` callback (around line 96) that handles `transcript/append` and other pushes. Add a handler for `session/name-updated`:

```ts
      if (message.type === 'session/name-updated') {
        dispatch({
          type: 'session/update',
          session: {
            id: message.sessionId,
            name: message.name,
          },
        });
        return;
      }
```

Place it before the `transcript/append` check (or alongside the other `if (message.type === ...)` branches). Match the existing dispatch pattern in that file.

- [ ] **Step 2: Add mock support in host-client-mock**

In `apps/desktop/src/host-client-mock.ts`, find the `session/rename` mock (around line 1884) and add a `session/auto-name` mock alongside it:

```ts
      case 'session/auto-name': {
        const id = (command as { sessionId: string }).sessionId;
        const firstMessage = (command as { firstMessage: string }).firstMessage;
        const name = firstMessage.slice(0, 40).trim() || `session-${id.slice(0, 8)}`;
        return {
          id,
          type: 'response',
          command: 'session/auto-name',
          success: true,
          data: { sessionId: id, name, nameSource: 'auto' },
        };
      }
```

- [ ] **Step 3: Typecheck desktop**

Run: `pnpm --filter @piwin/desktop typecheck`
Expected: PASS.

- [ ] **Step 4: Run desktop tests**

Run: `pnpm --filter @piwin/desktop test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/hooks/use-host-bootstrap.ts apps/desktop/src/host-client-mock.ts
git commit -m "feat(desktop): subscribe to session/name-updated push + mock auto-name command"
```

---

### Task 7: Config normalization + docs

**Files:**
- Modify: `packages/agent-host/src/config-store.ts` (normalize `session.autoName`)
- Modify: `docs/adr/` (add ADR for auto-naming)
- Modify: `AGENTS.md` package ownership cheat sheet (optional)

- [ ] **Step 1: Normalize session config in config-store**

In `packages/agent-host/src/config-store.ts`, find where `compaction` is normalized (around line 178) and add session normalization alongside:

```ts
  normalized.session = normalizeSessionConfig(
    record.session,
    defaults.session ?? createDefaultSessionConfig(),
  );
```

Add the helper function near the other `normalize*Config` functions:

```ts
function normalizeSessionConfig(
  record: unknown,
  defaults: SessionConfig,
): SessionConfig {
  if (!record || typeof record !== 'object') {
    return defaults;
  }
  const value = record as { autoName?: unknown };
  return {
    autoName: typeof value.autoName === 'boolean' ? value.autoName : defaults.autoName,
  };
}
```

Import `SessionConfig` and `createDefaultSessionConfig` from `@piwin/contracts` at the top, and add `session: createDefaultSessionConfig()` to the `createDefaultPiwinConfig` (or equivalent defaults object) in the same file.

- [ ] **Step 2: Add `session` to defaults**

Find the defaults object in `config-store.ts` (where `compaction: createDefaultCompactionConfig()` is set) and add:

```ts
    session: createDefaultSessionConfig(),
```

- [ ] **Step 3: Typecheck + test**

Run: `pnpm --filter @piwin/agent-host typecheck && pnpm --filter @piwin/agent-host test`
Expected: PASS.

- [ ] **Step 4: Write ADR**

Create `docs/adr/0016-session-auto-naming.md`:

```markdown
# ADR 0016: Session Auto-Naming

**Date:** 2026-07-29

## Context

piwin sessions defaulted to `session-<id-prefix>` names, making the session list
hard to navigate. Manual rename exists (`session/rename`) but requires user
action. Industry standard (Claude Code, ChatGPT) is automatic title generation.

## Decision

Implement two-tier auto-naming:

1. **Text fallback** (`deriveDefaultNameFromMessage`): pure cleanup of the first
   user message (strip markdown/URLs, truncate 60 chars). Used immediately and
   as the LLM-failure fallback.
2. **LLM title** (`generateTitleViaProvider`): direct provider chat-completion
   fetch (no Pi session) using the session's current ModelRef, triggered after
   the first completed exchange (`run/terminal` outcome=completed).

**Three-state name source** (`nameSource: 'default' | 'auto' | 'user'`) on
`SessionIndexRecord` / `SessionSummary`:
- `default`: placeholder, eligible for auto-naming.
- `auto`: host-derived, eligible for re-naming (retry on next exchange if LLM failed).
- `user`: manual rename, NEVER overwritten.

**Trigger**: `run/terminal` with `outcome: 'completed'` and `messageCount >= 2`
and `nameSource !== 'user'` and `nameSource !== 'auto'` (one-shot per session).

**Opt-out**: `PiwinConfig.session.autoName: false`.

## Consequences

- `packages/agent-host` gains a `lightweight-completion.ts` module that calls
  provider APIs directly (not via Pi session). This is bounded to title
  generation and does not violate the "only agent-host depends on Pi" rule
  (provider APIs are not Pi).
- One extra provider API call per session (first exchange only).
- `nameSource` field is additive; legacy records default to `'default'`.
```

- [ ] **Step 5: Commit**

```bash
git add packages/agent-host/src/config-store.ts docs/adr/0016-session-auto-naming.md
git commit -m "feat(config): normalize session.autoName + ADR 0016 for auto-naming"
```

---

### Task 8: End-to-end verification

- [ ] **Step 1: Full typecheck**

Run: `pnpm typecheck`
Expected: PASS across all packages.

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 3: Manual smoke test (CLI)**

```bash
pnpm dev:cli
# In the CLI: open a project, start a new session, send one message.
# After the first assistant reply completes, the session list should show
# a derived/LLM title instead of "session-xxxxxxxx".
# Manually rename via the rename command, then send another message —
# the manual name must persist (not overwritten).
```

- [ ] **Step 4: Manual smoke test (Desktop, if available)**

```bash
pnpm dev:desktop
# Same flow: new session → send message → check sidebar updates to auto title.
# Right-click → rename → send another message → name stays.
```

- [ ] **Step 5: Final commit if any fixes needed**

If smoke tests reveal issues, fix and commit with descriptive messages.
