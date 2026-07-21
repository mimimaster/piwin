# @piwin/memory

Cross-session memory store for piwin (CE-MEM-01..04).

## Layout

```text
~/.piwin/memory/
  global/<id>.md
  projects/<projectKey>/<id>.md
  daily/<YYYY-MM-DD>/<id>.md
  .overview-cache/<cache-key>.md
```

Each entry is Markdown with YAML-like frontmatter. Indexing uses a full directory
scan + simple substring/token search (no better-sqlite3 yet). Documented for a
later FTS upgrade via `memory-index.sqlite3`.

## Public API

`createMemoryStore` → list / read / search / write / update / delete / accept /
quotaSummary / buildOverview.

## Policy

- Ordinary entries (non-daily): quota **500 per scope** (global or project).
- Daily notes: unlimited under `daily/`.
- Path traversal under memory root is rejected.
- Confidence: `high` without `reviewedAt` and with quote length &lt; 5 is
  downgraded to `medium` on write/update/accept.

Apps must never import this package to touch FS; go through host IPC / tools.
