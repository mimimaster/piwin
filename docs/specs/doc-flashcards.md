# Spec — Doc-sourced & open flashcard generation

| Field | Value |
|-------|-------|
| Status | **Draft for review (v3)** |
| Date | 2026-07-28 |
| Depends on | [ADR 0018](../adr/0018-notes-flashcards-local-rag.md), [ADR 0008](../adr/0008-skills-mcp-pi-wiring.md), artifact sandbox ([ADR 0005](../adr/0005-artifact-and-media.md)), ExecutionMode (`chat` / `agent` / `agent-debug`) |
| Packages | `contracts`, `@piwin/flashcards`, **`@piwin/doc-rag` (new)**, `@piwin/agent-host`, `@piwin/artifact`, `@piwin/skills` (bundled), desktop, cli |
| Supersedes | v2 draft (same path) |

> **v3 changelog (vs v2):** (1) Replace “flip one boolean” with an explicit
> **ExecutionMode tool-profile** redesign — chat is no longer `hostTools = []`.
> (2) Generation orchestration is a **client-assembled prompt** protocol
> (`index → retrieve → pure prompt builder → session/prompt`); host does not
> intercept invisible params. (3) `fileSelection` is end-to-end. (4)
> `batchCreate` has a partial-success contract. (5) Full IPC + artifact
> discriminated-union for open-source. (6) Security policy for arbitrary
> folders. (7) Migration path for existing agent-mode flashcard users.
>
> Chinese backup: [doc-flashcards.zh.md](./doc-flashcards.zh.md). English is
> authoritative on conflict.

---

## 1. Intent

piwin already has notes + flashcards (ADR 0018). This feature extends that
personal knowledge layer so a user can:

1. Point at **any local folder** of docs/code.
2. Get a **durable, re-openable set of flashcards** bound to that folder.
3. Generate cards in a **knowledge conversation** (chat), not a coding session.
4. Keep **source attribution** (file + line + excerpt) available but unobtrusive.

The design goal is not “another RAG product.” It is: **reuse the notes RAG
pattern at folder scope, keep cards as plain-text truth, and put generation
behind a small, mode-scoped tool surface.**

---

## 2. Design principles

| # | Principle | Implication |
|---|-----------|-------------|
| P1 | **Plain text is truth; indexes are caches** | Cards live as markdown under `~/.piwin/flashcards/`. Doc-rag sqlite is rebuildable and may be deleted. |
| P2 | **Separate knowledge plane from coding plane** | Chat = knowledge tools. Agent = coding tools. No cluttering either surface with the other’s tools. |
| P3 | **Host stays a dumb pipe for generation turns** | Apps (desktop/CLI) index + retrieve + assemble prompt text. Host runs `session/prompt` and tools. No hidden param intercept. |
| P4 | **Structured model I/O via tools** | The model emits cards through `flashcard_batch_create`, not free-form markdown the app must parse. |
| P5 | **Dynamic capability, not hardcoded lists** | Supported file types come from the chunker at runtime (`supportedExtensions`). |
| P6 | **User intent for destructive / outward actions** | Forget-folder needs confirm. Open-source resolves paths only from stored card fields on the host. |
| P7 | **Degrade gracefully** | No embedding provider → FTS-only. Empty selection / empty retrieve → clear error, not silent garbage cards. |
| P8 | **Contracts first, adapters second** | Types and IPC in `@piwin/contracts`; packages implement; apps consume public APIs only. |

---

## 3. Architecture

### 3.1 Layer map

```text
┌──────────────────────────────────────────────────────────────────┐
│ Presentation                                                      │
│  Desktop DocCardsPanel · CLI `piwin doccards …`                   │
│  (pick folder, select files, params, trigger generate, rebind)    │
├──────────────────────────────────────────────────────────────────┤
│ Orchestration (app-owned, pure + IPC)                             │
│  index-folder → retrieve → buildFlashcardGenerationPrompt →       │
│  session/prompt (chat tool profile)                               │
├──────────────────────────────────────────────────────────────────┤
│ Application packages                                              │
│  @piwin/doc-rag     folder scan / chunk / FTS+vector index        │
│  @piwin/flashcards  card store, codec, artifact template, dedup   │
│  @piwin/notes       reuse: tokenizer, fuseHybridHits, embeddings  │
│  @piwin/artifact    action whitelist + bridge validation          │
├──────────────────────────────────────────────────────────────────┤
│ Agent host                                                        │
│  Tool profiles by ExecutionMode · flashcard tools · doccards IPC  │
│  Dual adapters (SDK / RPC) share the same tool assembly path      │
├──────────────────────────────────────────────────────────────────┤
│ Contracts                                                         │
│  FlashcardRecord fields · FlashcardBatchResult · HostCommand      │
│  ArtifactAction discriminated union                               │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 Package dependencies

```text
@piwin/doc-rag
  → @piwin/contracts
  → @piwin/notes   (public exports only: tokenize*, fuseHybridHits,
                    createEmbeddingProvider, EmbeddingProvider types)

@piwin/flashcards  (unchanged deps; additive fields/APIs)

apps/desktop, apps/cli
  → host IPC only (no FS into doc-rag internals)

@piwin/agent-host
  → doc-rag + flashcards + artifact (wiring)
```

**Embedding config (v1):** resolve via `config.notes.embedding` (same provider
as notes). Document in UI that “embedding for notes also powers doc-rag.”
A dedicated `config.docRag` is deferred until product needs diverge.

**sqlite rule:** exactly one module in `@piwin/doc-rag` may import
`node:sqlite` (`doc-index.ts`), same per-package rule as notes.

### 3.3 Two generation shapes

| Shape | When | RAG? | Source fields | Tools used |
|-------|------|------|---------------|------------|
| **Folder-sourced** | User picks a folder (Doc Cards UI / CLI) | Yes — doc-rag | `sourceFolder`, `sourceFile`, `sourceLine`, `sourceExcerpt` | flashcard batch (+ list for dedup) |
| **Open** | User asks in chat with no folder context | No | none | flashcard batch (+ list); optional web tools if enabled in knowledge profile |

**Note-sourced** generation (`sourceNoteId`) already exists under ADR 0018.
v1 of *this* feature keeps it working by including **read-only notes search**
in the knowledge tool profile (see §10). Full notes CRUD stays agent-side.

---

## 4. Scope

### 4.1 Goals

1. Folder → index → topic retrieve → batch cards with file/line attribution.
2. Folder binding: list / rebind / forget; source-missing is not data loss.
3. Open generation without folder (general knowledge; optional web if profile allows).
4. Source UX: indicator + click popover; open file via host-validated path.
5. Chat carries knowledge tools; agent stays coding-focused.
6. Bundled quality guidance always present in the Doc Cards generate path
   (skill is secondary; prompt embeds the rules).

### 4.2 Non-goals (v1)

- Folder file watchers / auto-regenerate on change.
- PDF / Office / binary chunking.
- Unified `FlashcardSource` discriminated-union refactor (fields stay additive).
- Cloud sync / shared decks.
- Configurable card visual theme.
- Extracting `@piwin/rag-core` from notes (YAGNI until circular deps appear).
- Making chat a full second agent (no bash/process/MCP in knowledge profile v1).

### 4.3 Requirements checklist

Normative detail lives in later sections; this table is the acceptance index.

| ID | Requirement | Detail |
|----|-------------|--------|
| A1 | Scan any user-picked folder (not only trusted projects) | §7, §8.1 |
| A2 | Dynamic extensions from chunker | §8.1 |
| A3 | Chunk markdown / code / plain text | §8.1 |
| A4–A6 | FTS5 + optional vector + hybrid RRF | §8.1 |
| A7 | Index rebuildable under `~/.piwin/doc-rag/` | §5.4 |
| A8 | Retrieve by topic + optional file allowlist | §8.1, §9 |
| B1 | `flashcard_batch_create` | §9.3 |
| B2–B3 | Folder-sourced + open generation | §3.3, §9 |
| B4 | topic / difficulty / count params | §9.1 |
| B5 | Dedup: list + trigram; batch partial success | §9.3 |
| B6 | Normal `session/prompt` streaming | §9 |
| B7 | Combined artifact HTML (per-card `cardId` preserved) | §12 |
| C1–C5 | sourceFolder bind / list / missing / rebind / forget | §5, §11 |
| D1–D5 | Source indicator, popover, open-source action | §12 |
| E1–E3 | Tool profiles + skill | §10, §9.4 |
| F1–F6 | Doc Cards desktop tab | §13 |
| G1–G6 | CLI parity | §14 |
| H1 | Hardcoded artifact style v1 | §12 |

---

## 5. Domain model

### 5.1 Source kinds (logical)

```text
FlashcardOrigin =
  | { kind: 'folder'; folder: AbsPath; file: RelPath; line: number; excerpt: string }
  | { kind: 'note';   noteId: string; excerpt: string }
  | { kind: 'open' }
```

v1 **storage** remains flat optional fields (no union refactor). The logical
model above is for implementers and skill text only.

### 5.2 Card field additions

```ts
// packages/contracts — additive on existing FlashcardRecord / FlashcardCreateInput
sourceFolder?: string;  // absolute, canonicalized (§7.2)
sourceFile?: string;    // relative to sourceFolder, no '..'
sourceLine?: number;    // 1-based inclusive start line of excerpt
// sourceExcerpt already exists
```

### 5.3 Folder binding semantics

- **Registry = cards.** There is no separate folder registry file. “Cards for
  folder F” ≡ `list({ sourceFolder: canonicalize(F) })`.
- **Match key** is the **canonical absolute path string** stored at create time
  (see §7.2). Rebind rewrites that string in bulk.
- **Source missing:** `fs.access(folder)` fails → UI badge; cards remain.
- **Forget:** delete all cards (and review JSON) whose `sourceFolder` matches;
  does **not** delete the user’s documents or the doc-rag cache (cache may be
  pruned separately or lazily on next index of a different path).

### 5.4 Storage layout

```text
~/.piwin/flashcards/
  cards/<card-id>.md      # truth: frontmatter includes source* fields
  review/<card-id>.json   # FSRS state (unchanged)
  decks.json

~/.piwin/doc-rag/
  <folder-key>/           # folder-key = sha256(canonicalAbsPath).slice(0, 16)
    .source-path          # canonical absolute path (cleanup / debug)
    doc-index.sqlite3     # rebuildable FTS5 (+ optional vectors)
```

---

## 6. Invariants (binding)

1. Cards (markdown + review JSON) are user data; all `*.sqlite3` under
   `doc-rag/` are disposable caches.
2. `sourceFolder` is a **canonical absolute path string**, never a bare hash.
3. Source-missing ≠ data loss; rebind / forget are the recovery verbs.
4. Supported extensions are **only** what the active `DocChunker` exposes.
5. Path confinement: every scanned/indexed/opened file path must realpath to
   a location **inside** the user-selected folder root (§7).
6. Artifact actions stay on a **whitelist**; CSP/sandbox posture unchanged.
7. Generation turns use the **knowledge tool profile** (chat), not coding tools.
8. Batch create is **partial-success**: one duplicate does not abort the batch.
9. Open-source file open resolves **only** from host-side card store fields;
   untrusted artifact payload paths are not trusted as absolute locations.

---

## 7. Security policy

Arbitrary-folder indexing is a deliberate escape from `~/.piwin/notes/`. Treat
it as **user-granted, host-enforced**.

### 7.1 Confinement

| Rule | Behavior |
|------|----------|
| Folder root | Absolute path from OS directory picker or CLI arg |
| Realpath | After resolve, `realpath` folder root; reject if missing |
| Child paths | Every file path must `realpath` under folder root; reject symlink escapes |
| Relative `sourceFile` | No absolute paths; no `..` segments; normalize with posix/win rules |
| Open file | Host loads card by `cardId`, builds `join(sourceFolder, sourceFile)`, re-checks confinement, then opens |

### 7.2 Path canonicalization

Store and compare:

```ts
function canonicalizeFolderPath(input: string): string {
  // resolve → realpath → strip trailing separators (except root)
  // on macOS default: preserve case as realpath returns
}
```

All IPC that takes `folderPath` / `oldPath` / `newPath` runs this first.
`list-by-folder` and rebind match on the canonical string.

### 7.3 Scan / index limits (v1 constants)

| Limit | Default | On breach |
|-------|---------|-----------|
| Max files indexed | 2_000 | stop with partial + warning |
| Max single file bytes | 512 KiB | skip file |
| Max total bytes | 32 MiB | stop with partial + warning |
| Max walk depth | 12 | skip deeper |
| Skip dir names | `node_modules`, `.git`, `dist`, `build`, `.svn`, `__pycache__` | always |
| Skip file names | `.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa*`, `credentials.json` | always |
| Hidden entries | skip (name starts with `.`) except allowlist none in v1 | always |

Index / retrieve accept `AbortSignal`. Concurrent index of the same
`folder-key` is serialized (mutex per key); second caller waits or gets
`already-indexing` error — pick **wait with shared promise** in v1.

### 7.4 Model blast radius

- `flashcard_batch_create`: cap `cards.length` (default 40).
- `doccards/forget-folder`: desktop confirm; CLI requires `--yes`.
- Knowledge profile has **no** bash / process / MCP write tools.

---

## 8. Package design — `@piwin/doc-rag`

### 8.1 Public surface

```ts
export type DocChunk = {
  filePath: string;     // relative to folder root
  content: string;
  startLine: number;    // 1-based
  endLine: number;
  language: string;
};

export type DocChunker = {
  readonly supportedExtensions: readonly string[];
  chunk(filePath: string, content: string): DocChunk[];
};

export type ScannedDocFile = {
  relativePath: string;
  sizeBytes: number;
  language: string;
};

export type RetrieveOptions = {
  limit?: number;                 // default 10
  fileAllowlist?: string[];       // relative paths; empty array ⇒ error
  maxTotalChars?: number;         // default 24_000 (token-budget proxy)
  embeddingProvider?: EmbeddingProvider;
  signal?: AbortSignal;
};

export type RetrievedChunk = DocChunk & {
  score: number;
  snippet: string;
};

export type IndexFolderOptions = {
  includeFiles?: string[];        // if set, only these relative paths
  signal?: AbortSignal;
};

export type FolderRag = {
  scanFolder(folderPath: string): Promise<{
    files: ScannedDocFile[];
    supportedExtensions: string[];
  }>;
  indexFolder(
    folderPath: string,
    options?: IndexFolderOptions,
  ): Promise<{
    indexed: number;
    chunks: number;
    degraded: boolean;            // true ⇒ FTS-only
    skipped: number;
    warnings: string[];
  }>;
  retrieve(
    folderPath: string,
    query: string,
    options?: RetrieveOptions,
  ): Promise<RetrievedChunk[]>;
  isIndexed(folderPath: string): Promise<boolean>;
  close(): void;
};

export function createFolderRag(options: {
  chunker?: DocChunker;           // default v1 chunker
  embeddingProvider?: EmbeddingProvider;
  piwinRoot?: string;             // default ~/.piwin
}): FolderRag;

/** Pure: turns retrieval + params into the user message for session/prompt. */
export function buildFlashcardGenerationPrompt(input: {
  folderPath: string;
  chunks: RetrievedChunk[];
  topic?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  count?: 'fewer' | 'standard' | 'more';
  qualityRules: string;           // always supplied by caller (§9.4)
}): string;
```

### 8.2 Chunker v1 behavior

| Kind | Strategy |
|------|----------|
| Markdown (`.md` etc.) | Split on headings / paragraphs / fenced code blocks |
| Code (`.ts`, `.js`, `.py`, `.rs`, `.go`, …) | Function/class-oriented split; fallback ~200 lines |
| Plain text | Double-newline paragraphs |
| Unsupported ext | Skip at scan (not an error) |

`supportedExtensions` is owned by the chunker instance — never a shared
hardcoded constant in apps.

### 8.3 Indexer

- sqlite via `node:sqlite` in `doc-index.ts` only.
- FTS5 over pre-tokenized chunk text (notes `tokenize*` helpers).
- Optional float32 vector blob + brute-force cosine (notes pattern).
- Hybrid: FTS + vector + `fuseHybridHits` from notes; no provider → FTS only.
- `retrieve` applies `fileAllowlist` **after** hybrid rank (or as FTS filter if
  cheap); truncates by `maxTotalChars` while preserving whole chunks.

---

## 9. Generation pipeline

### 9.1 Orchestration protocol (normative)

**There is no host-side “intercept PromptInput for FlashcardGenerationParams.”**
`PromptInput` stays `{ text, attachments?, model?, … }`.

```text
Doc Cards Generate (folder-sourced)
──────────────────────────────────
1. Ensure chat session (create if active mode ≠ chat; title "Doc cards: <name>")
2. IPC doccards/index-folder { folderPath, includeFiles? }
3. IPC doccards/retrieve     { folderPath, query: topic||folderName,
                               fileAllowlist?, limit?, maxTotalChars? }
4. If chunks.length === 0 → surface error; do not prompt
5. text = buildFlashcardGenerationPrompt({ folderPath, chunks, params,
                                           qualityRules: FLASHCARD_QUALITY_RULES })
6. session/prompt({ text })   // knowledge tool profile
7. Model: flashcard_list (dedup) → flashcard_batch_create({ cards: [...] })
8. Tool streams AgentEvents; UI renders returned artifact HTML
```

```text
Open generation (no folder)
───────────────────────────
1. User message in an existing chat session (or new chat)
2. Optional: prepend FLASHCARD_QUALITY_RULES via skill / slash / system habit
3. session/prompt({ text: user request })
4. Model uses general knowledge (and web_* only if present in profile)
5. flashcard_batch_create without source* fields
```

CLI `doccards generate` runs the same steps 2–7 non-interactively where
possible (stream tool output to TTY); `--files a,b` maps to `includeFiles` /
`fileAllowlist`.

### 9.2 Why this shape

| Alternative | Rejected because |
|-------------|------------------|
| Host intercepts hidden generation metadata on `session/prompt` | No field on `PromptInput`; dual-mode adapters diverge; hard to test |
| Single `doccards/generate` that owns the whole agent turn | Couples UI lifecycle to host; harder to stream as normal chat; overloads IPC |
| Model reads files with tools | Reintroduces N-tool thrash; poor grounding; security noise |

Client (or CLI) orchestration + pure prompt builder keeps packages testable and
the host a pipe — aligned with P3.

### 9.3 Batch tool & store contract

```ts
export type FlashcardBatchCreateInput = {
  cards: FlashcardCreateInput[];
};

export type FlashcardBatchCreateResult = {
  created: FlashcardRecord[];
  skipped: Array<{
    front: string;
    reason: 'duplicate' | 'validation';
    detail?: string;
  }>;
  /** Combined flip-card HTML; each card keeps its own cardId for rate/open actions. */
  artifactHtml: string;
};
```

`CardStore.batchCreate`:

1. Reject if `cards.length === 0` or `> MAX_BATCH` (40).
2. For each card: try `create`; on `DuplicateCardError` or field validation
   failure → push to `skipped`, continue.
3. Build `artifactHtml` from **created** cards only (multi-card template:
   stacked flip cards or a simple pager — implementation choice; each card’s
   rate/open actions must carry that card’s `cardId`).

Tool `flashcard_batch_create` returns JSON-serializable
`FlashcardBatchCreateResult` plus instructions to embed `artifactHtml` in an
`html` fence (same pattern as single create).

Single `flashcard_create` remains for ad-hoc one-offs.

### 9.4 Quality rules injection

Bundled skill path: `skills/generate-flashcards/SKILL.md` → installed by
`ensureBundledSkillsInstalled` into `~/.piwin/skills/` **only if missing**
(existing non-overwrite policy).

**Doc Cards generate must not rely on skill discovery alone.**  
`FLASHCARD_QUALITY_RULES` is a **string constant** co-located with the prompt
builder (exported from `@piwin/flashcards` or `@piwin/doc-rag`) and always
embedded in step 5. Skill body should stay in sync (snapshot test) but is
best-effort for free-form chat.

Skill content outline:

- Folder-sourced: ground only in provided passages; fill all source* fields.
- Open: omit source* fields.
- Note-sourced: fill `sourceNoteId` + `sourceExcerpt` when passages cite notes.
- Atomic front; no answer leak; short back; difficulty mapping; one batch call;
  list-before-create dedup.

---

## 10. ExecutionMode tool profiles

### 10.1 Problem with “invert the boolean”

Today (`sdk-adapter.ts`):

```ts
const flashcardsEnabled = … && !chatMode;
const hostTools = chatMode ? [] : [ …web, mcp, plan, process, memory, notes, flashcards ];
```

Chat strips **all** host tools. Flipping only `flashcardsEnabled` still yields
`hostTools = []`. v3 therefore redesigns assembly.

### 10.2 Profiles (normative)

| Profile | Modes | Host tools (conceptual) |
|---------|-------|-------------------------|
| **knowledge** | `chat` | `flashcard_*` (list/create/batch_create/delete); **read-only** `note_search` if notes enabled; optional `web_search`/`web_fetch` if `tools-web` enabled for knowledge |
| **coding** | `agent` | Existing set **minus** flashcard tools (bash gate, process, memory, notes CRUD tools, mcp, web, plan, …) |
| **debug** | `agent-debug` | Union of knowledge + coding |

```ts
// Illustrative assembly — exact code lives in sdk-adapter (shared by RPC path)
const knowledgeTools = [
  ...flashcardTools,
  ...notesSearchOnlyTools,  // subset: search, not write/delete
  ...knowledgeWebTools,     // may be []
];
const codingTools = [
  ...webTools, ...mcpBridge.tools, planTool, ...processTools,
  ...memoryTools, ...notesTools, /* no flashcards */
];

const hostTools =
  executionMode === 'chat' ? knowledgeTools :
  executionMode === 'agent-debug' ? [...codingTools, ...flashcardTools] :
  codingTools;
```

Update contracts comments that currently say “chat strips tools” to
“chat uses the knowledge tool profile.”

### 10.3 Migration

| Audience | Behavior |
|----------|----------|
| Existing users generating cards in **agent** mode | **Breaking** by default: flashcard tools leave agent |
| Escape hatch (one release, optional permanent) | `config.flashcards.agentModeTools?: boolean` (default `false`). When `true`, coding profile also includes flashcard tools |
| Desktop empty states / copy | Update “generate via agent” → “generate via chat / Doc Cards” |
| ADR 0018 §7 | Amend: generation is knowledge-chat-driven; agent opt-in via config |

### 10.4 Dual adapters

Both `PiSdkAdapter` and `PiRpcAdapter` must share the same profile helper
(extract `buildHostToolsForMode(...)` once). No SDK-only behavior.

---

## 11. IPC surface (`packages/contracts` + host handlers)

### 11.1 Commands

```ts
| { id?: string; type: 'doccards/scan-folder'; folderPath: string }
| { id?: string; type: 'doccards/index-folder';
    folderPath: string;
    includeFiles?: string[];
  }
| { id?: string; type: 'doccards/retrieve';
    folderPath: string;
    query: string;
    fileAllowlist?: string[];
    limit?: number;
    maxTotalChars?: number;
  }
| { id?: string; type: 'doccards/list-by-folder'; folderPath: string }
| { id?: string; type: 'doccards/rebind-folder'; oldPath: string; newPath: string }
| { id?: string; type: 'doccards/forget-folder'; folderPath: string }
| { id?: string; type: 'doccards/open-source';
    cardId: string;
    openFile?: boolean;   // default true when invoked from artifact
  }
```

### 11.2 Success payloads

| Command | Data |
|---------|------|
| `scan-folder` | `{ files: ScannedDocFile[]; supportedExtensions: string[] }` |
| `index-folder` | `{ indexed: number; chunks: number; degraded: boolean; skipped: number; warnings: string[] }` |
| `retrieve` | `{ chunks: RetrievedChunk[]; degraded: boolean }` |
| `list-by-folder` | `{ records: FlashcardRecord[]; folderExists: boolean; canonicalPath: string }` |
| `rebind-folder` | `{ updated: number }` |
| `forget-folder` | `{ deleted: number }` |
| `open-source` | `{ opened: boolean; path?: string }` — path only after host resolve |

### 11.3 `fileSelection` end-to-end

| Stage | Field |
|-------|-------|
| UI checkboxes | relative paths from `scan-folder` |
| Index | `includeFiles` — if provided, only chunk those files (empty array → error) |
| Retrieve | `fileAllowlist` — drop chunks outside set (empty array → error) |
| Prompt | only retrieved chunks appear |

If the user leaves all boxes checked, omit both fields (means “all supported
files”). If the user unchecks some, pass the checked set to **both** index and
retrieve for consistency.

### 11.4 Flashcards package store APIs

- `list({ sourceFolder?: string; deck?: string; sourceNoteId?: string })`
- `batchCreate(input) → FlashcardBatchCreateResult` (without artifactHtml at
  store layer — artifact built in tools or template helper)
- `deleteBySourceFolder(folderPath) → { deleted: number }`
- `rebindSourceFolder(oldPath, newPath) → { updated: number }`
- Codec round-trip for new fields

Clarify layering:

```ts
// store
batchCreate(cards) → { created, skipped }

// flashcard-tools
flashcard_batch_create → store.batchCreate + buildCombinedArtifactHtml(created)
                     → FlashcardBatchCreateResult
```

---

## 12. Artifact source UX & bridge

### 12.1 Template behavior

| Card | Back face | Popover | Open file |
|------|-----------|---------|-----------|
| Folder- or note-sourced | Subtle indicator only (no “Source:” label) | excerpt + path + line (iframe-local) | button → `flashcard/open-source` |
| Open | No indicator | — | — |

Style remains **hardcoded** inline CSS in v1.

Multi-card `artifactHtml`: each card is a self-contained flip unit with its
own `cardId` in rate/open payloads.

### 12.2 Artifact contracts (discriminated union)

```ts
export type ArtifactActionName = 'flashcard/rate' | 'flashcard/open-source';

export type FlashcardRateActionPayload = {
  cardId: string;
  rating: 'again' | 'hard' | 'good' | 'easy';
};

export type FlashcardOpenSourceActionPayload = {
  cardId: string;
  openFile?: boolean;
  // Optional hints for UI only — host MUST ignore for path resolution:
  sourceFile?: string;
  sourceLine?: number;
};

export type ArtifactActionMessage =
  | {
      type: 'piwin-artifact:action';
      channelId: string;
      action: 'flashcard/rate';
      payload: FlashcardRateActionPayload;
    }
  | {
      type: 'piwin-artifact:action';
      channelId: string;
      action: 'flashcard/open-source';
      payload: FlashcardOpenSourceActionPayload;
    };
```

Validation (`bridge-protocol.ts`):

- `cardId` matches product id pattern.
- `sourceLine` if present: **integer ≥ 1**.
- `sourceFile` if present: relative, no `..`.
- Unknown actions dropped.

Desktop `ArtifactFrame` / `App.tsx`: on `flashcard/open-source`, send
`doccards/open-source` with `{ cardId, openFile: true }` only — **do not**
forward untrusted paths as authority.

Host handler: `read(cardId)` → require `sourceFolder` + `sourceFile` →
canonicalize + confine → open via Tauri/shell at `sourceLine` when possible.

---

## 13. Desktop UI

### 13.1 Knowledge Center tab

Fourth sub-tab `docs` (“Doc Cards” / “文档卡片”) on existing
`KnowledgeCenterPanel`. Tabs `wiki` / `cards` / `memory` unchanged.

### 13.2 DocCardsPanel

```
┌─────────────────────────────────────────────┐
│ [ Choose folder… ]   /Users/…/docs          │
│ Supported: .md .txt .ts …   (from scan)     │
│ Files: 12    Bound cards: 8                 │
│ ☑ intro.md   ☑ api.md   …                   │
│ Topic [____]  Difficulty [med▾]  Count [▾]  │
│ [ Generate cards ]                          │
│ ── Bound cards ──                           │
│  • What is X?                               │
│  [ Rebind ]  [ Forget folder… ]             │
└─────────────────────────────────────────────┘
```

Flow follows §9.1. Generate while non-chat → spawn chat session
`"Doc cards: <folder-basename>"`. Source-missing → badge + Rebind.
Forget → confirm dialog.

---

## 14. CLI

```text
piwin doccards scan <folder>
piwin doccards index <folder> [--files a,b]
piwin doccards retrieve <folder> <query> [--files a,b] [--limit N]
piwin doccards list <folder>
piwin doccards generate <folder> [--topic …] [--difficulty …] [--count …] [--files a,b]
piwin doccards rebind <old> <new>
piwin doccards forget <folder> --yes
```

`generate` implements §9.1 against a chat-mode session. Non-TTY may print
created fronts / skipped reasons as JSON.

---

## 15. Config

```ts
// existing FlashcardsConfig — additive
export type FlashcardsConfig = {
  enabled?: boolean;
  /** When true, flashcard tools also appear on the coding (agent) profile. Default false. */
  agentModeTools?: boolean;
  /** Max cards per flashcard_batch_create. Default 40. */
  maxBatchSize?: number;
};
```

Embedding: reuse `config.notes.embedding` (documented).

---

## 16. Testing & acceptance

### 16.1 Unit / integration matrix

| Area | Cases |
|------|-------|
| chunker | md / code / plain splits; unsupported skip; dynamic extensions |
| doc-index | FTS; vector mock; hybrid; FTS degrade; rebuild |
| folder-rag | index→retrieve; includeFiles; fileAllowlist; empty allowlist error; traversal/symlink reject; size limits; concurrent index |
| prompt builder | includes quality rules; chunk paths/lines; param echo; truncation note when maxTotalChars hits |
| card-codec | folder fields round-trip |
| card-store | batchCreate partial skip; list by folder; rebind; deleteBySourceFolder; canonical path match |
| bridge-protocol | rate + open-source; bad id; line 0 rejected; traversal |
| artifact-template | indicator/popover; open card clean; multi-card distinct cardIds |
| tool profile | chat has flashcards (+ note_search); agent lacks flashcards unless agentModeTools; agent-debug union |
| flashcard-tools | batch result shape; artifactHtml only for created |
| skill | frontmatter + body snapshot aligns with FLASHCARD_QUALITY_RULES themes |

### 16.2 Acceptance (“done”)

1. `pnpm typecheck` green for touched packages.
2. Package tests above pass.
3. Manual: pick folder → generate → cards bound → reopen folder sees them →
   move folder → missing badge → rebind → forget.
4. Manual: agent session has no flashcard tools (default); chat has them.
5. ADR 0018 appendix + desktop copy updated.
6. No app import of Pi; doc-rag does not import agent-host.

---

## 17. ADR updates (append to ADR 0018)

- Folder source fields + binding semantics.
- `@piwin/doc-rag` chunk-level index (notes pattern at folder scope).
- Knowledge vs coding tool profiles (chat no longer tool-empty).
- `flashcard_batch_create` + partial success.
- Artifact action union adds `flashcard/open-source`.
- Generation orchestration: app retrieve + pure prompt builder.
- Config `flashcards.agentModeTools` migration hatch.

---

## 18. Open questions (non-blocking)

Defaults above are good enough to implement; revisit with evidence:

1. **Chunk size / overlap** — start paragraph / ~200-line; later recall-eval.
2. **Stale index** — v1 manual re-index only; later mtime lazy reconcile.
3. **Retrieve k vs maxTotalChars** — defaults 10 / 24k; tune on quality.
4. **Multi-card artifact layout** — stack vs carousel (UX only).
5. **Whether knowledge profile should include full notes tools later** — v1 is search-only.

---

## Appendix A — Sequence (folder generate)

```text
User                Desktop              Host                 doc-rag / store         Model
 │                    │                    │                        │                   │
 │ choose folder      │                    │                        │                   │
 │───────────────────>│ scan-folder        │                        │                   │
 │                    │───────────────────>│ scan                   │                   │
 │                    │<───────────────────│                        │                   │
 │ Generate           │                    │                        │                   │
 │───────────────────>│ index-folder       │                        │                   │
 │                    │───────────────────>│ indexFolder            │                   │
 │                    │ retrieve           │                        │                   │
 │                    │───────────────────>│ retrieve               │                   │
 │                    │ buildPrompt (pure, in app or shared util)   │                   │
 │                    │ session/prompt(text)                        │                   │
 │                    │───────────────────>│ ───────────────────────┼──────────────────>│
 │                    │                    │   flashcard_list       │                   │
 │                    │                    │   flashcard_batch_create                   │
 │                    │                    │───────────────────────>│ create×N          │
 │                    │ events + artifact  │<───────────────────────│                   │
 │<───────────────────│                    │                        │                   │
```

## Appendix B — v2 → v3 issue closure

| v2 defect | v3 resolution |
|-----------|----------------|
| `hostTools = []` makes gating invert useless | §10 tool profiles |
| Generation params not on wire | §9.1 client assemble; `doccards/retrieve` |
| `fileSelection` unused | §11.3 `includeFiles` + `fileAllowlist` |
| batch throw vs skip | §9.3 partial-success result |
| `open-source` missing from IPC / types | §11.1, §12.2 |
| Notes source vs chat-only flashcards | §10 knowledge profile includes note_search |
| Security under-specified | §7 |
| Breaking agent flashcards silent | §10.3 `agentModeTools` |
| Skill discovery only | §9.4 always-embed quality rules |
| Token bloat open-ended | `maxTotalChars` default 24_000 |
