# ADR 0103: One knowledge space with frozen content identity

| Field | Value |
|-------|-------|
| Status | **Accepted — stages 0–7 candidate (2026-11-04)** (owner decision 2026-11-03: rebuild the knowledge center as a knowledge workspace). Stage 7 verification: [`plans/2026-11-04-knowledge-space-stage-7-acceptance.zh.md`](../plans/2026-11-04-knowledge-space-stage-7-acceptance.zh.md) |
| Date | 2026-11-03 |
| Scope | `@piwin/contracts`, `@piwin/host-runtime`, `apps/desktop` |
| Amends | — (extends [0024](./0024-unified-knowledge-base.md) / the unified knowledge base spec) |
| Related | [0003](./0003-dual-mode-host.md) (run/session ownership the reading assistant reuses), [0019](./0019-permission-policy.md), [0086](./0086-cli-tui-on-remote-protocol.md) |
| Spec | [`specs/2026-11-02-knowledge-product-integration.md`](../specs/2026-11-02-knowledge-product-integration.md) |
| Plan | [`plans/2026-11-03-knowledge-space-redesign-plan.zh.md`](../plans/2026-11-03-knowledge-space-redesign-plan.zh.md) |

## Context

The knowledge center shipped as two tabs (Wiki, Flashcards) plus a source
drawer. Everything technical — registry, chunks, index state, connection
tests — sat in the same surface as reading, so a user could not browse their
own material: an unindexed folder was listed as "未入库" with no way to read
it, the wiki showed four sample concepts whenever the Host had none, and the
page reported pseudo-metrics (`0.87s`, `100%`, "已交叉校验", "向量索引校验")
that no Host read backed.

The product owner asked for a knowledge workspace that can be used daily:
browse material, read it, ask an AI while reading, and carry a selection into
a normal session. The visual reference is a study site (neutral panels,
compact grouped rail, one accent), not a technical console.

Stages 0–7 of the redesign plan are in tree: protocol and shell, materials
library, selection + independent assist, wiki create/update/distill drafts,
native flashcard drafts with topic tags, unified search and index status.
Collections remain read-only membership. Mobile has no full reader. The `@`
menu still has no knowledge items.

## Decision

1. **Identity is separate from title, and it is frozen now.** `KnowledgeContentId`
   (`knowledge-workspace.ts`) is a discriminated union over `notes` (`noteId`),
   `material` (`baseId` + `relativePath`), `wiki` (`relativePath`) and `card`
   (`itemId`). The existing `folderKey` / `documentId` / `noteId` / wiki path /
   `itemId` stay the only identities; no per-section entity is generated.
2. **Wiki pages use their relative path as identity for now.** The wiki store
   has no stable page id. A stable page id arrives with the wiki revision work;
   this ADR records that migration instead of inventing an id nothing produces.
3. **Collections are Host data, counts are derived.** `~/.piwin/knowledge/collections.json`
   (`version: 1`) holds id, name, timestamps and membership. Counts are
   computed on read, so a stale count can never outlive the membership it
   describes. A missing file is an empty set; a corrupt file is an error and is
   never overwritten with an empty document — collections are user data, not
   rebuildable index data. Unknown member kinds written by a newer Host are
   dropped from the read view rather than failing the listing.
4. **`knowledge/collections/list` is read-only in this change.** Stage 0 freezes
   the on-disk shape so the membership writer added with the materials library
   never has to migrate. There is deliberately no create/edit command yet.
5. **A new capability, not a wider one.** `capabilities.knowledgeWorkspace`
   (contracts + remote protocol) marks collections. A Host without it keeps its
   wiki and flashcards; only the collections block reports "this Host version
   does not store collections yet". One missing capability never seals the
   workspace.
6. **Section ids stay client-side.** `'overview' | 'materials' | 'wiki' | 'flashcards'`
   and the legacy-entry mapping live in `apps/desktop/src/knowledge/workspace/knowledge-workspace-sections.ts`,
   unit tested, because they describe navigation and not Host authority.
7. **Legacy entries keep their meaning.** `documents` meant "wiki with the
   source drawer open", which was the materials list, so it now opens the
   materials library; an explicit `initialFolderPath` does the same; a plain
   entry opens the overview. Old links never land on an empty surface.
8. **Every number on the overview is a Host read.** Materials, knowledge pages
   and due cards come from `knowledge/bases/list`, `knowledge/wiki/overview`
   and `flashcards/study/catalog`. A block the Host cannot answer renders as
   unavailable with the Host's error, never as a placeholder.
9. **Sample content is opt-in.** The wiki's starter concepts are read-only
   teaching pages behind an explicit "查看示例" action; an empty wiki shows a
   real empty state, and sample pages are never counted as the user's content.
10. **No fabricated verification.** "已交叉校验", "向量索引校验", `0.87s` and
    `100%` are removed. The wiki provenance block states that a page's own path
    is not evidence and points at the sources instead.
11. **Style stays local.** `styles/region-knowledge-workspace.css` maps the
    study-site look onto existing piwin tokens (`--surface-*`, `--text-*`,
    `--line-*`, `--iris`) so light, dark and the other themes keep working
    without a per-component palette and without touching the app theme.

12. **Browsing reads the filesystem, never the index.** `knowledge/documents/list`
    walks the registered folder with the existing scanner and attaches
    `indexed` / `chunkCount` per document. A folder registered seconds ago
    lists and reads; "not indexed" only removes the search badge. This is the
    fix for the shipped behaviour where an unindexed folder was a dead row
    labelled "未入库".
13. **Reads are bounded windows, and the client is told the bound.**
    `knowledge/document/read` returns `startLine` / `endLine` / `totalLines` /
    `hasMore` / `truncatedChars`. The reader never claims full text; it says
    which line it reached and offers to continue. Formats without a text
    reader (PDF/Office without parsers) stay listed with
    `readability: 'unsupported'` and a reason, instead of returning binary
    noise.
14. **Deletion and traversal stay different errors.** Existence is checked
    before `isPathConfined`, so a deleted document reports "not found" while a
    symlink escaping the folder still fails as a path-escape.
15. **`capabilities.knowledgeDocuments` gates the reader.** A Host without it
    keeps the source-card list; the client degrades instead of calling a
    command the Host does not know.
16. **Client state is the library, not a route.** The selected source and the
    open document live in the workspace shell; Escape leaves the reader first
    and the workspace second, and switching sections closes the reader so a
    stale document never reappears.

## Consequences

- Material browsing now exists at the **source** level (registered folders,
  real index state, readable before indexing). Per-document paging and bounded
  document reads are stage 2; until then the section groups by source and does
  not claim a document list it cannot page.
- The top search box is rendered only for the sections whose list it actually
  filters (materials, knowledge pages). A single cross-type search over
  materials, wiki and cards arrives with stage 6; a box that silently did
  nothing on the other sections would be the same class of pseudo-affordance
  this change removes.
- Reading position ("继续阅读"), the reading assistant and selection actions are
  absent rather than stubbed. The overview offers review, recent pages,
  collections and adding material — all of which are real today.
- `WikiCopilotPane` still shows a fixed derived-card sample. It is a rendering
  prototype for the reading-assistant pane and is replaced in stage 3.
- `KnowledgeSourceHub` is no longer rendered by the app; its fabricated stat
  cells were removed here. Whether to delete the component is a stage 2
  decision (its search panel is still referenced by stage 6 work).
- `initialTab: 'documents'` and the `FlashcardsWorkspaceView` adapter stay.
  Removing them needs the CLI/Mobile entry audit from stage 7.

## Verification

- `packages/host-runtime/src/knowledge-collections.test.ts` — missing file is
  empty, corrupt file and unsupported version are errors, counts derive from
  membership (duplicates counted once), newest first.
- `packages/host-runtime/src/knowledge-workspace-baseline.test.ts` plus
  `knowledge-workspace.test-fixture.ts` — one isolated root with a Chinese
  long-form document, an unindexed folder, a registered-but-deleted folder, a
  wiki page and a basic + cloze card carrying a real source relation. Records
  today's behaviour, including the gap that an unscoped search narrows silently
  while an explicit scope reports `not-indexed` / `missing`.
- `apps/desktop/src/knowledge/workspace/knowledge-workspace-sections.test.ts` —
  section order and legacy-entry mapping.
- `apps/desktop/src/workspace-subpages/KnowledgeWorkspaceView.test.tsx` — plain
  entry opens the overview, real counts, no pseudo-metrics, materials states and
  filter, legacy `documents` → materials, wiki section keeps its drawer,
  recent-page navigation, flashcards → materials hand-off, old-Host and empty
  states, distil+produce, folder picker.
- `packages/host-runtime/src/knowledge-documents.test.ts` — list works with no
  index (and when the index itself throws), per-document index state, cursor
  paging, path filter, unknown base; reads span windows with real totals,
  refuse traversal, refuse non-text formats, and report a deleted file as
  missing.
- `apps/desktop/src/workspace-subpages/KnowledgeWorkspaceView.test.tsx` — the
  library lists documents, opens the reader, reads an unindexed document,
  keeps the read bounded with "keep reading", and falls back to source cards
  on a Host without the capability.
- `apps/desktop/e2e/knowledge-library.spec.ts` (Playwright, real browser +
  mock Host) — the library is reachable from the shipped sidebar, lists three
  documents, opens one the index has never seen, renders its lines with a
  progress bound, refuses to open a format with no text reader, and returns to
  the list.
- `pnpm test:architecture` green; `pnpm typecheck` green.
